import express from 'express';
import https from 'https';
import http from 'http';
import { URLSearchParams } from 'url';
import * as zlib from 'zlib';

const app = express();
const PORT = process.env.NEXUS_PORT ? parseInt(process.env.NEXUS_PORT, 10) : 5055;

// ── Config ────────────────────────────────────────────────
const BASE_URL   = 'https://nexusstudypww.pages.dev';
const NEXT_PATH  = '/study/batches/69897f0a4c12aeb013d4ea52/subjects/physical-chemistry-435878/subject-topics/some-basic-concept-of-chemistry-271949?batchSubjectId=699e917179cd976a1e1ff2df&subjectId=5fa000977d57900119ba29db&chapterId=69dde15c0371965a91014a4d';
const AG_TTL     = 23 * 60 * 60 * 1000; // 23h

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const BASE_HEADERS: Record<string, string> = {
  'user-agent': UA,
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9',
  'accept-encoding': 'gzip, deflate',
  'upgrade-insecure-requests': '1',
};

let agCache: { value: string; fetchedAt: number } | null = null;

// ── HTTP helper ────────────────────────────────────────────
interface Resp {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  url: string;
}

function doRequest(url: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  timeout?: number;
}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body, followRedirects = false, maxRedirects = 0, timeout = 15000 } = opts;
    let redirectCount = 0;

    function go(reqUrl: string, cookieJar: Record<string, string>) {
      const parsed = new URL(reqUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const reqHeaders: Record<string, string> = { ...headers };
      // Inject cookies
      const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookieStr) reqHeaders['cookie'] = cookieStr;

      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout,
      }, (res) => {
        // Parse Set-Cookie
        const setCookies = res.headers['set-cookie'] || [];
        for (const sc of setCookies) {
          const pair = sc.split(';')[0];
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
          }
        }

        const loc = res.headers['location'] as string;
        if (followRedirects && loc && redirectCount < maxRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          redirectCount++;
          const nextUrl = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
          go(nextUrl, cookieJar);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const enc = res.headers['content-encoding'] || '';
          let text = '';
          try {
            if (enc.includes('gzip')) text = zlib.gunzipSync(raw).toString('utf8');
            else if (enc.includes('deflate')) text = zlib.inflateSync(raw).toString('utf8');
            else text = raw.toString('utf8');
          } catch { text = raw.toString('utf8'); }

          const flatHeaders: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v) flatHeaders[k] = v as string | string[];
          }

          resolve({
            status: res.statusCode || 0,
            headers: flatHeaders,
            body: text,
            url: reqUrl,
          });
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${reqUrl}`)); });
      if (body) req.write(body);
      req.end();
    }

    go(url, {});
  });
}

// ── Extract JS redirect URLs from HTML ───────────────────
function extractJsRedirect(html: string): string | null {
  const patterns = [
    /window\.location\.href\s*=\s*['"]([^'"]+)['"]/,
    /window\.location\s*=\s*['"]([^'"]+)['"]/,
    /window\.location\.(?:assign|replace)\(['"]([^'"]+)['"]\)/,
    /<meta[^>]+http-equiv=['"]?refresh['"]?[^>]+content=['"][^'"]*?url=([^\s'">;]+)/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) return m[1];
  }
  return null;
}

// ── Arolinks bypass — full flow ───────────────────────────
async function bypassOnce(nextPath: string): Promise<string | null> {
  const cookieJar: Record<string, string> = {};
  const nexusDomain = 'nexusstudypww.pages.dev';
  const arolinksDomain = 'arolinks.com';
  const pipefitterDomain = 'pipefitter.in';

  function setCookie(name: string, value: string, domain: string) {
    cookieJar[name] = value; // global jar (simple approach)
  }

  function getCookieHeader(extras?: Record<string, string>): string {
    const all = { ...cookieJar, ...(extras || {}) };
    return Object.entries(all).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // STEP 1: Get agt cookie
  const gateUrl = `${BASE_URL}/__gate/go?next=${encodeURIComponent(nextPath)}`;
  const r1 = await doRequest(gateUrl, {
    method: 'GET',
    headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/__gate/start?next=${encodeURIComponent(nextPath)}`, 'sec-fetch-site': 'same-origin' },
    followRedirects: false,
  });

  if (r1.status < 300 || r1.status > 308) { console.warn('[bypass] Step1 unexpected status:', r1.status); return null; }

  // Parse cookies from r1
  const sc1 = (r1.headers['set-cookie'] || []) as string[];
  for (const sc of (Array.isArray(sc1) ? sc1 : [sc1])) {
    const [pair] = sc.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
  }

  const agt = cookieJar['agt'];
  const arolinksUrl = r1.headers['location'] as string;
  if (!agt || !arolinksUrl) { console.warn('[bypass] Step1 missing agt or location'); return null; }
  console.log(`[bypass] agt: ${agt.slice(0, 40)}...`);

  // STEP 1b: AppSession warm-up
  const r1b = await doRequest(`https://${arolinksDomain}/`, {
    method: 'GET',
    headers: { ...BASE_HEADERS, 'referer': BASE_URL + '/', 'sec-fetch-site': 'cross-site', 'cookie': getCookieHeader() },
    followRedirects: true,
    maxRedirects: 3,
  });
  const sc1b = (r1b.headers['set-cookie'] || []) as string[];
  for (const sc of (Array.isArray(sc1b) ? sc1b : [sc1b])) {
    const [pair] = sc.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
  }
  console.log(`[bypass] AppSession: ${cookieJar['AppSession'] || 'missing'}`);

  // STEP 2: Follow arolinks → pipefitter chain
  let url = arolinksUrl.startsWith('http') ? arolinksUrl : `https://${arolinksDomain}${arolinksUrl}`;
  let referer = BASE_URL + '/';
  const visited = new Set<string>();

  for (let hop = 0; hop < 8; hop++) {
    const baseUrl = url.split('#')[0];
    if (visited.has(baseUrl)) { console.log('[bypass] Loop detected, stopping chain'); break; }
    visited.add(baseUrl);

    const r = await doRequest(url, {
      method: 'GET',
      headers: { ...BASE_HEADERS, 'referer': referer, 'sec-fetch-site': 'cross-site', 'cookie': getCookieHeader() },
      followRedirects: false,
    });

    // Parse cookies
    const scArr = (r.headers['set-cookie'] || []) as string[];
    for (const sc of (Array.isArray(scArr) ? scArr : [scArr])) {
      const [pair] = sc.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers['location'] as string;
      if (!loc) break;
      referer = url;
      url = loc.startsWith('http') ? loc : new URL(loc, url).href;
      continue;
    }

    // JS redirect?
    const jsUrl = extractJsRedirect(r.body);
    if (jsUrl) {
      referer = url;
      url = jsUrl.startsWith('http') ? jsUrl : new URL(jsUrl, url).href;
      continue;
    }
    break;
  }

  let uopusi = cookieJar['uopusi'] || '';
  const phpsessid = cookieJar['PHPSESSID'] || '';
  if (!uopusi || !phpsessid) { console.warn('[bypass] uopusi or PHPSESSID missing'); return null; }

  // Decode uopusi
  const decode = (s: string): string => { try { const d = decodeURIComponent(s); return d.includes('%') ? decodeURIComponent(d) : d; } catch { return s; } };
  uopusi = decode(uopusi);
  console.log(`[bypass] uopusi: ${uopusi}`);

  // Inject cross-domain
  cookieJar['uopusi']   = uopusi;
  cookieJar['PHPSESSID'] = phpsessid;

  // STEP 2d: Beacon fire
  const beaconUrls = [
    `${BASE_URL}/__gate/ping?t=${encodeURIComponent(agt)}`,
    `${BASE_URL}/__gate/cb?t=${encodeURIComponent(agt)}`,
    `${BASE_URL}/__gate/done?t=${encodeURIComponent(agt)}`,
    `${BASE_URL}/__gate/verify?t=${encodeURIComponent(agt)}&next=${encodeURIComponent(nextPath)}`,
  ];
  for (const burl of beaconUrls) {
    try {
      await doRequest(burl, {
        method: 'GET',
        headers: { ...BASE_HEADERS, 'cookie': getCookieHeader(), 'referer': `https://${pipefitterDomain}/`, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
        followRedirects: false,
        timeout: 10000,
      });
    } catch (e: any) { console.warn('[bypass] beacon error:', e.message); }
  }

  // STEP 2e: Pipefitter keepalive
  try {
    const kp = await doRequest(`https://${pipefitterDomain}/studyeducations/?universtityeducations=keep&uiso=190188&st=1`, {
      method: 'GET',
      headers: { ...BASE_HEADERS, 'cookie': getCookieHeader(), 'referer': `https://${arolinksDomain}/`, 'sec-fetch-site': 'cross-site' },
      followRedirects: true, maxRedirects: 3,
      timeout: 15000,
    });
    const scKp = (kp.headers['set-cookie'] || []) as string[];
    for (const sc of (Array.isArray(scKp) ? scKp : [scKp])) {
      const [pair] = sc.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
    // Re-decode uopusi if overwritten
    if (cookieJar['uopusi'] && cookieJar['uopusi'].includes('%')) {
      cookieJar['uopusi'] = decode(cookieJar['uopusi']);
    }
  } catch (e: any) { console.warn('[bypass] keepalive error (non-fatal):', e.message); }

  await new Promise(r => setTimeout(r, 1500));

  // STEP 3: Verify — up to 3 inner attempts
  const verifyUrl = `${BASE_URL}/__gate/verify?t=${encodeURIComponent(agt)}&next=${encodeURIComponent(nextPath)}`;
  const verifyHeaders = {
    ...BASE_HEADERS,
    'referer': `https://${pipefitterDomain}/`,
    'origin': `https://${pipefitterDomain}`,
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'cookie': getCookieHeader(),
  };

  for (let va = 1; va <= 3; va++) {
    if (va > 1) { console.log(`[bypass] verify attempt ${va}/3`); await new Promise(r => setTimeout(r, va * 1000)); }

    const r3 = await doRequest(verifyUrl, {
      method: 'GET',
      headers: verifyHeaders,
      followRedirects: false,
      timeout: 20000,
    });

    // Parse cookies
    const sc3 = (r3.headers['set-cookie'] || []) as string[];
    for (const sc of (Array.isArray(sc3) ? sc3 : [sc3])) {
      const [pair] = sc.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }

    const loc = r3.headers['location'] as string || '';
    if (loc.includes('__gate/start')) {
      console.warn(`[bypass] verify attempt ${va}: __gate/start — retrying`);
      continue;
    }

    if (cookieJar['ag']) {
      console.log(`[bypass] ag cookie obtained on verify attempt ${va}`);
      return cookieJar['ag'];
    }

    // Follow redirect to get ag
    if (loc && r3.status >= 300) {
      const followUrl = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
      const r3f = await doRequest(followUrl, {
        method: 'GET', headers: verifyHeaders, followRedirects: true, maxRedirects: 3, timeout: 20000,
      });
      const sc3f = (r3f.headers['set-cookie'] || []) as string[];
      for (const sc of (Array.isArray(sc3f) ? sc3f : [sc3f])) {
        const [pair] = sc.split(';');
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
      }
      if (cookieJar['ag']) return cookieJar['ag'];
    }
  }

  console.warn('[bypass] all verify attempts failed');
  return null;
}

async function fetchAg(): Promise<string> {
  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const wait = attempt * 2000;
      console.log(`[nexus] retry ${attempt}/${MAX_RETRIES} in ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
    try {
      const ag = await bypassOnce(NEXT_PATH);
      if (ag) {
        console.log(`[nexus] ag obtained on attempt ${attempt}: ${ag.slice(0, 40)}...`);
        return ag;
      }
    } catch (e: any) {
      console.warn(`[nexus] attempt ${attempt} error:`, e.message);
    }
  }
  throw new Error(`All ${MAX_RETRIES} bypass attempts failed`);
}

async function getAg(force = false): Promise<string> {
  const now = Date.now();
  if (!force && agCache && (now - agCache.fetchedAt) < AG_TTL) {
    console.log(`[nexus] ag cache HIT age=${Math.floor((now - agCache.fetchedAt) / 60000)}m`);
    return agCache.value;
  }
  console.log('[nexus] fetching fresh ag via arolinks bypass...');
  const ag = await fetchAg();
  agCache = { value: ag, fetchedAt: now };
  return ag;
}

// ── Routes ────────────────────────────────────────────────
app.get('/cookie', async (_req, res) => {
  try {
    const ag = await getAg();
    res.json({ ag, fetchedAt: agCache?.fetchedAt });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get('/cookie/refresh', async (_req, res) => {
  try {
    const ag = await getAg(true);
    res.json({ ag, refreshed: true });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get('/status', (_req, res) => {
  res.json({
    status: 'ok',
    agCached: !!agCache,
    agAge_min: agCache ? Math.floor((Date.now() - agCache.fetchedAt) / 60000) : null,
    bypass: 'arolinks-v18',
  });
});

// ── Startup warmup ────────────────────────────────────────
getAg().catch(e => console.warn('[nexus] startup ag fetch failed:', e.message));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[nexus] Gateway listening on http://0.0.0.0:${PORT}`);
  console.log(`[nexus] Using arolinks bypass (v18 logic)`);
});
