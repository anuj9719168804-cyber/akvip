import express from 'express';
import https from 'https';
import http from 'http';
import * as zlib from 'zlib';
import dns from 'dns';

// ── Free-proxy pool for arolinks.com requests ─────────────
// Public HTTP proxy lists se proxies fetch karo, phir arolinks pe test karo.
// AROLINKS_PROXY=http://user:pass@host:port → paid proxy, always wins.
// AROLINKS_FREE_PROXY=0 → free pool band karo.
// FREE_PROXY_SOURCES=url1,url2 → extra plain-text "ip:port" lists.

const AROLINKS_PAID_PROXY = (process.env.AROLINKS_PROXY || '').trim();
const FREE_PROXY_ENABLED = !['0', 'false', 'no', 'off'].includes(
  (process.env.AROLINKS_FREE_PROXY || '1').trim().toLowerCase()
);

const FREE_PROXY_SOURCES: string[] = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=yes&anonymity=elite',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  ...(process.env.FREE_PROXY_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean),
];

const PROXY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface ProxyState {
  pool: string[];
  poolFetchedAt: number;
  working: string | null;
  workingAt: number;
  noneUntil: number;
  bad: Map<string, number>; // proxy -> expiry ts
}

const _px: ProxyState = {
  pool: [], poolFetchedAt: 0,
  working: null, workingAt: 0,
  noneUntil: 0,
  bad: new Map(),
};

const POOL_TTL     = 5 * 60 * 1000;   // 5 min
const WORKING_TTL  = 10 * 60 * 1000;  // 10 min
const NONE_TTL     = 60 * 1000;       // 1 min retry
const BAD_TTL      = 10 * 60 * 1000;  // 10 min blacklist

function _normalizeProxy(p: string): string {
  p = p.trim();
  return p.includes('://') ? p : `http://${p}`;
}

async function _fetchProxyPool(): Promise<string[]> {
  const now = Date.now();
  if (_px.pool.length && now - _px.poolFetchedAt < POOL_TTL) return _px.pool;
  const found: string[] = [];
  for (const src of FREE_PROXY_SOURCES) {
    try {
      const text = await new Promise<string>((res, rej) => {
        const srcUrl = new URL(src);
        const lib = srcUrl.protocol === 'https:' ? https : http;
        const req = lib.get(src, { timeout: 8000 }, resp => {
          const chunks: Buffer[] = [];
          resp.on('data', (c: Buffer) => chunks.push(c));
          resp.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', rej);
        req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
      });
      const lines = text.split('\n')
        .map(l => l.trim())
        .filter(l => l && l.includes(':') && !l.startsWith('#'));
      found.push(...lines.map(_normalizeProxy));
      if (found.length >= 60) break;
    } catch { /* source unreachable — try next */ }
  }
  _px.pool = [...new Map(found.map(p => [p, p])).values()].slice(0, 100);
  _px.poolFetchedAt = now;
  return _px.pool;
}

/** Test karo ki proxy arolinks.com tak pahunch sakta hai (Wikipedia se — arolinks 302 deta hai). */
async function _testProxy(proxy: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const pu = new URL(proxy);
      // CONNECT tunnel: proxy se wikipedia tak HTTPS request
      const req = http.request({
        host: pu.hostname,
        port: parseInt(pu.port || '80', 10),
        method: 'CONNECT',
        path: 'www.wikipedia.org:443',
        headers: { 'User-Agent': PROXY_UA, 'Proxy-Connection': 'keep-alive' },
        timeout: 8000,
      }, res => {
        // CONNECT 200 = tunnel open, proxy kaam kar raha hai
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
}

async function _discoverProxy(): Promise<string | null> {
  const pool = await _fetchProxyPool();
  if (!pool.length) return null;
  const now = Date.now();
  // Expired bad entries saaf karo
  for (const [p, exp] of _px.bad) if (exp <= now) _px.bad.delete(p);
  const candidates = pool.filter(p => !_px.bad.has(p)).slice(0, 30);
  if (!candidates.length) return null;

  // Parallel test — jo pehle pass ho woh return karo
  return new Promise(resolve => {
    let settled = false;
    let pending = candidates.length;
    for (const proxy of candidates) {
      _testProxy(proxy).then(ok => {
        if (!settled) {
          if (ok) { settled = true; resolve(proxy); }
          else if (--pending === 0) resolve(null);
        }
      });
    }
    // Deadline 20s
    setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 20000);
  });
}

let _proxyDiscovering = false;
let _proxyWaiters: Array<(p: string | null) => void> = [];

/** Free proxy URL return karo arolinks ke liye, ya null (direct). */
async function getArolinksProxy(): Promise<string | null> {
  if (AROLINKS_PAID_PROXY) return AROLINKS_PAID_PROXY;
  if (!FREE_PROXY_ENABLED) return null;
  const now = Date.now();
  if (_px.working && now - _px.workingAt < WORKING_TTL) return _px.working;
  if (now < _px.noneUntil) return null;

  // Serialise discovery — ek hi thread search kare
  if (_proxyDiscovering) {
    return new Promise(res => _proxyWaiters.push(res));
  }
  _proxyDiscovering = true;
  let found: string | null = null;
  try {
    found = await _discoverProxy();
    if (found) {
      _px.working = found; _px.workingAt = Date.now();
      console.log(`[proxy] ✅ free proxy: ${found}`);
    } else {
      _px.noneUntil = Date.now() + NONE_TTL;
      console.warn(`[proxy] koi working free proxy nahi mila (${NONE_TTL / 1000}s baad retry)`);
    }
  } finally {
    _proxyDiscovering = false;
    for (const w of _proxyWaiters) w(found);
    _proxyWaiters = [];
  }
  return found;
}

/** Proxy fail ho gaya — blacklist karo, next call fresh dhundega. */
function invalidateProxy() {
  if (_px.working) {
    console.warn(`[proxy] dropping bad proxy: ${_px.working}`);
    _px.bad.set(_px.working, Date.now() + BAD_TTL);
  }
  _px.working = null; _px.workingAt = 0;
}

const app = express();
const PORT = process.env.NEXUS_PORT ? parseInt(process.env.NEXUS_PORT, 10) : 5055;

// ── Config ────────────────────────────────────────────────
const CANDIDATE_BASES = [
  process.env.NEXUS_BASE_URL,
  'https://nexusstudypww.pages.dev',
].filter(Boolean) as string[];

let BASE_URL = CANDIDATE_BASES[0];

const NEXT_PATH = process.env.NEXUS_NEXT_PATH ||
  '/study/batches/69897f0a4c12aeb013d4ea52/subjects/inorganic-chemistry-694592/subject-topics/chemical-bonding-and-molecular-structure-975186?batchSubjectId=699e9154cc5de084d45895b9&subjectId=66c4223dc652bd0018be9332&chapterId=69dde15cb4ecb0676884e8f9';

const AG_TTL = 23 * 60 * 60 * 1000;

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const BASE_HEADERS: Record<string, string> = {
  'user-agent': UA,
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9',
  'accept-encoding': 'gzip, deflate',
  'upgrade-insecure-requests': '1',
};

let agCache: { value: string; fetchedAt: number } | null = null;

// ── DNS resolve ───────────────────────────────────────────
async function resolveBaseUrl(): Promise<void> {
  for (const candidate of CANDIDATE_BASES) {
    const domain = new URL(candidate).hostname;
    const ok = await new Promise<boolean>(resolve => {
      dns.resolve4(domain, (err, addrs) => resolve(!err && addrs.length > 0));
    });
    if (ok) { BASE_URL = candidate; console.log(`[nexus] BASE_URL: ${candidate}`); return; }
    console.warn(`[nexus] DNS fail: ${domain}`);
  }
}

// ── HTTP helper — jar BY REFERENCE ───────────────────────
// Har hop mein same jar object use hota hai — cookies automatically share hoti hain
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
  jar: Record<string, string>; // BY REFERENCE — caller ka master jar
  proxy?: string | null;       // optional proxy URL (http://host:port)
}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body, followRedirects = false, maxRedirects = 5, timeout = 20000, jar, proxy } = opts;
    let redirectCount = 0;

    function parseCookies(setCookieHeader: string | string[] | undefined) {
      const list = Array.isArray(setCookieHeader) ? setCookieHeader : (setCookieHeader ? [setCookieHeader] : []);
      for (const sc of list) {
        const pair = sc.split(';')[0];
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) jar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
      }
    }

    function go(reqUrl: string) {
      const parsed = new URL(reqUrl);
      const reqHeaders: Record<string, string> = { ...headers };

      // Har hop mein jar se fresh cookie string
      const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookieStr) reqHeaders['cookie'] = cookieStr;
      else delete reqHeaders['cookie'];

      // ── Proxy routing ──────────────────────────────────
      // HTTPS target: CONNECT tunnel through proxy (proxy authentication supported)
      // HTTP target:  plain HTTP proxy request (GET http://... HTTP/1.1)
      function makeRequest(socket?: import('net').Socket) {
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;
        const reqOpts: Parameters<typeof lib.request>[0] = socket
          ? {
              // Tunnel already open — speak HTTPS over it
              createConnection: () => socket as any,
              hostname: parsed.hostname,
              path: parsed.pathname + parsed.search,
              method: redirectCount > 0 ? 'GET' : method,
              headers: reqHeaders,
              timeout,
            } as any
          : {
              hostname: parsed.hostname,
              port: parsed.port || (isHttps ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: redirectCount > 0 ? 'GET' : method,
              headers: reqHeaders,
              timeout,
            };
        const req = lib.request(reqOpts, handleResponse);
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${reqUrl}`)); });
        if (body && redirectCount === 0) req.write(body);
        req.end();
      }

      function handleResponse(res: import('http').IncomingMessage) {
        // Cookies seedha jar mein (by reference — caller ko turant milti hain)
        parseCookies(res.headers['set-cookie']);

        const loc = res.headers['location'] as string;
        if (followRedirects && loc && redirectCount < maxRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          redirectCount++;
          const nextUrl = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
          res.resume(); // body consume karo — socket hang nahi hogi
          go(nextUrl);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] as string) || '';
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

          resolve({ status: res.statusCode || 0, headers: flatHeaders, body: text, url: reqUrl });
        });
        res.on('error', reject);
      }

      // ── Dispatch: direct ya proxy tunnel ──────────────
      if (!proxy) {
        makeRequest(); // direct, no proxy
      } else if (parsed.protocol === 'http:') {
        // Plain HTTP proxy request (GET http://full-url HTTP/1.1)
        const pu = new URL(proxy);
        const extraHeaders: Record<string, string> = { ...reqHeaders, 'proxy-connection': 'keep-alive', 'host': parsed.host };
        if (pu.username) {
          extraHeaders['proxy-authorization'] = `Basic ${Buffer.from(`${pu.username}:${pu.password}`).toString('base64')}`;
        }
        const preq = http.request({
          hostname: pu.hostname,
          port: parseInt(pu.port || '80', 10),
          method: redirectCount > 0 ? 'GET' : method,
          path: reqUrl,
          headers: extraHeaders,
          timeout,
        }, handleResponse);
        preq.on('error', reject);
        preq.on('timeout', () => { preq.destroy(); reject(new Error(`Proxy timeout: ${reqUrl}`)); });
        if (body && redirectCount === 0) preq.write(body);
        preq.end();
      } else {
        // HTTPS target through HTTP proxy — CONNECT tunnel
        const pu = new URL(proxy);
        const connectHeaders: Record<string, string> = {
          'host': `${parsed.hostname}:${parsed.port || 443}`,
          'proxy-connection': 'keep-alive',
          'user-agent': PROXY_UA,
        };
        if (pu.username) {
          connectHeaders['proxy-authorization'] = `Basic ${Buffer.from(`${pu.username}:${pu.password}`).toString('base64')}`;
        }
        const tunnel = http.request({
          hostname: pu.hostname,
          port: parseInt(pu.port || '80', 10),
          method: 'CONNECT',
          path: `${parsed.hostname}:${parsed.port || 443}`,
          headers: connectHeaders,
          timeout,
        });
        tunnel.on('connect', (_res, socket) => {
          // TLS over tunnel — rejectUnauthorized false because public proxies may intercept
          const tlsSocket = (require('tls') as typeof import('tls')).connect({
            socket,
            servername: parsed.hostname,
            rejectUnauthorized: false,
          }, () => makeRequest(tlsSocket as any));
          tlsSocket.on('error', reject);
        });
        tunnel.on('error', reject);
        tunnel.on('timeout', () => { tunnel.destroy(); reject(new Error(`CONNECT timeout: ${reqUrl}`)); });
        tunnel.end();
      }
    }

    go(url);
  });
}

// ── Extract JS redirect from HTML ─────────────────────────
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

// ── Bypass — Python v18 exact port ───────────────────────
// HAR confirmed flow (chronological):
// 1. __gate/start (page load)
// 2. __gate/go → agt cookie + arolinks redirect
// 3. arolinks/XXXX → AppSession + JS redirect to pipefitter
// 4. pipefitter/studyeducations/?universtityeducations=XXXX → PHPSESSID + uopusi
// 5. beacon fire + keepalive
// 6. __gate/verify + agt → ag cookie
async function bypassOnce(nextPath: string): Promise<string | null> {
  // MASTER JAR — by reference, sab requests share karte hain
  const jar: Record<string, string> = {};

  const decode = (s: string): string => {
    try { const d = decodeURIComponent(s); return d.includes('%') ? decodeURIComponent(d) : d; }
    catch { return s; }
  };

  // Free proxy fetch karo (paid proxy ho to wahi, warna public pool se)
  let proxy = await getArolinksProxy();
  if (proxy) console.log(`[bypass] using proxy: ${proxy}`);
  else console.log('[bypass] direct connection (no proxy)');

  // STEP 1: __gate/go → agt + arolinks redirect
  const r1 = await doRequest(`${BASE_URL}/__gate/go?next=${encodeURIComponent(nextPath)}`, {
    method: 'GET',
    headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/__gate/start?next=${encodeURIComponent(nextPath)}`, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' },
    followRedirects: false,
    jar,
    proxy,
  });

  if (r1.status < 300 || r1.status > 308) { console.warn('[bypass] Step1 bad status:', r1.status); return null; }
  const agt = jar['agt'];
  const arolinksUrl = r1.headers['location'] as string;
  if (!agt || !arolinksUrl) { console.warn('[bypass] Step1: agt or location missing'); return null; }
  console.log(`[bypass] agt: ${agt.slice(0, 50)}...`);

  // STEP 1b: arolinks preflight → AppSession
  await doRequest('https://arolinks.com/', {
    headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/`, 'sec-fetch-site': 'cross-site' },
    followRedirects: true, maxRedirects: 3, jar, proxy,
  });
  console.log(`[bypass] AppSession: ${jar['AppSession'] || 'missing'}`);

  // STEP 2: arolinks/XXXX → JS redirect to pipefitter
  const aroFull = arolinksUrl.startsWith('http') ? arolinksUrl : `https://arolinks.com${arolinksUrl}`;
  const r2a = await doRequest(aroFull, {
    headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/`, 'sec-fetch-site': 'cross-site' },
    followRedirects: false, jar, proxy,
  });
  // Pipefitter URL nikalo.
  // Pehle known JS redirect patterns, phir Location header, phir body mein kahin bhi
  // pipefitter.in ka URL (redirect code badalne par bhi kaam karta hai).
  const bodyPipefitter = r2a.body.match(/https?:\/\/pipefitter\.in\/[^\s"'<>\\]+/);
  const pipefitterUrl =
    extractJsRedirect(r2a.body) ||
    (r2a.headers['location'] as string) ||
    (bodyPipefitter ? bodyPipefitter[0] : '');
  if (!pipefitterUrl || !pipefitterUrl.includes('pipefitter.in')) {
    // Diagnostic: redirect ke aas-paas ka HTML dikhao, taaki naye pattern ka pata chale
    const hint = (r2a.body.match(/.{0,120}(location|redirect|pipefitter|href|url)[\s\S]{0,160}/i) || [''])[0];
    console.warn(`[bypass] Step2: pipefitter URL nahi mili (status ${r2a.status}, body ${r2a.body.length}B). Hint: ${hint.replace(/\s+/g, ' ').slice(0, 300)}`);
    return null;
  }
  console.log(`[bypass] pipefitter URL: ${pipefitterUrl.slice(0, 80)}`);

  // FIX G2: uiso dynamically extract karo from pipefitter redirect URL
  // Hardcoded 190188 wrong hota hai jab server different uiso serve kare
  let extractedUiso = '190188'; // safe fallback
  try {
    const pipefitterParsed = new URL(pipefitterUrl.startsWith('http') ? pipefitterUrl : `https://pipefitter.in${pipefitterUrl}`);
    const uisoParam = pipefitterParsed.searchParams.get('uiso');
    if (uisoParam) { extractedUiso = uisoParam; console.log(`[bypass] uiso extracted: ${extractedUiso}`); }
  } catch { console.warn('[bypass] uiso URL parse failed — using fallback 190188'); }

  // STEP 2 hop2: pipefitter → PHPSESSID + uopusi
  await doRequest(pipefitterUrl, {
    headers: { ...BASE_HEADERS, 'referer': aroFull, 'sec-fetch-site': 'cross-site' },
    followRedirects: true, maxRedirects: 4, jar, proxy,
  });
  console.log(`[bypass] PHPSESSID: ${jar['PHPSESSID'] || 'missing'}`);
  console.log(`[bypass] uopusi raw: ${jar['uopusi'] || 'missing'}`);

  if (!jar['uopusi'] || !jar['PHPSESSID']) {
    // Fallback: direct pipefitter hit
    console.warn('[bypass] uopusi missing — trying direct pipefitter fallback');
    // FIX G2: extractedUiso use karo — hardcoded 190188 nahi
    await doRequest(`https://pipefitter.in/studyeducations/?universtityeducations=keep&uiso=${extractedUiso}&st=1`, {
      headers: { ...BASE_HEADERS, 'referer': 'https://arolinks.com/', 'sec-fetch-site': 'cross-site' },
      followRedirects: true, maxRedirects: 5, jar, proxy,
    });
    console.log(`[bypass] fallback PHPSESSID: ${jar['PHPSESSID'] || 'missing'}`);
    console.log(`[bypass] fallback uopusi: ${jar['uopusi'] || 'missing'}`);
  }

  if (!jar['uopusi'] || !jar['PHPSESSID']) {
    console.warn('[bypass] uopusi ya PHPSESSID nahi mili');
    return null;
  }

  // Decode uopusi (double-encoded: education%252C → education%2C → education,)
  jar['uopusi'] = decode(jar['uopusi']);
  console.log(`[bypass] uopusi decoded: ${jar['uopusi']}`);

  // STEP 2d: Beacon fire
  for (const path of ['__gate/ping', '__gate/cb', '__gate/done']) {
    try {
      await doRequest(`${BASE_URL}/${path}?t=${encodeURIComponent(agt)}`, {
        headers: { ...BASE_HEADERS, 'referer': 'https://pipefitter.in/', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
        followRedirects: false, timeout: 8000, jar, proxy,
      });
    } catch { /* non-fatal */ }
  }

  // Verify beacon (already does redirect ke saath)
  try {
    await doRequest(`${BASE_URL}/__gate/verify?t=${encodeURIComponent(agt)}&next=${encodeURIComponent(nextPath)}`, {
      headers: { ...BASE_HEADERS, 'referer': 'https://pipefitter.in/', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
      followRedirects: false, timeout: 10000, jar, proxy,
    });
  } catch { /* non-fatal */ }

  // STEP 2e: Keepalive
  try {
    // FIX G2: extractedUiso use karo — hardcoded 190188 nahi
    await doRequest(`https://pipefitter.in/studyeducations/?universtityeducations=keep&uiso=${extractedUiso}&st=1`, {
      headers: { ...BASE_HEADERS, 'referer': 'https://arolinks.com/', 'sec-fetch-site': 'cross-site' },
      followRedirects: true, maxRedirects: 3, jar, proxy,
    });
    if (jar['uopusi'] && jar['uopusi'].includes('%')) jar['uopusi'] = decode(jar['uopusi']);
  } catch { /* non-fatal */ }

  await new Promise(r => setTimeout(r, 1500));

  // STEP 3: Verify — inner 3 attempts
  let currentAgt = jar['agt'] || agt;
  for (let va = 1; va <= 3; va++) {
    if (va > 1) { await new Promise(r => setTimeout(r, va * 1000)); console.log(`[bypass] verify attempt ${va}/3`); }

    const verifyUrl = `${BASE_URL}/__gate/verify?t=${encodeURIComponent(currentAgt)}&next=${encodeURIComponent(nextPath)}`;
    const verifyHeaders = {
      ...BASE_HEADERS,
      'referer': 'https://pipefitter.in/',
      'origin': 'https://pipefitter.in',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    };

    const r3 = await doRequest(verifyUrl, {
      headers: verifyHeaders,
      followRedirects: false,
      timeout: 20000,
      jar, proxy,
    });

    const loc3 = (r3.headers['location'] as string) || '';

    if (loc3.includes('__gate/start')) {
      // Fresh agt lene ki koshish
      console.warn(`[bypass] verify ${va}: __gate/start mila`);
      try {
        const startUrl = loc3.startsWith('http') ? loc3 : `${BASE_URL}${loc3}`;
        await doRequest(startUrl, {
          headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/`, 'sec-fetch-site': 'same-origin' },
          followRedirects: false, jar, proxy,
        });
        if (jar['agt'] && jar['agt'] !== currentAgt) {
          currentAgt = jar['agt'];
          console.log(`[bypass] naya agt: ${currentAgt.slice(0, 50)}...`);
        }
      } catch { /* ignore */ }
      continue;
    }

    if (jar['ag']) { console.log(`[bypass] ag mila! attempt ${va} (GET)`); return jar['ag']; }

    // Redirect follow karo
    if (loc3 && r3.status >= 300) {
      const followUrl = loc3.startsWith('http') ? loc3 : `${BASE_URL}${loc3}`;
      await doRequest(followUrl, { headers: verifyHeaders, followRedirects: true, maxRedirects: 3, jar, proxy });
      if (jar['ag']) { console.log(`[bypass] ag mila redirect pe, attempt ${va}`); return jar['ag']; }
    }

    // POST fallback
    const r3p = await doRequest(verifyUrl, {
      method: 'POST',
      headers: { ...verifyHeaders, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
      body: `t=${encodeURIComponent(currentAgt)}&next=${encodeURIComponent(nextPath)}`,
      followRedirects: false, timeout: 20000, jar, proxy,
    });
    if (jar['ag']) { console.log(`[bypass] ag mila POST se, attempt ${va}`); return jar['ag']; }

    const postLoc = (r3p.headers['location'] as string) || '';
    if (postLoc && r3p.status >= 300 && !postLoc.includes('__gate/start')) {
      const pfu = postLoc.startsWith('http') ? postLoc : `${BASE_URL}${postLoc}`;
      await doRequest(pfu, { headers: verifyHeaders, followRedirects: true, maxRedirects: 3, jar, proxy });
      if (jar['ag']) return jar['ag'];
    }
  }

  console.warn('[bypass] sab verify attempts fail');
  return null;
}

// ── Outer retry loop (Python v18 MAX_RETRIES=4) ───────────
async function fetchAg(): Promise<string> {
  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const wait = attempt * 2000;
      console.log(`[nexus] retry ${attempt}/${MAX_RETRIES} in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
    try {
      const ag = await bypassOnce(NEXT_PATH);
      if (ag) { console.log(`[nexus] ag attempt ${attempt}: ${ag.slice(0, 50)}...`); return ag; }
      // Bypass failed — proxy shayad kaam nahi kar raha, dusra dhundho
      invalidateProxy();
    } catch (e: any) {
      console.warn(`[nexus] attempt ${attempt} error:`, e.message);
      invalidateProxy();
    }
  }
  throw new Error(`All ${MAX_RETRIES} bypass attempts failed`);
}

async function getAg(force = false): Promise<string> {
  const now = Date.now();
  if (!force && agCache && (now - agCache.fetchedAt) < AG_TTL) {
    console.log(`[nexus] cache HIT age=${Math.floor((now - agCache.fetchedAt) / 60000)}m`);
    return agCache.value;
  }
  console.log('[nexus] fresh ag fetch start...');
  const ag = await fetchAg();
  agCache = { value: ag, fetchedAt: now };
  return ag;
}

// ── Routes ────────────────────────────────────────────────
app.get('/cookie', async (_req, res) => {
  try {
    const ag = await getAg();
    res.json({ ag, fetchedAt: agCache?.fetchedAt });
  } catch (e: any) { res.status(503).json({ error: e.message }); }
});

app.get('/cookie/refresh', async (_req, res) => {
  try {
    const ag = await getAg(true);
    res.json({ ag, refreshed: true });
  } catch (e: any) { res.status(503).json({ error: e.message }); }
});

app.get('/status', (_req, res) => {
  res.json({ status: 'ok', agCached: !!agCache, agAge_min: agCache ? Math.floor((Date.now() - agCache.fetchedAt) / 60000) : null });
});

app.get('/proxy/status', (_req, res) => {
  res.json({
    paid: AROLINKS_PAID_PROXY || null,
    freeEnabled: FREE_PROXY_ENABLED,
    working: _px.working,
    workingAge_min: _px.working ? Math.floor((Date.now() - _px.workingAt) / 60000) : null,
    poolSize: _px.pool.length,
    badCount: _px.bad.size,
  });
});

app.post('/proxy/invalidate', (_req, res) => {
  invalidateProxy();
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────
resolveBaseUrl().then(() => {
  getAg().catch(e => console.warn('[nexus] startup fetch failed:', e.message));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[nexus] listening on http://0.0.0.0:${PORT}`);
});
