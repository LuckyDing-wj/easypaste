# EasyPaste 项目代码审查报告

## 一、元信息

| 项 | 内容 |
|---|---|
| 审查日期 | 2026-11-08 |
| 审查对象 | `D:\Code\IdeaProjects\easypaste`（Cloudflare Pages 项目，私有网络剪切板） |
| 审查范围 | git 跟踪的全部 12 个文件，100% 覆盖：`functions/api/get.js`、`functions/api/set.js`、`functions/api/verify.js`、`functions/api/_auth.js`、`public/index.html`、`public/_headers`、`public/_redirects`、`wrangler.toml`、`package.json`、`package-lock.json`、`README.md`、`.gitignore` |
| 审查方法 | 只读审查（唯一写入文件为本报告）。逐文件人工通读 + 按认证/鉴权、注入、XSS、CSRF、CORS、配额滥用、边界条件、错误处理、前端质量、配置部署等维度逐项核对；关键平台事实对照 Cloudflare 官方文档核实（`_headers` 作用域、Workers KV 限额、Workers 非标准 `crypto.subtle.timingSafeEqual`） |
| 版本基线 | git HEAD `f7e88bd`（"Access code remembered for 7 days with auto renewal"） |

---

## 二、执行摘要

整体评价：**这是一个安全设计基本正确的小型项目**。认证链路（链接密钥 + 访问码 + HMAC 签名 cookie）全部 fail-closed，无 XSS、无 CSRF、无注入、无敏感信息入库；前端零依赖且全程使用 `textContent`/`value` 渲染；README 面向非技术用户写得非常细致。

主要风险集中在三类：

1. **滥用防护为零（最高优先级）**：`/api/verify` 无速率限制，`/api/set` 无内容大小与频率限制。在"URL 即持有 + 访问码可自选弱口令"的威胁模型下，访问码可被在线爆破，KV 免费配额（1000 写/日）可被写爆导致服务不可用。
2. **防御深度不足**：CSP 因内联脚本被迫开启 `unsafe-inline`；密钥比较非常数时间；安全响应头不覆盖 Functions 响应。
3. **配置与工程化短板**：`wrangler.toml` 缺少 Pages 必需字段（形同虚设）、零测试、本地开发缺 `.dev.vars`、错误处理吞错且状态码语义不准。

问题统计：**高 1 / 中 6 / 低 8 / 信息 6，合计 21 项**。无"立即数据泄漏"级别的致命漏洞，但建议尽快落实 H-1 与 M-1 两条限流/限额措施。

---

## 三、项目概况

EasyPaste 是部署在 Cloudflare Pages 上的单用户私人网络剪切板：

- **数据模型**：KV 单键 `clipboard`，值为 `{content, updatedAt}` JSON，每次保存整体覆盖（只保留最新一条）。
- **认证模型**（`functions/api/_auth.js`）：
  - 三重凭据：URL 中的链接密钥（`CLIP_SECRET`，UUID）→ HTTP 头 `X-Clip-Secret` 必须匹配；然后要么 `X-Clip-Code` 头直接匹配访问码（API 场景），要么携带 HMAC 签名的 `clip_auth` cookie（浏览器场景）。
  - cookie token = `过期时间戳.HMAC-SHA256(exp)`，签名密钥由 `CLIP_SECRET:CLIP_CODE` 派生；7 天有效，剩余不足一半时自动续期（滑动窗口）。
  - `/api/verify` 校验访问码后签发 cookie（`HttpOnly; Secure; SameSite=Strict`）。
- **前端**：`index.html` 单页（含内联 CSS/JS），从 `/clip/xxx` 路径或 `?secret=` 提取密钥，解锁后加载/保存/复制/清空，支持 Ctrl+S 与粘贴自动保存、三态主题。
- **路由**：`_redirects` 将 `/clip/*` 200 重写到 `index.html`；`functions/api/` 目录约定自动映射为 `/api/*` 路由；`_auth.js` 以下划线开头不参与路由。

代码量小（4 个后端文件共约 130 行 + 单页前端约 630 行），无第三方运行时依赖。

---

## 四、分角度详审

### 4.1 架构与代码组织

**结论：结构清晰、职责划分合理，无重大架构问题；存在少量 DRY 与工程化欠缺。**

- 后端按 Pages Functions 目录约定组织，`_auth.js` 抽出公共认证逻辑，`_` 前缀避免误注册路由，是地道的 Pages 实践。
- 认证与业务分离干净：`get.js`/`set.js` 只做"鉴权 + 读写 KV"，token 生成/校验/续期全部内聚在 `_auth.js`，token 无状态（不查库），适配 edge 环境。
- 单键单剪贴板是刻意的极简设计（README 明确"每次保存覆盖"），对本产品定位成立。
- 欠缺点：
  - **I-5（信息）**：`verify.js` 自行重复实现 `X-Clip-Secret` 校验（第 5 行），未复用 `_auth.js` 的逻辑；若将来校验规则变化（如加常量时间比较），两处需同步修改。
  - **I-6（信息）**：无 lint/format/CI，代码风格靠手维护。
  - **I-3（信息）**：`index.html:34-72` 暗色主题 CSS 变量在 `html[data-theme="dark"]` 与 `@media (prefers-color-scheme: dark)` 中完整重复一份，改一处易漏另一处。可用后处理器或 CSS 自定义属性继承消除。

### 4.2 安全

#### 已核查、未发现问题的子项（明确结论）

| 子项 | 结论 | 依据 |
|---|---|---|
| 认证/鉴权逻辑本身 | **未发现问题** | `checkAuth`（`_auth.js:35-59`）所有失败分支均 fail-closed：`CLIP_SECRET` 未配置直接拒绝（36 行）；`CLIP_CODE` 未配置时跳过直通路径且 `verify.js:9` 拒绝空码 → 全站锁死而非开放；畸形 token（无 `.`、`exp` 非整数、过期、签名不符）全部拒绝，`hmac` 校验兜底了 `indexOf('.') === -1` 时 `slice(0,-1)` 的边界情况 |
| CSRF | **未发现问题** | 三重防护叠加：所有写接口要求自定义头 `X-Clip-Secret`（跨站表单/sendBeacon 无法携带，携带则触发 CORS 预检且无 CORS 响应头必然失败）+ cookie `SameSite=Strict` 跨站不发送 + 写接口仅 POST |
| XSS / 注入 | **未发现问题** | 后端无任何 SQL/命令/模板拼接；前端渲染全部走 `contentEl.value`（index.html:512）与 `textContent`（429、448、467、474），无 `innerHTML`/`document.write`/`eval`。前提是 CSP 开洞问题（M-4）不构成实际注入点，但削弱了纵深防御 |
| CORS | **未发现问题** | Functions 未返回任何 CORS 响应头 → 跨源默认拒绝读取；自定义头触发预检必失败，符合"默认安全" |
| 敏感信息泄露（仓库） | **未发现问题** | 仓库无任何硬编码秘密；`.gitignore` 覆盖 `.idea/`；README 中 UUID 为占位示例。注意 README:96 建议用第三方网站生成 UUID 属轻微不良引导（见 L-8） |
| KV 访问控制 | **未发现问题（读路径）** | 读取必须同时持有链接密钥 + 有效访问码凭据；`Cache-Control: no-store`（get.js:25）防止 CDN/代理缓存剪贴板内容 |

#### 发现的问题

**H-1【高】认证端点无速率限制，访问码可在线爆破**
- 位置：`functions/api/verify.js:4-11`（涉及 `_auth.js` 整体）
- 描述：`/api/verify` 对每个请求只做两次字符串比较，无任何节流、无失败计数、无锁定。README:100 引导用户"填你自己记得住的访问码"，实践中往往是 4-6 位数字或常见口令。
- 影响：威胁模型是"链接即持有"——UUID 一旦通过浏览器历史、截图、聊天转发泄漏（M-2），访问码就是唯一屏障。免费版 Pages 每日 10 万次请求额度内，攻击者可长时间稳定爆破（ sustained ≈1.2 req/s，高峰期远高）；6 位数字码一天内可穷举。爆破成功后 cookie 7 天滑动续期（`_auth.js:58`），等于永久占有剪贴板读写权，且无审计痕迹。
- 修复建议：
  1. 用 KV 做固定窗口限流（KV 最终一致，精度有限但足以挡爆破；更严格可换 Durable Object 或 Workers Rate Limiting binding）：

```js
// functions/api/_rate.js（新文件，下划线开头不参与路由）
// 按 IP 的固定窗口限流：windowSec 窗口内最多 max 次
export async function rateLimit(env, ip, windowSec = 300, max = 10) {
  const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = Number((await env.CLIP_KV.get(key)) || 0) + 1;
  if (n === 1) await env.CLIP_KV.put(key, '1', { expirationTtl: windowSec + 60 });
  return n <= max;
}

// verify.js 中，在进入校验前：
const ip = request.headers.get('CF-Connecting-IP');
if (!(await rateLimit(env, ip))) {
  return new Response('Too Many Requests', { status: 429 });
}
```
  2. 在 Cloudflare dashboard 为 `/api/verify` 配置 WAF Rate Limiting 规则（免费版含 1 条），双保险。
  3. README 增加访问码强度要求：≥12 位随机字符串（可用密码管理器生成）。
  注意：限流键取 `CF-Connecting-IP`，勿用 `X-Forwarded-For`（可伪造）。

**M-2【中】链接密钥承载于 URL，且支持更易泄漏的 `?secret=` 查询串变体**
- 位置：`public/index.html:420-422`
  ```js
  const secret = urlParams.get('secret') || (pathParts.length >= 2 && pathParts[0] === 'clip' ? pathParts[1] : null);
  ```
- 描述：URL 中的凭据会进入浏览器历史、收藏夹、聊天记录、截屏；`?secret=` 变体还会进入各级访问日志与 Referrer（路径形式同样会，但查询串的日志覆盖面更广）。`Referrer-Policy: strict-origin-when-cross-origin`（_headers:5）已把跨域 Referrer 降为仅 origin，缓解了跨域泄漏，但对"链接本身被分享/截屏"无能为力。
- 影响：链接密钥泄漏不直接放行（还需访问码），但使 H-1 的爆破成为可能，并显著缩小攻击者工作量。
- 修复建议：删除 `?secret=` 分支，仅保留 `/clip/xxx` 路径形式；README 增加"链接泄漏处置"章节（更换 `CLIP_SECRET` 即全体失效）。若产品允许，可考虑"链接仅定位、凭据完全依赖访问码 + cookie"的纯访问码模式。
  ```js
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const secret = pathParts.length >= 2 && pathParts[0] === 'clip' ? pathParts[1] : null;
  ```

**M-3【中】密钥/访问码/HMAC 比较非常数时间**
- 位置：`functions/api/_auth.js:36`、`39`、`56`；`functions/api/verify.js:5`、`9`
- 描述：`!==` 普通字符串比较在长度/前缀不一致时可产生可测的时间差。JS 引擎字符串比较 + 网络抖动使远程利用极其困难，属防御深度问题而非现实漏洞。
- 影响：理论上可辅助侧信道推断，实际风险低。
- 修复建议：Workers 提供非标准 `crypto.subtle.timingSafeEqual`（仅接受等长 buffer，需自行处理长度差异）：
  ```js
  // _auth.js 内新增
  function safeEq(a, b) {
    const ab = new TextEncoder().encode(a);
    const bb = new TextEncoder().encode(b);
    if (ab.length !== bb.length) return false; // 长度泄漏无害
    return crypto.subtle.timingSafeEqual(ab, bb);
  }
  // 替换所有 !== 比较：X-Clip-Secret、X-Clip-Code、签名、body.code
  ```

**M-4【中】CSP 因内联脚本/样式开启 `unsafe-inline`，防御深度基本归零**
- 位置：`public/_headers:2`
- 描述：`script-src 'self' 'unsafe-inline'` 使 CSP 对脚本注入完全失去防护价值；页面有两个内联 `<script>`（index.html:7-13 主题防闪烁、374-632 主逻辑）与一个大 `<style>` 块，因此当前配置"被迫"开洞。
- 影响：一旦未来任何 DOM 注入点被引入（如改用 `innerHTML` 渲染），CSP 无法兜底；也无法利用 CSP 上报发现回归。
- 修复建议：把两段内联脚本抽为静态文件（如 `public/assets/theme.js`、`public/assets/app.js`），CSP 收紧为：
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'
  ```
  `style-src` 可保留 `unsafe-inline`（样式注入危害远小于脚本），或一并将 `<style>` 抽为 `style.css` 后彻底收紧。同时建议用 CSP 的 `frame-ancestors 'none'` 补充/替代已废弃倾向的 `X-Frame-Options`。

**I-1【信息】`_headers` 安全头不作用于 Functions 响应**
- 位置：`public/_headers`（全局）；`functions/api/*.js`（三个响应点）
- 描述：官方文档明确："Custom headers defined in the `_headers` file are not applied to responses generated by Pages Functions"。即 `/api/get`、`/api/set`、`/api/verify` 的 JSON 响应**不带** CSP、`X-Content-Type-Options: nosniff`、HSTS 等。
- 影响：有限——这些响应是 `Content-Type: application/json` 的 JSON，无 HTML 渲染面；浏览器 HSTS 记忆来自 HTML 文档。但 `nosniff` 缺失在极端情况下（错误 Content-Type 嗅探）理论上可被利用。
- 修复建议：在三个 function 的响应头中统一补齐，或抽一个 `withSecurityHeaders(response)` 工具函数：
  ```js
  // functions/api/_headers.js（新文件）
  export function secured(res) {
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }
  ```

**L-6【低】cookie 未使用 `__Host-` 前缀**
- 位置：`functions/api/_auth.js:31`
- 描述：cookie 属性已满足 `__Host-` 前缀的全部要求（`Secure`、`Path=/`、无 `Domain`），改前缀即可白拿一层浏览器强制（防子域覆写、防降级）。
- 修复建议：
  ```js
  return `__Host-${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL}`;
  ```

**L-8【低】README 安全引导不足**
- 位置：`README.md:96`（推荐第三方网站 uuidgenerator.net 生成密钥）、`README.md:100`（访问码无强度要求）
- 描述：在第三方网站生成密钥等于把秘密暴露给该站点；访问码无强度要求直接放大 H-1。
- 修复建议：改为本地生成（PowerShell：`[guid]::NewGuid()`；或 `openssl rand -hex 16`）；增加"访问码 ≥12 位随机、泄漏后立即更换 `CLIP_SECRET`/`CLIP_CODE`"的说明。顺带说明：更换 `CLIP_CODE` 会使所有已签发 cookie 失效（HMAC 密钥变化），这实际上是现成的"全员登出"机制，值得写进文档。

### 4.3 正确性与边界条件

**结论：核心校验逻辑边界处理良好（fail-closed），但资源上限控制缺失。**

已核查、未发现问题的子项：

- **键校验**：KV 键固定为 `"clipboard"` 字面量，无用户输入参与键名，无键注入面。`get.js:11`。
- **畸形 token 边界**（`_auth.js:51-56`）：`indexOf('.')` 为 -1 时 `expStr` 可能是合法数字，但第 56 行 HMAC 校验必然失败 → 安全兜底；`Number('')` → NaN → `Number.isInteger` 拦截；过期判断 `exp * 1000 < Date.now()` 正确。
- **签名一致性**：`makeToken` 用 `String(exp)` 签名（27 行），`checkAuth` 用 token 原文前缀（56 行），两者一致（token 写入时即 `String(exp)`），无不对称。
- **JSON 解析容错**：`verify.js:8` `request.json().catch(() => ({}))`；`get.js:16-22` 对非 JSON 旧数据回退为原文；`set.js:14` 显式 `typeof content !== 'string'` 校验。均健壮。
- **cookie 过期与 Max-Age 一致**：token `exp = now + TTL`，cookie `Max-Age = TTL`（31 行），无漂移。

发现的问题：

**M-1【中】写入无内容大小限制、无频率限制、KV 无 TTL——配额与容量滥用风险**
- 位置：`functions/api/set.js:14-22`
- 描述：`content` 只要不是字符串就拒绝，但长度不设上限。KV 单值上限 25 MiB；免费版每日 1000 次写、**同一键每秒仅 1 次写**（超限直接报错）；键无 `expirationTtl`，数据永久驻留。
- 影响：持有凭据者（或凭据泄漏后）可：a) 写入 25 MiB 巨块，拖慢每次加载、耗流量；b) 高频写入触发"同键 1 写/秒"限制使正常保存开始报错；c) 轻易写爆每日 1000 次写配额，全站当日不可写；d) 存储永久累积（虽然单键覆盖，影响有限）。
- 修复建议：
  ```js
  // set.js，在 typeof 校验之后：
  const MAX_CONTENT = 1 * 1024 * 1024; // 1 MiB，按需调整
  if (content.length > MAX_CONTENT) {
    return new Response(JSON.stringify({ error: 'content too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // 可选：90 天未保存自动过期（每次 put 刷新 TTL），按产品取舍
  await context.env.CLIP_KV.put('clipboard', data, { expirationTtl: 90 * 86400 });
  ```
  前端也应提前拦截（避免白传 25 MiB）：在 `saveBtn` 点击时检查 `contentEl.value.length > 1_048_576` 并提示。

**L-1【低】错误处理吞错且状态码语义不准**
- 位置：`functions/api/set.js:28-33`（KV 写失败/JSON 解析失败一律 400 "Bad Request"）；`functions/api/get.js:29-34`（吞掉错误只回 500，无日志）
- 描述：`set.js` 的单个 `try` 同时包裹 `request.json()` 与 `KV.put`，KV 故障（配额满、同键超 1 写/秒）会被误报为 400，调用方无法区分"请求有错"还是"服务端故障"；两处 catch 均无 `console.error`，线上排障只能靠猜。
- 修复建议：拆分 try 与补日志：
  ```js
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Bad Request' }, 400);
  }
  try {
    await context.env.CLIP_KV.put('clipboard', data);
  } catch (e) {
    console.error('KV put failed:', e);
    return json({ error: 'Internal error' }, 500);
  }
  ```

**L-2【低】`/api/get` 未限定 GET 方法**
- 位置：`functions/api/get.js:3`
- 描述：`onRequest` 接受任意方法（POST/PUT/DELETE `/api/get` 都会读 KV），与 REST 语义不符，也可能让误用的客户端不易察觉。
- 修复建议：`export async function onRequestGet(context) { ... }`。

**I-2【信息】KV 单键读改写无并发控制（last-write-wins）**
- 位置：`functions/api/set.js:22`；`public/index.html:549-555`
- 描述：两设备并发保存时后写者覆盖先写者，无乐观锁/ETag。此外前端"重解锁不重拉"策略（`everLoaded`）保护了本地未保存编辑，但意味着本地旧内容可能在保存时覆盖服务器上其他设备写入的新内容。对单用户剪切板是可接受的设计取舍，建议在 README 标注。

### 4.4 错误处理与健壮性

**结论：失败路径基本 fail-closed 且有用户可见反馈；问题是吞错无日志（L-1）与一处前端未处理 rejection（L-3）。**

正面确认：
- `verify.js:8` JSON 解析失败回退空对象，不会 500。
- `get.js:15-23` 对 KV 中损坏/历史遗留的非 JSON 数据有回退路径。
- 前端所有 `localStorage` 访问包 try/catch（index.html:8-12、391-403），隐私模式下不崩。
- `load()` 的 403/非 200 分支都有 UI 反馈（index.html:500-507）。
- 解锁按钮防重入（`unlockBtn.disabled` + 文案切换，532-533）；保存按钮防重入（`saving` 标志，565-569）。

**L-3【低】前端 `load()` 无 catch，网络错误静默且产生未处理 rejection**
- 位置：`public/index.html:492-521`
- 描述：`load()` 是 `try { ... } finally { ... }`，没有 catch。`fetch` 网络异常或 `res.json()` 解析失败时：异常沿 `load()`（441 行，未 await）变成 unhandled promise rejection；`finally` 隐藏了 loading 遮罩，但界面停在默认可见的解锁面板上，无任何错误文案。
- 修复建议：
  ```js
  async function load() {
    if (!secret) return;
    try {
      // ...原有逻辑
    } catch (e) {
      showUnlock('加载失败，请检查网络后重试');
    } finally {
      contentEl.placeholder = '在此粘贴内容...';
      loadingOverlay.style.display = 'none';
    }
  }
  ```

### 4.5 性能与成本

**结论：正常单用户使用下成本极低；风险全部来自"无限制"（H-1、M-1、L-4）。**

- 正常用量：一次页面加载 = 1 次 KV 读（100k 读/日额度，占 0.001%）；一次保存 = 1 次 KV 写（1000 写/日）。单用户绰绰有余。
- `get.js` 无缓存层，但 KV 读延迟低且额度大，无必要。
- **滥用放大器**：H-1（爆破走 `/api/verify`，只耗 Pages 请求额度 10 万/日，不耗 KV 写）；M-1（写路径耗 KV 写配额，25 MiB 巨值还耗带宽与读取延迟）；L-4（前端粘贴自动保存放大写次数）。
- **L-4【低】粘贴自动保存防抖不足**
  - 位置：`public/index.html:625-631`
  - 描述：`paste` 事件触发后 300ms 即自动点击保存；连续/分块粘贴（大内容从终端分多次粘贴很常见）会产生多次 KV 写，快速消耗 1000 写/日配额。
  - 修复建议：防抖加长且仅在内容变化时保存：
    ```js
    pasteTimer = setTimeout(() => {
      updateStats();
      if (secret && contentEl.value !== lastSaved) saveBtn.click();
    }, 1500);
    ```

### 4.6 前端质量（index.html）

**结论：质量高于预期，XSS 安全；存在若干 UX 边角问题。**

正面确认：
- **XSS 安全**：动态内容全部经 `textContent`/`.value`，无任何 HTML 注入点（详见 4.2）。
- **可用性细节到位**：FOUC 防闪烁（head 内联主题脚本 try/catch）；`aria-pressed` 三态主题切换、`aria-live="polite"` 错误消息（355）、`<label for>` 关联、44px 最小触控目标；移动端 `textarea` 强制 16px 防 iOS 聚焦缩放（324）；`100dvh` 处理移动端地址栏。
- **状态保护**：`everLoaded`（424、549-555）在授权过期重新解锁后不重拉内容，避免覆盖未保存编辑——这是很用心的设计。
- 解锁表单用 `<form>` + `submit` 事件，回车可用；按钮防重入。

**L-5【低】无未保存内容离开提醒**
- 位置：`public/index.html`（缺失，建议加在脚本尾部）
- 描述：剪贴板的核心场景是"粘贴→切走→回来保存"，误关标签页即丢内容，且没有任何提示。
- 修复建议：
  ```js
  window.addEventListener('beforeunload', (e) => {
    if (contentEl.value !== lastSaved) { e.preventDefault(); e.returnValue = ''; }
  });
  ```
- **I-3【信息】**：暗色 CSS 两份重复（见 4.1）。
- 其余小项：无 favicon（控制台一条 404，可加 `<link rel="icon" href="data:,">` 消除）；`Ctrl+S` 判断 `e.key === 's'` 在 Shift 组合时为 `'S'` 会漏判，可改 `e.key.toLowerCase()`（信息级，不单列）。

### 4.7 配置与部署

**M-5【中】wrangler.toml 缺 Pages 必需字段，形同虚设**
- 位置：`wrangler.toml:1-2`
- 描述：现有内容只有 `name` 与 `compatibility_date`。Pages 项目要让 wrangler 识别该文件，必须包含 `pages_build_output_dir`；KV 绑定也未声明（README 引导全部在 dashboard 手工配置）。后果：a) `wrangler pages deploy` CLI 路径不可用；b) 配置只存在于 dashboard，代码仓库无法复现环境，换账号/重建项目即配置漂移；c) `compatibility_date = "2024-01-01"` 相对审查日（2026-11）已落后近两年。
- 修复建议：
  ```toml
  name = "easypaste"
  compatibility_date = "2026-01-01"   # 升级后回归测试
  pages_build_output_dir = "public"

  [[kv_namespaces]]
  binding = "CLIP_KV"
  id = "<从 dashboard KV 页复制 namespace id>"
  ```
  注意：一旦启用 wrangler.toml 的 Pages 配置，绑定类设置将**以文件为准**，dashboard 中对应项只读，需同步迁移。

**I-1（重申）**：`_headers`/`_redirects` 文件位置正确（在构建输出目录 `public/` 下）、语法正确；`/clip/*  /index.html  200` 是 200 rewrite，`/api/*` 走 Functions 路由不受其影响，语义无误；`_headers` 的规则覆盖 `index.html` 与 `/clip/*` 重写产物（静态资源），但如 4.2 所述不覆盖 Functions 响应。

**L-7【低】本地开发环境缺失**
- 位置：`package.json:5`
- 描述：`wrangler pages dev public --kv CLIP_KV` 启动后 `env.CLIP_SECRET`/`CLIP_CODE` 未定义 → 所有请求 403，本地完全无法联调（README 也未提供本地开发章节）。另外 wrangler 未列入 devDependencies，`npx` 每次拉取最新版，行为可能随版本漂移。
- 修复建议：
  1. 新建 `.dev.vars`（并确认其被 `.gitignore` 忽略）：
     ```
     CLIP_SECRET=dev-secret-00000000-0000-0000-0000-000000000000
     CLIP_CODE=dev-code
     ```
  2. `npm i -D wrangler@latest` 固定版本，脚本改为 `"dev": "wrangler pages dev public --kv CLIP_KV"`。

**I-4【信息】**：无自定义 `404.html`（Cloudflare 默认 404 页可接受）；HSTS 未加 `preload`（对个人项目无必要，可选）。

### 4.8 可维护性与测试

**M-6【中】零测试**
- 位置：全局（无任何测试文件/依赖/脚本）
- 描述：整个项目没有一行测试。最值得覆盖的是 `_auth.js`：token 签发/校验往返、过期拒绝、畸形 token（无点号、非数字、空签名）、续期阈值（TTL/2 边界）、`CLIP_CODE` 缺失时的 fail-closed 行为。这些是纯函数/请求级逻辑，极易测试。
- 修复建议：引入 `vitest` + `@cloudflare/vitest-pool-workers`（可在 Workers 运行时内测 Pages Functions）：
  ```js
  // test/_auth.test.js（示意）
  import { makeToken, checkAuth } from '../functions/api/_auth.js';
  const env = { CLIP_SECRET: 's3cret', CLIP_CODE: 'code123' };
  test('round-trip', async () => {
    const token = await makeToken(env);
    const req = new Request('https://x/', { headers: { Cookie: `clip_auth=${token}` , 'X-Clip-Secret': 's3cret' } });
    expect((await checkAuth(env, req)).ok).toBe(true);
  });
  test('forged token rejected', async () => {
    const req = new Request('https://x/', { headers: { Cookie: 'clip_auth=9999999999.deadbeef', 'X-Clip-Secret': 's3cret' } });
    expect((await checkAuth(env, req)).ok).toBe(false);
  });
  ```

**L-8（重申）**：README 整体质量极高（面向非技术用户的分步教程），仅安全引导两项需补强（见 4.2）。README:28 对 `_auth.js` 不参与路由的解释正确，文档与实现一致（已逐条核对：TTL 天数、覆盖语义、路径格式、绑定名均与代码相符）。

---

## 五、问题清单汇总表

| 编号 | 严重度 | 位置 | 摘要 |
|---|---|---|---|
| H-1 | 高 | functions/api/verify.js:4-11 | 认证端点无限流，弱访问码可在线爆破，成功后滑动续期等于永久占有 |
| M-1 | 中 | functions/api/set.js:14-22 | 无内容大小限制/写入限流/KV TTL，可写爆 KV 免费配额（1000 写/日、25 MiB 值、同键 1 写/秒） |
| M-2 | 中 | public/index.html:420-422 | 链接密钥置于 URL 且支持 `?secret=`，历史/日志/截图泄漏面大 |
| M-3 | 中 | functions/api/_auth.js:36,39,56; verify.js:5,9 | 密钥/访问码/HMAC 比较非常数时间（防御深度） |
| M-4 | 中 | public/_headers:2 | CSP 含 `script-src 'unsafe-inline'`，脚本层防御深度归零 |
| M-5 | 中 | wrangler.toml:1-2 | 缺 `pages_build_output_dir`/KV 绑定声明，配置漂移；compatibility_date 过旧 |
| M-6 | 中 | 全局 | 零测试，认证核心逻辑无回归保障 |
| L-1 | 低 | functions/api/set.js:28-33; get.js:29-34 | KV 故障误报 400；所有 catch 吞错无日志 |
| L-2 | 低 | functions/api/get.js:3 | `onRequest` 未限定 GET 方法 |
| L-3 | 低 | public/index.html:492-521 | `load()` 无 catch：网络错误静默 + 未处理 rejection |
| L-4 | 低 | public/index.html:625-631 | 粘贴自动保存防抖仅 300ms 且不判变更，放大 KV 写次数 |
| L-5 | 低 | public/index.html（缺失） | 无 beforeunload 未保存提醒 |
| L-6 | 低 | functions/api/_auth.js:31 | cookie 未用 `__Host-` 前缀 |
| L-7 | 低 | package.json:5 | 本地开发缺 `.dev.vars`（本地全 403）；wrangler 版本未固定 |
| L-8 | 低 | README.md:96,100 | 推荐第三方网站生成密钥；访问码无强度要求、无泄漏处置指引 |
| I-1 | 信息 | public/_headers | 安全头不作用于 Functions 响应（官方文档确认），API 响应缺 nosniff 等 |
| I-2 | 信息 | functions/api/set.js:22; index.html:549 | KV 单键 last-write-wins，无并发控制；重解锁不重拉可能用旧内容覆盖新内容 |
| I-3 | 信息 | public/index.html:34-72 | 暗色主题 CSS 变量两份重复 |
| I-4 | 信息 | public/ | 缺 404.html、favicon；HSTS 无 preload（可选） |
| I-5 | 信息 | functions/api/verify.js:5 | secret 校验逻辑未复用 `_auth.js`（DRY） |
| I-6 | 信息 | 全局 | 无 lint/format/CI |

统计：高 1、中 6、低 8、信息 6，共 21 项。另有一批子项经核查为"未发现问题"：认证逻辑（fail-closed）、CSRF、XSS/注入、CORS、仓库敏感信息、KV 键注入、畸形 token 边界、_redirects/_headers 语法与位置。

---

## 六、项目亮点

1. **认证模型设计成熟**：链接持有 + 访问码知识的双因素；全链路 fail-closed（`CLIP_SECRET` 缺失、`CLIP_CODE` 缺失、畸形 token、过期 token 一律拒绝）；HMAC 无状态 token 适配 edge；滑动续期；更换 `CLIP_CODE` 即隐式全员登出（密钥派生联动）。
2. **CSRF/CORS 默认安全**：自定义头 + `SameSite=Strict` + 无 CORS 响应头三重叠加，跨站与跨源读取全部天然被拒。
3. **前端零依赖且 XSS 安全**：约 260 行原生 JS 覆盖完整功能，动态渲染全部 `textContent`/`value`，无一个 HTML 注入点。
4. **UX 细节用心**：FOUC 防闪烁（含隐私模式降级）、`everLoaded` 保护未保存编辑、aria 可访问性、44px 触控目标、移动端 16px 防缩放、防重入。
5. **健壮的失败路径**：`json().catch()`、非 JSON 数据回退、localStorage try/catch、错误消息对用户可见且不泄露内部信息。
6. **文档质量罕见地高**：README 是真正面向非技术用户的分步部署教程，且与代码逐条一致（绑定名、TTL、路由语义均核对无误）。
7. **约定优于配置的地道 Pages 实践**：`_` 前缀排除路由、`_redirects`/`_headers` 位置与语法正确、`onRequestPost` 正确限定方法（set/verify）。

---

## 七、优先级整改路线

**P0 — 立即（防滥用，上线即裸奔）**
1. H-1：`/api/verify` 加 KV/IP 限流（代码见 4.2），README 增加访问码强度要求。
2. M-1：`/api/set` 加 1 MiB 上限（前后端双重拦截），评估是否给 KV 写加 `expirationTtl`。

**P1 — 本周（防御深度与工程基础）**
3. M-4：内联脚本抽离，收紧 CSP（`script-src 'self'`），补 `frame-ancestors 'none'`。
4. M-5：补全 `wrangler.toml`（`pages_build_output_dir`、KV 绑定、升级 compatibility_date）。
5. L-1：拆分 set.js 错误处理、补 `console.error`；L-2 改 `onRequestGet`。
6. L-7：`.dev.vars` + 固定 wrangler 版本，补 README 本地开发章节。

**P2 — 近期（前端与文档）**
7. L-3：`load()` 补 catch；L-4：粘贴自动保存加长防抖并判变更；L-5：beforeunload 提醒。
8. M-2：移除 `?secret=` 分支；L-8：README 密钥本地生成指引与泄漏处置章节。
9. M-6：给 `_auth.js` 补 vitest 单测（往返/伪造/过期/畸形/续期阈值）。

**P3 — 择机（低危与信息级）**
10. M-3：常量时间比较；L-6：`__Host-` cookie 前缀；I-1：Functions 响应补 nosniff。
11. I-3：消除 CSS 重复；I-5：verify 复用 _auth 校验；I-6：加 lint + CI；I-4：favicon/404。

---

## 八、修复记录（2026-11-09）

按本报告全部 21 项问题逐一修复。原则：保持零运行时依赖、fail-closed、极简；未执行 git commit/push。

| 编号 | 状态 | 说明 | 关键改动位置 |
|---|---|---|---|
| H-1 | 已修复 | 新增 KV 固定窗口限流（键 `rl:<CF-Connecting-IP>:<窗口号>`，未用可伪造的 X-Forwarded-For）；`/api/verify` 在一切校验前限流：5 分钟窗口 10 次/IP，超限 429（fail-closed：KV 读写故障也按超限处理）。README 补充访问码 ≥12 位要求与限流说明。未采用报告建议的"仅 n===1 时写 KV"写法——那会使计数恒为 2、限流失效，改为"未超限才写回计数" | `functions/api/_rate.js`（新增）、`functions/api/verify.js:8-11` |
| M-1 | 已修复 | `content` 超 1 MiB 返回 413；写路径限流 1 分钟 6 次/IP（置于 checkAuth 之后，未认证请求不消耗 KV 读）；前端保存前预检大小并提示。**KV 维持不加 expirationTtl**：剪贴板数据丢失不可接受，宁可数据永久保留（报告建议中 TTL 为"可选"项），取舍已写入 README"设计说明" | `functions/api/set.js:4,17-20,26-34`、`public/assets/app.js`（MAX_CONTENT 预检与 413/429 文案）、`README.md` |
| M-2 | 已修复 | 删除 `?secret=` 分支，仅保留 `/clip/xxx` 路径形式；README 注明旧格式链接已废弃需更换 | `public/assets/app.js:71-72`、`README.md`（使用章节注记） |
| M-3 | 已修复 | 新增 `safeEq(a,b)`：长度不等直接 false，Workers 用原生 `crypto.subtle.timingSafeEqual`，其他环境（Node 测试）回退手写异或常量时间比较；`_auth.js` 三处（secret/code/HMAC 签名）与 `verify.js`（body.code）全部替换。注意 Node 26 无 Workers 特有的 `timingSafeEqual`，回退分支是测试可运行的前提 | `functions/api/_auth.js:26-40`、`functions/api/verify.js:17` |
| M-4 | 已修复 | 两段内联脚本抽为 `public/assets/theme.js`（head 阻塞式外链，先于首次渲染执行，防闪烁天然成立）与 `public/assets/app.js`（body 末尾）；CSP 收紧为 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'`（内联 `<style>` 保留故 style 保留 unsafe-inline；img-src data: 为 data: favicon） | `public/assets/theme.js`、`public/assets/app.js`（新增）、`public/index.html`（634→350 行）、`public/_headers` |
| M-5 | 已修复 | 补 `pages_build_output_dir = "public"`、`[[kv_namespaces]] binding="CLIP_KV"`（id 为占位符 + 注释指引到 dashboard 复制）、`compatibility_date = "2026-01-01"`；注释说明启用文件后 dashboard 对应项只读 | `wrangler.toml` |
| M-6 | 已修复 | 用 Node 内置 test runner（**零 npm 依赖**），新增 18 个用例：token 签发/校验往返、伪造签名拒绝、过期拒绝、畸形 token（无点号/非数字 exp/空签名）、续期阈值（剩余 < TTL/2 换新、≥ TTL/2 不换、续期 cookie 内新 token 可通过校验）、CLIP_CODE 缺失 fail-closed、CLIP_SECRET 缺失/头不匹配、safeEq 全分支（含模拟 Workers 原生 timingSafeEqual）、authCookie `__Host-` 前缀属性、限流（超限/IP 隔离/TTL 参数/无 IP 与无 KV 放行/读写故障 fail-closed，注入假 env.CLIP_KV）、json()/secured() 响应头。package.json 加 `"test": "node --test test/"` | `test/_auth.test.js`、`test/_rate.test.js`、`test/_headers.test.js`（新增）、`package.json` |
| L-1 | 已修复 | set.js 拆分 JSON 解析（400）与 KV 写（500 + `console.error`）两个 try；get.js 读失败补 `console.error`；新增 `json()` 响应工具统一出口 | `functions/api/set.js:22-39`、`functions/api/get.js:28-30`、`functions/api/_headers.js`（新增） |
| L-2 | 已修复 | `onRequest` 改为 `onRequestGet`，`/api/get` 仅接受 GET | `functions/api/get.js:4` |
| L-3 | 已修复 | `load()` 补 catch，网络错误显示"加载失败，请检查网络后重试"；不再产生未处理 rejection | `public/assets/app.js:132-134` |
| L-4 | 已修复 | 粘贴自动保存防抖 300ms→1500ms，且仅 `contentEl.value !== lastSaved` 时才保存 | `public/assets/app.js:199-208` |
| L-5 | 已修复 | beforeunload 未保存提醒（有 secret 且内容与 lastSaved 不一致时触发） | `public/assets/app.js:211-216` |
| L-6 | 已修复 | cookie 名改 `__Host-clip_auth`（保持 HttpOnly/Secure/SameSite=Strict/Path=/，无 Domain），读/写同名校验闭环 | `functions/api/_auth.js:6,49-52` |
| L-7 | 已修复 | 新增 `.dev.vars.example`（占位值模板）与 `.dev.vars`（本地开发值，已加入 .gitignore）；`npm i -D wrangler` 实际成功（网络慢但可用，固定 `^4.158.0` 入 devDependencies + lock），dev 脚本改为本地 `wrangler pages dev public --kv CLIP_KV`；README 补"本地开发与测试"章节 | `.dev.vars.example`、`.dev.vars`（新增）、`.gitignore`、`package.json`、`README.md` |
| L-8 | 已修复 | README：密钥改为本地生成（PowerShell `[guid]::NewGuid()` / `openssl rand -hex 16`，明确不要用第三方网站）；访问码 ≥12 位随机要求；新增"安全与泄漏处置"章节（换 `CLIP_SECRET` 全体旧链接失效、换 `CLIP_CODE` 即全员登出需重新输码、内置限流与 cookie 前缀说明）；移除 `?secret=` 说明 | `README.md`（第五步、安全与泄漏处置） |
| I-1 | 已修复 | 新增 `functions/api/_headers.js` 导出 `secured(res)`（nosniff + no-store）与 `json(data, status, extra)` 工具；get/set/verify 全部 JSON 响应（含 403/429/413/400/500）统一走该出口 | `functions/api/_headers.js`（新增）、三个路由文件 |
| I-2 | 已修复 | README"设计说明"补充：多设备并发保存为后写覆盖、无冲突合并，单用户可接受；同时说明数据永久保留与 1 MiB 上限取舍 | `README.md`（设计说明） |
| I-3 | 已修复 | JS 始终将 `data-theme` 归一为 `light|dark`（auto 由 theme.js/app.js 用 matchMedia 解析并监听变化），CSS 只保留 `html[data-theme="dark"]` 一份变量，删除 `@media (prefers-color-scheme: dark)` 重复段；theme.js 为 head 内阻塞式外链脚本，执行先于首次渲染，防 FOUC 不退化 | `public/assets/theme.js`、`public/assets/app.js:35-56`、`public/index.html` |
| I-4 | 已修复 | `<link rel="icon" href="data:,">` 消除 favicon 404；新增极简 `public/404.html`（无脚本，符合 CSP）。HSTS preload 维持不加（报告标注为个人项目可选） | `public/index.html:7`、`public/404.html`（新增） |
| I-5 | 已修复 | `_auth.js` 导出 `checkSecret(env, request)`（safeEq 版），verify.js 复用之并删除自实现比较；checkAuth 内部同样复用 | `functions/api/_auth.js:43-47`、`functions/api/verify.js:14` |
| I-6 | 已修复 | 新增 `.github/workflows/ci.yml`：push/PR 跑 `node --test test/` + 对 `functions/api/*.js` 与 `public/assets/*.js` 逐个 `node --check`，未引入任何 lint 依赖 | `.github/workflows/ci.yml`（新增） |

### 验证结果

- `npm test`（即 `node --test test/`，Node v26.13.0）：**18 个测试全部通过，0 失败**（duration ≈ 200ms）。
- `node --check`：`functions/api/_auth.js`、`_headers.js`、`_rate.js`、`get.js`、`set.js`、`verify.js` 全部通过；另加验 `public/assets/*.js` 与 `test/*.js` 亦全部通过。
- 端到端冒烟（Node 全局 Request/Response + 假 KV 直接驱动三个 handler）：verify 错误码 403 / 正确码 200 + `__Host-clip_auth` Set-Cookie / 同 IP 第 11 次 429；set 未认证 403 / 正常保存 200 / 超 1 MiB 413 / 坏 JSON 400；get 读回内容 200 且带 nosniff + no-store / 未认证 403。
- `git status` 确认 `.dev.vars` 已被忽略、未执行任何 commit/push。

### 修复中的取舍决策

1. **限流计数策略**：报告建议代码只在 n===1 时写 KV，会使计数恒停在 2、限流失效；改为每次未超限时写回计数，put 失败（含 KV 同键 1 写/秒，本身即高频信号）按超限处理，保持 fail-closed。
2. **set.js 限流位置**：置于 checkAuth 之后（未认证请求不消耗 KV 读）；verify.js 按要求置于一切校验之前（爆破面在访问码）。
3. **safeEq 环境回退**：`crypto.subtle.timingSafeEqual` 为 Workers 特有，Node 26 无此 API；保留原生优先、异或常量时间回退，保证零依赖测试可运行。
4. **防 FOUC 方案**：theme.js 保留 head 内**阻塞式外链**脚本（非内联），阻塞脚本先于首次渲染执行，无需为 CSP 开 `unsafe-inline`，I-3 与 M-4 同时成立。
5. **KV 不加 expirationTtl**：数据丢失不可接受，维持永久保留（写入 README 与本记录）。
6. **API 错误响应统一 JSON**：verify/get 的 403 从纯文本改为 JSON（前端仅看状态码，行为不变），前端相应增加 429/413 针对性文案。
7. **package.json 加 `"type": "module"`**：消除 node --test 的模块类型警告；仓库无 CJS 代码，无副作用。
8. **wrangler 固定版本成功**：`npm i -D wrangler` 实际可用（^4.158.0），采用 devDependencies 方案而非 `npx wrangler@^4` 兜底。
9. **CI 用 Node 24（LTS）**；本地验证环境为 Node 26。
10. **顺手修复报告 4.6 信息级小项**：Ctrl+S 判断改 `e.key.toLowerCase()`，修复 Shift 组合时漏判。
11. **`.dev.vars` 预填开发占位值**（dev-secret-00000000-…/dev-code-123456），与 `.dev.vars.example`、README 本地开发章节保持一致。
