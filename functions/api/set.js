import { checkAuth } from './_auth.js';
import { rateLimit } from './_rate.js';
import { json } from './_headers.js';

const MAX_CONTENT = 1024 * 1024; // 1 MiB，防巨块拖慢加载与耗尽流量

export async function onRequestPost(context) {
  const auth = await checkAuth(context.env, context.request);

  if (!auth.ok) {
    return json({ error: 'Forbidden' }, 403);
  }

  // 写路径限流：1 分钟窗口 6 次/IP，防写爆 KV 每日配额
  if (!(await rateLimit(context.env, context.request.headers.get('CF-Connecting-IP'), 60, 6))) {
    return json({ error: 'Too Many Requests' }, 429);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Bad Request' }, 400);
  }
  const { content } = body;

  if (typeof content !== "string") {
    return json({ error: "content must be a string" }, 400);
  }
  if (content.length > MAX_CONTENT) {
    return json({ error: "content too large" }, 413);
  }

  // KV 不加 expirationTtl：剪贴板数据丢失不可接受，数据永久保留（取舍见 README）
  const data = JSON.stringify({ content, updatedAt: new Date().toISOString() });
  try {
    await context.env.CLIP_KV.put("clipboard", data);
  } catch (e) {
    console.error("KV put failed:", e);
    return json({ error: "Internal error" }, 500);
  }

  const extra = auth.refresh ? { "Set-Cookie": auth.refresh } : {};
  return json({ ok: true }, 200, extra);
}
