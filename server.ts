import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_API_ORIGIN = process.env.TARGET_API_ORIGIN?.trim() || 'https://nexusstudypww.pages.dev';

// ── FlareSolverr CF-bypass ────────────────────────────────
// FlareSolverr (https://github.com/FlareSolverr/FlareSolverr) ek headless
// browser service hai jo Cloudflare JS challenge solve karke cf_clearance
// cookie deta hai. Bina iske CDN 403 deta hai.
//
// Setup (ek baar):
//   docker run -d --name flaresolverr --restart unless-stopped \
//     -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
//
// Env: FLARESOLVERR_URL (default: http://localhost:8191/v1)
//      CF_CACHE_TTL_MIN  (default: 20, minutes)
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL?.trim() || 'http://localhost:8191/v1';
const CF_CACHE_TTL_MS  = parseInt(process.env.CF_CACHE_TTL_MIN || '20') * 60 * 1000;

interface CfEntry { clearance: string; userAgent: string; expiresAt: number; }
const _cfCache = new Map<string, CfEntry>();

function _cfDomain(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return url; }
}

/** Cached cf_clearance + User-Agent for this URL's domain, or null if stale/missing. */
function getCfEntry(url: string): CfEntry | null {
  const e = _cfCache.get(_cfDomain(url));
  return (e && Date.now() < e.expiresAt) ? e : null;
}

/** Ask FlareSolverr to solve the Cloudflare challenge for `url`.
 *  Returns true and caches the result on success. Fails silently (logs + returns false). */
async function solveCf(url: string): Promise<boolean> {
  const domain = _cfDomain(url);
  try {
    const resp = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
      signal: AbortSignal.timeout(80000),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => '');
      console.warn(`[cf-bypass] FlareSolverr HTTP ${resp.status} for ${domain}: ${msg.slice(0, 200)}`);
      return false;
    }
    const data: any = await resp.json();
    if (data?.status !== 'ok') {
      console.warn(`[cf-bypass] FlareSolverr couldn't solve ${domain}: ${data?.message}`);
      return false;
    }
    const cookies: any[] = data?.solution?.cookies || [];
    const userAgent: string = data?.solution?.userAgent || '';
    const clearanceCookie = cookies.find((c: any) => c.name === 'cf_clearance');
    if (!clearanceCookie || !userAgent) {
      console.warn(`[cf-bypass] FlareSolverr: no cf_clearance/UA for ${domain}`);
      return false;
    }
    _cfCache.set(domain, {
      clearance: clearanceCookie.value,
      userAgent,
      expiresAt: Date.now() + CF_CACHE_TTL_MS,
    });
    console.log(`[cf-bypass] ✅ cf_clearance cached for ${domain} (${CF_CACHE_TTL_MS / 60000} min)`);
    return true;
  } catch (e: any) {
    if (e?.cause?.code === 'ECONNREFUSED' || e?.name === 'TypeError') {
      console.warn(`[cf-bypass] FlareSolverr not reachable at \${FLARESOLVERR_URL} — 403s will persist until it runs.`);
    } else {
      console.warn(`[cf-bypass] solveCf(\${domain}) error: \${e?.message}`);
    }
    return false;
  }
}

// ── Nexus gateway ─────────────────────────────────────────
const NEXUS_PORT = process.env.NEXUS_PORT || '5055';
const GATEWAYS = [
  process.env.NEXUS_GATEWAY_PRIMARY || `http://127.0.0.1:${NEXUS_PORT}`,
  ...(process.env.NEXUS_GATEWAY_FALLBACK ? [process.env.NEXUS_GATEWAY_FALLBACK] : []),
];

let gatewayProcess: ChildProcess | null = null;

function startGatewayChild() {
  if (process.env.DISABLE_EMBEDDED_GATEWAY === 'true') return;
  const gatewayScript = path.resolve(__dirname, 'nexus-gateway.ts');
  console.log(`[server] Starting embedded nexus gateway on port ${NEXUS_PORT}...`);
  gatewayProcess = spawn('npx', ['tsx', gatewayScript], {
    cwd: __dirname,
    env: { ...process.env, NEXUS_PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gatewayProcess.stdout?.on('data', (d) => process.stdout.write(`[gateway] ${d}`));
  gatewayProcess.stderr?.on('data', (d) => process.stderr.write(`[gateway] ${d}`));
  gatewayProcess.on('exit', (code, signal) => {
    console.warn(`[server] Gateway exited (code=${code}, signal=${signal}). Restarting in 3s...`);
    gatewayProcess = null;
    setTimeout(startGatewayChild, 3000);
  });
}

function stopGatewayChild() {
  if (gatewayProcess && !gatewayProcess.killed) gatewayProcess.kill();
}
process.on('exit', stopGatewayChild);
process.on('SIGINT', () => { stopGatewayChild(); process.exit(0); });
process.on('SIGTERM', () => { stopGatewayChild(); process.exit(0); });

// ── ag cookie cache ───────────────────────────────────────
let agCache: { value: string; fetchedAt: number; cfPolicy?: string; cfSignature?: string; cfKeyPairId?: string } | null = null;
const AG_TTL = 23 * 60 * 60 * 1000;

async function fetchFreshAg(): Promise<string> {
  for (const gw of GATEWAYS) {
    try {
      const r = await fetch(`${gw}/cookie/refresh`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) continue;
      const j = await r.json() as any;
      if (j?.ag) return j.ag;
    } catch { /* try next */ }
  }
  return '';
}

async function getAg(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && agCache && (now - agCache.fetchedAt) < AG_TTL) return agCache.value;
  for (const gw of GATEWAYS) {
    try {
      const r = await fetch(`${gw}/cookie`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = await r.json() as any;
      if (j?.ag) {
        agCache = {
          value: j.ag,
          fetchedAt: now,
          cfPolicy: j.cfPolicy || '',
          cfSignature: j.cfSignature || '',
          cfKeyPairId: j.cfKeyPairId || '',
        };
        return j.ag;
      }
    } catch { /* try next */ }
  }
  return agCache?.value || '';
}

function buildCookieHeader(reqCookie: string, ag: string, cfClearance?: string): string {
  const withoutAg = reqCookie.split(';')
    .filter(c => !c.trim().startsWith('ag=') && !c.trim().startsWith('cf_clearance='))
    .join(';').trim();
  const parts = [withoutAg, ag ? `ag=${ag}` : '', cfClearance ? `cf_clearance=${cfClearance}` : '']
    .filter(Boolean);
  return parts.join('; ').replace(/^; |; $/g, '').replace(/; ; /g, '; ');
}

// ── BRANDING REPLACE ──────────────────────────────────────
function replaceBranding(text: string): string {
  return text
    .replace(/Learnxpw/g, 'GB STUDY')
    .replace(/PW Nexus/gi, 'GB STUDY')
    .replace(/PWNEXUS/gi, 'GB STUDY')
    .replace(/Nexus Study/gi, 'GB STUDY')
    .replace(/https:\/\/t\.me\/\+[A-Za-z0-9_-]+/g, 'https://t.me/GBFreestudy')
    .replace(/https:\/\/i\.ibb\.co\/V8CbjrG\/image\.png/g, 'https://i.ibb.co/Q3g9fGSt/1791541921524.png');
}

// ── /api/play — Cloudfront direct stream proxy ───────────
// FIX: MPD BaseURL is direct cloudfront — segments requested by
// Shaka/browser go through /api/play?url=<signed-cloudfront-url>
// We proxy them directly, injecting ag cookie (needed for pwnexus CDN
// auth). Also handle MPD rewrite: replace direct BaseURL with proxy path.
async function handlePlay(req: Request, res: Response, ag: string, retry = true): Promise<void> {
  const rawUrl = req.query.url as string;
  if (!rawUrl) { res.status(400).send('Missing url'); return; }

  // Decode — browser sometimes double-encodes %7E → ~
  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    if (targetUrl.includes('%25')) targetUrl = decodeURIComponent(targetUrl);
  } catch { targetUrl = rawUrl; }

  const cookieHeader = buildCookieHeader((req.headers['cookie'] as string) || '', ag);
  const rangeHeader = req.headers['range'];

  // CloudFront requests ke liye CF signed cookies inject karo
  let finalCookieHeader = cookieHeader;
  if (targetUrl.includes('cloudfront.net') && agCache?.cfPolicy) {
    const cfCookies = [
      cookieHeader,
      `CloudFront-Policy=${agCache.cfPolicy}`,
      `CloudFront-Signature=${agCache.cfSignature}`,
      `CloudFront-Key-Pair-Id=${agCache.cfKeyPairId}`,
    ].filter(Boolean).join('; ');
    finalCookieHeader = cfCookies;
    console.log('[play] Injecting CloudFront signed cookies');
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
    'Referer': `${TARGET_API_ORIGIN}/`,
    'Origin': TARGET_API_ORIGIN,
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    ...(finalCookieHeader ? { 'Cookie': finalCookieHeader } : {}),
    ...(rangeHeader ? { 'Range': rangeHeader } : {}),
  };

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30000),
    });

    // 403 = ag expired → refresh + retry once
    if (upstream.status === 403 && retry) {
      console.warn('[play] 403 from cloudfront — refreshing ag...');
      agCache = null;
      const freshAg = await fetchFreshAg();
      if (freshAg) { agCache = { value: freshAg, fetchedAt: Date.now() }; }
      return handlePlay(req, res, freshAg || ag, false);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const forwardHeaders = ['content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    for (const h of forwardHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    // MPD: rewrite BaseURL so segment requests go through our /api/play proxy
    // This ensures cloudfront signed-url params are preserved server-side
    if (contentType.includes('dash+xml') || targetUrl.endsWith('.mpd')) {
      const mpdText = await upstream.text();
      // Extract the signedUrl query params from the original mpd request url
      // and append them to each segment so cloudfront accepts them
      let urlObj: URL | null = null;
      try { urlObj = new URL(targetUrl); } catch { /* skip */ }
      const signedParams = urlObj ? urlObj.search : '';

      // Rewrite BaseURL: replace direct cloudfront base with our proxy endpoint
      // Segments like dash/480/1.mp4 become /api/play?url=<cf-base>dash/480/1.mp4<signed>
      const cfBase = mpdText.match(/<BaseURL>(https?:\/\/[^<]+)<\/BaseURL>/)?.[1] || '';
      let rewrittenMpd = mpdText;
      if (cfBase) {
        // Encode the base for use as query param
        const encodedBase = encodeURIComponent(cfBase);
        const encodedParams = encodeURIComponent(signedParams);
        // Replace <BaseURL> with our proxy that will reconstruct the full URL
        rewrittenMpd = mpdText.replace(
          /<BaseURL>https?:\/\/[^<]+<\/BaseURL>/g,
          `<BaseURL>/api/play?base=${encodedBase}&signed=${encodedParams}&path=</BaseURL>`
        );
      }
      res.setHeader('Content-Length', Buffer.byteLength(rewrittenMpd, 'utf8').toString());
      res.send(rewrittenMpd);
      return;
    }

    // Binary stream — pipe directly
    if (!upstream.body) { res.end(); return; }
    const reader = upstream.body.getReader();
    req.on('close', () => reader.cancel());
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          const canContinue = res.write(value);
          if (!canContinue) await new Promise<void>(resolve => res.once('drain', resolve));
        }
      } catch { if (!res.headersSent) res.status(500).end(); }
    };
    await pump();
  } catch (e: any) {
    console.error('[play] error:', e?.message);
    if (!res.headersSent) res.status(502).send('Stream error: ' + e?.message);
  }
}

// ── /api/play with base+signed+path params (segment proxy) ─
// When MPD BaseURL is rewritten to /api/play?base=...&signed=...&path=
// the player appends the segment path after "path=" giving us
// /api/play?base=<cf-base>&signed=<params>&path=dash/480/1.mp4
async function handleSegment(req: Request, res: Response, ag: string, retry = true): Promise<void> {
  const base = req.query.base as string;
  const signed = req.query.signed as string;
  const segPath = req.query.path as string;
  if (!base || !segPath) { res.status(400).send('Missing params'); return; }

  let decodedBase: string, decodedSigned: string;
  try {
    decodedBase = decodeURIComponent(base);
    decodedSigned = decodeURIComponent(signed || '');
  } catch { decodedBase = base; decodedSigned = signed || ''; }

  const targetUrl = `${decodedBase}${segPath}${decodedSigned}`;
  // Delegate to handlePlay with constructed URL
  req.query = { url: targetUrl };
  return handlePlay(req, res, ag, retry);
}

// ── Generic API proxy ─────────────────────────────────────
async function proxyApiRequest(
  req: Request,
  targetUrl: URL,
  ag: string,
  retryOn403 = true
): Promise<{ status: number; contentType: string; body: Buffer | string; setCookie?: string }> {
  const cfEntry = getCfEntry(targetUrl.toString());
  const cookieHeader = buildCookieHeader((req.headers['cookie'] as string) || '', ag, cfEntry?.clearance);
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': cfEntry?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${TARGET_API_ORIGIN}/`,
    'Origin': TARGET_API_ORIGIN,
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'] as string;

  const fetchOptions: RequestInit = { method: req.method, headers };
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    fetchOptions.body = JSON.stringify(req.body);
  }

  const response = await fetch(targetUrl.toString(), fetchOptions);
  const contentType = response.headers.get('content-type') || '';
  const setCookie = response.headers.get('set-cookie') || undefined;

  // 403 → 1st try FlareSolverr for cf_clearance, then refresh ag
  if (response.status === 403 && retryOn403) {
    console.warn(`[proxy] 403 — trying FlareSolverr cf-bypass for ${_cfDomain(targetUrl.toString())}...`);
    const solved = await solveCf(targetUrl.toString());
    agCache = null;
    const freshAg = await fetchFreshAg();
    if (freshAg) { agCache = { value: freshAg, fetchedAt: Date.now() }; }
    if (solved || freshAg) return proxyApiRequest(req, targetUrl, freshAg || ag, false);
    console.warn('[proxy] FlareSolverr not available and ag refresh failed — returning 403 as-is.');
  }

  if (contentType.includes('application/json') || contentType.includes('text/plain')) {
    let text = await response.text();
    const trimmed = text.trim();

    // Plain-text forbidden body (some CDNs return 200 + "Forbidden")
    if (trimmed === 'Forbidden' || trimmed === 'Unauthorized' || trimmed.startsWith('Access denied')) {
      if (retryOn403) {
        agCache = null;
        const freshAg = await fetchFreshAg();
        if (freshAg) {
          agCache = { value: freshAg, fetchedAt: Date.now() };
          return proxyApiRequest(req, targetUrl, freshAg, false);
        }
      }
      return {
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Session expired. Reconnecting...', code: 'UPSTREAM_FORBIDDEN' }),
        setCookie,
      };
    }

    text = replaceBranding(text);
    return { status: response.status, contentType: 'application/json', body: text, setCookie };
  }

  const buffer = await response.arrayBuffer();
  return { status: response.status, contentType, body: Buffer.from(buffer), setCookie };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // PDF proxy
  app.get('/proxy-pdf', async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing url');
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': `${TARGET_API_ORIGIN}/`,
        },
      });
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/pdf');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (e: any) { res.status(500).send(e?.message || 'PDF error'); }
  });

  // Gateway status
  app.get('/nexus/status', async (_req, res) => {
    for (const gw of GATEWAYS) {
      try {
        const r = await fetch(`${gw}/status`, { signal: AbortSignal.timeout(5000) });
        return res.json(await r.json());
      } catch { /* try next */ }
    }
    res.status(503).json({ status: 'gateway_unreachable' });
  });

  // ── /nexus/ag — expose current ag cookie for external curl use ──
  // Usage: AG=$(curl -s http://localhost:3000/nexus/ag | jq -r .ag)
  //        curl "http://localhost:3000/api/video-url?..." -H "Cookie: ag=$AG"
  app.get('/nexus/ag', async (_req, res) => {
    try {
      const ag = await getAg();
      if (!ag) {
        return res.status(503).json({ success: false, error: 'ag not yet available — gateway still warming up, retry in a few seconds' });
      }
      const ageMin = agCache ? Math.floor((Date.now() - agCache.fetchedAt) / 60000) : null;
      res.json({ success: true, ag, age_min: ageMin });
    } catch (e: any) {
      res.status(503).json({ success: false, error: e.message });
    }
  });

  // ── /nexus/ag/refresh — force-refresh ag cookie ──
  app.get('/nexus/ag/refresh', async (_req, res) => {
    try {
      agCache = null;
      const ag = await getAg(true);
      if (!ag) return res.status(503).json({ success: false, error: 'Bypass failed — check gateway logs' });
      res.json({ success: true, ag, refreshed: true });
    } catch (e: any) {
      res.status(503).json({ success: false, error: e.message });
    }
  });

  // CORS preflight for /api/play
  app.options('/api/play', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.status(204).end();
  });

  // /api/play — must be BEFORE generic /api/* handler
  app.get('/api/play', async (req: Request, res: Response) => {
    const ag = await getAg();
    // Segment proxy mode (base + signed + path params)
    if (req.query.base && req.query.path) {
      return handleSegment(req, res, ag);
    }
    return handlePlay(req, res, ag);
  });

  // ── /api/video-url — explicit handler ───────────────────────────────────
  // Frontend calls: /api/video-url?batch_id=...&subject_id=...&video_id=...
  // pwnexus CDN ka /api/video-url directly "Verification required" deta hai.
  // Fix: Schedule endpoint se URL nikalo, phir signedUrl construct karo.
  app.get('/api/video-url', async (req: Request, res: Response) => {
    const batchId   = (req.query.batch_id   as string) || '';
    const subjectId = (req.query.subject_id as string) || '';
    const videoId   = (req.query.video_id   as string) || '';

    if (!batchId || !subjectId || !videoId) {
      return res.status(400).json({ success: false, error: 'batch_id, subject_id, video_id required' });
    }

    try {
      const ag = await getAg();

      // 1st try: dedicated video-url endpoint on pwnexus CDN
      const directUrl = new URL(
        `/api/video-url?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&video_id=${encodeURIComponent(videoId)}`,
        TARGET_API_ORIGIN
      );
      const direct = await proxyApiRequest(req, directUrl, ag, true);
      const directData = typeof direct.body === 'string'
        ? (() => { try { return JSON.parse(direct.body as string); } catch { return null; } })()
        : null;

      if (direct.status === 200 && directData?.data?.url) {
        console.log(`[video-url] CDN direct hit OK for videoId=${videoId}`);
        const rawUrl = directData.data.url;
        // CloudFront direct URL browser se access nahi hota (MissingKey error)
        // /api/play proxy ke through bhejo — ag cookie server side inject hogi
        const proxyUrl = `/api/play?url=${encodeURIComponent(rawUrl)}`;
        return res.status(200).json({
          success: true,
          data: {
            url: proxyUrl,
            signedUrl: proxyUrl,
            urlType: directData.data.urlType || 'penpencilvdo',
          },
        });
      }

      // 2nd try: Schedule endpoint — carries the video URL inside the response
      const schedUrl = new URL(
        `/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(videoId)}`,
        TARGET_API_ORIGIN
      );
      const sched = await proxyApiRequest(req, schedUrl, ag, true);
      const schedData = typeof sched.body === 'string'
        ? (() => { try { return JSON.parse(sched.body as string); } catch { return null; } })()
        : null;

      if (schedData) {
        const item = schedData?.data?.data || schedData?.data || schedData;
        const rawUrl = item?.url || item?.videoDetails?.videoUrl || '';
        // signedUrl missing ho toh rawUrl se fallback — player dono same treat karta hai
        const signedUrl = item?.videoDetails?.signedUrl || item?.signedUrl || rawUrl;

        if (rawUrl) {
          console.log(`[video-url] Extracted from Schedule for videoId=${videoId}`);
          // CloudFront direct URL browser se access nahi hota — proxy karo
          const proxyUrl = `/api/play?url=${encodeURIComponent(rawUrl)}`;
          return res.status(200).json({
            success: true,
            data: { url: proxyUrl, signedUrl: proxyUrl, urlType: item?.urlType || 'penpencilvdo' },
          });
        }
      }

      // 3rd try: /api/content endpoint (some batches use this instead of Schedule)
      try {
        const contentUrl = new URL(
          `/api/content?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&content_id=${encodeURIComponent(videoId)}`,
          TARGET_API_ORIGIN
        );
        const content = await proxyApiRequest(req, contentUrl, ag, false);
        const contentData = typeof content.body === 'string'
          ? (() => { try { return JSON.parse(content.body as string); } catch { return null; } })()
          : null;

        if (contentData) {
          const item = contentData?.data?.data || contentData?.data || contentData;
          const rawUrl = item?.url || item?.videoUrl || item?.videoDetails?.videoUrl || '';
          const signedUrl = item?.videoDetails?.signedUrl || item?.signedUrl || rawUrl;

          if (rawUrl) {
            console.log(`[video-url] Extracted from /api/content for videoId=${videoId}`);
            const proxyUrl = `/api/play?url=${encodeURIComponent(rawUrl)}`;
            return res.status(200).json({
              success: true,
              data: { url: proxyUrl, signedUrl: proxyUrl, urlType: item?.urlType || 'penpencilvdo' },
            });
          }
        }
      } catch (e3: any) {
        console.warn(`[video-url] 3rd try /api/content failed: ${e3?.message}`);
      }

      // Nothing found
      console.warn(`[video-url] Could not extract URL for videoId=${videoId}`);
      return res.status(404).json({
        success: false,
        error: 'Video URL not found',
        debug: { schedStatus: sched.status, directStatus: direct.status },
      });

    } catch (err: any) {
      console.error('[video-url] error:', err?.message);
      res.status(502).json({ success: false, error: err?.message || 'Proxy error' });
    }
  });

  // /api/* — generic proxy to pwnexus
  app.use('/api', async (req: Request, res: Response) => {
    try {
      const targetUrl = new URL(req.originalUrl, TARGET_API_ORIGIN);
      const ag = await getAg();
      const result = await proxyApiRequest(req, targetUrl, ag);
      res.status(result.status);
      if (result.setCookie) res.setHeader('set-cookie', result.setCookie.replace(/Domain=[^;]+;?/gi, ''));
      if (result.contentType) res.setHeader('Content-Type', result.contentType);
      return res.send(result.body);
    } catch (err: any) {
      console.error('API Proxy Error:', err?.message || err);
      res.status(502).json({ success: false, message: 'Proxy error', error: String(err?.message || err) });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.resolve(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GB STUDY server running at http://0.0.0.0:${PORT}`);
    console.log(`Mode: ${isProd ? 'production' : 'development'}`);
    console.log(`Nexus gateway: ${GATEWAYS[0]}`);
  });

  startGatewayChild();
}

startServer().catch((err) => { console.error('Failed to start server:', err); process.exit(1); });
