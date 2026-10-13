// Fetches a recipe web page (or a YouTube watch page) on the server, so the browser doesn't need
// flaky public proxies. Only signed-in, allowed users can call it.
import { requireUser, errResponse } from "../lib/auth.mjs";
import { checkedUrl, fetchHtml } from "../lib/page.mjs";

export const config = { path: "/api/fetch-page", method: "GET" };

export default async (req) => {
  try {
    await requireUser(req);
    const target = checkedUrl(new URL(req.url).searchParams.get("url") || "");

    const text = await fetchHtml(target);
    return new Response(text, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return errResponse(e);
  }
};
