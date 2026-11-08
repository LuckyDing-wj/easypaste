// 免输访问码有效期（天）：解锁一次后，该浏览器在此期间免输访问码
// 每次成功请求自动续期（剩余不足一半时重新签发 cookie）
const TTL_DAYS = 7;
const TTL = TTL_DAYS * 24 * 3600;
const COOKIE_NAME = 'clip_auth';

function b64url(buf) {
  let s = '';
  new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// token = 过期时间戳.HMAC 签名，签名密钥由 CLIP_SECRET + CLIP_CODE 派生
async function hmac(env, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.CLIP_SECRET + ':' + env.CLIP_CODE),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

export async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + TTL;
  return exp + '.' + (await hmac(env, String(exp)));
}

export function authCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL}`;
}

// 校验请求：X-Clip-Code 直接通过，或有效 cookie token（临近过期时返回续期 Set-Cookie）
export async function checkAuth(env, request) {
  if (!env.CLIP_SECRET || request.headers.get('X-Clip-Secret') !== env.CLIP_SECRET) {
    return { ok: false };
  }
  if (env.CLIP_CODE && request.headers.get('X-Clip-Code') === env.CLIP_CODE) {
    return { ok: true };
  }

  const cookies = {};
  (request.headers.get('Cookie') || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  const token = cookies[COOKIE_NAME];
  if (!token) return { ok: false };

  const dot = token.indexOf('.');
  const expStr = token.slice(0, dot);
  const exp = Number(expStr);
  const sig = token.slice(dot + 1);
  if (!Number.isInteger(exp) || !sig || exp * 1000 < Date.now()) return { ok: false };
  if (sig !== (await hmac(env, expStr))) return { ok: false };

  const refresh = exp - Date.now() / 1000 < TTL / 2 ? authCookie(await makeToken(env)) : null;
  return { ok: true, refresh };
}
