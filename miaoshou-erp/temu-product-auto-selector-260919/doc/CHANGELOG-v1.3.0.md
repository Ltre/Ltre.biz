# v1.3.0 改动说明（2026-09-20）

基于 `temu-product-auto-selector-260919` 的 v1.2.0 版本，按用户 4 点要求完成：

## 1. 插件筛选结果：全选 / 反选 / 取消选择
- `chrome-ext/sidepanel.html`：结果区操作按钮由单一“全选可采集”改为三个按钮：**全选**、**反选**、**取消选择**，再加“执行采集 / 导出JSON”。
- `chrome-ext/sidepanel.js`：新增 `invertSelectBtn`、`clearSelectBtn` 两个处理器；三个操作都只作用于“可采集项”（未排除且未采集），已排除/已采集商品不受影响。

## 2. 风控图形验证码：AI 自动识别并完成验证
之前版本是“AI 识别 + 暂停等人工”，本版改为自动处理：

- `chrome-ext/lib/ai.js`：`inspectRiskChallenge` 替换为 `solveRiskChallenge`。视觉模型根据页面截图 + DOM 元素清单返回可执行方案：验证类型、动作（`drag_slider / click_points / type_text / click_button`）、视口比例坐标、目标元素 ID、滑块目标比例、需输入的文字。
- `chrome-ext/content.js`：
  - 新增 `findChallengeElements()`：探测滑块手柄/轨道、点选图片网格、文字输入框、确认按钮等验证码相关 DOM 元素（含视口矩形）。
  - 新增 `SOLVE_CHALLENGE` 消息：按方案在页面内执行 DOM 级拖动滑块、点击图片、输入文字。
- `chrome-ext/sidepanel.js`：
  - 新增 `autoSolveChallenge()`：循环「截图 → AI 识别 → 执行操作 → 复查是否已通过」，最多自动尝试 3 次；通过后任务自动继续。
  - 优先使用 `chrome.debugger`（manifest 已新增 `debugger` 权限）注入真实输入事件（`Input.dispatchMouseEvent` / `Input.insertText`），可操作跨域 iframe 内的验证码；调试器不可用时回退到页面内 DOM 自动化。
  - 所有触发验证的环节（搜索、扫描、翻页、详情页、采集前检查）统一走 `sendWithSolve()`：遇验证先自动处理，处理成功后重试原操作。
  - AI 未启用 / 未选视觉模型 / 自动尝试多次失败时，才暂停任务并提示人工完成。
- 说明：验证码若位于跨域 iframe 且调试器不可用，DOM 自动化无法触达 iframe 内部，此时仍会暂停人工处理；这是浏览器安全隔离的边界。

## 3. 修正 D1 binding 名称不一致
- `server/package.json`：`db:migrate:local` / `db:migrate:remote` 由 `AI_RELAY_DB` 修正为 `DB`，与 `wrangler.jsonc` 的 D1 binding 一致。现在可直接 `npm run db:migrate:local` / `npm run db:migrate:remote`。
- `server/README.md`、`doc/guide/server-init-guide.md` 中相关命令同步修正。

## 4. 后台渠道/模型：编辑、删除、启用/停用
- `server/src/index.js` 新增接口：
  - `PATCH /api/admin/models/:id`：修改模型 ID、显示名、视觉能力、输入/输出成本、启用状态。
  - `DELETE /api/admin/models/:id`：删除模型（有调用记录的模型返回 409，只能停用，保留用量统计）。
  - `DELETE /api/admin/channels/:id`：删除渠道（有调用记录的渠道返回 409，只能停用）。
  - 模型的 `enabled` 与渠道的 `enabled` 都决定“是否给用户使用”：停用后不再出现在用户模型列表，直接调用也返回 403。
- `server/public/app.js`：每个已登记模型显示可编辑表单（模型 ID / 显示名 / 视觉勾选 / 输入输出成本）+ 保存 / 删除 / 启用停用按钮；渠道行新增“删除渠道”按钮。
- `server/public/style.css`：新增模型编辑器与停用态样式。

## 验证结果
- 全部 JS 通过 `node --check`（插件 + 服务端）。
- 服务端 `node --test tests/*.test.js`：6/6 通过（含新增的“模型编辑/启停/删除 + 渠道删除保护”集成测试）。
- 插件 `tests/ai.test.js`、`tests/rules.test.js`：通过。
- `manifest.json`、`package.json`、`wrangler.jsonc` JSON 校验通过。
- 说明：本环境无法联网下载 Wrangler，未实际启动 `wrangler dev`；D1 集成链路通过 Node 22 `node:sqlite` 执行同一份 migration 验证。

## 分发包
- `dist-list/chrome-ext/v1.3.0.zip`（插件，Chrome 开发者模式加载）
- `dist-list/server/v0.2.0.zip`（服务端，独立部署）
