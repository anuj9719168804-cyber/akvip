import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { spawn, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_API_ORIGIN = 'https://s2-cdn.pwnexus.eu.cc';

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
      if (j?.ag) { agCache = { value: j.ag, fetchedAt: now }; return j.ag; }
    } catch { /* try next */ }
  }
  return agCache?.value || '';
}

function buildCookieHeader(reqCookie: string, ag: string): string {
  const withoutAg = reqCookie.split(';').filter(c => !c.trim().startsWith('ag=')).join(';').trim();
  if (!ag) return withoutAg;
  return withoutAg ? `${withoutAg}; ag=${ag}` : `ag=${ag}`;
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

  const upstreamHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
    'Referer': `${TARGET_API_ORIGIN}/`,
    'Origin': TARGET_API_ORIGIN,
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
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
  const cookieHeader = buildCookieHeader((req.headers['cookie'] as string) || '', ag);
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

  // 403 → refresh + retry once
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
