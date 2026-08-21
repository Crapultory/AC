# AISOC Backend (FastAPI)

## 1. 模块定位
AISOC Backend 是 `hermes aisoc` 的服务层。当前以 `server` 模块为主，后续扩展 `a2a` 模块后，同一入口将根据 `--module` 参数启动不同服务：
- `server`：当前 Web Console / FastAPI API / 统一聊天 WebSocket 服务
- `a2a`：A2A (Agent-to-Agent) 协议服务
- `extcli`：本地增强交互命令行，直接在终端里与 `AIAgent` 对话

`server` 模块当前负责：
- 统一认证（用户账号 + JWT）
- 会话、Cron、Skill、Memory、Logs、Overview 数据读取/写入
- 统一聊天模块（`/api/chat/session` WebSocket + quick commands + drawer 预览 + 附件）
- 托管前端静态资源（`web_dist`）

当前统一入口：`aisoc/backend/main.py`
- `hermes aisoc ...` 会复用这份入口逻辑
- 也可以直接运行 `python aisoc/backend/main.py ...`
- 直接以 Python 启动时额外支持 `-p/--profile`，用于显式指定 Hermes profile；`hermes -p <profile> aisoc ...` 仍保持原有逻辑不变

---

## 2. 开发与启动

### 2.1 推荐启动方式（集成前后端）
在仓库根目录执行：

```bash
hermes aisoc --module server --port 9120
```

常用参数：
- `--module server|a2a|extcli`：选择启动模块，默认 `server`
- `--port 9120`：服务端口（默认 9120）
- `--host 127.0.0.1`：监听地址（默认 loopback）
- `--no-open`：不自动打开浏览器，仅 `server` 模块使用
- `--insecure`：允许非 loopback 绑定（有安全风险）
- `--skip-build`：跳过前端构建（需已有 `backend/web_dist`），仅 `server` 模块使用

未来 A2A 模块启动形态：

```bash
hermes aisoc --module a2a --host 127.0.0.1 --port 9086
```

A2A 模块默认允许直接连接；设置 `AISOC_A2A_AUTH=true` 后，会在 HTTP 中间件层对 A2A RPC 请求启用 Bearer Token 认证。

`extcli` 模块启动形态：

```bash
hermes aisoc --module extcli
```

也支持直接以 Python 启动同一入口：

```bash
python aisoc/backend/main.py -p myprofile --module server --port 9120
python aisoc/backend/main.py --profile myprofile --module a2a --host 127.0.0.1 --port 9086
python aisoc/backend/main.py -p myprofile --module extcli
```

说明：
- `-p/--profile` 仅用于 `python aisoc/backend/main.py ...` 这类 direct startup 场景
- `hermes -p <profile> aisoc ...` 继续由 Hermes 主入口负责 profile 解析，不需要额外改写参数

`extcli` 特性：
- 直接复用 `AIAgent` 对话循环，并通过 SessionDB 恢复上下文，不再手动维护 history
- 输出默认写入 `/tmp/extcli_output`，输入继续通过当前终端读取，实现输入/输出通道分离
- 支持用户输入、AI 流式输出、tool call 展示、tool result 摘要展示
- tool result 最多显示前 50 个字符，超出部分以 `...` 省略
- `main` 会话忙碌时拒绝新的主会话输入，不缓存待回放消息
- 支持 `delegate_ext(is_loop=true)` 前台子会话；子会话激活时，终端输入会临时路由给子 agent
- 子会话内 `/main` 与 `/exit` 等价，都会结束子会话并返回主会话；只有主会话前台时 `/exit` 才会退出整个 `extcli`
- 支持 `/new` 重置当前主会话；当子会话前台时，`/new` 会作为普通输入传给子 agent
- `a2a` / `extcli` 模块启动的 agent 会按 Hermes 原生语义加载 `config.yaml` 中启用的 `mcp_servers`
- 可通过环境变量 `AISOC_MCP_ACTIVE` 覆盖该行为：未设置时自动加载，`true/1/yes/on` 强制启用，`false/0/no/off` 禁用

### 2.2 直接以 Python 启动（调试后端）

```bash
python aisoc/backend/main.py -p myprofile --module server --host 127.0.0.1 --port 9120 --no-open
```

或只调后端 server 模块：

```bash
python -c "from aisoc.backend.server import start_server; start_server(host='127.0.0.1', port=9120, open_browser=False)"
```

### 2.3 认证配置
- `AISOC_BOOTSTRAP_ADMIN_PASSWORD`：首次启动播种初始 `admin` 账号所需（≥8 位）；未设置时不会创建 admin，`/api/system/bootstrap` 返回 `admin_setup_required: true`，任何账号均无法登录
- `AISOC_JWT_SECRET`：若设置，则 JWT 使用该固定密钥签发/校验；未设置时进程启动自动生成随机密钥（不落盘）——**重启且未设置该变量会使所有已登录会话失效**
- `AISOC_A2A_AUTH`：A2A 模块认证开关；`true/1/yes/on` 启用，未设置或 `false/0/no/off` 关闭
- `A2A_SESSION_TOKEN`：仅 `a2a` 模块使用；启用 A2A 认证时若设置，则使用静态 token（`a2a_token_source=env`）
- 启用 A2A 认证且未设置 `A2A_SESSION_TOKEN` 时：进程启动自动生成随机 A2A token（`a2a_token_source=generated`）
- `AISOC_A2A_ADMIN_TOKEN`：仅用于启用 `/man` A2A 管理页面和换取短期管理凭证；这是独立的管理 secret，不得与负责 A2A 通信认证的 `A2A_SESSION_TOKEN` 复用相同值
- `AISOC_MCP_ACTIVE`：仅影响 `a2a` / `extcli` 的 MCP 装载；默认跟随配置自动加载，设置为 `false/0/no/off` 可在启动时关闭 MCP

---

## 3. 架构与设计

### 3.1 分层架构
- `server.py`
  - FastAPI app 组装
  - CORS + 认证中间件
  - 路由注册 + Swagger Bearer 认证注入
  - SPA 静态文件与 fallback
- `routes/*.py`
  - API 路由层（参数校验、状态码转换）
- `services/*.py`
  - 业务编排层（调用 Hermes 现有能力）
- `models.py`
  - Pydantic 请求/响应模型
- `auth.py` + `config.py`
  - 密码哈希、JWT 签发/校验、配置装配

### 3.2 认证机制
- 独立于 aegis 的用户账号体系：sqlite `users` 表（`$HERMES_HOME/aisoc.db`），PBKDF2-HMAC-SHA256 密码哈希，JWT（HS256）访问令牌
- 角色模型极简：仅一个 `is_admin` 布尔位，硬编码 `username == "admin"` 为超级管理员，无多角色/权限表
- 所有 `/api/*` 默认受保护
- 白名单（无需认证）：
  - `/api/auth/login`
  - `/api/auth/register`
  - `/api/auth/session`
  - `/api/auth/logout`
  - `/api/system/bootstrap`
  - `/health`
- HTTP：`Authorization: Bearer <JWT>`（`/api/auth/login` 换取）
- WebSocket：`?token=<JWT>`（浏览器 WS 升级不便带自定义 Authorization）
- 自助注册（`POST /api/auth/register`）默认落地 `status=disabled`，需管理员在 `/api/users` 启用后才能登录

### 3.3 A2A 认证机制
- 默认关闭；通过 `AISOC_A2A_AUTH=true` 启用
- 启用后使用 `Authorization: Bearer <A2A_SESSION_TOKEN>` 保护 A2A HTTP 路由
- 公开白名单：
  - `/health`
  - `/.well-known/agent-card.json`
  - `/a2a/.well-known/agent-card.json`（或 `A2A_BASE_PATH` 对应前缀）
- 仅在 HTTP 中间件层认证，不改变 A2A executor、消息流或任务状态机
- `A2A_SESSION_TOKEN` 仅用于 `a2a` 模块，与 `server` 模块的用户账号 + JWT 认证完全独立，不共享同一套凭证

### 3.4 A2A 管理与重启
- 设置非空 `AISOC_A2A_ADMIN_TOKEN` 后启用 `GET /man`；未设置时页面会明确显示管理未启用，管理 API 返回 503，重启不可用
- 页面通过 `POST /man/api/auth` 提交 `{"token":"<AISOC_A2A_ADMIN_TOKEN>"}`，成功后换取有效期 5 分钟的专用 Bearer；管理 secret 和短期 Bearer 都只保存在浏览器内存中，不写入 cookie、localStorage 或 sessionStorage
- `POST /man/api/restart` 只接受上述短期 Bearer，不接受原始管理 secret 或 `A2A_SESSION_TOKEN`；浏览器流程需要危险操作确认并准确输入 `RESTART A2A`
- 管理路由仅允许浏览器同源调用；无 `Origin` 的非浏览器客户端仍可使用相同的管理认证流程
- 重启成功返回 HTTP 202，统一字段为 `accepted`、`already_requested`、`service`、`pid`；重复请求不会启动第二个 watcher
- 重启会重放当前启动命令；若认证 token 原本由进程启动时随机生成，新进程可能生成不同值

### 3.5 统一聊天链路设计（1.0）
聊天核心在 `aisoc/backend/chat/`（自 aegis chat 模块回迁；已恢复用户账号绑定，会话按认证用户的 `user_id` 隔离）：
- `WS /api/chat/session`：唯一聊天通道。客户端事件 `session.bind` / `message.send` /
  `approval.respond` / `clarify.respond` / `session.interrupt` / `session.resume`；
  服务端事件 envelope（`message.delta/completed`、`run.state`、`tool.*`、
  `delegate.*`、`approval.*`、`clarify.*`、`error`，含 `server_event_id` 去重）。
- `message.send` 文本先经 `QuickCommandService.resolve_text` 做 `@[type_name]`
  快捷指令服务端展开与 `{var}` 参数替换（seed 在 `services/quick_command_seeds.py`，
  可用 `$HERMES_HOME/aisoc_quick_commands.json` 扩展/覆盖）。
- `GET /api/chat/quick-commands`：composer 快捷指令清单。
- `GET /api/chat/drawer-html?path=...`：工作区受限的文件预览（A2UI HTML 产物等）。
- `POST /api/chat/attachments`：聊天附件上传。
- `/agent2ui/*`：Agent2UI bridge 与模板静态资源（匿名，供 sandboxed 预览 iframe 加载）。
- 会话即 `hermes_state.SessionDB` 会话（`platform=aisoc_web`），`/api/sessions?source=aisoc_web`
  可过滤出 Web 聊天会话。

旧 PTY/TUI 链路（`/api/chat/pty|ws|pub|events`、`--tui`、`services/tui_embed.py`）已于 1.0 移除。

---

## 4. API 模块清单

### 4.1 Auth
前缀：`/api/auth`
- `POST /login`
- `POST /register`（自助注册，落地 `status=disabled`）
- `GET /session`
- `POST /logout`
- `PUT /password`

### 4.1a Users（仅管理员）
前缀：`/api/users`
- `GET /`
- `POST /`
- `PUT /{uid}/status`
- `PUT /{uid}/password`
- `DELETE /{uid}`

### 4.2 System
- `GET /health`
- `GET /api/system/bootstrap`（含 `admin_setup_required`）
- `POST /api/system/restart`（仅管理员）

### 4.3 Chat
前缀：`/api/chat`
- `WS /session`
- `GET /quick-commands`
- `GET /drawer-html`
- `POST /attachments`

### 4.4 Sessions
前缀：`/api/sessions`
- `GET /`
- `GET /search`
- `GET /{session_id}`
- `GET /{session_id}/detail`
- `GET /{session_id}/latest-descendant`
- `GET /{session_id}/messages`
- `DELETE /{session_id}`

### 4.5 Cron
前缀：`/api/cron`
- `GET /jobs`
- `GET /jobs/{job_id}`
- `GET /jobs/{job_id}/history`
- `POST /jobs`
- `PUT /jobs/{job_id}`
- `PUT /jobs/{job_id}/raw`
- `POST /jobs/{job_id}/pause`
- `POST /jobs/{job_id}/resume`
- `POST /jobs/{job_id}/trigger`
- `DELETE /jobs/{job_id}`

### 4.6 Skills
前缀：`/api/skills`
- `GET /` （skill item 含 `path` 字段）
- `GET /{skill_name}` （返回 `content` + `appendix[]`）
- `GET /{skill_name}/appendix?path={path}` （返回附件文本内容）
- `PUT /toggle`
- `POST /reload`

### 4.7 Memory
前缀：`/api/memory`
- `GET /`
- `GET/PUT /soul`
- `GET/PUT /user`
- `GET/PUT /files/{name}`

### 4.8 Logs
前缀：`/api/logs`
- `GET /`

### 4.9 Knowledge Base
前缀：`/api/kb`
- `GET /tree?cwd=` （列出指定目录下的文件和文件夹，`cwd` 为空时列出根目录）
- `GET /documents?path=` （返回指定文件的文本内容）

环境变量：`AISOC_WIKI_PATH` 指定知识库根目录，未设置或路径不存在时返回 503。

安全限制：
- 禁止路径遍历（`..`）和符号链接逃逸
- 文件大小上限 2 MB（超出返回 413）
- 非 UTF-8 文本文件返回 415

### 4.10 Overview
前缀：`/api/overview`
- `GET /status`
- `GET /stats`
- `GET /token-trend`
- `GET /security-events`
- `GET /keywords`
- `GET /keywords/{keyword}/sessions`
- `GET /cron-token-dist`
- `GET /cronjobs`

说明（2026-05 更新）：
- 原 `GET /api/overview/cronjobs/{job_id}/history` 已迁移到 `GET /api/cron/jobs/{job_id}/history`
- 原 `GET /api/overview/sessions/{session_id}/detail` 已迁移到 `GET /api/sessions/{session_id}/detail`
- Overview 仅保留总览/聚合接口；明细下钻接口归属到对应业务模块（Cron / Sessions）

### 4.11 A2A Management
- `GET /man`
- `POST /man/api/auth`：请求体 `{"token":"..."}`，返回 5 分钟、仅用于管理 API 的 Bearer 及到期信息
- `POST /man/api/restart`：需要管理 Bearer，成功返回 HTTP 202 和 `accepted`、`already_requested`、`service`、`pid`

---

## 5. 关键实现与依赖

- FastAPI + Uvicorn：轻量、类型友好、便于 WS 与 docs 扩展
- Pydantic：请求模型和约束统一
- Hermes 内核复用：
  - `SessionDB`（会话）
  - `cron.jobs`（任务）
  - `skills_config` / `skills_tool`
  - `hermes_cli.logs`
- 聊天核心：`aisoc/backend/chat/`（agent 回调 → WS 事件流，复用 `agent_runtime.default_agent_factory`）

---

## 6. 技术栈选择（为什么）

- **FastAPI**：
  - 同时处理 REST + WebSocket 方便
  - 自动 OpenAPI，便于前端/agent 调试
- **服务层拆分（routes + services）**：
  - 路由层保持薄，业务逻辑集中，便于 agent 定位改动点
- **用户账号 + JWT**：
  - 与 aegis 保持一致的最小角色模型（单一 `is_admin` 布尔位），独立 sqlite 用户库，不与 aegis 共享登录态
  - 相比共享 token，支持多用户审计、逐用户禁用/重置密码，以及按用户隔离聊天会话
- **复用 Hermes 核心数据源**：
  - 避免双写与数据漂移，确保 CLI 与 Dashboard 一致

---

## 7. 开发建议（给其他 Agent）

1. 新增接口优先放在 `routes/*.py + services/*.py`，避免在 `server.py` 堆逻辑。
2. 涉及安全策略改动时，先检查：
   - `PUBLIC_API_PATHS`
   - `auth_middleware`
   - WS token 校验逻辑
3. 如果改动 Overview/Chat 接口，务必联动前端 `src/lib/*.ts` 的调用契约。
4. 发布前至少做一次：

```bash
cd aisoc/frontend && npm run build
```

确保 `backend/web_dist` 已更新可用。
