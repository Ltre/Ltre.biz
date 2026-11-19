# 通用 AI Relay / Gateway（Cloudflare）

这是独立于 Temu 插件业务的通用 AI 推理中转服务。插件只是其中一个客户端；服务端不知道“商品筛选、采集、验证码”等业务语义。

## 组件

- Cloudflare Workers：HTTP API、鉴权、上游调度。
- D1：用户、登录验证码、会话、渠道、模型、用户模型权限、用量统计。
- R2：可选的推理审计对象；本地 mock 模式也用于保存调试验证码。
- Workers AI：作为一种 `workers_ai` 渠道，也用于后台诊断。
- 静态 Assets：同一个 Worker 提供轻量管理页，Wrangler 本地即可从页面联调数据库/存储/AI。

没有强行引入 Workflows：当前请求均为短事务；等后续有长任务、异步批处理、重试编排时再接入，避免为了“用上组件”而增加复杂度。

## 客户端统一接口

- `POST /api/auth/request-code` `{phone}`
- `POST /api/auth/verify-code` `{phone,code}` → Bearer token
- `GET /api/me`
- `GET /api/models` → 只返回该用户被授权的渠道/模型，按渠道分组
- `POST /v1/chat/completions` → OpenAI Chat Completions 风格统一入口，`model` 使用 `channel-slug/model-id`

客户端永远拿不到上游 Base URL、API Key、额外鉴权头。

## 渠道抽象

内置协议适配：

- `openai_compat`：OpenAI 兼容厂商、云平台、聚合服务、自建中转。
- `anthropic`：Anthropic Messages API。
- `gemini`：Gemini generateContent。
- `workers_ai`：Cloudflare Workers AI binding。

渠道凭据以 JSON 形式（`api_key` + `headers`）由 `UPSTREAM_MASTER_KEY` 使用 AES-GCM 加密后保存到 D1；主密钥本身必须放 Wrangler Secret / `.dev.vars`，不能写入数据库。

对于 Cloudflare AI Gateway、自定义 Provider 或其它需要额外请求头的平台，可将 gateway URL 作为 `base_url`，并把 `cf-aig-authorization` 等放入渠道 `headers`。Cloudflare 目前也支持 Custom Providers 与 OpenAI-compatible Gateway，因此无需在客户端做平台特判。

## 用户注册 / 微信验证码

### 注册

公众号接入 `/webhook/wechat`。用户关注后发送：

`reg:15911111111`

服务端创建用户并绑定该公众号 OpenID。当前实现支持公众号**明文消息模式**，用于小范围部署最简单；若以后启用兼容/安全模式，再增加消息 AES 解密层。

### 登录验证码

插件请求验证码后：

- `WECHAT_DELIVERY=official_account`：通过公众号客服消息向已绑定 OpenID 发送 6 位验证码。
- `WECHAT_DELIVERY=mock`：仅用于本地开发；验证码写入本地 R2，并在 `DEV_MODE=true` 时响应 `dev_code`，便于一条链路联调。

公众号客服消息本身可能受微信的会话时间窗口等平台规则约束；如果后续需要“服务通知/模板消息”，建议新增独立 delivery adapter，不改变认证 API。

## 本地 Wrangler 联调

1. `cd server`
2. `npm install`
3. `cp .dev.vars.example .dev.vars`，填好三个必须 Secret：`ADMIN_TOKEN`、`LOGIN_CODE_SECRET`、`UPSTREAM_MASTER_KEY`
4. 初始化 D1：`npm run db:migrate:local`
5. 启动：`npm run dev`
6. 打开 Wrangler 输出的地址（通常 `http://localhost:8787`），输入 `ADMIN_TOKEN`
7. “诊断 D1/R2/Workers AI”可从页面检查三个绑定；Workers AI 即使在本地 Wrangler 下也会访问 Cloudflare 账户并产生相应用量
8. DEV_MODE 下可在管理页模拟 `reg:手机号`；再从插件请求验证码完成登录

> `wrangler.jsonc` 中的 D1 `database_id` 是本地占位值。部署生产前先创建真实 D1/R2，并把真实 D1 ID / bucket 名称写入配置。

### 生产资源示例

```bash
npx wrangler d1 create generic-ai-relay
npx wrangler r2 bucket create generic-ai-relay-audit
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put LOGIN_CODE_SECRET
npx wrangler secret put UPSTREAM_MASTER_KEY
npx wrangler secret put WECHAT_TOKEN
npx wrangler secret put WECHAT_APPID
npx wrangler secret put WECHAT_SECRET
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

## 管理后台

当前轻量后台支持：

- 渠道创建/编辑/删除（厂商直连、云平台、中转均视为“渠道”）。
- 渠道启用/停用开关（决定该渠道下模型是否对用户可见可用）。
- 为渠道登记模型 ID、视觉能力、输入/输出成本；已登记模型支持编辑、删除、启用/停用。
- 查看用户 AI 权限状态并启用/暂停。
- 按用户勾选允许使用的具体渠道模型。
- 按时间范围统计调用次数、输入/输出/总 Token、估算费用、错误数。
- D1 / R2 / Workers AI 一键诊断。

模型与渠道的 `enabled` 开关都会直接影响用户侧：停用的渠道/模型不会再出现在用户的模型列表里，直接调用也会被拒绝（403）。有调用记录的渠道不能删除，只能停用，避免破坏用量统计外键。

## 关于 sub2api

`Wei-Shaw/sub2api` 适合更完整的订阅配额分发、复杂分组、计费与账号调度。本项目只借鉴“用户权限 + 渠道/模型 + 用量”抽象，不直接依赖它，避免为当前小范围场景引入 Docker/完整后端栈。未来如果需求膨胀到多租户计费、复杂额度窗口、账号池调度，可再评估迁移或兼容。
