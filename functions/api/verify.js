import { makeToken, authCookie } from './_auth.js';

// 校验访问码，通过后为该浏览器签发免输访问码的 cookie
export async function onRequestPost({ request, env }) {
  if (request.headers.get('X-Clip-Secret') !== env.CLIP_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.code || body.code !== env.CLIP_CODE) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': authCookie(await makeToken(env)) },
  });
}
