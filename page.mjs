// Shared helpers for reading web pages on the server.
import { fail } from "./auth.mjs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function checkedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw fail(400, "That doesn't look like a web address.");
  }
  if (!/^https?:$/.test(u.protocol)) throw fail(400, "Only http(s) links are allowed.");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.includes(":") || // IPv6 literals
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) // IPv4 literals
  ) {
    throw fail(400, "That address is not allowed.");
  }
  return u;
}

export async function fetchHtml(target, maxChars = 3_500_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(target, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9,da;q=0.8",
        cookie: "CONSENT=YES+1; SOCS=CAI",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!r.ok) throw fail(502, "That site answered with error " + r.status + ".");
    const text = await r.text();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch (e) {
    if (e.status) throw e;
    throw fail(502, "Could not reach that site.");
  } finally {
    clearTimeout(timer);
  }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", frac12: "½", frac14: "¼", frac34: "¾", deg: "°" };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

// Turns a page into readable text, one line per block, and keeps any recipe data blocks.
export function pageToText(html, maxChars = 45000) {
  const ld = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/"Recipe"/.test(m[1])) ld.push(m[1].trim().slice(0, 12000));
  }
  let t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  t = decode(t)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  const body = (ld.length ? "STRUCTURED DATA FROM PAGE:\n" + ld.join("\n") + "\n\n" : "") + "PAGE TEXT:\n" + t;
  return body.slice(0, maxChars);
}
