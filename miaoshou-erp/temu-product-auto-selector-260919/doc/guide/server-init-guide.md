
问：


	server端怎么用？
	有哪些信息需要配置才能启动server？
	微信那边的东西在哪配置？
	另外，我完全不会用cloudflare的wrangler cli















可以。你这版 `server/` 实际上已经是一个可以独立运行的 **Cloudflare Worker + D1 + R2 + AI Relay 管理后台**。你完全不会 Wrangler 没关系，先按“本地 mock → Cloudflare 正式环境 → 最后接微信”的顺序做最容易。

这一版已经修正 D1 migration 脚本：`wrangler.jsonc` 的 binding 与 `package.json` 都统一使用 **`DB`**，因此可以直接执行 `npm run db:migrate:local` / `npm run db:migrate:remote`。

## 一、这个 server 到底需要配置哪些东西？

你当前的架构可以理解成：

```text
Chrome 插件
   │
   │ 手机号登录 / 获取模型 / AI推理
   ▼
Cloudflare Worker
   ├── D1        用户、验证码、Session、渠道、模型、权限、用量
   ├── R2        调试/可选AI审计
   ├── Workers AI
   ├── 第三方AI，例如腾讯云/OpenAI兼容中转
   └── 微信公众号
```

真正“启动 Server”时，核心配置是这些：

| 配置                    | 本地开发     | 正式环境      | 用途                 |
| --------------------- | -------- | --------- | ------------------ |
| `ADMIN_TOKEN`         | 必须       | 必须        | 登录你自己的管理后台         |
| `LOGIN_CODE_SECRET`   | 必须       | 必须        | 手机验证码 Hash         |
| `UPSTREAM_MASTER_KEY` | 必须       | 必须        | 加密保存上游 API Key     |
| D1                    | 本地模拟     | 必须创建      | 用户、渠道、权限、用量        |
| R2                    | 本地模拟     | 当前配置下建议创建 | 调试/审计              |
| Workers AI            | 可选实际调用   | 可选        | Cloudflare 自己的模型渠道 |
| `WECHAT_TOKEN`        | mock 时不要 | 微信正式环境需要  | 微信回调签名             |
| `WECHAT_APPID`        | mock 时不要 | 微信正式环境需要  | 公众号 AppID          |
| `WECHAT_SECRET`       | mock 时不要 | 微信正式环境需要  | 公众号 AppSecret      |
| 上游 AI Key             | 启动不需要    | 推理时才需要    | 在网页后台配置渠道          |

因此，**你第一次本地启动，微信任何东西都不用配。**

---

# 二、第一次本地启动：照着做就行

你是 Windows，下面直接按 PowerShell 写。

### 1. 解压项目并进入 server

比如：

```powershell
cd D:\xxx\temu-product-auto-selector-260919-v1.3.0\server
```

确认这里能看到：

```text
package.json
wrangler.jsonc
src\
public\
migrations\
.dev.vars.example
```

### 2. 安装依赖

先确保已经安装 Node.js。推荐直接用当前 Node.js LTS。

然后：

```powershell
npm install
```

这里会自动安装 Wrangler，不需要你另外研究怎么安装 Wrangler。

以后所有 Wrangler 命令都用：

```powershell
npx wrangler ...
```

即可。

### 3. 登录 Cloudflare

执行：

```powershell
npx wrangler login
```

浏览器会弹出 Cloudflare 页面。

登录你的 Cloudflare 账号，然后授权 Wrangler。

完成后可以检查：

```powershell
npx wrangler whoami
```

Cloudflare 官方也是采用 `wrangler login` 完成授权；以后 `wrangler deploy` 就可以直接把 Worker 发布到你的账号。([Cloudflare Docs][1])

### 4. 建立本地 `.dev.vars`

执行：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

然后用记事本打开：

```powershell
notepad .dev.vars
```

你现在只需要认真设置三个值。

可以先生成三个随机值。

生成 `ADMIN_TOKEN`：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

再执行一次，作为：

```text
LOGIN_CODE_SECRET
```

然后 `UPSTREAM_MASTER_KEY` **必须是 32 字节 Base64**：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

最后你的 `.dev.vars` 大概这样：

```ini
ADMIN_TOKEN=你生成的第一个随机字符串
LOGIN_CODE_SECRET=你生成的第二个随机字符串
UPSTREAM_MASTER_KEY=你生成的Base64字符串

WECHAT_TOKEN=
WECHAT_APPID=
WECHAT_SECRET=

WECHAT_DELIVERY=mock

DEV_MODE=true
STORE_AI_PAYLOADS=0
SESSION_TTL_DAYS=30
OTP_TTL_MINUTES=5
ALLOWED_ORIGINS=*
```

本地开发的 Secret 放 `.dev.vars` 正是 Cloudflare 官方推荐方式；这个文件不要提交到 Git。([Cloudflare Docs][2])

### 5. 初始化本地 D1

这里注意我前面说的 bug。

**不要：**

```powershell
npm run db:migrate:local
```

当前包里的脚本参数写错了。

直接执行：

```powershell
npx wrangler d1 migrations apply DB --local
```

应该看到 `0001_init.sql` 被执行。

它会建立：

```text
users
login_codes
sessions
channels
models
user_model_permissions
usage_logs
runtime_cache
```

Cloudflare 的 migration 命令允许使用 D1 的数据库名或 binding 名，因此这里直接使用你配置中的 `DB` 是正确的。([Cloudflare Docs][3])

### 6. 启动 Server

执行：

```powershell
npm run dev
```

实际上就是：

```powershell
npx wrangler dev
```

通常会显示：

```text
http://localhost:8787
```

Cloudflare 当前的 `wrangler dev` 会让 Worker 本身运行在本机；D1、R2 默认使用本地模拟资源。需要特别注意，**Workers AI 不支持本地模拟，它实际调用 Cloudflare 远程 AI 服务**。([Cloudflare Docs][4])

浏览器打开：

```text
http://localhost:8787
```

你就会看到我做的：

> 通用 AI Relay

管理页面。

---

# 三、进入管理后台以后怎么用？

顶部有：

```text
管理员登录
```

把刚才：

```text
ADMIN_TOKEN
```

填进去。

点击：

```text
保存本机
```

然后就可以管理：

```text
渠道
用户
模型权限
用量统计
D1/R2/Workers AI 诊断
```

### 第一次建议先模拟注册一个用户

页面最下面：

> 本地联调

输入：

```text
15911111111
```

点击：

> 模拟 reg:手机号

这就相当于这个用户已经：

```text
关注公众号
→
发送 reg:15911111111
```

只是本地测试阶段不真的走微信。

---

# 四、然后要配置 AI 渠道

这里有个很重要的设计：

**AI API Key 不再写 `.dev.vars`。**

腾讯云、OpenAI、中转商等上游 API 信息，全部在这个网页管理后台的：

> 渠道

中配置。

例如腾讯云 Token Plan，可以新增：

```text
渠道名称：
腾讯云 Token Plan

slug：
tencent-token-plan

协议：
OpenAI 兼容

Base URL：
https://api.lkeap.cloud.tencent.com/plan/v3

API Path：
/chat/completions

API Key：
sk-tp-xxxxxxxxxxxx
```

腾讯云当前官方仍把个人版 Token Plan 的 OpenAI-compatible Base URL 定义为：

```text
https://api.lkeap.cloud.tencent.com/plan/v3
```

完整 Chat Completions 地址为：

```text
https://api.lkeap.cloud.tencent.com/plan/v3/chat/completions
```

模型列表是动态变化的，应以你的套餐控制台当时显示的 Model ID 为准。([腾讯云][5])

你填写的腾讯 API Key 会：

```text
UPSTREAM_MASTER_KEY
      ↓
AES-GCM 加密
      ↓
D1 channels.credentials_enc
```

插件看不到这个 Key。

---

## 五、渠道建完以后还要“添加模型”

例如某个模型 ID：

```text
deepseek-v4-flash
```

或者腾讯当前套餐实际提供的其它 Model ID。

这里还有一个：

```text
☑ 视觉
```

非常重要。

如果这个模型能够读取图片，就勾选。

插件里的：

```text
在出现风控图形验证码时必须用 AI
```

要求当前选择的模型在 server 中被标记为：

```text
vision=true
```

否则插件会拒绝进入这个模式。

如果只是想先测试整个 Server，Cloudflare Workers AI 也可以作为一个渠道：

```text
渠道名称：
Cloudflare Workers AI

slug：
workers-ai

协议：
Workers AI

Base URL：
留空

API Path：
留空

API Key：
留空
```

然后添加一个 Workers AI Model ID。

Cloudflare 当前仍提供多种视觉模型，例如 `@cf/meta/llama-3.2-11b-vision-instruct`，官方模型目录明确标记其支持 Vision。([Cloudflare Docs][6])

不过 Workers AI 本地执行时实际上仍然访问 Cloudflare，因此会产生相应 AI 用量。([Cloudflare Docs][7])

---

# 六、还差一步：给用户授权模型

这是很多人第一次会漏掉的。

你建好了：

```text
腾讯云 Token Plan
    └── 模型 A
```

并不意味着用户马上能看到。

进入：

> 用户与模型权限

找到：

```text
15911111111
```

下面会显示所有模型。

勾选允许他使用的：

```text
☑ 腾讯云 / xxx-model
```

然后：

> 保存该用户模型权限

这样插件调用：

```http
GET /api/models
```

时才会得到这个模型。

---

# 七、Chrome 插件怎么连接这个本地 Server

打开你的 Temu 插件：

> AI 推理设置

填写：

```text
AI Relay 服务地址：

http://localhost:8787
```

手机号：

```text
15911111111
```

点击：

> 发送验证码

因为目前：

```text
WECHAT_DELIVERY=mock
DEV_MODE=true
```

Server 不会真的发微信。

插件会直接显示类似：

```text
本地 DEV 验证码：384721
```

把这 6 位验证码填进去：

> 登录

然后：

> 刷新模型

就应该能看到：

```text
腾讯云 Token Plan
    xxx-model
```

这意味着整条链路已经打通：

```text
插件
 ↓
手机号验证码
 ↓
Server Session
 ↓
D1 用户
 ↓
用户模型权限
 ↓
腾讯云/其它AI
 ↓
用量统计
```

**我建议你一定先把这一阶段跑通，再搞微信。**

---

# 八、正式部署到 Cloudflare 怎么做？

本地确认没问题以后，才开始建立真实资源。

### 创建正式 D1

执行：

```powershell
npx wrangler d1 create generic-ai-relay
```

Cloudflare 会返回类似：

```text
database_name = "generic-ai-relay"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Cloudflare 官方的 `wrangler d1 create` 就是创建远程 D1，并返回应该放进 Wrangler 配置的数据库 UUID。([Cloudflare Docs][3])

打开：

```text
server\wrangler.jsonc
```

现在里面是：

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

换成刚刚 Cloudflare 给你的真实 ID：

```json
"database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

binding **不要改**：

```json
"binding": "DB"
```

---

### 创建 R2

执行：

```powershell
npx wrangler r2 bucket create generic-ai-relay-audit
```

你的 `wrangler.jsonc` 已经是：

```json
{
  "binding": "AUDIT_BUCKET",
  "bucket_name": "generic-ai-relay-audit"
}
```

所以名字正好对应。

Cloudflare 官方也是通过 `wrangler r2 bucket create <name>` 创建 R2 bucket。([Cloudflare Docs][8])

---

# 九、生产环境三个核心 Secret

正式环境不能依赖 `.dev.vars`。

运行：

```powershell
npx wrangler secret put ADMIN_TOKEN
```

它会提示：

```text
Enter a secret value:
```

粘贴你的 ADMIN_TOKEN。

然后：

```powershell
npx wrangler secret put LOGIN_CODE_SECRET
```

再：

```powershell
npx wrangler secret put UPSTREAM_MASTER_KEY
```

Cloudflare Secret 会以加密绑定的形式提供给 Worker，而不是明文写进 `wrangler.jsonc`。([Cloudflare Docs][2])

---

# 十、生产环境还有两个地方一定要改

你现在 `wrangler.jsonc` 中还是：

```json
"DEV_MODE": "true",
"WECHAT_DELIVERY": "mock"
```

正式部署时必须改成：

```json
"DEV_MODE": "false",
"WECHAT_DELIVERY": "official_account"
```

否则：

```text
/api/dev/register
```

仍然开放，而且验证码仍然走 mock。

---

# 十一、微信到底在哪里配置？

这里分成 **Cloudflare 一边** 和 **微信公众号后台一边**。

Cloudflare 一边需要三个 Secret：

```text
WECHAT_TOKEN
WECHAT_APPID
WECHAT_SECRET
```

其中：

### WECHAT_TOKEN

这是**你自己随便生成的一串随机字符串**。

例如：

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

假设得到：

```text
a922...xxxx
```

执行：

```powershell
npx wrangler secret put WECHAT_TOKEN
```

然后填：

```text
a922...xxxx
```

这个值以后还要原样填到微信公众平台的：

```text
服务器配置 → Token
```

---

### WECHAT_APPID

来自你的微信公众号：

```text
微信公众平台
→ 设置与开发
→ 基本配置
→ 开发者ID(AppID)
```

然后：

```powershell
npx wrangler secret put WECHAT_APPID
```

---

### WECHAT_SECRET

同一个地方的：

```text
开发者密码(AppSecret)
```

然后：

```powershell
npx wrangler secret put WECHAT_SECRET
```

不要把 AppSecret 写到 Git 或 `wrangler.jsonc`。

---

# 十二、迁移正式数据库

执行：

```powershell
npx wrangler d1 migrations apply DB --remote
```

这次操作的是 Cloudflare 真正的 D1，不再是你电脑上的模拟数据库。Cloudflare 官方将 `--local` 和 `--remote` 明确区分为本地数据库与远端 D1。([Cloudflare Docs][3])

---

# 十三、正式部署

执行：

```powershell
npx wrangler deploy
```

成功以后会得到类似：

```text
https://generic-ai-relay.xxxxx.workers.dev
```

Cloudflare 部署 Worker 后会提供 `workers.dev` 地址；正式长期使用也可以再绑定自己的 Custom Domain。([Cloudflare Docs][1])

这个地址就是以后插件里的：

```text
AI Relay 服务地址
```

例如：

```text
https://generic-ai-relay.xxxxx.workers.dev
```

---

# 十四、微信公众号后台怎么填

Worker 部署完成以后，进入微信公众号后台服务器配置。

填写：

| 微信字段           | 填什么                                                         |
| -------------- | ----------------------------------------------------------- |
| 服务器地址 URL      | `https://generic-ai-relay.xxxxx.workers.dev/webhook/wechat` |
| Token          | 与 `WECHAT_TOKEN` 完全相同                                       |
| 消息加解密方式        | **明文模式**                                                    |
| EncodingAESKey | 当前代码不用                                                      |

为什么必须明文？

因为你当前 `server/src/index.js` 里明确写了：

```js
if (parseXmlTag(body, 'Encrypt')) {
    // 当前仅启用公众号明文消息模式
}
```

也就是说目前**没有实现微信 AES 消息解密**。

微信对服务器 URL 验证时会请求：

```text
/webhook/wechat
?signature=...
&timestamp=...
&nonce=...
&echostr=...
```

你的 Worker 会用：

```text
WECHAT_TOKEN
```

校验签名。

校验成功以后就能启用服务器配置。

---

# 十五、注册流程就会变成你原来设计的那样

用户关注公众号，发送：

```text
reg:15911111111
```

微信会把消息 POST 到：

```text
/webhook/wechat
```

Server 得到：

```text
FromUserName = 用户的 OpenID
Content = reg:15911111111
```

然后 D1 建立：

```text
phone = 15911111111
wechat_openid = 用户OpenID
status = active
```

公众号会被动回复：

```text
注册成功：15911111111。
现在可在客户端使用该手机号获取登录验证码。
```

这一段当前代码已经实现。

---

# 十六、但微信验证码这里，我发现一个比较重要的架构问题

这个你在真正上线以前最好先知道。

你现在 Server 的验证码发送并不是“微信服务通知”，实际实现的是：

```text
公众号客服消息接口
```

代码调用：

```text
https://api.weixin.qq.com/cgi-bin/message/custom/send
```

流程是：

```text
插件请求验证码
     ↓
Cloudflare Worker
     ↓
获取微信 access_token
     ↓
客服消息 API
     ↓
向 OpenID 主动发送验证码
```

这里有两个现实限制。

首先，公众号客服消息接口本身有账号权限和用户交互窗口方面的限制，不能默认认为任何公众号都能在任意时间主动给关注者发消息。

更重要的是，当前公众号 API 的很多 `access_token` 类接口要求配置 **IP 白名单**。腾讯云最新文档也明确提示，调用公众号 API 前需要设置 IP 白名单；客服消息、模板/订阅消息等主动 API 都属于需要考虑来源 IP 的场景。([腾讯云][9])

而普通 Cloudflare Workers：

```text
fetch(api.weixin.qq.com)
```

并没有给你的免费 Worker 分配一个方便拿来填写微信白名单的固定单一出口 IP。

Cloudflare提供可控 Dedicated Egress IP 的能力属于企业级网络能力。([Cloudflare Docs][10])

所以目前：

```text
公众号 reg:手机号
```

这一段没有问题，因为是：

```text
微信 → Cloudflare
```

但：

```text
Cloudflare → 微信客服消息 API → 主动发送验证码
```

**在正式环境存在被微信 IP 白名单卡住的可能。**

典型可能表现为微信返回：

```text
40164
invalid ip
```

---

# 十七、因此我建议你的实际部署顺序

先做到：

```text
本地 mock
✓ Server启动
✓ D1
✓ 管理后台
✓ 注册用户
✓ 添加腾讯云渠道
✓ 添加模型
✓ 用户模型权限
✓ 插件手机号登录
✓ 插件获取模型
✓ AI推理
✓ 用量统计
```

这一部分完全跑通后，再部署 Cloudflare。

微信方面：

```text
第一阶段
reg:手机号
```

可以直接接 Cloudflare。

至于：

```text
插件点击发送验证码
→ 微信主动推送验证码
```

我建议下一步再调整一下发送方案。

**如果坚持整个 server 只部署 Cloudflare，最稳的方案反而是避免依赖微信主动客服消息 API：让验证码通过用户向公众号发一条消息后，由 `/webhook/wechat` 直接“被动回复”返回。**

这样：

```text
微信 → Worker → 微信
```

不需要 Worker 再主动调用：

```text
api.weixin.qq.com/message/custom/send
```

也就规避了固定出口 IP 这个问题。

---

## 另外，这版我建议顺手修两个地方

第一个就是前面发现的 `package.json`：

现在：

```json
"db:migrate:local": "wrangler d1 migrations apply DB --local",
"db:migrate:remote": "wrangler d1 migrations apply DB --remote"
```

应该改成：

```json
"db:migrate:local": "wrangler d1 migrations apply DB --local",
"db:migrate:remote": "wrangler d1 migrations apply DB --remote"
```

修完以后你以后就可以简单执行：

```powershell
npm run db:migrate:local
```

和：

```powershell
npm run db:migrate:remote
```

第二个是微信验证码 delivery。**我认为应该在下一版把微信 delivery 抽象再补完整**，至少分成：

```text
mock
wechat_passive_reply
official_account_customer_service
其它后续 delivery
```

这样 Cloudflare 免费部署和“固定 IP 服务器主动推送”两种环境都能用，而不是把微信登录验证码和某一个客服消息 API 绑死。

如果你现在只是想先把服务跑起来，实际上只需要做到这一条链：

```text
npm install
→ npx wrangler login
→ 建 .dev.vars
→ npx wrangler d1 migrations apply DB --local
→ npm run dev
→ 打开 http://localhost:8787
```

**微信先一个字段都不用填。**这也是你现在最容易排除问题的方式。

[1]: https://developers.cloudflare.com/ai-gateway/integrations/aig-workers-ai-binding/?utm_source=chatgpt.com "Set up Workers AI with AI Gateway · Cloudflare AI Gateway docs"
[2]: https://developers.cloudflare.com/workers/wrangler/configuration/?utm_source=chatgpt.com "Configuration - Wrangler · Cloudflare Workers docs"
[3]: https://developers.cloudflare.com/d1/wrangler-commands/?utm_source=chatgpt.com "Wrangler commands · Cloudflare D1 docs"
[4]: https://developers.cloudflare.com/workers/local-development/?utm_source=chatgpt.com "Local development · Cloudflare Workers docs"
[5]: https://cloud.tencent.com/document/product/1823/130072?utm_source=chatgpt.com "大模型服务平台 TokenHub Cline_腾讯云"
[6]: https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/?utm_source=chatgpt.com "Llama 3.2 11B Vision Instruct model on Cloudflare Workers AI · Cloudflare Workers AI docs"
[7]: https://developers.cloudflare.com/workers/local-development/bindings-per-env/?utm_source=chatgpt.com "Supported bindings per development mode · Cloudflare Workers docs"
[8]: https://developers.cloudflare.com/r2/get-started/cli/?utm_source=chatgpt.com "CLI · Cloudflare R2 docs"
[9]: https://cloud.tencent.cn/document/product/1301/100187?utm_source=chatgpt.com "腾讯云微搭低代码 微信公众号_腾讯云"
[10]: https://developers.cloudflare.com/learning-paths/secure-internet-traffic/build-egress-policies/deploy-egress-ips/?utm_source=chatgpt.com "Egress IP best practices · Cloudflare Learning Paths"
