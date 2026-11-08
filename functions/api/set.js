import { checkAuth } from './_auth.js';

export async function onRequestPost(context) {
  const auth = await checkAuth(context.env, context.request);

  if (!auth.ok) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const body = await context.request.json();
    const { content } = body;

    if (typeof content !== "string") {
      return new Response(JSON.stringify({ error: "content must be a string" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = JSON.stringify({ content, updatedAt: new Date().toISOString() });
    await context.env.CLIP_KV.put("clipboard", data);

    const headers = { "Content-Type": "application/json" };
    if (auth.refresh) headers["Set-Cookie"] = auth.refresh;

    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Bad Request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
