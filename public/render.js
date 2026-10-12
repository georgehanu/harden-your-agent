// The transcript's markdown renderer. This is the UI channel defence 3 is about, so it lives on its own
// and mirrors src/defences/render.ts: escape everything, then let a small set of markdown back in.
// Safe mode blocks remote images, shows each link's real host, and allows no raw HTML. Naive mode is the
// quick renderer most apps ship, kept here only so you can switch to it and see what it lets through.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESC[c]);
const UNESC = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const unescapeHtml = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (e) => UNESC[e]);
const hostOf = (url) => {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

export function renderMarkdown(markdown, safe) {
  const held = [];
  const hold = (html) => `${held.push(html) - 1}`;
  let text = String(markdown).replace(/\r\n/g, "\n").replace(/[]/g, "");

  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => hold(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`));
  text = safe ? escapeHtml(text) : withoutScripts(text);

  const html = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => renderBlock(block, safe, hold))
    .join("\n");

  let out = html;
  while (/\d+/.test(out)) out = out.replace(/(\d+)/g, (_, i) => held[Number(i)]);
  return out;
}

function renderBlock(block, safe, hold) {
  if (/^\d+$/.test(block)) return block;
  const lines = block.split("\n");
  const quote = /^(&gt;|>)\s?/;
  if (lines.every((line) => quote.test(line))) {
    return `<blockquote>${inline(lines.map((line) => line.replace(quote, "")).join("<br>"), safe, hold)}</blockquote>`;
  }
  if (lines.every((line) => /^[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ""), safe, hold)}</li>`).join("")}</ul>`;
  }
  return `<p>${inline(lines.join("<br>"), safe, hold)}</p>`;
}

function inline(text, safe, hold) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${safe ? code : escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => hold(image(alt, url, safe)))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => hold(link(label, url, safe)))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function image(alt, url, safe) {
  if (!safe) return `<img src="${url.replace(/"/g, "%22")}" alt="${alt.replace(/"/g, "")}">`;
  const raw = unescapeHtml(url);
  if (raw.startsWith("/") && !raw.startsWith("//")) return `<img src="${url}" alt="${alt}">`;
  return `<span class="blocked-image">image not shown · ${escapeHtml(hostOf(raw) ?? "unknown host")}</span>`;
}

function link(label, url, safe) {
  if (!safe) return `<a href="${url.replace(/"/g, "%22")}">${label}</a>`;
  const raw = unescapeHtml(url);
  const host = /^https?:\/\//i.test(raw) ? hostOf(raw) : null;
  if (!host) return `${label} <span class="link-host">link removed</span>`;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${label}</a> <span class="link-host">${escapeHtml(host)}</span>`;
}

function withoutScripts(html) {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|template|base|meta|link|form)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}
