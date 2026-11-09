import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeToken, authCookie, checkAuth, checkSecret, safeEq } from '../functions/api/_auth.js';

const env = { CLIP_SECRET: 'test-secret', CLIP_CODE: 'test-code-123456' };
const TTL_MS = 7 * 24 * 3600 * 1000;

// 在偏移后的时钟下执行（用于过期/续期阈值测试）
function withClock(offsetMs, fn) {
  const real = Date.now;
  Date.now = () => real() + offsetMs;
  return Promise.resolve().then(fn).finally(() => { Date.now = real; });
}

function authedRequest(token, extra = {}) {
  return new Request('https://x.example/clip/s', {
    headers: { 'X-Clip-Secret': 'test-secret', Cookie: `__Host-clip_auth=${token}`, ...extra },
  });
}

test('token 签发/校验往返', async () => {
  const token = await makeToken(env);
  assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/);
  const auth = await checkAuth(env, authedRequest(token));
  assert.equal(auth.ok, true);
  assert.equal(auth.refresh, null); // 新 token 不应触发续期
});

test('伪造签名拒绝', async () => {
  assert.equal((await checkAuth(env, authedRequest('9999999999.deadbeef'))).ok, false);
  const token = await makeToken(env);
  const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  assert.equal((await checkAuth(env, authedRequest(tampered))).ok, false);
});

test('过期 token 拒绝', async () => {
  const token = await makeToken(env);
  await withClock(TTL_MS + 60_000, async () => {
    const auth = await checkAuth(env, authedRequest(token));
    assert.equal(auth.ok, false);
  });
});

test('畸形 token 拒绝（无点号/非数字 exp/空签名）', async () => {
  for (const bad of ['nodot', 'abc.def', '1234567890.']) {
    assert.equal((await checkAuth(env, authedRequest(bad))).ok, false, bad);
  }
});

test('剩余不足 TTL/2 时返回续期 cookie，充足时不返回', async () => {
  const token = await makeToken(env);
  await withClock(Math.floor(TTL_MS / 2) + 1000, async () => {
    const auth = await checkAuth(env, authedRequest(token));
    assert.equal(auth.ok, true);
    assert.match(auth.refresh, /^__Host-clip_auth=\d+\.[A-Za-z0-9_-]+;/);
    // 续期 cookie 里的新 token 本身应可通过校验
    const newToken = auth.refresh.split(';')[0].split('=')[1];
    assert.equal((await checkAuth(env, authedRequest(newToken))).ok, true);
  });
  await withClock(Math.floor(TTL_MS / 2) - 1000, async () => {
    const auth = await checkAuth(env, authedRequest(token));
    assert.equal(auth.ok, true);
    assert.equal(auth.refresh, null);
  });
});

test('CLIP_CODE 缺失时 fail-closed（直通头不放行、无 cookie 拒绝）', async () => {
  const envNoCode = { CLIP_SECRET: 'test-secret' };
  assert.equal((await checkAuth(envNoCode, authedRequest('x', { 'X-Clip-Code': 'anything' }))).ok, false);
  const token = await makeToken(env);
  assert.equal((await checkAuth(envNoCode, authedRequest(token))).ok, false);
});

test('CLIP_SECRET 缺失或头不匹配时拒绝', async () => {
  assert.equal(checkSecret({ CLIP_SECRET: 'test-secret' }, new Request('https://x/', { headers: { 'X-Clip-Secret': 'test-secret' } })), true);
  assert.equal(checkSecret({ CLIP_SECRET: 'test-secret' }, new Request('https://x/', { headers: { 'X-Clip-Secret': 'wrong' } })), false);
  assert.equal(checkSecret({ CLIP_SECRET: 'test-secret' }, new Request('https://x/')), false);
  assert.equal(checkSecret({}, new Request('https://x/', { headers: { 'X-Clip-Secret': 'test-secret' } })), false);
});

test('safeEq：相等/不等/长度不等/空串', () => {
  assert.equal(safeEq('abc', 'abc'), true);
  assert.equal(safeEq('abc', 'abd'), false);
  assert.equal(safeEq('abc', 'ab'), false);
  assert.equal(safeEq('', ''), true);
  assert.equal(safeEq('abc', 'ABC'), false);
});

test('safeEq：Workers 原生 timingSafeEqual 分支', () => {
  const fake = (a, b) => {
    assert.equal(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  };
  crypto.subtle.timingSafeEqual = fake;
  try {
    assert.equal(safeEq('same', 'same'), true);
    assert.equal(safeEq('same', 'diff'), false);
  } finally {
    delete crypto.subtle.timingSafeEqual;
  }
});

test('authCookie 使用 __Host- 前缀且属性齐全', () => {
  const cookie = authCookie('1.2');
  assert.match(cookie, /^__Host-clip_auth=1\.2;/);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
    assert.ok(cookie.includes(attr), attr);
  }
  assert.ok(!cookie.toLowerCase().includes('domain='));
});
