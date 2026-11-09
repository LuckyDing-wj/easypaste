import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secured, json } from '../functions/api/_headers.js';

test('json() 默认 200 并带安全头', async () => {
  const res = json({ ok: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: true });
});

test('json() 支持自定义状态码与附加头（如 Set-Cookie）', () => {
  const res = json({ error: 'Forbidden' }, 403, { 'Set-Cookie': '__Host-clip_auth=1.2; Secure' });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Set-Cookie'), '__Host-clip_auth=1.2; Secure');
});

test('secured() 给已有响应补 nosniff 与 no-store', () => {
  const res = secured(new Response('x', { status: 500 }));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
