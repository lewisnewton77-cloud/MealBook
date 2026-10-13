// Fallback for recipe pages the browser-side reader can't make sense of (no recipe data, other
// languages, odd layouts). Fetches the page and lets Claude pull out ingredients and method.
import { requireUser, fail, json, errResponse } from "../lib/auth.mjs";
import { checkedUrl, fetchHtml, pageToText } from "../lib/page.mjs";

export const config = { path: "/api/read-recipe-page", method: "POST" };

const PROMPT =
  'Below is the text of a web page that should contain one cooking recipe. Extract it. Reply with ONLY a JSON object and no other text: {"title":string,"servings":number or null,"time_minutes":number or null,"tags":[up to 3 short lowercase tags],"ingredients":[one string per ingredient including its quantity, in the order the page lists them],"method":[one string per step, in the correct cooking order, without step numbers]}. Use only what is on the page and keep its original language. If the page has method steps but no ingredient list, build the ingredients from the quantities mentioned in the method and say nothing else. If there is no recipe at all, return {"ingredients":[],"method":[]}.';

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
    const target = checkedUrl(String(body.url || ""));
    const text = pageToText(await fetchHtml(target));

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 2500,
        messages: [{ role: "user", content: PROMPT + "\n\n" + text }],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("Anthropic error", r.status, t.slice(0, 300));
      throw fail(
        502,
        r.status === 401 || r.status === 403
          ? "The Anthropic key in Netlify was rejected."
          : "Claude could not read that page (error " + r.status + ")."
      );
    }
    const data = await r.json();
    const out = (data.content || []).map((c) => c.text || "").join("");
    const a = out.indexOf("{");
    const b = out.lastIndexOf("}");
    if (a < 0 || b < a) throw fail(502, "Claude did not return a recipe.");
    let recipe;
    try {
      recipe = JSON.parse(out.slice(a, b + 1));
    } catch {
      throw fail(502, "Claude did not return a readable recipe.");
    }
    return json(200, recipe);
  } catch (e) {
    return errResponse(e);
  }
};
