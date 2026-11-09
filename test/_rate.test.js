import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../functions/api/_rate.js';

// 内存版 KV：记录 put 的值与 expirationTtl，可注入故障
function fakeKV({ failGet = false, failPut = false } = {}) {
  const store = new Map();
  const ttlOf = new Map();
  return {
    get: async (k) => {
      if (failGet) throw new Error('get failed');
      return store.get(k) ?? null;
    },
    put: async (k, v, opts) => {
      if (failPut) throw new Error('put failed');
      store.set(k, v);
      ttlOf.set(k, opts?.expirationTtl);
    },
    store,
    ttlOf,
  };
}

test('窗口内未超限放行，超限拒绝', async () => {
  const env = { CLIP_KV: fakeKV() };
  for (let i = 0; i < 10; i++) {
    assert.equal(await rateLimit(env, '1.1.1.1', 300, 10), true, `第 ${i + 1} 次`);
  }
  assert.equal(await rateLimit(env, '1.1.1.1', 300, 10), false);
});

test('不同 IP 互相独立', async () => {
  const env = { CLIP_KV: fakeKV() };
  assert.equal(await rateLimit(env, '1.1.1.1', 300, 1), true);
  assert.equal(await rateLimit(env, '2.2.2.2', 300, 1), true);
  assert.equal(await rateLimit(env, '1.1.1.1', 300, 1), false);
  assert.equal(await rateLimit(env, '2.2.2.2', 300, 1), false);
});

test('计数写入带过期 TTL（窗口 + 60s 缓冲）', async () => {
  const kv = fakeKV();
  await rateLimit({ CLIP_KV: kv }, '1.1.1.1', 300, 10);
  const key = [...kv.store.keys()][0];
  assert.match(key, /^rl:1\.1\.1\.1:\d+$/);
  assert.equal(kv.ttlOf.get(key), 360);
});

test('无 IP 或无 CLIP_KV 时放行（本地开发）', async () => {
  assert.equal(await rateLimit({ CLIP_KV: fakeKV() }, null), true);
  assert.equal(await rateLimit({}, '1.1.1.1'), true);
});

test('KV 读/写故障时按超限处理（fail-closed）', async () => {
  assert.equal(await rateLimit({ CLIP_KV: fakeKV({ failGet: true }) }, '1.1.1.1'), false);
  assert.equal(await rateLimit({ CLIP_KV: fakeKV({ failPut: true }) }, '1.1.1.1'), false);
});
