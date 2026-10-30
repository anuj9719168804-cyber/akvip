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

let agCache: { value: string; fetchedAt: number; cfPolicy?: string; cfSignature?: string; cfKeyPairId?: string } | null = null;

// ── HTTP helper ────────────────────────────────────────────
interface Resp {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  url: string;
  finalCookies: Record<string, string>; // all cookies collected across redirects
}

function doRequest(url: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  timeout?: number;
  initialCookies?: Record<string, string>; // seed cookies into the request chain
}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body, followRedirects = false, maxRedirects = 0, timeout = 15000, initialCookies = {} } = opts;
    let redirectCount = 0;

    // Shared cookie jar across all hops — seeded with caller's cookies
    const sharedJar: Record<string, string> = { ...initialCookies };

    function go(reqUrl: string) {
      const parsed = new URL(reqUrl);
      const lib = parsed.protocol === 'https:' ? https : http;

      // Build request headers — merge caller headers but always inject sharedJar cookies
      const reqHeaders: Record<string, string> = { ...headers };
      // Remove any static cookie header the caller passed; we manage cookies via sharedJar
      delete reqHeaders['cookie'];
      const cookieStr = Object.entries(sharedJar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookieStr) reqHeaders['cookie'] = cookieStr;

      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout,
      }, (res) => {
        // Parse Set-Cookie into sharedJar so every hop benefits
        const setCookies = res.headers['set-cookie'] || [];
        for (const sc of setCookies) {
          const pair = sc.split(';')[0];
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            sharedJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
          }
        }

        const loc = res.headers['location'] as string;
        if (followRedirects && loc && redirectCount < maxRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          redirectCount++;
          const nextUrl = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
          go(nextUrl); // sharedJar carries over automatically
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
            finalCookies: { ...sharedJar }, // expose all collected cookies to caller
          });
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${reqUrl}`)); });
      if (body) req.write(body);
      req.end();
    }

    go(url);
  });
}

// ── Extract JS redirect + fetch/XHR + embedded URLs from HTML ────────────────
// Python v11 FIX: fetch()/XHR URLs background mein fire karo taaki uopusi milne
// wale ad-pixels capture ho sakein. Navigation chain sirf js-location/meta-refresh
// se aage badhti hai; fetch/xhr/embedded sirf side-fire hote hain.
interface ExtractedUrl {
  kind: 'js-location' | 'meta-refresh' | 'fetch' | 'xhr' | 'embedded';
  url: string;
}

const PIPE_SKIP = /\/wp-|\/feed|\/tag\/|\/category\/|\/author\/|\/wp-json|\.css|\.js|xmlrpc|#|\/comments\//;

function extractAllUrls(html: string, baseUrl: string): ExtractedUrl[] {
  const found: ExtractedUrl[] = [];
  const seen = new Set<string>();
  const add = (kind: ExtractedUrl['kind'], raw: string) => {
    try {
      const u = new URL(raw, baseUrl).href;
      if (!seen.has(u)) { seen.add(u); found.push({ kind, url: u }); }
    } catch { /* invalid URL skip */ }
  };

  // window.location / assign / replace
  const locPatterns = [
    /window\.location\.href\s*=\s*['"]([^'"]+)['"]/g,
    /window\.location\s*=\s*['"]([^'"]+)['"]/g,
    /window\.location\.(?:assign|replace)\(['"]([^'"]+)['"]\)/g,
  ];
  for (const pat of locPatterns) {
    let m; while ((m = pat.exec(html)) !== null) add('js-location', m[1]);
  }

  // Meta refresh
  const metaPat = /<meta[^>]+http-equiv=['"]?refresh['"]?[^>]+content=['"][^'"]*?url=([^\s'">;]+)/gi;
  let m; while ((m = metaPat.exec(html)) !== null) add('meta-refresh', m[1].trim());

  // fetch() calls
  const fetchPat = /fetch\(['"]([^'"]+)['"]/g;
  while ((m = fetchPat.exec(html)) !== null) add('fetch', m[1]);

  // XHR .open()
  const xhrPat = /\.open\(['"][A-Z]+['"],\s*['"]([^'"]+)['"]/g;
  while ((m = xhrPat.exec(html)) !== null) add('xhr', m[1]);

  // pipefitter.in/studyeducations/ embedded (uopusi setter — v11 fix)
  const pipePat = /https?:\/\/pipefitter\.in\/studyeducations\/[^\s"'<>]*/g;
  while ((m = pipePat.exec(html)) !== null) add('embedded', m[0].replace(/["'\\]+$/, ''));

  // arolinks.com links (intermediate redirects)
  const arolinksPat = /https?:\/\/arolinks\.com\/[^\s"'<>]+/g;
  while ((m = arolinksPat.exec(html)) !== null) add('embedded', m[0].replace(/["'\\]+$/, ''));

  // Other pipefitter.in links — skip wp/static junk
  const pipeOtherPat = /https?:\/\/pipefitter\.in\/[^\s"'<>]+/g;
  while ((m = pipeOtherPat.exec(html)) !== null) {
    const u = m[0].replace(/["'\\]+$/, '');
    if (!/\/studyeducations\//.test(u) && !PIPE_SKIP.test(u)) add('js-location', u);
  }

  return found;
}

// Simple wrapper: single navigation redirect for hop chain
function extractJsRedirect(html: string, baseUrl = 'https://pipefitter.in/'): string | null {
  const all = extractAllUrls(html, baseUrl);
  const nav = all.find(e => e.kind === 'js-location' || e.kind === 'meta-refresh');
  return nav ? nav.url : null;
}

// ── Arolinks bypass — full flow ───────────────────────────
async function bypassOnce(nextPath: string): Promise<string | null> {
  const cookieJar: Record<string, string> = {};
  const nexusDomain = 'nexusstudypww.pages.dev';
  const arolinksDomain = 'arolinks.com';
  const pipefitterDomain = 'pipefitter.in';

  // Merge finalCookies from a doRequest response back into our master jar
  function absorbCookies(resp: Awaited<ReturnType<typeof doRequest>>) {
    Object.assign(cookieJar, resp.finalCookies);
  }

  // STEP 1: Get agt cookie
  const gateUrl = `${BASE_URL}/__gate/go?next=${encodeURIComponent(nextPath)}`;
  const r1 = await doRequest(gateUrl, {
    method: 'GET',
    headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/__gate/start?next=${encodeURIComponent(nextPath)}`, 'sec-fetch-site': 'same-origin' },
    followRedirects: false,
    initialCookies: { ...cookieJar },
  });
  absorbCookies(r1);

  if (r1.status < 300 || r1.status > 308) { console.warn('[bypass] Step1 unexpected status:', r1.status); return null; }

  const agt = cookieJar['agt'];
  const arolinksUrl = r1.headers['location'] as string;
  if (!agt || !arolinksUrl) { console.warn('[bypass] Step1 missing agt or location'); return null; }
  console.log(`[bypass] agt: ${agt.slice(0, 40)}...`);

  // STEP 1b: AppSession warm-up
  const r1b = await doRequest(`https://${arolinksDomain}/`, {
    method: 'GET',
    headers: { ...BASE_HEADERS, 'referer': BASE_URL + '/', 'sec-fetch-site': 'cross-site' },
    followRedirects: true,
    maxRedirects: 3,
    initialCookies: { ...cookieJar },
  });
  absorbCookies(r1b);
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
      headers: { ...BASE_HEADERS, 'referer': referer, 'sec-fetch-site': 'cross-site' },
      followRedirects: false,
      initialCookies: { ...cookieJar },
    });
    absorbCookies(r);

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers['location'] as string;
      if (!loc) break;
      referer = url;
      url = loc.startsWith('http') ? loc : new URL(loc, url).href;
      continue;
    }

    // Extract all URLs from page
    const allUrls = extractAllUrls(r.body, url);

    // v11 FIX 3: fetch/xhr/embedded URLs background mein fire karo (uopusi ad-pixels)
    const sideUrls = allUrls.filter(e => e.kind === 'fetch' || e.kind === 'xhr' || e.kind === 'embedded');
    for (const { kind, url: su } of sideUrls.slice(0, 5)) {
      try {
        const sf = await doRequest(su, {
          method: 'GET',
          headers: { ...BASE_HEADERS, 'referer': url, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
          followRedirects: true, maxRedirects: 3,
          timeout: 10000,
          initialCookies: { ...cookieJar },
        });
        absorbCookies(sf);
        if (cookieJar['uopusi']) { console.log(`[bypass] uopusi found via ${kind}: ${su.slice(0, 60)}`); }
      } catch (e: any) { console.warn(`[bypass] side-fire ${kind} error:`, e.message); }
    }

    // Navigation redirect?
    const navUrl = allUrls.find(e => e.kind === 'js-location' || e.kind === 'meta-refresh');
    if (navUrl && !visited.has(navUrl.url.split('#')[0])) {
      referer = url;
      url = navUrl.url;
      continue;
    }
    break;
  }

  let uopusi = cookieJar['uopusi'] || '';
  let phpsessid = cookieJar['PHPSESSID'] || '';

  // STEP 2b: Fallback — agar uopusi chain ke baad bhi missing hai toh direct pipefitter hit
  if (!uopusi) {
    console.warn('[bypass] uopusi missing after chain — trying direct pipefitter fallback');
    const fallbackUrl = `https://${pipefitterDomain}/studyeducations/?universtityeducations=keep&uiso=190188&st=1`;
    try {
      const rfb = await doRequest(fallbackUrl, {
        method: 'GET',
        headers: { ...BASE_HEADERS, 'referer': `https://${arolinksDomain}/`, 'sec-fetch-site': 'cross-site' },
        followRedirects: true, maxRedirects: 6,
        timeout: 20000,
        initialCookies: { ...cookieJar },
      });
      absorbCookies(rfb);
      uopusi = cookieJar['uopusi'] || '';
      phpsessid = cookieJar['PHPSESSID'] || '';
      console.log(`[bypass] Step2b fallback: uopusi=${uopusi ? 'found' : 'still missing'}, PHPSESSID=${phpsessid ? 'found' : 'still missing'}`);
    } catch (e: any) { console.warn('[bypass] Step2b fallback error:', e.message); }
  }

  if (!uopusi || !phpsessid) { console.warn('[bypass] uopusi or PHPSESSID missing after all fallbacks'); return null; }

  // Decode uopusi — Python ki tarah full double-decode karo
  // pipefitter kabhi kabhi double-encoded value set karta hai: education%252C → education%2C → education,
  const decode = (s: string): string => {
    try {
      let d = decodeURIComponent(s);
      // Agar abhi bhi % baki hai (double-encoded tha) toh phir se decode karo
      if (d.includes('%')) d = decodeURIComponent(d);
      return d;
    } catch { return s; }
  };
  uopusi = decode(uopusi);
  console.log(`[bypass] uopusi (decoded): ${uopusi}`);

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
        headers: { ...BASE_HEADERS, 'referer': `https://${pipefitterDomain}/`, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
        followRedirects: false,
        timeout: 10000,
        initialCookies: { ...cookieJar },
      });
    } catch (e: any) { console.warn('[bypass] beacon error:', e.message); }
  }

  // STEP 2e: Pipefitter keepalive
  try {
    const kp = await doRequest(`https://${pipefitterDomain}/studyeducations/?universtityeducations=keep&uiso=190188&st=1`, {
      method: 'GET',
      headers: { ...BASE_HEADERS, 'referer': `https://${arolinksDomain}/`, 'sec-fetch-site': 'cross-site' },
      followRedirects: true, maxRedirects: 3,
      timeout: 15000,
      initialCookies: { ...cookieJar },
    });
    absorbCookies(kp);
    // Re-decode uopusi if overwritten by keepalive redirect
    if (cookieJar['uopusi'] && cookieJar['uopusi'].includes('%')) {
      cookieJar['uopusi'] = decode(cookieJar['uopusi']);
    }
  } catch (e: any) { console.warn('[bypass] keepalive error (non-fatal):', e.message); }

  await new Promise(r => setTimeout(r, 1500));

  // STEP 3: Verify — up to 3 inner attempts
  const verifyUrl = `${BASE_URL}/__gate/verify?t=${encodeURIComponent(agt)}&next=${encodeURIComponent(nextPath)}`;
  const verifyBaseHeaders = {
    ...BASE_HEADERS,
    'referer': `https://${pipefitterDomain}/`,
    'origin': `https://${pipefitterDomain}`,
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  };

  let currentVerifyUrl = verifyUrl;

  for (let va = 1; va <= 3; va++) {
    if (va > 1) { console.log(`[bypass] verify attempt ${va}/3`); await new Promise(r => setTimeout(r, va * 1000)); }

    // ── 3a: GET ──────────────────────────────────────────────────────────
    const r3 = await doRequest(currentVerifyUrl, {
      method: 'GET',
      headers: { ...verifyBaseHeaders },
      followRedirects: false,
      timeout: 20000,
      initialCookies: { ...cookieJar },
    });
    absorbCookies(r3);

    const loc = r3.headers['location'] as string || '';

    // __gate/start mila — wahan bhi GET karo, kabhi kabhi naya agt milta hai
    if (loc.includes('__gate/start')) {
      console.warn(`[bypass] verify attempt ${va}: __gate/start — fetching start for fresh agt...`);
      try {
        const startUrl = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
        const rs = await doRequest(startUrl, {
          method: 'GET',
          headers: { ...BASE_HEADERS, 'referer': `${BASE_URL}/`, 'sec-fetch-site': 'same-origin' },
          followRedirects: false,
          timeout: 15000,
          initialCookies: { ...cookieJar },
        });
        absorbCookies(rs);
        // Naya agt mila? verify URL update karo
        if (cookieJar['agt'] && cookieJar['agt'] !== agt) {
          console.log(`[bypass] new agt from start: ${cookieJar['agt'].slice(0, 40)}...`);
          currentVerifyUrl = `${BASE_URL}/__gate/verify?t=${encodeURIComponent(cookieJar['agt'])}&next=${encodeURIComponent(nextPath)}`;
        }
      } catch (e: any) { console.warn('[bypass] start GET error:', e.message); }
      continue;
    }

    if (cookieJar['ag']) {
      console.log(`[bypass] ag cookie obtained on verify attempt ${va} (GET)`);
      return cookieJar['ag'];
    }

    // Follow redirect to get ag
    if (loc && r3.status >= 300) {
      const followUrl = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
      const r3f = await doRequest(followUrl, {
        method: 'GET',
        headers: { ...verifyBaseHeaders },
        followRedirects: true,
        maxRedirects: 3,
        timeout: 20000,
        initialCookies: { ...cookieJar },
      });
      absorbCookies(r3f);
      if (cookieJar['ag']) return cookieJar['ag'];
    }

    // ── 3b: POST fallback — GET se ag nahi mili ──────────────────────────
    console.log(`[bypass] verify attempt ${va}: GET failed — trying POST fallback`);
    const postBody = new URLSearchParams({ t: cookieJar['agt'] || agt, next: nextPath }).toString();
    const r3post = await doRequest(currentVerifyUrl, {
      method: 'POST',
      headers: {
        ...verifyBaseHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
      },
      body: postBody,
      followRedirects: false,
      timeout: 20000,
      initialCookies: { ...cookieJar },
    });
    absorbCookies(r3post);

    if (cookieJar['ag']) {
      console.log(`[bypass] ag cookie obtained on verify attempt ${va} (POST)`);
      return cookieJar['ag'];
    }

    // POST redirect follow karo
    const postLoc = r3post.headers['location'] as string || '';
    if (postLoc && r3post.status >= 300 && !postLoc.includes('__gate/start')) {
      const postFollowUrl = postLoc.startsWith('http') ? postLoc : `${BASE_URL}${postLoc}`;
      const r3pf = await doRequest(postFollowUrl, {
        method: 'GET',
        headers: { ...verifyBaseHeaders },
        followRedirects: true,
        maxRedirects: 3,
        timeout: 20000,
        initialCookies: { ...cookieJar },
      });
      absorbCookies(r3pf);
      if (cookieJar['ag']) return cookieJar['ag'];
    }
  }

  console.warn('[bypass] all verify attempts failed');
  return null;
}

interface BypassResult {
  ag: string;
  cfPolicy?: string;
  cfSignature?: string;
  cfKeyPairId?: string;
}

async function fetchAg(): Promise<BypassResult> {
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
        // Try to fetch CF cookies by hitting the video CDN with the ag cookie
        let cfPolicy = '', cfSignature = '', cfKeyPairId = '';
        try {
          const cfResp = await doRequest(
            'https://nexusstudypww.pages.dev/api/Schedule?BatchId=69897f0a4c12aeb013d4ea52&SubjectId=physics-948847&ContentId=6a90a57042bce943d91c479c',
            { method: 'GET', headers: { ...BASE_HEADERS, 'cookie': `ag=${ag}` }, followRedirects: true, maxRedirects: 3 }
          );
          cfPolicy    = cfResp.finalCookies['CloudFront-Policy']     || cfResp.finalCookies['cf_policy']    || '';
          cfSignature = cfResp.finalCookies['CloudFront-Signature']  || cfResp.finalCookies['cf_signature'] || '';
          cfKeyPairId = cfResp.finalCookies['CloudFront-Key-Pair-Id']|| cfResp.finalCookies['cf_key_pair_id'] || '';
          if (cfPolicy) console.log('[nexus] CloudFront cookies obtained!');
          else console.log('[nexus] CloudFront cookies not in Schedule response (normal for this CDN)');
        } catch (e: any) { console.warn('[nexus] CF cookie fetch error (non-fatal):', e.message); }
        return { ag, cfPolicy, cfSignature, cfKeyPairId };
      }
    } catch (e: any) {
      console.warn(`[nexus] attempt ${attempt} error:`, e.message);
    }
  }
  throw new Error(`All ${MAX_RETRIES} bypass attempts failed`);
}

async function getAg(force = false): Promise<BypassResult> {
  const now = Date.now();
  if (!force && agCache && (now - agCache.fetchedAt) < AG_TTL) {
    console.log(`[nexus] ag cache HIT age=${Math.floor((now - agCache.fetchedAt) / 60000)}m`);
    return agCache;
  }
  console.log('[nexus] fetching fresh ag via arolinks bypass...');
  const result = await fetchAg();
  agCache = { ...result, fetchedAt: now };
  return result;
}

// ── Routes ────────────────────────────────────────────────
app.get('/cookie', async (_req, res) => {
  try {
    const result = await getAg();
    res.json({
      ag: result.ag,
      fetchedAt: agCache?.fetchedAt,
      cfPolicy: result.cfPolicy || '',
      cfSignature: result.cfSignature || '',
      cfKeyPairId: result.cfKeyPairId || '',
    });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

app.get('/cookie/refresh', async (_req, res) => {
  try {
    const result = await getAg(true);
    res.json({
      ag: result.ag,
      refreshed: true,
      cfPolicy: result.cfPolicy || '',
      cfSignature: result.cfSignature || '',
      cfKeyPairId: result.cfKeyPairId || '',
    });
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
