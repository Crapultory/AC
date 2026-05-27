# AISOC Overview + 全站赛博风改造设计

## 元信息
- 日期: 2026-05-27
- 作者: Guisheng Guo + Codex
- 状态: Draft (待实现)
- 范围类型: 现有 AISOC 架构上的增量设计

## 背景与目标
当前 `aisoc` 已有登录认证、模块页（chat/sessions/cron/skills/memory）和对应 API。
`aisoc/aisoc-dashboard` 提供了更完整的 `overview` 运营看板和赛博风视觉，但实现方式是另一套独立目录。

本设计目标:
1. 在当前 `aisoc` 架构中新增 `overview` 页面与配套后端聚合接口。
2. 复刻 `aisoc-dashboard` 的 overview 信息元素与交互能力。
3. 登录后默认进入 overview。
4. 将当前可见页面统一为赛博风视觉，并允许适度重排布局。
5. 保持现有 API 与现有核心功能不回归。

## 非目标
1. 不恢复前端 `logs` 导航模块。
2. 不重写 chat 的 PTY/WS 核心链路。
3. 不删除或破坏已有接口契约。
4. 不引入新的认证机制（沿用现有 Bearer Token 登录）。

## 约束与决策
1. 用户决策: overview 接口采用“新增聚合层”，不改现有接口路径和语义。
2. 用户决策: 全站赛博化，允许适度重排布局。
3. 用户决策: 样式改造范围为 `login/overview/chat/sessions/cron/skills/memory`。
4. 认证要求: `/api/overview/*` 全部受现有 auth middleware 保护。

## 总体架构

### 后端
新增独立 overview 聚合层:
- `aisoc/backend/services/overview_service.py`
- `aisoc/backend/routes/overview.py`
- 在 `aisoc/backend/server.py` 中注册 router

设计原则:
1. 对外提供稳定的 overview 专用数据模型。
2. 对内尽量复用现有 service（session/cron/memory）与 `SessionDB` 聚合能力。
3. 与旧接口解耦，便于灰度与回退。

### 前端
新增与改造:
- 新增 `aisoc/frontend/src/pages/OverviewPage.tsx`
- 新增 `aisoc/frontend/src/lib/overview.ts`（类型 + API 调用）
- 改造 `aisoc/frontend/src/styles.css` 为赛博主题（或拆分 `styles-overview.css` 后在入口引入）
- 更新路由与导航（默认 landing 改为 `/overview`）

设计原则:
1. Overview 页面全量复刻参考目录中的核心元素与交互。
2. 其他页面保留功能路径，仅做视觉统一与轻量结构重排。
3. 保持组件边界清晰，避免把 overview 逻辑散落到各页面。

## API 设计（新增 `/api/overview/*`）

### 1) `GET /api/overview/status`
用于顶部状态条。

返回:
- `status`: `ONLINE | IDLE | OFFLINE`
- `model`: `string`
- `provider`: `string`
- `profile`: `string`
- `uptime_seconds`: `number`
- `last_activity`: `number`（unix 秒）

口径:
- `ONLINE`: 进程可用且存在最近活跃会话。
- `IDLE`: 进程可用但无最近活跃。
- `OFFLINE`: 进程不可用。

### 2) `GET /api/overview/stats`
用于统计卡片和来源分布。

返回:
- `total_sessions`
- `active_sessions`
- `today_tokens`
- `today_input_tokens`
- `today_output_tokens`
- `cron_jobs_total`
- `cron_jobs_enabled`
- `memory_used_chars`
- `memory_total_chars`
- `memory_percent`
- `source_distribution: Record<string, number>`

### 3) `GET /api/overview/token-trend?days=7|30`
用于 token 趋势图。

返回数组项:
- `date` (`MM-DD`)
- `input_tokens`
- `output_tokens`
- `total_tokens`
- `sessions`

### 4) `GET /api/overview/security-events?limit=15`
用于安全事件流。

返回数组项:
- `session_id`
- `type`
- `type_label`
- `icon`
- `time`
- `status`
- `risk_level`
- `summary`
- `entities: string[]`
- `verdict`
- `tokens`
- `duration`
- `source`

说明:
- 复刻参考实现中的“结构化摘要提取”思路。
- 主要基于 cron/session 最终 assistant 内容抽取事件摘要。

### 5) `GET /api/overview/cronjobs`
用于 cron 表格。

返回数组项:
- `id`
- `name`
- `enabled`
- `schedule`
- `last_run`（可空）
- `run_count`

### 6) `GET /api/overview/cronjobs/{job_id}/history`
用于 cron 历史弹窗。

返回数组项:
- `session_id`
- `started_at`
- `ended_at`
- `duration_seconds`
- `messages`
- `tokens`
- `status`

### 7) `GET /api/overview/sessions/{session_id}/detail`
用于 session 详情弹窗。

返回:
- `session_id`
- `source`
- `model`
- `started_at`
- `ended_at`
- `message_count`
- `tokens`
- `messages[]`

消息处理策略:
1. 按时间顺序返回。
2. 对超长 tool 输出截断。
3. 跳过空 assistant turn。
4. 前端展示默认不渲染 `system` 角色（与当前 sessions 页一致）。

### 8) `GET /api/overview/keywords`
用于关键词云。

返回数组项:
- `word`
- `count`
- `lang: zh | en`

### 9) `GET /api/overview/keywords/{keyword}/sessions`
用于关键词 drill-down。

返回数组项:
- `session_id`
- `title`
- `source`
- `started_at`
- `messages`
- `tokens`

### 10) `GET /api/overview/cron-token-dist?period=today|7d|30d`
用于 cron token 占比分布。

返回:
- `period`
- `total_cron_tokens`
- `non_cron_tokens`
- `grand_total`
- `cron_percent`
- `jobs[]`（含 runs/input/output/io/cache_read/cache_write/percent）

### 错误语义
- `401`: token 无效或缺失。
- `404`: session/job 等资源不存在。
- `422`: 参数非法。
- `500`: 服务器内部错误。

## 前端页面设计

### 路由与默认页
1. 受保护路由 index -> `/overview`。
2. 登录成功跳转 -> `/overview`。
3. 导航顺序:
   - Overview
   - Chat
   - Sessions
   - Cron
   - Skills
   - Memory

### Overview 页面结构（复刻）
1. Header: logo/clock/uptime/live/status/model。
2. Stats Row: 活跃会话/cron/memory/token。
3. Charts Row: token 趋势（7D/30D）+ 来源分布。
4. Keywords 云（可点击下钻）。
5. Cron token 分布（today/7d/30d 切换）。
6. Bottom Row: cron 表 + 安全事件流（分页）。
7. Modals: cron history / session detail / keyword sessions。

### 全站赛博风统一
页面范围: `login/overview/chat/sessions/cron/skills/memory`。

统一视觉要点:
1. 深色背景 + 电光青/绿强调色 + 发光边框。
2. 面板化布局与高对比文字层级。
3. 轻量动效（fade-in、hover sweep、live dot）。
4. 表格、按钮、badge、输入框统一皮肤。
5. 响应式断点:
   - `>=1200`: 多列仪表盘
   - `768-1199`: 双列折叠
   - `<768`: 单列堆叠

### 现有页面适度重排策略
1. `login`: 中央认证卡片 + 赛博背景层。
2. `chat`: 主区 PTY + 右侧信息侧栏，保持 WS/PTY 行为不变。
3. `sessions`: 左列表右消息详情，保持只展示消息。
4. `cron`: 左列表右详情，操作按钮统一样式。
5. `skills`: 列表卡片化、状态徽标增强。
6. `memory`: 左导航 + 右编辑器，保存状态可视化。

## 数据流与状态管理
1. Overview 首屏采用并发请求，优先渲染 status/stats。
2. modal 详情按需加载（点击后请求）。
3. 局部失败局部降级，不阻塞全页。
4. 图表只在数据/容器变化时重绘，减少重排抖动。

## 安全与鉴权
1. 沿用现有 `Authorization: Bearer <token>`。
2. token 来源不变（浏览器缓存 + 后端校验）。
3. overview 接口默认走现有 auth middleware。
4. 所有下钻接口返回最小必要信息，避免多余敏感字段外露。

## 错误处理与可观测性
1. 前端统一错误展示（面板内 error text）。
2. 后端接口错误消息稳定简洁。
3. 保留现有日志体系，必要时为 overview 聚合增加调试日志（非默认噪声）。

## 风险与缓解
1. 风险: 聚合查询复杂，首屏请求偏重。
   - 缓解: 并发 + 分块渲染 + limit 控制。
2. 风险: 样式重构影响现有页面可读性。
   - 缓解: 样式分层命名与页面级选择器隔离。
3. 风险: 事件抽取逻辑偏规则化，存在误判。
   - 缓解: 保留原始 session detail 下钻验证路径。

## 测试与验收标准

### 后端
1. `/api/overview/*` 接口 200/401/404/422 行为正确。
2. 字段与语义满足本设计定义。
3. 现有 API 不回归。

### 前端
1. 登录后默认进入 `/overview`。
2. Overview 所有模块可加载与交互。
3. chat/sessions/cron/skills/memory 均完成赛博风统一。
4. `sessions` 详情只显示消息，默认过滤 `system`。

### 构建与冒烟
1. `tsc -b` 通过。
2. `vite build` 若受本机 rollup 签名问题影响，标注为环境问题。
3. 手工链路: Login -> Overview -> Sessions -> Cron -> Memory -> Chat。

## 实施拆分（高层）
1. 后端 overview 聚合 service 与 routes。
2. 前端 overview 页面与数据层。
3. 全站样式系统升级与页面适配。
4. 路由默认页调整。
5. 联调、修复与验收。

## 开放问题（已收敛）
1. 是否复刻 logs 页面: 否（用户确认）。
2. 是否修改现有 API: 否（新增 overview 聚合层）。
3. 是否允许布局重排: 是（适度）。

## 结论
本设计在不破坏现有 AISOC 功能和接口的前提下，引入完整 overview 能力并统一赛博视觉。
通过新增聚合层与页面级改造，能够实现可控风险下的全量复刻与可持续演进。
