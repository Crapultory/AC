# Aegis Frontend

`aegis/frontend/` 是 Aegis 安全协同中枢的前端控制台。它基于 `React 19 + Vite 6 + Tailwind CSS 4 + Motion`，其中 `Agent Orchestration` 与 `Routing Policy` 已接入 `aegis/backend` 的真实 API，并由后台直接托管生产静态资源。

## 当前能力

- `Overview`：展示安全中枢总览、拓扑星图、Agent 索引和安全态势卡片。
- `Aegis Chat`：提供本地模拟的安全分析会话流，按预设场景回放 Agent/VIP Tool 协同链路。
- `Agent Orchestration`：支持登录后对 `/api/agents` 执行新增、编辑、删除。
- `Routing Policy`：支持登录后对 `/api/routing/global` 执行新增、编辑、删除。

## 技术栈

- `React 19`
- `TypeScript`
- `Vite 6`
- `Tailwind CSS 4`
- `lucide-react`
- `motion`

## 本地启动

前置要求：

- `Node.js 20+`
- `npm 10+`（推荐）

启动步骤：

1. 进入模块目录：
   `cd aegis/frontend`
2. 安装依赖：
   `npm install`
3. 启动 Aegis 后端（推荐）：
   `hermes aegis`
4. 在浏览器打开：
   `http://127.0.0.1:9130/login`

说明：

- 登录方式为用户名/密码，成功后前端会保存后端签发的 JWT access token。
- 默认初始化管理员账号为 `admin / admin123456`，仅适合本地引导，登录后应尽快修改。
- Agent 与 Global Rule 数据持久化在 `HERMES_HOME/a2a.json`。
- 用户数据持久化在 `HERMES_HOME/aegis.db`。
- Chat 页面的会话回放仍然保存在浏览器 `localStorage`，键名为 `aegis_convs`。

如果只想跑前端开发服务器：

1. 启动后端：
   `python aegis/backend/main.py --no-open`
2. 另一个终端进入 `aegis/frontend`
3. 运行：
   `npm run dev`
4. 打开：
   `http://127.0.0.1:3000/login`

Vite 已经代理 `/api` 和 `/health` 到 `http://127.0.0.1:9130`。

## 常用命令

- `npm run dev`：启动开发环境，默认监听 `0.0.0.0:3000`
- `npm run lint`：执行 `tsc --noEmit`
- `npm run build`：生成生产构建产物到 `aegis/backend/web_dist`
- `npm run preview`：本地预览构建结果

## 目录结构

```text
aegis/frontend
├── index.html
├── logo
├── package.json
├── vite.config.ts
├── src
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── types.ts
│   ├── vite-env.d.ts
│   ├── data/mockData.ts
│   ├── lib
│   │   ├── adapters.ts
│   │   ├── api.ts
│   │   └── auth.ts
│   └── components
│       ├── Sidebar.tsx
│       ├── LoginScreen.tsx
│       ├── OverviewTab.tsx
│       ├── ChatTab.tsx
│       ├── AgentTab.tsx
│       └── PolicyTab.tsx
```

## 数据与交互说明

- `Agent Orchestration` 读取和写入 `/api/agents`。
- `Routing Policy` 读取和写入 `/api/routing/global`。
- Chat 页面的回复与执行链路仍为前端模拟逻辑，不会真正调用 A2A、RPC 或外部安全系统。
- 当前侧边栏品牌图标接入的是 `logo/aegis-icon-brand-tile-color.svg`。

## 本次 Review 摘要

- 已将页面顶部和总览页中的 UTC 时间改为动态生成，避免“LIVE”状态下仍显示固定时间。
- 已为总览页 Agent 占比增加空数据保护，避免在 Agent 被删空时出现 `NaN%`。
- 原模块最初残留了 AI Studio 模板文案；本 README、页面标题和部分注释已经更新为当前模块语义。

## 已知边界

- 当前只对接了 `Agent Orchestration` 和 `Routing Policy` 两个后端模块。
- `Overview` 与 `Aegis Chat` 仍然偏演示态，尚未接真实安全执行链路。
