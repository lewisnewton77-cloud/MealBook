// Reads a recipe from one or more screenshots using Claude (vision).
// The Anthropic key lives in Netlify's environment settings, never in the browser.
import { requireUser, fail, json, errResponse } from "../lib/auth.mjs";

export const config = { path: "/api/read-screenshot", method: "POST" };

const PROMPT =
  'Extract the recipe from these screenshots (they may be consecutive parts of one recipe). Reply with ONLY a JSON object and no other text: {"title":string,"servings":number or null,"time_minutes":number or null,"tags":[up to 3 short lowercase tags],"ingredients":[one string per ingredient including its quantity, in original order],"method":[one string per step, without step numbers]}. Do not invent anything that is not visible. Keep the original language of the recipe.';

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
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((s) => typeof s === "string" && s.length > 100)
      .slice(0, 6);
    if (!images.length) throw fail(400, "No image received.");
    if (images.reduce((n, s) => n + s.length, 0) > 4_500_000) throw fail(413, "Those images are too large.");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 2500,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((data) => ({
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data },
              })),
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("Anthropic error", r.status, t.slice(0, 300));
      throw fail(
        502,
        r.status === 401 || r.status === 403
          ? "The Anthropic key in Netlify was rejected."
          : "Claude could not read the image (error " + r.status + ")."
      );
    }

    const data = await r.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a < 0 || b < a) throw fail(502, "Claude did not return a recipe.");
    let recipe;
    try {
      recipe = JSON.parse(text.slice(a, b + 1));
    } catch {
      throw fail(502, "Claude did not return a readable recipe.");
    }
    return json(200, recipe);
  } catch (e) {
    return errResponse(e);
  }
};
