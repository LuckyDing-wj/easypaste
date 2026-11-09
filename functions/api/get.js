import { checkAuth } from './_auth.js';
import { json } from './_headers.js';

export async function onRequestGet(context) {
  const auth = await checkAuth(context.env, context.request);

  if (!auth.ok) {
    return json({ error: 'Forbidden' }, 403);
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
        content = raw; // 兼容历史遗留的非 JSON 数据
      }
    }

    const extra = auth.refresh ? { "Set-Cookie": auth.refresh } : {};
    return json({ content, updatedAt }, 200, extra);
  } catch (e) {
    console.error("KV get failed:", e);
    return json({ error: "Internal error" }, 500);
  }
}
