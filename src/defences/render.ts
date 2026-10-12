// Defence 3 · Render policy (lesson 3)
//
// What the screen does with the model's output is a channel too:
//   - an image is a request the reader never chose, to a host the model picked
//   - a link's text can name one place and go to another
//   - raw HTML can look exactly like your own buttons
//
// So the safe renderer escapes everything first, then lets a small set of markdown back in: bold,
// inline code, code blocks, quotes, lists, links and images. Images load only from this app's own paths.
// Every link shows the host it really goes to and opens only when clicked. No raw HTML, ever.
//
// The naive renderer is what a quick markdown function often does. It's here so you can compare.
// (Even the naive one drops scripts, styles and event handlers: this app runs in your browser.)

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
const unescapeHtml = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity]!);

export function renderMarkdown(markdown: string, { safe }: { safe: boolean }): string {
  const held: string[] = []; // finished HTML, kept away from the later steps
  const hold = (html: string) => `${held.push(html) - 1}`;
  let text = markdown.replace(/\r\n/g, "\n").replace(/[]/g, "");

  // Code blocks first, so nothing inside them is treated as markdown.
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) =>
    hold(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`),
  );

  // The one line that matters most: from here on, "<" in the model's output is just a character.
  text = safe ? escapeHtml(text) : withoutScripts(text);

  const html = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => renderBlock(block, safe, hold))
    .join("\n");
  // Placeholders can nest (a code span inside a link), so swap until none are left.
  let out = html;
  while (/\d+/.test(out)) out = out.replace(/(\d+)/g, (_, i: string) => held[Number(i)]);
  return out;
}

function renderBlock(block: string, safe: boolean, hold: (html: string) => string) {
  if (/^\d+$/.test(block)) return block; // a code block
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

function inline(text: string, safe: boolean, hold: (html: string) => string) {
  return text
    .replace(/`([^`]+)`/g, (_, code: string) => hold(`<code>${safe ? code : escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, url: string) => hold(image(alt, url, safe)))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => hold(link(label, url, safe)))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function image(alt: string, url: string, safe: boolean) {
  if (!safe) return `<img src="${url.replace(/"/g, "%22")}" alt="${alt.replace(/"/g, "")}">`;
  const raw = unescapeHtml(url);
  if (raw.startsWith("/") && !raw.startsWith("//")) return `<img src="${url}" alt="${alt}">`; // this app's own image
  return `<span class="blocked-image">[image not shown: ${escapeHtml(hostOf(raw) ?? "unknown host")}]</span>`;
}

function link(label: string, url: string, safe: boolean) {
  if (!safe) return `<a href="${url.replace(/"/g, "%22")}">${label}</a>`;
  const raw = unescapeHtml(url);
  const host = /^https?:\/\//i.test(raw) ? hostOf(raw) : null;
  if (!host) return `${label} <span class="link-host">link removed</span>`;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${label}</a> <span class="link-host">${escapeHtml(host)}</span>`;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

/** The naive renderer passes HTML through, minus the parts that would make this demo actually dangerous. */
function withoutScripts(html: string) {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|template|base|meta|link|form)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

// ── what the rendered HTML would do in a browser (for the terminal demo and the hardening suite) ──

export interface Audit {
  /** Hosts the browser would contact the moment the reply appears. */
  remoteImages: string[];
  /** Every link: what it says, and where it really goes. */
  links: { text: string; host: string }[];
  /** Elements that came from raw HTML in the model's output, not from markdown. */
  rawHtml: string[];
}

const MARKDOWN_TAGS = new Set(["p", "br", "strong", "code", "pre", "ul", "li", "blockquote", "a", "img", "span"]);

export function auditHtml(html: string): Audit {
  const remoteImages = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)]
    .map((m) => unescapeHtml(m[1]))
    .filter((src) => !src.startsWith("/") || src.startsWith("//"))
    .map((src) => hostOf(src) ?? src);
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    text: unescapeHtml(m[2].replace(/<[^>]+>/g, "")),
    host: hostOf(unescapeHtml(m[1])) ?? m[1],
  }));
  const rawHtml = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)]
    .filter(([, tag, attributes]) => !MARKDOWN_TAGS.has(tag.toLowerCase()) || /\sstyle\s*=/i.test(attributes))
    .map(([element]) => element);
  return { remoteImages, links, rawHtml };
}
