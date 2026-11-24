// Link preview image for a news story: GET /api/og?url=<article link> → { image: "<the article's og:image>" }.
// Admin calls it when a News link is added. It returns only the image address the publisher puts in the page for
// link previews (og:image / twitter:image); the image itself is not downloaded or stored here.
// Guarded against fetching private or local addresses, with a short timeout and a size cap.
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 600 * 1024, TIMEOUT_MS = 7000, MAX_HOPS = 4;
const UA = 'Mozilla/5.0 (compatible; ReelscoreBot/1.0; +https://reelscore-xi.vercel.app/about)';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
}
async function safeTarget(u) {
  let url; try { url = new URL(u); } catch (e) { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) return null;
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some(a => privateIp(a.address))) return null;
  return url;
}
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function findImage(html, base) {
  const head = html.slice(0, 400000);
  const metas = head.match(/<meta\b[^>]*>/gi) || [];
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };
  const want = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  for (const key of want) {
    for (const t of metas) {
      const k = (attr(t, 'property') || attr(t, 'name')).toLowerCase();
      if (k === key) { const c = decode(attr(t, 'content')); if (c) { try { return new URL(c, base).href; } catch (e) {} } }
    }
  }
  const link = head.match(/<link\b[^>]*rel\s*=\s*["']?image_src["']?[^>]*>/i);
  if (link) { const c = decode(attr(link[0], 'href')); if (c) { try { return new URL(c, base).href; } catch (e) {} } }
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
  const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  const raw = String((req.query && req.query.url) || '');
  if (!raw || raw.length > 2000) return send(400, { error: 'Give the article link as ?url=' });
  let url = await safeTarget(raw);
  if (!url) return send(400, { error: 'That link can’t be fetched.' });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let r;
    for (let hop = 0; ; hop++) {
      r = await fetch(url.href, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.8' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        if (hop >= MAX_HOPS) return send(502, { error: 'Too many redirects.' });
        url = await safeTarget(new URL(r.headers.get('location'), url).href);
        if (!url) return send(400, { error: 'That link redirects somewhere that can’t be fetched.' });
        continue;
      }
      break;
    }
    if (!r.ok) return send(502, { error: 'The site answered ' + r.status + '.' });
    if (!/html/i.test(r.headers.get('content-type') || '')) return send(422, { error: 'That link isn’t a web page.' });
    const reader = r.body.getReader(); let got = 0, html = '';
    const dec = new TextDecoder('utf-8');
    while (got < MAX_BYTES) {
      const { done, value } = await reader.read(); if (done) break;
      got += value.length; html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    try { reader.cancel(); } catch (e) {}
    const image = findImage(html, url.href);
    if (!image || !/^https:\/\//i.test(image)) return send(404, { error: 'No preview image on that page.' });
    return send(200, { image });
  } catch (e) {
    return send(504, { error: e && e.name === 'AbortError' ? 'The site took too long.' : 'Couldn’t reach that site.' });
  } finally { clearTimeout(timer); }
};
