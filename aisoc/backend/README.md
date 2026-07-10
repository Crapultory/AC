# AISOC Backend (FastAPI)

## 1. 模块定位
AISOC Backend 是 `hermes aisoc` 的服务层。当前以 `server` 模块为主，后续扩展 `a2a` 模块后，同一入口将根据 `--module` 参数启动不同服务：
- `server`：当前 Web Console / FastAPI API / Chat TUI PTY-WebSocket 网关
- `a2a`：A2A (Agent-to-Agent) 协议服务
- `extcli`：本地增强交互命令行，直接在终端里与 `AIAgent` 对话

`server` 模块当前负责：
- 统一认证（Bearer Token）
- 会话、Cron、Skill、Memory、Logs、Overview 数据读取/写入
- Chat TUI 的 PTY/WebSocket 网关
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
hermes aisoc --module server --port 9120 --tui
```

常用参数：
- `--module server|a2a|extcli`：选择启动模块，默认 `server`
- `--port 9120`：服务端口（默认 9120）
- `--host 127.0.0.1`：监听地址（默认 loopback）
- `--no-open`：不自动打开浏览器，仅 `server` 模块使用
- `--insecure`：允许非 loopback 绑定（有安全风险）
- `--tui`：启用嵌入式 chat PTY/WS 能力，仅 `server` 模块使用
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
python aisoc/backend/main.py -p myprofile --module server --port 9120 --tui
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
python aisoc/backend/main.py -p myprofile --module server --host 127.0.0.1 --port 9120 --no-open --tui
```

或只调后端 server 模块：

```bash
python -c "from aisoc.backend.server import start_server; start_server(host='127.0.0.1', port=9120, open_browser=False, embedded_chat=True)"
```

### 2.3 Token 配置
- `AISOC_SESSION_TOKEN`：若设置，则使用静态 token（`token_source=env`）
- 未设置时：进程启动自动生成随机 token（`token_source=generated`）
- `AISOC_A2A_AUTH`：A2A 模块认证开关；`true/1/yes/on` 启用，未设置或 `false/0/no/off` 关闭
- `A2A_SESSION_TOKEN`：仅 `a2a` 模块使用；启用 A2A 认证时若设置，则使用静态 token（`a2a_token_source=env`）
- 启用 A2A 认证且未设置 `A2A_SESSION_TOKEN` 时：进程启动自动生成随机 A2A token（`a2a_token_source=generated`）
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
  - token 校验与配置装配

### 3.2 认证机制
- 所有 `/api/*` 默认受保护
- 白名单（无需认证）：
  - `/api/auth/login`
  - `/api/auth/session`
  - `/api/auth/logout`
  - `/api/system/bootstrap`
  - `/health`
- HTTP：`Authorization: Bearer <token>`
- WebSocket：`?token=<token>`（浏览器 WS 升级不便带自定义 Authorization）

### 3.3 A2A 认证机制
- 默认关闭；通过 `AISOC_A2A_AUTH=true` 启用
- 启用后使用 `Authorization: Bearer <A2A_SESSION_TOKEN>` 保护 A2A HTTP 路由
- 公开白名单：
  - `/health`
  - `/.well-known/agent-card.json`
  - `/a2a/.well-known/agent-card.json`（或 `A2A_BASE_PATH` 对应前缀）
- 仅在 HTTP 中间件层认证，不改变 A2A executor、消息流或任务状态机
- `AISOC_SESSION_TOKEN` 仍仅用于 `server` 模块；`A2A_SESSION_TOKEN` 仅用于 `a2a` 模块

### 3.4 Chat（`--tui`）链路设计
当 `embedded_chat=True`（CLI `--tui`）时启用：
- `/api/chat/pty`：浏览器 <-> PTY 双向字节流
- `/api/chat/ws`：JSON-RPC sidecar（tui_gateway）
- `/api/chat/pub`、`/api/chat/events`：事件分发通道

非 `--tui` 模式下上述 WS 返回 `4403`。

---

## 4. API 模块清单

### 4.1 Auth
前缀：`/api/auth`
- `POST /login`
- `GET /session`
- `POST /logout`

### 4.2 System
- `GET /health`
- `GET /api/system/bootstrap`

### 4.3 Chat
前缀：`/api/chat`
- `GET /status`
- `WS /pty`
- `WS /ws`
- `WS /pub`
- `WS /events`

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

---

## 5. 关键实现与依赖

- FastAPI + Uvicorn：轻量、类型友好、便于 WS 与 docs 扩展
- Pydantic：请求模型和约束统一
- Hermes 内核复用：
  - `SessionDB`（会话）
  - `cron.jobs`（任务）
  - `skills_config` / `skills_tool`
  - `hermes_cli.logs`
- PTY/TUI 桥接：`services/tui_embed.py` + `tui_gateway`

---

## 6. 技术栈选择（为什么）

- **FastAPI**：
  - 同时处理 REST + WebSocket 方便
  - 自动 OpenAPI，便于前端/agent 调试
- **服务层拆分（routes + services）**：
  - 路由层保持薄，业务逻辑集中，便于 agent 定位改动点
- **Bearer Token 简模型**：
  - 局域网本地工具场景下实现成本低、调试效率高
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
