// Dependency-free RSS 2.0 / Atom collector. Produces seed items for the Scout and for RSS-only runs:
// { title, url, published, excerpt, source, domain, tier, category }. Feed failures are reported, never fatal.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const entities = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ');
// Many feeds (Reddit, blog.google) entity-escape their HTML, sometimes twice (&amp;#39;), so strip tags
// again after decoding and decode a second time.
const decode = (s) => entities(stripTags(entities(stripTags(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))))
  .replace(/\s+/g, ' ').trim();

const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = decode(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i); link = m ? m[1] : ''; }
    const date = decode(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const published = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
    // Publisher's own teaser text, unverified. Capped so a full-content feed can't bloat records.
    const excerpt = decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 500);
    items.push({ title: decode(tag(b, 'title')), url: link.trim(), published, excerpt });
  }
  return items.filter((i) => i.title && /^https?:\/\//.test(i.url));
}

async function collect(sources, { fetchImpl, lookbackDays, maxItems, now = new Date() }) {
  const cutoff = new Date(now.getTime() - lookbackDays * 86400000);
  const items = [], failures = [], stats = [];
  await Promise.all(sources.filter((s) => s.rss_url).map(async (s) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetchImpl(s.rss_url, { headers: { 'User-Agent': 'AIOperatorWeekly/1.0 (+newsletter research)' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseFeed(await res.text());
      let inWindow = 0;
      for (const it of parsed) {
        // Items with no date are kept; the Scout must establish the event date itself.
        if (!it.published || new Date(it.published) >= cutoff) { inWindow++; items.push({ ...it, source: s.name, domain: s.domain, tier: s.tier, category: s.category }); }
      }
      stats.push({ source: s.name, url: s.rss_url, ok: true, items_in_feed: parsed.length, items_in_window: inWindow });
    } catch (e) {
      const error = e.name === 'AbortError' ? 'timeout' : [e.message, e.cause?.code || e.cause?.message].filter(Boolean).join(': ');
      failures.push({ source: s.name, url: s.rss_url, error });
      stats.push({ source: s.name, url: s.rss_url, ok: false, error });
    }
    finally { clearTimeout(timer); }
  }));
  items.sort((a, b) => (a.tier - b.tier) || String(b.published).localeCompare(String(a.published)));
  return { items: items.slice(0, maxItems), failures, stats };
}

module.exports = { collect, parseFeed };
