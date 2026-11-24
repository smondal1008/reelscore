// A YouTube video's title and channel, for pre-filling Admin rows: GET /api/yt?id=<11-character video id> → { title, channel }.
// Uses YouTube's public oEmbed endpoint, so it needs no API key and uses none of the daily quota.
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (code, body, cache) => { res.statusCode = code; if (cache) res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600'); res.end(JSON.stringify(body)); };
  const id = String((req.query && req.query.id) || '');
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return send(400, { error: 'Give a YouTube video id as ?id=' });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: ctl.signal });
    if (r.status === 401 || r.status === 403) return send(403, { error: 'That video can’t be embedded or is private.' });
    if (!r.ok) return send(404, { error: 'No such video.' });
    const j = await r.json();
    return send(200, { title: String(j.title || ''), channel: String(j.author_name || '') }, true);
  } catch (e) {
    return send(504, { error: 'YouTube didn’t answer.' });
  } finally { clearTimeout(timer); }
};
