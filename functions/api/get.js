export async function onRequest(context) {
  const secret = context.request.headers.get("X-Clip-Secret");

  if (!secret || secret !== context.env.CLIP_SECRET) {
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

    return new Response(JSON.stringify({ content, updatedAt }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
