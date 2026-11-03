#!/usr/bin/env node
// Renders an issue written in Markdown into email-safe HTML with inline styles only (beehiiv strips <style>).
//   node scripts/render-issue.js demo/2026-11-03/issue.md
// Writes next to the input:
//   issue.html         standalone page to open in a browser (and the copy for the demo)
//   beehiiv-body.html  the same content without <html>/<head>, for pasting into a beehiiv HTML block
// Supports what the issue uses: #/##/### headings, paragraphs, - and 1. lists (one nesting level), > boxes,
// **bold**, *italic*, `code`, [links](https://…), --- rules. "[DRAFT TAKE …]" and "[Mohil to confirm]" are
// highlighted so they can't be missed before sending.

const fs = require('fs');
const path = require('path');

const C = { ink: '#1f2937', muted: '#6b7280', accent: '#0f5132', link: '#1a56db', rule: '#e5e7eb', box: '#fff7ed', boxLine: '#f59e0b', code: '#f3f4f6' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t
    .replace(/\[(DRAFT TAKE[^\]]*|Mohil to confirm)\]/g, '<span style="background:#fde68a;color:#7c2d12;font-weight:700;padding:1px 5px;border-radius:3px;">[$1]</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" style="color:${C.link};text-decoration:underline;">$1</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code style="background:${C.code};padding:1px 4px;border-radius:3px;font-family:Menlo,Consolas,monospace;font-size:13px;">${codes[i]}</code>`);
}

function render(md) {
  const out = [];
  const stack = []; // open list tags, e.g. ['ul'] or ['ul','ul']
  let quote = null;
  const closeLists = (depth = 0) => { while (stack.length > depth) out.push(stack.length > 1 ? `</${stack.pop()}></li>` : `</${stack.pop()}>`); };
  const flushQuote = () => {
    if (!quote) return;
    out.push(`<div style="background:${C.box};border-left:4px solid ${C.boxLine};padding:12px 16px;margin:0 0 24px;border-radius:4px;font-size:14px;line-height:1.5;">${render(quote.join('\n'))}</div>`);
    quote = null;
  };
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (line.startsWith('>')) { closeLists(); (quote ||= []).push(line.replace(/^>\s?/, '')); continue; }
    flushQuote();
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      closeLists();
      const lvl = m[1].length;
      const style = [
        `margin:0 0 4px;font-size:30px;line-height:1.2;color:${C.accent};letter-spacing:-0.5px;`,
        `margin:36px 0 12px;padding-top:16px;border-top:2px solid ${C.accent};font-size:21px;color:${C.accent};`,
        `margin:22px 0 8px;font-size:17px;color:${C.ink};`,
      ][lvl - 1];
      out.push(`<h${lvl} style="${style}">${inline(m[2])}</h${lvl}>`);
    } else if ((m = line.match(/^(\s*)(?:([-*])|(\d+)\.)\s+(.*)/))) {
      const depth = m[1].length >= 2 ? 2 : 1;
      const tag = m[2] ? 'ul' : 'ol';
      if (depth > stack.length) {
        if (stack.length) { const last = out.pop(); out.push(last.replace(/<\/li>$/, '')); }
        stack.push(tag);
        out.push(`<${tag} style="padding-left:22px;margin:${depth > 1 ? '4px 0' : '8px 0 12px'};">`);
      } else { closeLists(depth); }
      out.push(`<li style="margin:5px 0;line-height:1.55;">${inline(m[4])}</li>`);
    } else if (/^---+$/.test(line)) {
      closeLists(); out.push(`<hr style="border:none;border-top:1px solid ${C.rule};margin:28px 0;">`);
    } else if (!line.trim()) {
      if (!/^\s+[-*\d]/.test(lines[i + 1] || '')) closeLists();
    } else {
      closeLists();
      out.push(`<p style="margin:8px 0;line-height:1.6;">${inline(line)}</p>`);
    }
  }
  flushQuote(); closeLists();
  return out.join('\n');
}

function page(body, title) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#f4f5f7;">
<div style="max-width:680px;margin:0 auto;background:#ffffff;padding:32px 28px 40px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:${C.ink};">
${body}
</div></body></html>
`;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/render-issue.js <issue.md>'); process.exit(1); }
  const md = fs.readFileSync(file, 'utf8');
  const body = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:${C.ink};">\n${render(md)}\n</div>`;
  const dir = path.dirname(file);
  const title = (md.match(/^# (.*)$/m) || [, 'AI Operator Weekly'])[1];
  fs.writeFileSync(path.join(dir, 'issue.html'), page(body, title));
  fs.writeFileSync(path.join(dir, 'beehiiv-body.html'), `${body}\n`);
  console.log(`Wrote ${path.join(dir, 'issue.html')} and ${path.join(dir, 'beehiiv-body.html')}`);
}

module.exports = { render, inline };
