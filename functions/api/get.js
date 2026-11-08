import { checkAuth } from './_auth.js';

export async function onRequest(context) {
  const auth = await checkAuth(context.env, context.request);

  if (!auth.ok) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const raw = await context.env.CLIP_KV.get("clipboard");
    let content = "";
    let updatedAt = null;

    if (raw) {
      try {
        const data = JSON.parse(raw);
        content = data.content || "";
        updatedAt = data.updatedAt || null;
      } catch {
        content = raw;
      }
    }

    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (auth.refresh) headers["Set-Cookie"] = auth.refresh;

    return new Response(JSON.stringify({ content, updatedAt }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
