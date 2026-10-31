import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// TARGET = nexus CDN for API calls (JSON responses)
// CloudFront is fetched DIRECTLY by server — never through nexus again
// Auto-resolves from DNS — no hardcoded IPs needed
const TARGET_CANDIDATES = [
  process.env.TARGET_API_ORIGIN?.trim(),
  'https://nexusstudypww.pages.dev',
  'https://nexusstudypww.netlify.app',
].filter(Boolean) as string[];

let TARGET_API_ORIGIN = TARGET_CANDIDATES[0];

async function resolveTargetOrigin(): Promise<void> {
  const { default: dns } = await import('dns');
  for (const candidate of TARGET_CANDIDATES) {
    const domain = new URL(candidate).hostname;
    const ok = await new Promise<boolean>(resolve => {
      dns.resolve4(domain, (err: any, addrs: string[]) => resolve(!err && addrs.length > 0));
    });
    if (ok) {
      TARGET_API_ORIGIN = candidate;
      console.log(`[server] TARGET_API_ORIGIN resolved: ${candidate}`);
      return;
    }
    console.warn(`[server] ${domain} DNS failed — trying next`);
  }
  console.warn('[server] All TARGET candidates failed DNS — using default');
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
let agCache: { value: string; fetchedAt: number } | null = null;
const AG_TTL = 23 * 60 * 60 * 1000;

// FIX G3: mutex — concurrent getAg() calls ek hi refresh trigger na karein
// Bina is ke multiple 403s ek saath aane par 3-4 parallel bypass attempts shuru ho jaate hain
let _agRefreshPromise: Promise<string> | null = null;

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

async function _doGetAg(forceRefresh: boolean): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && agCache && (now - agCache.fetchedAt) < AG_TTL) return agCache.value;
  for (const gw of GATEWAYS) {
    try {
      const r = await fetch(`${gw}/cookie`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = await r.json() as any;
      if (j?.ag) { agCache = { value: j.ag, fetchedAt: now }; return j.ag; }
    } catch { /* try next */ }
  }
  return agCache?.value || '';
}

async function getAg(forceRefresh = false): Promise<string> {
  // FIX G3: agar already ek refresh chal rahi hai to same promise return karo
  if (forceRefresh || !agCache) {
    if (!_agRefreshPromise) {
      _agRefreshPromise = _doGetAg(forceRefresh).finally(() => { _agRefreshPromise = null; });
    }
    return _agRefreshPromise;
  }
  return _doGetAg(false);
}

function buildCookieHeader(reqCookie: string, ag: string): string {
  const withoutAg = reqCookie.split(';').filter(c => !c.trim().startsWith('ag=')).join(';').trim();
  if (!ag) return withoutAg;
  return withoutAg ? `${withoutAg}; ag=${ag}` : `ag=${ag}`;
}

function replaceBranding(text: string): string {
  return text
    .replace(/Learnxpw/g, 'GB STUDY')
    .replace(/PW Nexus/gi, 'GB STUDY')
    .replace(/PWNEXUS/gi, 'GB STUDY')
    .replace(/Nexus Study/gi, 'GB STUDY')
    .replace(/https:\/\/t\.me\/\+[A-Za-z0-9_-]+/g, 'https://t.me/GBFreestudy')
    .replace(/https:\/\/i\.ibb\.co\/V8CbjrG\/image\.png/g, 'https://i.ibb.co/Q3g9fGSt/1791541921524.png');
}

// ── /api/play — CloudFront DIRECT stream proxy ───────────
// CRITICAL FIX: CloudFront URL seedha fetch karo — NEVER through nexus again.
// Old bug: server CloudFront URL ko TARGET_API_ORIGIN/api/play?url=... ke
// through route karta tha → double proxy → Shaka Error 1001 (network failure).
async function handlePlay(req: Request, res: Response, ag: string, retry = true): Promise<void> {
  const rawUrl = req.query.url as string;
  if (!rawUrl) { res.status(400).send('Missing url'); return; }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    if (targetUrl.includes('%25')) targetUrl = decodeURIComponent(targetUrl);
  } catch { targetUrl = rawUrl; }

  // CRITICAL: CloudFront URL DIRECTLY fetch karo — no double proxy
  const cookieHeader = buildCookieHeader((req.headers['cookie'] as string) || '', ag);
  const rangeHeader = req.headers['range'] as string | undefined;

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
    'Referer': `${TARGET_API_ORIGIN}/`,
    'Origin': TARGET_API_ORIGIN,
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    ...(rangeHeader ? { 'Range': rangeHeader } : {}),
  };

  // FIX 1: CORS preflight — Shaka sends OPTIONS before Range requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30000),
    });

    if (upstream.status === 403 && retry) {
      console.warn('[play] 403 — refreshing ag and retrying...');
      agCache = null;
      const freshAg = await fetchFreshAg();
      if (freshAg) agCache = { value: freshAg, fetchedAt: Date.now() };
      return handlePlay(req, res, freshAg || ag, false);
    }

    // FIX 2: Always set correct content-type — CloudFront kabhi kabhi omit karta hai
    let contentType = upstream.headers.get('content-type') || '';
    if (!contentType) {
      if (targetUrl.includes('.mpd') || targetUrl.includes('master.mpd')) {
        contentType = 'application/dash+xml';
      } else if (targetUrl.includes('init.mp4')) {
        contentType = 'video/mp4';
      } else if (targetUrl.match(/\.(mp4|m4s|m4a)(\?|$)/)) {
        contentType = 'video/mp4';
      } else {
        contentType = 'application/octet-stream';
      }
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);

    // FIX 3: Full CORS headers — Shaka needs these for Range requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // FIX 4: Forward all important headers — Shaka Range probe depends on accept-ranges
    const forwardHeaders = [
      'content-length', 'content-range', 'accept-ranges',
      'cache-control', 'last-modified', 'etag', 'expires',
    ];
    for (const h of forwardHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    // FIX 5: Always declare accept-ranges so Shaka knows server supports Range
    if (!upstream.headers.get('accept-ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    // MPD: rewrite BaseURL so segments come through /api/play proxy
    if (contentType.includes('dash+xml') || targetUrl.includes('.mpd')) {
      const mpdText = await upstream.text();

      let urlObj: URL | null = null;
      try { urlObj = new URL(targetUrl); } catch { /* skip */ }
      const signedParams = urlObj ? urlObj.search : '';

      // FIX 6: Rewrite ALL BaseURL occurrences (HAR showed multiple per MPD)
      const cfBaseMatch = mpdText.match(/<BaseURL>(https?:\/\/[^<]+)<\/BaseURL>/);
      const cfBase = cfBaseMatch?.[1] || '';

      let rewrittenMpd = mpdText;
      if (cfBase) {
        // Extract just the base path (before any query params)
        let cleanBase = cfBase;
        try { cleanBase = new URL(cfBase).origin + new URL(cfBase).pathname; } catch {}
        const encodedBase = encodeURIComponent(cleanBase);
        const encodedParams = encodeURIComponent(signedParams);
        rewrittenMpd = mpdText.replace(
          /<BaseURL>https?:\/\/[^<]+<\/BaseURL>/g,
          `<BaseURL>/api/play?base=${encodedBase}&signed=${encodedParams}&path=</BaseURL>`
        );
        console.log(`[play] MPD rewritten. cfBase=${cleanBase.slice(0, 60)} signedParams=${signedParams.slice(0, 40)}`);
      } else {
        console.warn('[play] MPD: no BaseURL found — segments may fail');
      }

      res.removeHeader('content-length');
      const buf = Buffer.from(rewrittenMpd, 'utf8');
      res.setHeader('Content-Length', buf.byteLength.toString());
      res.setHeader('Content-Type', 'application/dash+xml');
      res.end(buf);
      return;
    }

    // FIX 7: HEAD request — no body needed (Shaka probe)
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    // Binary stream — pipe directly (segments, init.mp4, etc.)
    if (!upstream.body) { res.end(); return; }
    const reader = upstream.body.getReader();
    let cancelled = false;
    req.on('close', () => { cancelled = true; reader.cancel().catch(() => {}); });
    while (!cancelled) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      const canContinue = res.write(value);
      if (!canContinue) await new Promise<void>(resolve => res.once('drain', resolve));
    }
  } catch (e: any) {
    console.error('[play] fetch error:', e?.message);
    if (!res.headersSent) res.status(502).send('Stream error: ' + e?.message);
  }
}

// ── Segment proxy (from rewritten MPD BaseURL) ────────────
// URL format: /api/play?base=<encoded_cfBase>&signed=<encoded_params>&path=dash/480/1.mp4
// HAR confirmed: segments use: cfBase + segPath + signedQuery
// e.g. https://d1d34p8...cloudfront.net/UUID/dash/480/1.mp4?start=...&Signature=...
async function handleSegment(req: Request, res: Response, ag: string): Promise<void> {
  const base    = req.query.base   as string;
  const signed  = req.query.signed as string;
  const segPath = req.query.path   as string;
  if (!base || !segPath) { res.status(400).send('Missing params'); return; }

  let decodedBase: string, decodedSigned: string;
  try {
    decodedBase   = decodeURIComponent(base);
    decodedSigned = decodeURIComponent(signed || '');
  } catch { decodedBase = base; decodedSigned = signed || ''; }

  // FIX: signed params already start with '?' — don't double-add
  // decodedBase ends with '/', segPath is like 'dash/480/1.mp4'
  // decodedSigned is like '?start=...&Signature=...'
  const cleanBase = decodedBase.endsWith('/') ? decodedBase : `${decodedBase}/`;
  const fullUrl = `${cleanBase}${segPath}${decodedSigned}`;
  console.log(`[segment] → ${fullUrl.slice(0, 100)}`);
  req.query = { url: encodeURIComponent(fullUrl) };
  return handlePlay(req, res, ag);
}

// ── Generic API proxy ─────────────────────────────────────
async function proxyApiRequest(
  req: Request,
  targetUrl: URL,
  ag: string,
  retryOn403 = true
): Promise<{ status: number; contentType: string; body: Buffer | string; setCookie?: string }> {
  const cookieHeader = buildCookieHeader((req.headers['cookie'] as string) || '', ag);
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${TARGET_API_ORIGIN}/`,
    'Origin': TARGET_API_ORIGIN,
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'] as string;

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
    // FIX S3: timeout add kiya — bina iske slow upstream indefinitely hang karta hai
    signal: AbortSignal.timeout(25000),
  };
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    fetchOptions.body = JSON.stringify(req.body);
  }

  const response = await fetch(targetUrl.toString(), fetchOptions);
  const contentType = response.headers.get('content-type') || '';
  const setCookie = response.headers.get('set-cookie') || undefined;

  if (response.status === 403 && retryOn403) {
    console.warn('[proxy] 403 — refreshing ag...');
    agCache = null;
    const freshAg = await fetchFreshAg();
    if (freshAg) { agCache = { value: freshAg, fetchedAt: Date.now() }; }
    return proxyApiRequest(req, targetUrl, freshAg || ag, false);
  }

  if (contentType.includes('application/json') || contentType.includes('text/plain')) {
    let text = await response.text();
    const trimmed = text.trim();
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
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `${TARGET_API_ORIGIN}/` },
      });
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/pdf');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (e: any) { res.status(500).send(e?.message || 'PDF error'); }
  });

  // Gateway status + ag endpoints
  app.get('/nexus/status', async (_req, res) => {
    for (const gw of GATEWAYS) {
      try { const r = await fetch(`${gw}/status`, { signal: AbortSignal.timeout(5000) }); return res.json(await r.json()); }
      catch { /* try next */ }
    }
    res.status(503).json({ status: 'gateway_unreachable' });
  });

  app.get('/nexus/ag', async (_req, res) => {
    const ag = await getAg();
    if (!ag) return res.status(503).json({ success: false, error: 'ag not ready' });
    res.json({ success: true, ag, age_min: agCache ? Math.floor((Date.now() - agCache.fetchedAt) / 60000) : null });
  });

  app.get('/nexus/ag/refresh', async (_req, res) => {
    agCache = null;
    const ag = await getAg(true);
    if (!ag) return res.status(503).json({ success: false, error: 'Refresh failed' });
    res.json({ success: true, ag, refreshed: true });
  });

  // CORS preflight — Shaka sends OPTIONS before Range requests
  app.options('/api/play', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
  });

  // HEAD support for Shaka range probe
  app.head('/api/play', async (req: Request, res: Response) => {
    const ag = await getAg();
    return handlePlay(req, res, ag);
  });

  // /api/play — BEFORE generic /api/*
  app.get('/api/play', async (req: Request, res: Response) => {
    const ag = await getAg();
    if (req.query.base && req.query.path) return handleSegment(req, res, ag);
    return handlePlay(req, res, ag);
  });

  // /api/video-url — explicit handler
  // HAR confirmed: video-url returns url + signedUrl separately
  // Combined: url + signedUrl = full cloudfront MPD URL with signed params
  app.get('/api/video-url', async (req: Request, res: Response) => {
    const batchId   = (req.query.batch_id   as string) || '';
    const subjectId = (req.query.subject_id as string) || '';
    const videoId   = (req.query.video_id   as string) || '';

    if (!batchId || !subjectId || !videoId) {
      return res.status(400).json({ success: false, error: 'batch_id, subject_id, video_id required' });
    }

    try {
      const ag = await getAg();

      // Try 1: dedicated video-url endpoint
      const directUrl = new URL(
        `/api/video-url?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&video_id=${encodeURIComponent(videoId)}`,
        TARGET_API_ORIGIN
      );
      const direct = await proxyApiRequest(req, directUrl, ag, true);
      const directData = (() => { try { return JSON.parse(direct.body as string); } catch { return null; } })();

      if (direct.status === 200 && directData?.data?.url) {
        const cfUrl    = directData.data.url;         // e.g. https://d1d34p8...cloudfront.net/UUID/master.mpd
        const signedUrl = directData.data.signedUrl || ''; // e.g. ?start=...&Signature=...

        // FIX: combine url + signedUrl to get full signed cloudfront URL
        // Then wrap in /api/play?url=... so server proxies it with ag cookie
        const fullCfUrl = cfUrl.includes('?') ? cfUrl : `${cfUrl}${signedUrl}`;
        const proxyMpdUrl = `/api/play?url=${encodeURIComponent(fullCfUrl)}`;

        return res.status(200).json({
          success: true,
          data: {
            url: proxyMpdUrl,
            signedUrl: proxyMpdUrl,
            urlType: directData.data.urlType || 'penpencilvdo',
            videoContainer: directData.data.videoContainer || 'DASH',
          },
        });
      }

      // Try 2: Schedule endpoint fallback
      const schedUrl = new URL(
        `/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(videoId)}`,
        TARGET_API_ORIGIN
      );
      const sched = await proxyApiRequest(req, schedUrl, ag, true);
      const schedData = (() => { try { return JSON.parse(sched.body as string); } catch { return null; } })();
      const item = schedData?.data?.data || schedData?.data || schedData;
      const rawUrl = item?.url || item?.videoDetails?.videoUrl || '';

      if (rawUrl) {
        const proxyMpdUrl = `/api/play?url=${encodeURIComponent(rawUrl)}`;
        return res.status(200).json({
          success: true,
          data: { url: proxyMpdUrl, signedUrl: proxyMpdUrl, urlType: item?.urlType || 'penpencilvdo' },
        });
      }

      return res.status(404).json({ success: false, error: 'Video URL not found' });
    } catch (err: any) {
      res.status(502).json({ success: false, error: err?.message || 'Proxy error' });
    }
  });

  // /api/* generic proxy
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
  });

  startGatewayChild();
}

resolveTargetOrigin().then(() => startServer()).catch((err) => { console.error('Failed to start server:', err); process.exit(1); });
