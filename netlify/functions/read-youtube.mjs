// Reads a YouTube video's title, description and (when available) captions on the server, then
// lets Claude pull the recipe out of them.
import { requireUser, fail, json, errResponse } from "../lib/auth.mjs";
import { fetchHtml } from "../lib/page.mjs";

export const config = { path: "/api/read-youtube", method: "POST" };

const PROMPT =
  'Below is the title, description and (if available) spoken captions of a cooking video. Extract the recipe. Reply with ONLY a JSON object and no other text: {"title":string,"servings":number or null,"time_minutes":number or null,"tags":[up to 3 short lowercase tags],"ingredients":[one string per ingredient including its quantity if given],"method":[one string per step in cooking order, without step numbers],"problem":string or null}. Use only what the description or captions say and keep their language. If quantities are not stated, list the ingredient names without inventing amounts. If there is no recipe in the material, return empty arrays and explain in problem. Otherwise problem is null.';

const unesc = (s) => {
  try {
    return JSON.parse('"' + s + '"');
  } catch {
    return s;
  }
};

export function parseWatchPage(html) {
  const title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1] || "";
  const d = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  const description = d ? unesc(d[1]) : "";
  const tracks = [];
  const ct = html.match(/"captionTracks":\[(.*?)\],"audioTracks"|"captionTracks":\[(.*?)\]/s);
  const blob = ct ? ct[1] || ct[2] || "" : "";
  const parts = blob.split('"baseUrl":"').slice(1);
  for (const part of parts) {
    const u = part.match(/^((?:[^"\\]|\\.)*)"/);
    const lang = part.slice(0, 1500).match(/"languageCode":"([\w-]+)"/);
    if (u) tracks.push({ url: unesc(u[1]), lang: lang ? lang[1] : "" });
  }
  const consentWall = /consent\.youtube\.com|Before you continue to YouTube/i.test(html);
  return { title: unesc(title).replace(/&amp;/g, "&"), description, tracks, consentWall };
}

async function getCaptions(tracks) {
  if (!tracks.length) return "";
  const t = tracks.find((x) => /^(en|da)/.test(x.lang)) || tracks[0];
  try {
    const r = await fetch(t.url + (t.url.includes("fmt=") ? "" : "&fmt=json3"), {
      headers: { "user-agent": "Mozilla/5.0", "accept-language": "en-GB,en;q=0.9" },
    });
    if (!r.ok) return "";
    const body = await r.text();
    try {
      const j = JSON.parse(body);
      return (j.events || [])
        .flatMap((e) => (e.segs || []).map((s) => s.utf8 || ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 25000);
    } catch {
      return body
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 25000);
    }
  } catch {
    return "";
  }
}

export default async (req) => {
  try {
    await requireUser(req);
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw fail(500, "ANTHROPIC_API_KEY is not set in Netlify.");
    let body;
    try {
      body = await req.json();
    } catch {
      throw fail(400, "Bad request.");
    }
    const id = String(body.id || "");
    if (!/^[\w-]{11}$/.test(id)) throw fail(400, "That doesn't look like a YouTube video.");

    const html = await fetchHtml("https://www.youtube.com/watch?v=" + id + "&hl=en", 4_000_000);
    const p = parseWatchPage(html);
    const captions = await getCaptions(p.tracks);
    const diag = {
      description: p.description.length,
      captions: captions.length,
      consentWall: p.consentWall,
    };
    if (!p.description && !captions) {
      throw fail(
        502,
        p.consentWall
          ? "YouTube showed the server a consent page instead of the video."
          : "YouTube did not give the server this video's description or captions."
      );
    }

    const material =
      "TITLE: " + p.title + "\n\nDESCRIPTION:\n" + p.description.slice(0, 8000) +
      (captions ? "\n\nSPOKEN CAPTIONS:\n" + captions : "");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 2500,
        messages: [{ role: "user", content: PROMPT + "\n\n" + material }],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("Anthropic error", r.status, t.slice(0, 300));
      throw fail(
        502,
        r.status === 401 || r.status === 403
          ? "The Anthropic key in Netlify was rejected."
          : "Claude could not read that video (error " + r.status + ")."
      );
    }
    const data = await r.json();
    const out = (data.content || []).map((c) => c.text || "").join("");
    const a = out.indexOf("{");
    const b = out.lastIndexOf("}");
    let recipe = { ingredients: [], method: [] };
    if (a >= 0 && b > a) {
      try {
        recipe = JSON.parse(out.slice(a, b + 1));
      } catch {}
    }
    return json(200, { ...recipe, videoTitle: p.title, description: p.description.slice(0, 4000), diag });
  } catch (e) {
    return errResponse(e);
  }
};
