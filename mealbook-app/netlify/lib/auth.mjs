// Shared helpers for the Netlify functions.
// Every function checks that the caller is signed in with one of the allowed Google accounts
// before doing anything (so nobody else can use your server or your Claude credit).

export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const errResponse = (e) => json(e.status || 500, { error: e.message || "Something went wrong" });

// Verifies the Firebase ID token the browser sends, using Google's own lookup endpoint,
// and checks the verified email against ALLOWED_EMAILS. Returns the email.
export async function requireUser(req) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/i);
  if (!m) throw fail(401, "Please sign in again.");

  const key = process.env.FIREBASE_API_KEY;
  const allowed = (process.env.ALLOWED_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!key || !allowed.length) {
    throw fail(500, "The server is not set up yet (FIREBASE_API_KEY / ALLOWED_EMAILS are missing in Netlify).");
  }

  let r;
  try {
    r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: m[1] }),
    });
  } catch {
    throw fail(502, "Could not check your sign-in. Try again.");
  }
  if (!r.ok) throw fail(401, "Please sign in again.");

  const data = await r.json().catch(() => ({}));
  const u = (data.users || [])[0];
  if (!u || !u.email || !u.emailVerified || !allowed.includes(String(u.email).toLowerCase())) {
    throw fail(403, "This account is not allowed.");
  }
  return u.email;
}
