import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_API_ORIGIN = 'https://s2-cdn.pwnexus.eu.cc';

// ── Nexus gateway (ag cookie) ─────────────────────────────
const GATEWAYS = [
  process.env.NEXUS_GATEWAY_PRIMARY || 'http://127.0.0.1:5055',
  ...(process.env.NEXUS_GATEWAY_FALLBACK ? [process.env.NEXUS_GATEWAY_FALLBACK] : []),
];

let agCache: { value: string; fetchedAt: number } | null = null;
const AG_TTL = 23 * 60 * 60 * 1000; // 23h

async function getAg(): Promise<string> {
  const now = Date.now();
  if (agCache && (now - agCache.fetchedAt) < AG_TTL) return agCache.value;
  for (const gw of GATEWAYS) {
    try {
      const r = await fetch(`${gw}/cookie`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const j = await r.json() as any;
      if (j?.ag) { agCache = { value: j.ag, fetchedAt: now }; return j.ag; }
    } catch { /* try next */ }
  }
  return agCache?.value || '';
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // PDF direct proxy to prevent any browser CORS/canvas blocks
  app.get('/proxy-pdf', async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing url parameter');
    try {
      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': `${TARGET_API_ORIGIN}/`,
        },
      });
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/pdf');
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      res.status(500).send(e?.message || 'Error streaming PDF');
    }
  });

  // Proxy /api/* to previous server
  app.use('/api', async (req: Request, res: Response) => {
    try {
      const targetUrl = new URL(req.originalUrl, TARGET_API_ORIGIN);

      // Inject ag cookie
      const ag = await getAg();
      const existingCookie = (req.headers['cookie'] as string) || '';
      const withoutAg = existingCookie.split(';').filter(c => !c.trim().startsWith('ag=')).join(';').trim();
      const cookieHeader = ag ? (withoutAg ? `${withoutAg}; ag=${ag}` : `ag=${ag}`) : withoutAg;

      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${TARGET_API_ORIGIN}/`,
        'Origin': TARGET_API_ORIGIN,
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      };

      if (req.headers['content-type']) {
        headers['content-type'] = req.headers['content-type'] as string;
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
      };

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl.toString(), fetchOptions);
      const contentType = response.headers.get('content-type') || '';

      res.status(response.status);

      // Forward set-cookie (strip Domain so browser accepts it)
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) res.setHeader('set-cookie', setCookie.replace(/Domain=[^;]+;?/gi, ''));

      if (contentType.includes('application/json')) {
        let text = await response.text();
        // Replace branding and links in API responses
        text = text
          .replace(/Learnxpw/g, 'GB STUDY')
          .replace(/PW Nexus/gi, 'GB STUDY')
          .replace(/PWNEXUS/gi, 'GB STUDY')
          .replace(/https:\/\/t\.me\/\+[A-Za-z0-9_-]+/g, 'https://t.me/GBFreestudy')
          .replace(/https:\/\/i\.ibb\.co\/V8CbjrG\/image\.png/g, 'https://i.ibb.co/Q3g9fGSt/1791541921524.png');
        res.setHeader('Content-Type', 'application/json');
        return res.send(text);
      } else {
        const buffer = await response.arrayBuffer();
        if (contentType) res.setHeader('Content-Type', contentType);
        return res.send(Buffer.from(buffer));
      }
    } catch (err: any) {
      console.error('API Proxy Error:', err?.message || err);
      res.status(502).json({
        success: false,
        message: 'Proxy error reaching upstream service',
        error: String(err?.message || err),
      });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GB STUDY server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
