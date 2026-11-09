# EasyPaste - 私人网络剪切板

一个简单的网络剪切板，部署在 Cloudflare Pages 上。收藏一个链接，打开就能用。

## 它能做什么

- 收藏一个链接，打开就能粘贴和读取文本内容
- 换个设备打开同一个链接，也能看到之前保存的内容
- 打开页面后需要输入访问码，验证通过才会加载内容
- 解锁一次后 7 天内同一浏览器免输访问码，每次使用自动续期（有效期在 `functions/api/_auth.js` 的 `TTL_DAYS` 修改）
- 每次保存会覆盖之前的内容（只保留最新的一条）
- 单条内容上限 1 MiB，超出会被拒绝保存
- 浅色纸面风格，暖橙色主操作，长时间编辑更耐看
- 支持 Ctrl+S 快捷保存

## 项目里有什么文件

```
easypaste/
├── public/                    # 网页文件（Cloudflare 会自动托管这个文件夹）
│   ├── index.html             # 网页界面（你看到的页面）
│   ├── 404.html               # 访问不存在路径时显示的页面
│   ├── assets/
│   │   ├── theme.js           # 主题防闪烁（页面加载前先设置浅色/夜间）
│   │   └── app.js             # 页面交互逻辑（加载/保存/复制等）
│   ├── _redirects             # 告诉 Cloudflare 把 /clip/* 请求都指向 index.html
│   └── _headers               # 安全设置（防止别人嵌入你的页面等）
├── functions/                 # 后端 API（Cloudflare 自动运行）
│   └── api/
│       ├── get.js             # 读取剪切板内容的接口
│       ├── set.js             # 保存剪切板内容的接口（含 1 MiB 上限与写入限流）
│       ├── verify.js          # 校验访问码并签发免输访问码 cookie 的接口（含限流）
│       ├── _auth.js           # 授权校验与 cookie 续期（下划线开头，不作为路由）
│       ├── _rate.js           # 按 IP 的限流工具（下划线开头，不作为路由）
│       └── _headers.js        # API 响应安全头工具（下划线开头，不作为路由）
├── test/                      # 单元测试（node --test 运行，无需安装依赖）
├── .github/workflows/ci.yml   # GitHub Actions：推送时自动跑语法检查和测试
├── .dev.vars.example          # 本地开发环境变量模板
├── package.json               # 项目信息
├── package-lock.json          # npm 锁文件
├── wrangler.toml              # Cloudflare 配置文件
└── README.md                  # 你现在看的这个文件
```

## 第一次配置（只需要做一次）

### 第一步：创建 Cloudflare 账号

1. 打开 https://dash.cloudflare.com/sign-up
2. 用邮箱注册一个账号（免费的）
3. 登录进入控制台

### 第二步：创建 KV 存储空间

KV 是 Cloudflare 提供的免费存储服务，用来保存你的剪切板内容。

1. 登录 Cloudflare 控制台后，看左边的菜单
2. 点击 **Workers & Pages**
3. 点击 **KV**（在页面上方的标签栏里）
4. 点击蓝色的 **Create a namespace** 按钮
5. 名字填 `easypaste-kv`（随便填，但建议用这个名字）
6. 点击 **Add**
7. 创建成功后，你会看到一个列表，里面有一行显示你刚创建的 KV 空间

### 第三步：创建 Pages 项目并关联 GitHub

Pages 是 Cloudflare 提供的免费网站托管服务。

1. 在 Cloudflare 控制台，点击左边菜单的 **Workers & Pages**
2. 点击页面上方的 **Create application**
3. 点击 **Pages** 标签
4. 点击 **Connect to Git**
5. 如果你还没关联过 GitHub，会提示你授权 Cloudflare 访问你的 GitHub 账号
   - 点击 **Connect GitHub**
   - 登录你的 GitHub 账号
   - 授权 Cloudflare 访问
6. 选择你的 GitHub 仓库（就是 easypaste 这个项目所在的仓库）
7. 点击 **Begin setup**
8. 在配置页面：
   - **Framework preset**：选 `None`
   - **Build command**：留空（什么都不填）
   - **Build output directory**：填 `public`
9. 点击 **Save and Deploy**

第一次部署会失败（因为还没配置 KV 和环境变量），没关系，继续往下做。

### 第四步：绑定 KV 存储空间

1. 进入你的 Pages 项目页面
2. 点击上方的 **Settings** 标签
3. 点击左侧的 **Functions**
4. 往下滚，找到 **KV namespace bindings**
5. 点击 **Add binding**
6. 填写：
   - **Variable name**：`CLIP_KV`（必须是这个名字，不能改）
   - **KV namespace**：选择刚才创建的 `easypaste-kv`
7. 点击 **Save**

### 第五步：设置环境变量

1. 还是在 **Settings** 页面
2. 点击左侧的 **Environment variables**
3. 点击 **Add variable**
4. 填写：
   - **Variable name**：`CLIP_SECRET`（必须是这个名字）
   - **Value**：填一个 UUID，**在你自己的电脑上生成**（不要用网上的生成网站，避免密钥经过第三方）：
     - Windows：按 `Win+R` 输入 `powershell` 回车，然后输入 `[guid]::NewGuid().ToString()` 回车，复制输出的那串字符
     - Mac/Linux：终端里运行 `openssl rand -hex 16`
     - 格式类似 `550e8400-e29b-41d4-a716-446655440000`
   - **Encrypt**：建议勾上（加密保存，更安全）
5. 再点击 **Add variable**，继续添加访问码：
   - **Variable name**：`CLIP_CODE`（必须是这个名字）
   - **Value**：填你自己设置的访问码，**至少 12 位随机字符**（建议用密码管理器生成，不要用生日、手机号等能猜到的内容）
   - **Encrypt**：建议勾上
6. 点击 **Save**

### 第六步：重新部署

1. 点击上方的 **Deployments** 标签
2. 找到最近一次部署（应该显示失败）
3. 点击它右边的三个点 **···**
4. 点击 **Retry deployment**
5. 等待 1-2 分钟，状态变成绿色的 **Success** 就成功了

## 怎么使用

1. 打开你的网站地址，格式是：
   ```
   https://你的域名/clip/你的UUID
   ```
   例如：`https://easypaste.pages.dev/clip/550e8400-e29b-41d4-a716-446655440000`

2. **收藏这个链接**，以后直接打开就能用

   链接里的 UUID 是访问密钥，会和环境变量 `CLIP_SECRET` 校验。当前项目是一个部署实例共用一个剪切板，每次保存都会覆盖 KV 里的最新内容。

   > 注意：链接只支持 `/clip/你的UUID` 路径形式。旧版本支持过的 `?secret=你的UUID` 写法已移除（查询串更容易被浏览器历史、访问日志记录），如果你还存着老格式的链接，请换成上面的新格式。

3. 打开后你可以：
   - 先输入环境变量 `CLIP_CODE` 里设置的访问码
   - 在文本框里粘贴内容
   - 点击 **保存**（或按 Ctrl+S）保存内容
   - 点击 **复制** 把内容复制到剪切板
   - 点击 **清空** 清除文本框

## 绑定自己的域名（可选）

如果你有自己的域名，想用 `https://你的域名/clip/你的UUID` 来访问：

1. 进入 Pages 项目页面
2. 点击上方的 **Custom domains** 标签
3. 点击 **Set up a custom domain**
4. 输入你的域名（如 `paste.example.com`）
5. 按提示添加 DNS 记录（Cloudflare 会告诉你怎么操作）
6. 等待几分钟，域名就配置好了

## 怎么更新代码

以后如果你想改代码（比如改页面样式），流程是：

1. 修改代码
2. 推送到 GitHub：
   ```bash
   git add .
   git commit -m "修改了xxx"
   git push
   ```
3. Cloudflare 会自动检测到代码变化，自动部署新版本（等 1-2 分钟就好）

不需要手动去 Cloudflare 控制台操作。

## 本地开发与测试（可选）

想在电脑上先跑起来再部署，按下面步骤：

1. 安装 Node.js（https://nodejs.org 下载 LTS 版本）
2. 在项目文件夹里打开终端，执行：
   ```bash
   npm install
   ```
   这会安装本地开发工具 wrangler（只装在项目文件夹里，不会部署任何东西）。
3. 复制 `.dev.vars.example` 为 `.dev.vars`（这个文件已被 `.gitignore` 忽略，不会上传到 GitHub），里面预填了本地开发用的密钥和访问码。
4. 启动本地服务：
   ```bash
   npm run dev
   ```
5. 浏览器打开终端里显示的地址，格式如 `http://localhost:8788/clip/dev-secret-00000000-0000-0000-0000-000000000000`，访问码是 `dev-code-123456`（见 `.dev.vars`）。

跑测试（不需要联网，不需要安装额外依赖）：

```bash
npm test
```

## 安全与泄漏处置

这个项目的安全 = 链接密钥（`CLIP_SECRET`）+ 访问码（`CLIP_CODE`）两道门。链接密钥挡住"不知道链接的人"，访问码挡住"见过链接但不知道码的人"。任何一道疑似泄漏，都建议立即处理：

- **换访问码（`CLIP_CODE`）**：在 Cloudflare dashboard 的环境变量里改掉并重新部署。所有已登录的浏览器会立即失效（登录凭证是用访问码参与签名的，码一变全部作废），相当于"全员登出"，需要重新输入新访问码。适合"别人看过我输码"或"访问码太弱想加强"的情况。
- **换链接密钥（`CLIP_SECRET`）**：同样在环境变量里改掉并重新部署。**所有旧链接立即失效**，你需要用新值重新收藏链接。适合"链接被转发/截屏/出现在公开场合"的情况。
- 两道都怀疑泄漏就两个都换。换之前想清楚：旧链接会失效，各设备需要重新收藏新链接、重新输码。

另外几点内置的防护，了解即可：

- `/api/verify`（验证访问码）按 IP 限流：5 分钟内最多 10 次，超过返回 429。这是防止别人拿到链接后在线爆破访问码。
- `/api/set`（保存）按 IP 限流：1 分钟内最多 6 次。
- 访问码请设置至少 12 位随机字符，配合限流让爆破基本不可行。
- 登录凭证 cookie 使用 `__Host-` 前缀（浏览器强制只能在本站、HTTPS 下使用，其他子域无法伪造）。

## 设计说明（了解即可）

- **多设备并发保存是"后写覆盖"**：两台设备同时编辑时，最后点保存的那台会覆盖另一台的内容，本项目不做冲突合并。对单用户剪切板这是可接受的取舍，但请避免在两台设备上同时编辑。
- **内容永久保留**：剪切板数据在 KV 里不设过期时间——丢数据比占存储更不可接受，所以宁可让它一直留着。
- **单条上限 1 MiB**：前端保存前会预检并提示，后端也会拒绝超限内容，防止超大内容拖慢加载。
- **测试与持续集成**：推送代码后 GitHub Actions 会自动运行语法检查和单元测试（`.github/workflows/ci.yml`），测试不通过时可以在 GitHub 仓库的 Actions 标签页看到失败原因。

## 常见问题

**Q：打开网页显示"请通过正确的链接访问"？**
A：检查你的链接格式是否正确，必须是 `https://域名/clip/你的UUID` 这种格式。

**Q：保存内容后刷新页面看不到？**
A：检查 KV 绑定是否正确。Variable name 必须是 `CLIP_KV`，KV namespace 必须选择 `easypaste-kv`。

**Q：显示"密钥无效"？**
A：检查环境变量 `CLIP_SECRET` 是否设置正确，链接里的 UUID 是否和环境变量里的一致；同时检查 `CLIP_CODE` 是否和页面里输入的访问码一致。

**Q：部署一直失败？**
A：检查 Build output directory 是否填的是 `public`。
