import { makeToken, authCookie, checkSecret, safeEq } from './_auth.js';
import { rateLimit } from './_rate.js';
import { json } from './_headers.js';

// 校验访问码，通过后为该浏览器签发免输访问码的 cookie
export async function onRequestPost({ request, env }) {
  // 进入校验前先限流：防弱访问码在线爆破（5 分钟窗口 10 次/IP）
  if (!(await rateLimit(env, request.headers.get('CF-Connecting-IP'), 300, 10))) {
    return json({ error: 'Too Many Requests' }, 429);
  }
  if (!checkSecret(env, request)) {
    return json({ error: 'Forbidden' }, 403);
  }
  const body = await request.json().catch(() => ({}));
  if (!env.CLIP_CODE || typeof body.code !== 'string' || !safeEq(body.code, env.CLIP_CODE)) {
    return json({ error: 'Forbidden' }, 403);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': authCookie(await makeToken(env)) });
}
