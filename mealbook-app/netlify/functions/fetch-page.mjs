// Fetches a recipe web page (or a YouTube watch page) on the server, so the browser doesn't need
// flaky public proxies. Only signed-in, allowed users can call it.
import { requireUser, fail, errResponse } from "../lib/auth.mjs";

export const config = { path: "/api/fetch-page", method: "GET" };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_CHARS = 3_500_000;

function checkedUrl(raw) {
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

export default async (req) => {
  try {
    await requireUser(req);
    const target = checkedUrl(new URL(req.url).searchParams.get("url") || "");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let text;
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
      text = await r.text();
    } catch (e) {
      if (e.status) throw e;
      throw fail(502, "Could not reach that site.");
    } finally {
      clearTimeout(timer);
    }

    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
    return new Response(text, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return errResponse(e);
  }
};
