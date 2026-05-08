# EasyPaste - 私人网络剪切板

一个简单的网络剪切板，部署在 Cloudflare Pages 上。收藏一个链接，打开就能用。

## 它能做什么

- 收藏一个链接，打开就能粘贴和读取文本内容
- 换个设备打开同一个链接，也能看到之前保存的内容
- 每次保存会覆盖之前的内容（只保留最新的一条）
- 浅色纸面风格，青绿色主操作，长时间编辑更耐看
- 支持 Ctrl+S 快捷保存

## 项目里有什么文件

```
easypaste/
├── public/                    # 网页文件（Cloudflare 会自动托管这个文件夹）
│   ├── index.html             # 网页界面（你看到的页面）
│   ├── _redirects             # 告诉 Cloudflare 把 /clip/* 请求都指向 index.html
│   ├── _routes.json           # 告诉 Cloudflare 哪些请求需要走后端 API
│   └── _headers               # 安全设置（防止别人嵌入你的页面等）
├── functions/                 # 后端 API（Cloudflare 自动运行）
│   └── api/
│       ├── get.js             # 读取剪切板内容的接口
│       └── set.js             # 保存剪切板内容的接口
├── package.json               # 项目信息
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

### 第五步：设置密钥环境变量

1. 还是在 **Settings** 页面
2. 点击左侧的 **Environment variables**
3. 点击 **Add variable**
4. 填写：
   - **Variable name**：`CLIP_SECRET`（必须是这个名字）
   - **Value**：填一个 UUID，可以用这个网站生成 https://www.uuidgenerator.net/ （格式类似 `550e8400-e29b-41d4-a716-446655440000`）
   - **Encrypt**：建议勾上（加密保存，更安全）
5. 点击 **Save**

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

3. 打开后你可以：
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

## 常见问题

**Q：打开网页显示"请通过正确的链接访问"？**
A：检查你的链接格式是否正确，必须是 `https://域名/clip/你的UUID` 这种格式。

**Q：保存内容后刷新页面看不到？**
A：检查 KV 绑定是否正确。Variable name 必须是 `CLIP_KV`，KV namespace 必须选择 `easypaste-kv`。

**Q：显示"密钥无效"？**
A：检查环境变量 `CLIP_SECRET` 是否设置正确，链接里的 UUID 是否和环境变量里的一致。

**Q：部署一直失败？**
A：检查 Build output directory 是否填的是 `public`。
