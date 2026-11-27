// YouTube view counts and upload dates: GET /api/views?ids=<id>,<id>,… (up to 50) → { counts: { <id>: <views> }, dates: { <id>: <ISO time> } }.
// The /songs page shows the counts; Admin's "YouTube dates" tool stores the dates on each song.
// The YouTube Data API key lives only in the Vercel setting YT_API_KEY, never in the page or the repo.
// One call costs 1 unit of the 10,000-a-day quota. The CDN keeps each answer for 6 hours, so traffic doesn't add calls,
// and nothing is stored anywhere else (YouTube asks that stored API data be refreshed or deleted within 30 days).
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (code, body, cache) => { res.statusCode = code; res.setHeader('Cache-Control', cache); res.end(JSON.stringify(body)); };
  const ids = String((req.query && req.query.ids) || '').split(',').filter(Boolean);
  if (!ids.length || ids.length > 50 || !ids.every((id) => /^[A-Za-z0-9_-]{11}$/.test(id))) return send(400, { error: 'Give 1 to 50 YouTube video ids as ?ids=a,b,c' }, 'no-store');
  const key = process.env.YT_API_KEY;
  if (!key) return send(503, { error: 'View counts aren’t set up.' }, 'public, s-maxage=300');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&fields=items(id,snippet/publishedAt,statistics(viewCount))&maxResults=50&id=' + ids.join(',') + '&key=' + encodeURIComponent(key), { signal: ctl.signal });
    if (!r.ok) return send(502, { error: 'YouTube said no (' + r.status + ').' }, 'public, s-maxage=600');
    const j = await r.json(), counts = {}, dates = {};
    (j.items || []).forEach((it) => {
      const n = Number(it.statistics && it.statistics.viewCount); if (it.id && Number.isFinite(n)) counts[it.id] = n;
      const t = it.snippet && it.snippet.publishedAt; if (it.id && /^\d{4}-\d{2}-\d{2}T/.test(t || '')) dates[it.id] = t;
    });
    return send(200, { counts, dates }, 'public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400');
  } catch (e) {
    return send(504, { error: 'YouTube didn’t answer.' }, 'public, s-maxage=120');
  } finally { clearTimeout(timer); }
};
