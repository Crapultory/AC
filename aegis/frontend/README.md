# Aegis Frontend

`aegis/frontend/` 是 Aegis 安全协同中枢的独立前端原型模块。它基于 `React 19 + Vite 6 + Tailwind CSS 4 + Motion`，当前以本地 mock 数据驱动，用来演示中控总览、智能对话、Agent 编排和路由策略配置四个核心页面。

## 当前能力

- `Overview`：展示安全中枢总览、拓扑星图、Agent 索引和安全态势卡片。
- `Aegis Chat`：提供本地模拟的安全分析会话流，按预设场景回放 Agent/VIP Tool 协同链路。
- `Agent Orchestration`：支持新增、编辑、删除 Agent/VIP Tool 配置，并写入本地缓存。
- `Routing Policy`：支持新增、编辑、启停策略规则，并写入本地缓存。

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
3. 启动开发服务器：
   `npm run dev`
4. 在浏览器打开：
   `http://127.0.0.1:3000`

说明：

- 当前原型不依赖后端服务，也不需要配置 `GEMINI_API_KEY`。
- 页面状态保存在浏览器 `localStorage`，键名包括 `aegis_agents`、`aegis_rules`、`aegis_convs`。

## 常用命令

- `npm run dev`：启动开发环境，默认监听 `0.0.0.0:3000`
- `npm run lint`：执行 `tsc --noEmit`
- `npm run build`：生成生产构建产物
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
│   └── components
│       ├── Sidebar.tsx
│       ├── OverviewTab.tsx
│       ├── ChatTab.tsx
│       ├── AgentTab.tsx
│       └── PolicyTab.tsx
```

## 数据与交互说明

- 所有页面都使用 `src/data/mockData.ts` 中的初始化数据。
- 用户在页面上的配置编辑会写回 `localStorage`，刷新页面后会保留。
- Chat 页面的回复与执行链路为前端模拟逻辑，不会真正调用 A2A、RPC 或外部安全系统。
- 当前侧边栏品牌图标接入的是 `logo/aegis-icon-brand-tile-color.svg`。

## 本次 Review 摘要

- 已将页面顶部和总览页中的 UTC 时间改为动态生成，避免“LIVE”状态下仍显示固定时间。
- 已为总览页 Agent 占比增加空数据保护，避免在 Agent 被删空时出现 `NaN%`。
- 原模块最初残留了 AI Studio 模板文案；本 README、页面标题和部分注释已经更新为当前模块语义。

## 已知边界

- 当前仍是高保真原型，不包含真实 API、鉴权、A2A 通信或服务端持久化。
- 侧边栏 logo 已切到正式品牌资源，但页面其余视觉元素仍然属于原型阶段，后续可以继续统一品牌规范。
