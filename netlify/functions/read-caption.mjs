// Reads a recipe from a social-media caption (Instagram reels and posts).
// Two ways in: { text } = a caption the person pasted, or { url } = an Instagram link, where we
// try to read the public caption from the page. Instagram often refuses automated readers; when
// it does we say so plainly and the app offers the paste box instead.
import { requireUser, fail, json, errResponse } from "../lib/auth.mjs";
import { checkedUrl, fetchHtml } from "../lib/page.mjs";

export const config = { path: "/api/read-caption", method: "POST" };

const PROMPT =
  'Below is the caption of a social-media video (usually an Instagram reel) that contains a cooking recipe. Extract it. Reply with ONLY a JSON object and no other text: {"title":string,"servings":number or null,"time_minutes":number or null,"tags":[up to 3 short lowercase tags],"ingredients":[one string per ingredient including its quantity, in the order given],"method":[one string per step in the correct cooking order, without step numbers],"problem":string or null}. Ignore hashtags, emoji decoration, like and comment counts, mentions, "follow me", giveaways and links. Keep the original language. Use only what the caption says: do not invent ingredients, quantities or steps. If the caption has ingredients but no method (or the reverse), return what exists and say what is missing in problem. If the caption contains no recipe at all, return empty arrays and explain in problem. Otherwise problem is null.';

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const meta = (html, name) => {
  const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', "i");
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + name + '["\']', "i");
  const m = html.match(re1) || html.match(re2);
  return m ? decode(m[1]).trim() : "";
};

// Instagram's description looks like:  12K likes, 340 comments - name on May 1, 2026: "caption…"
export function captionFromPage(html) {
  const found = [];
  for (const n of ["og:description", "description", "twitter:description"]) {
    let d = meta(html, n);
    if (!d) continue;
    const m = d.match(/^[^:"“]{0,200}?\s(?:on|på)\s[^:]{3,40}:\s*["“”]?([\s\S]+?)["“”]?\.?$/);
    if (m && /likes?|comments?|synes godt om|kommentarer|views|visninger/i.test(d.slice(0, 120))) d = m[1];
    found.push(d);
  }
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const o of Array.isArray(j) ? j : [j]) for (const k of ["caption", "articleBody", "description"]) if (typeof o[k] === "string") found.push(o[k]);
    } catch {}
  }
  for (const m of html.matchAll(/"caption":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/g)) {
    try { found.push(JSON.parse('"' + m[1] + '"')); } catch {}
  }
  found.sort((a, b) => b.length - a.length);
  return found[0] || "";
}

export default async (req) => {
  try {
    await requireUser(req);
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw fail(500, "ANTHROPIC_API_KEY is not set in Netlify.");
    let body;
    try { body = await req.json(); } catch { throw fail(400, "Bad request."); }

    let text = String(body.text || "").trim().slice(0, 20000);
    let fromPage = false;
    if (!text) {
      const target = checkedUrl(String(body.url || ""));
      if (!/(^|\.)instagram\.com$/i.test(target.hostname)) throw fail(400, "This reader only handles Instagram links.");
      let html = "";
      try { html = await fetchHtml(target, 1_500_000); } catch (e) {
        throw fail(422, "Instagram wouldn't let the app read that post (" + (e.message || "blocked") + ").");
      }
      text = captionFromPage(html).trim();
      fromPage = true;
      if (text.length < 40) throw fail(422, "Instagram wouldn't share this post's caption with the app.");
    }
    const truncated = fromPage && /(…|\.\.\.)\s*$/.test(text);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: PROMPT + "\n\nCAPTION:\n" + text }],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("Anthropic error", r.status, t.slice(0, 300));
      throw fail(502, r.status === 401 || r.status === 403 ? "The Anthropic key in Netlify was rejected." : "Claude could not read that caption (error " + r.status + ").");
    }
    const data = await r.json();
    const out = (data.content || []).map((c) => c.text || "").join("");
    const a = out.indexOf("{"), b = out.lastIndexOf("}");
    if (a < 0 || b < a) throw fail(502, "Claude did not return a recipe.");
    let recipe;
    try { recipe = JSON.parse(out.slice(a, b + 1)); } catch { throw fail(502, "Claude did not return a readable recipe."); }
    recipe.caption = text;
    if (truncated) recipe.truncated = true;
    return json(200, recipe);
  } catch (e) {
    return errResponse(e);
  }
};
