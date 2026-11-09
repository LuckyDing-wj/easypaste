// Pages 的 _headers 文件不作用于 Functions 响应，需手动补安全头
export function secured(res) {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// JSON 响应统一出口：Content-Type + 安全头
export function json(data, status = 200, extra = {}) {
  const res = new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
  return secured(res);
}
