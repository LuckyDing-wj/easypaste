export async function onRequestPost(context) {
  const secret = context.request.headers.get("X-Clip-Secret");

  if (!secret || secret !== context.env.CLIP_SECRET) {
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
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Bad Request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
