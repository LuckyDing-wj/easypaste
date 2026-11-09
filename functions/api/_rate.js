// KV 固定窗口限流：windowSec 秒窗口内每 IP 最多 max 次
// KV 计数是最终一致 + 边缘缓存，精度有限，但足以挡在线爆破
export async function rateLimit(env, ip, windowSec = 300, max = 10) {
  if (!env.CLIP_KV || !ip) return true; // 本地开发或无 CF-Connecting-IP 时放行
  try {
    const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = Number((await env.CLIP_KV.get(key)) || 0) + 1;
    if (n > max) return false;
    await env.CLIP_KV.put(key, String(n), { expirationTtl: windowSec + 60 });
    return true;
  } catch (e) {
    // 读失败或同键写超限（1 写/秒，即高频访问信号），按超限处理
    return false;
  }
}
