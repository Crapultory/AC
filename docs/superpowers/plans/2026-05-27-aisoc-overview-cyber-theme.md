# AISOC Overview + Cyber Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 AISOC 功能和接口的前提下，新增全量 Overview 页面与聚合 API，并将 login/overview/chat/sessions/cron/skills/memory 统一为赛博风视觉，且登录后默认进入 overview。

**Architecture:** 后端新增 `/api/overview/*` 聚合层（route + service）并复用既有 session/cron/memory 能力；前端新增 Overview 页面与数据访问层，路由默认入口切换至 `/overview`；样式层统一为赛博主题并对现有页面做适度重排，保持核心交互链路不变。

**Tech Stack:** FastAPI, Pydantic, SessionDB(SQLite), React 19, React Router 7, TypeScript, Vitest, Vite。

---

## Scope Check
本计划覆盖两个紧耦合子域（overview 功能 + 全站视觉统一），需要共同交付才能满足验收标准（默认 landing、导航、主题一致性、overview 联动下钻）。因此保留在单一计划中实施，按任务边界拆分并保证每个任务可独立验证。

## File Structure Map

### Backend (new)
- Create: `aisoc/backend/services/overview_service.py`
  - 责任: 聚合 overview 所有查询与数据整形（status/stats/trend/events/cron/keyword/session-detail/token-dist）。
- Create: `aisoc/backend/routes/overview.py`
  - 责任: 暴露 `/api/overview/*` HTTP 接口并做参数校验、404/422 映射。

### Backend (modify)
- Modify: `aisoc/backend/server.py`
  - 责任: 注册 overview router。
- Modify: `aisoc/backend/models.py`（可选，若需要显式响应模型）
  - 责任: 定义 overview 路由所需 pydantic response/request model。

### Backend tests (new)
- Create: `tests/aisoc/backend/test_overview_routes.py`
  - 责任: 覆盖 `/api/overview/*` 鉴权、参数校验、基础返回结构。
- Create: `tests/aisoc/backend/test_overview_service.py`
  - 责任: 覆盖 overview_service 关键聚合逻辑和边界值。

### Frontend (new)
- Create: `aisoc/frontend/src/lib/overview.ts`
  - 责任: Overview 类型定义与 API 封装。
- Create: `aisoc/frontend/src/pages/OverviewPage.tsx`
  - 责任: Overview 页面 UI、数据加载、交互（tab/pagination/modal/drilldown）。

### Frontend (modify)
- Modify: `aisoc/frontend/src/App.tsx`
  - 责任: 新增 `/overview` 路由并将 index 默认跳转到 `/overview`。
- Modify: `aisoc/frontend/src/components/AppShell.tsx`
  - 责任: 侧边栏新增并置顶 Overview 导航项。
- Modify: `aisoc/frontend/src/pages/LoginPage.tsx`
  - 责任: 登录成功跳转改为 `/overview`。
- Modify: `aisoc/frontend/src/styles.css`
  - 责任: 统一赛博风主题 token + 全站页面样式 + overview 布局样式。
- Modify: `aisoc/frontend/src/pages/ChatPage.tsx`
- Modify: `aisoc/frontend/src/pages/SessionsPage.tsx`
- Modify: `aisoc/frontend/src/pages/CronPage.tsx`
- Modify: `aisoc/frontend/src/pages/SkillsPage.tsx`
- Modify: `aisoc/frontend/src/pages/MemoryPage.tsx`
  - 责任: 适配统一视觉与适度重排，保持功能行为。

### Frontend tests (new)
- Create: `aisoc/frontend/src/lib/overview.test.ts`
  - 责任: 覆盖 overview API helper 的请求参数和响应处理。
- Create: `aisoc/frontend/src/pages/OverviewPage.test.tsx`
  - 责任: 覆盖关键加载状态、tab 切换、modal 打开、错误降级。

---

### Task 1: 建立 Overview 后端骨架（路由注册 + 空实现）

**Files:**
- Create: `aisoc/backend/services/overview_service.py`
- Create: `aisoc/backend/routes/overview.py`
- Modify: `aisoc/backend/server.py`
- Test: `tests/aisoc/backend/test_overview_routes.py`

- [ ] **Step 1: 写失败测试（路由存在 + 受鉴权保护）**

```python
# tests/aisoc/backend/test_overview_routes.py

def test_overview_status_requires_auth(client):
    resp = client.get("/api/overview/status")
    assert resp.status_code == 401
```

- [ ] **Step 2: 运行单测并确认失败**

Run: `pytest tests/aisoc/backend/test_overview_routes.py::test_overview_status_requires_auth -v`
Expected: FAIL（404 或路由不存在）

- [ ] **Step 3: 实现最小代码让测试通过**

```python
# overview.py
router = APIRouter(prefix="/api/overview", tags=["overview"])

@router.get("/status")
async def status():
    return {"status": "IDLE", "model": "", "provider": "", "profile": "", "uptime_seconds": 0, "last_activity": 0}
```

并在 `server.py` 中 `include_router(build_overview_router())`。

- [ ] **Step 4: 再跑测试确认通过**

Run: `pytest tests/aisoc/backend/test_overview_routes.py::test_overview_status_requires_auth -v`
Expected: PASS（未授权返回 401，由 middleware 处理）

- [ ] **Step 5: Commit**

```bash
git add aisoc/backend/services/overview_service.py aisoc/backend/routes/overview.py aisoc/backend/server.py tests/aisoc/backend/test_overview_routes.py
git commit -m "feat(aisoc): scaffold overview routes and auth-protected endpoint"
```

---

### Task 2: 实现 status/stats/token-trend 聚合

**Files:**
- Modify: `aisoc/backend/services/overview_service.py`
- Modify: `aisoc/backend/routes/overview.py`
- Test: `tests/aisoc/backend/test_overview_service.py`
- Test: `tests/aisoc/backend/test_overview_routes.py`

- [ ] **Step 1: 写失败测试（字段结构与 days 参数）**

```python
def test_token_trend_days_7_and_30(client, auth_headers):
    for days in (7, 30):
        resp = client.get(f"/api/overview/token-trend?days={days}", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
```

- [ ] **Step 2: 运行并确认失败**

Run: `pytest tests/aisoc/backend/test_overview_routes.py -k "token_trend or stats or status" -v`
Expected: FAIL（未实现/结构不符）

- [ ] **Step 3: 最小实现聚合函数**

实现函数（示例命名）：
- `get_status()`
- `get_stats()`
- `get_token_trend(days: int)`

数据源：`SessionDB` + 现有配置/service。

- [ ] **Step 4: 补全参数校验**

`days` 限制为 `{7, 30}`，非法值返回 `422`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pytest tests/aisoc/backend/test_overview_service.py tests/aisoc/backend/test_overview_routes.py -k "status or stats or token_trend" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add aisoc/backend/services/overview_service.py aisoc/backend/routes/overview.py tests/aisoc/backend/test_overview_service.py tests/aisoc/backend/test_overview_routes.py
git commit -m "feat(aisoc): add overview status stats and token trend aggregations"
```

---

### Task 3: 实现 cronjobs/cron history/session detail 接口

**Files:**
- Modify: `aisoc/backend/services/overview_service.py`
- Modify: `aisoc/backend/routes/overview.py`
- Test: `tests/aisoc/backend/test_overview_routes.py`

- [ ] **Step 1: 写失败测试（cron history 与 session detail）**

```python
def test_overview_session_detail_not_found(client, auth_headers):
    resp = client.get("/api/overview/sessions/not-exists/detail", headers=auth_headers)
    assert resp.status_code == 404
```

- [ ] **Step 2: 运行并确认失败**

Run: `pytest tests/aisoc/backend/test_overview_routes.py -k "session_detail or cronjobs" -v`
Expected: FAIL

- [ ] **Step 3: 实现最小查询与 404 映射**

实现函数：
- `list_cronjobs()`
- `get_cronjob_history(job_id)`
- `get_session_detail(session_id)`

并确保 `session detail` 消息处理策略：
- 截断超长 tool 内容
- 跳过空 assistant

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/aisoc/backend/test_overview_routes.py -k "session_detail or cronjobs" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/backend/services/overview_service.py aisoc/backend/routes/overview.py tests/aisoc/backend/test_overview_routes.py
git commit -m "feat(aisoc): implement overview cron and session detail endpoints"
```

---

### Task 4: 实现 security events / keywords / cron-token-dist 接口

**Files:**
- Modify: `aisoc/backend/services/overview_service.py`
- Modify: `aisoc/backend/routes/overview.py`
- Test: `tests/aisoc/backend/test_overview_service.py`
- Test: `tests/aisoc/backend/test_overview_routes.py`

- [ ] **Step 1: 写失败测试（返回结构最小断言）**

```python
def test_overview_security_events_shape(client, auth_headers):
    resp = client.get("/api/overview/security-events?limit=15", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
```

- [ ] **Step 2: 运行并确认失败**

Run: `pytest tests/aisoc/backend/test_overview_routes.py -k "security_events or keywords or cron_token" -v`
Expected: FAIL

- [ ] **Step 3: 最小实现并对齐字段语义**

实现函数：
- `list_security_events(limit: int)`
- `list_keywords()`
- `list_keyword_sessions(keyword: str)`
- `get_cron_token_distribution(period: str)`

- [ ] **Step 4: 跑测试确认通过**

Run: `pytest tests/aisoc/backend/test_overview_service.py tests/aisoc/backend/test_overview_routes.py -k "security or keyword or cron_token" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/backend/services/overview_service.py aisoc/backend/routes/overview.py tests/aisoc/backend/test_overview_service.py tests/aisoc/backend/test_overview_routes.py
git commit -m "feat(aisoc): add overview security keywords and cron token distribution"
```

---

### Task 5: 前端 Overview 数据层与路由接入

**Files:**
- Create: `aisoc/frontend/src/lib/overview.ts`
- Modify: `aisoc/frontend/src/App.tsx`
- Modify: `aisoc/frontend/src/components/AppShell.tsx`
- Modify: `aisoc/frontend/src/pages/LoginPage.tsx`
- Test: `aisoc/frontend/src/lib/overview.test.ts`

- [ ] **Step 1: 写失败测试（API helper）**

```ts
import { describe, it, expect } from "vitest";

describe("overview api", () => {
  it("builds token-trend query with days", async () => {
    expect(true).toBe(false);
  });
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd aisoc/frontend && npm test -- src/lib/overview.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `overview.ts` 与路由改造**

实现:
- `getOverviewStatus/getOverviewStats/getTokenTrend/...`
- `App.tsx` 默认 index -> `/overview`
- `LoginPage.tsx` 登录成功 -> `/overview`
- `AppShell.tsx` 新增并置顶 `Overview`

- [ ] **Step 4: 跑测试确认通过**

Run: `cd aisoc/frontend && npm test -- src/lib/overview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/lib/overview.ts aisoc/frontend/src/App.tsx aisoc/frontend/src/components/AppShell.tsx aisoc/frontend/src/pages/LoginPage.tsx aisoc/frontend/src/lib/overview.test.ts
git commit -m "feat(aisoc-frontend): wire overview route and api client"
```

---

### Task 6: 实现 Overview 页面主体（header/stats/charts/表格/事件流）

**Files:**
- Create: `aisoc/frontend/src/pages/OverviewPage.tsx`
- Modify: `aisoc/frontend/src/App.tsx`
- Test: `aisoc/frontend/src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: 写失败测试（加载态 + 基础模块渲染）**

```tsx
it("renders overview title and loading state", () => {
  // render(<OverviewPage />)
  // expect(screen.getByText(/loading/i)).toBeInTheDocument()
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd aisoc/frontend && npm test -- src/pages/OverviewPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现页面骨架并接入数据**

实现内容:
- header + stats row + charts row + cron table + events list
- 首屏并发加载，局部错误降级

- [ ] **Step 4: 跑测试确认通过**

Run: `cd aisoc/frontend && npm test -- src/pages/OverviewPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/OverviewPage.tsx aisoc/frontend/src/App.tsx aisoc/frontend/src/pages/OverviewPage.test.tsx
git commit -m "feat(aisoc-frontend): add overview page core panels"
```

---

### Task 7: 实现 Overview 交互（tabs/pagination/modals/drilldown）

**Files:**
- Modify: `aisoc/frontend/src/pages/OverviewPage.tsx`
- Modify: `aisoc/frontend/src/lib/overview.ts`
- Test: `aisoc/frontend/src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: 写失败测试（tab 切换与 modal 打开）**

```tsx
it("switches trend range and opens session detail modal", async () => {
  // click 30D tab and event row
  // assert modal visible
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd aisoc/frontend && npm test -- src/pages/OverviewPage.test.tsx -t "switches trend range"`
Expected: FAIL

- [ ] **Step 3: 实现交互细节**

实现:
- trend 7D/30D
- cron token today/7d/30d
- events 分页
- cron history/session detail/keyword sessions 三个 modal

- [ ] **Step 4: 运行测试确认通过**

Run: `cd aisoc/frontend && npm test -- src/pages/OverviewPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/OverviewPage.tsx aisoc/frontend/src/lib/overview.ts aisoc/frontend/src/pages/OverviewPage.test.tsx
git commit -m "feat(aisoc-frontend): add overview interactive drilldowns"
```

---

### Task 8: 全站赛博风主题改造（样式系统）

**Files:**
- Modify: `aisoc/frontend/src/styles.css`

- [ ] **Step 1: 写失败测试（可选快照/类名断言）**

若当前无 CSS 测试基础，可用最小 DOM 断言替代:

```tsx
it("applies cyber theme root class vars", () => {
  expect(document.documentElement).toBeTruthy();
});
```

- [ ] **Step 2: 运行并确认失败（若有测试）**

Run: `cd aisoc/frontend && npm test -- src/pages/OverviewPage.test.tsx`
Expected: FAIL 或覆盖不足

- [ ] **Step 3: 实现主题 token + 通用组件样式**

实现内容:
- 深色底、霓虹色 token、panel/card/table/button/input/badge 统一样式
- 基础动效（fade-in、hover sweep、live dot）
- 响应式断点（>=1200, 768-1199, <768）

- [ ] **Step 4: 类型与页面回归检查**

Run: `cd aisoc/frontend && ./node_modules/.bin/tsc -b`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/styles.css
git commit -m "feat(aisoc-frontend): introduce unified cyberpunk theme system"
```

---

### Task 9: 现有页面适配赛博主题与适度重排

**Files:**
- Modify: `aisoc/frontend/src/pages/ChatPage.tsx`
- Modify: `aisoc/frontend/src/pages/SessionsPage.tsx`
- Modify: `aisoc/frontend/src/pages/CronPage.tsx`
- Modify: `aisoc/frontend/src/pages/SkillsPage.tsx`
- Modify: `aisoc/frontend/src/pages/MemoryPage.tsx`

- [ ] **Step 1: 写失败测试/断言（优先覆盖 Sessions 约束）**

```tsx
it("does not render system messages in session detail", () => {
  // assert system role hidden
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `cd aisoc/frontend && npm test -- src/pages/OverviewPage.test.tsx`
Expected: FAIL 或用例缺失

- [ ] **Step 3: 最小改造页面结构与 className**

约束:
- Chat 保持 PTY/WS 链路不变
- Sessions 详情只显示消息
- Cron/Skills/Memory 功能行为不变

- [ ] **Step 4: 运行类型检查与测试**

Run:
- `cd aisoc/frontend && ./node_modules/.bin/tsc -b`
- `cd aisoc/frontend && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aisoc/frontend/src/pages/ChatPage.tsx aisoc/frontend/src/pages/SessionsPage.tsx aisoc/frontend/src/pages/CronPage.tsx aisoc/frontend/src/pages/SkillsPage.tsx aisoc/frontend/src/pages/MemoryPage.tsx
git commit -m "feat(aisoc-frontend): apply cyber layout to existing module pages"
```

---

### Task 10: 后端前端联调与 OpenAPI 验证

**Files:**
- Modify: `aisoc/backend/models.py`（若需补模型）
- Modify: `aisoc/backend/routes/overview.py`（校正 schema/response）
- Modify: `aisoc/frontend/src/lib/overview.ts`（字段对齐）

- [ ] **Step 1: 写失败回归测试（字段对齐）**

```python
def test_overview_stats_has_required_fields(client, auth_headers):
    data = client.get("/api/overview/stats", headers=auth_headers).json()
    for key in ["total_sessions", "active_sessions", "source_distribution"]:
        assert key in data
```

- [ ] **Step 2: 跑后端测试并确认失败（若字段不齐）**

Run: `pytest tests/aisoc/backend/test_overview_routes.py -k stats -v`
Expected: FAIL（若未对齐）

- [ ] **Step 3: 修正模型与字段映射**

确保前后端字段名完全一致，无临时兼容分支。

- [ ] **Step 4: 全量验证**

Run:
- `pytest tests/aisoc/backend/test_overview_service.py tests/aisoc/backend/test_overview_routes.py -v`
- `cd aisoc/frontend && ./node_modules/.bin/tsc -b`
- `cd aisoc/frontend && npm test`

Expected: PASS（如 `vite build` 因本机签名问题失败，记录为环境问题）

- [ ] **Step 5: Commit**

```bash
git add aisoc/backend/models.py aisoc/backend/routes/overview.py aisoc/frontend/src/lib/overview.ts tests/aisoc/backend/test_overview_routes.py
git commit -m "fix(aisoc): align overview api contracts across backend and frontend"
```

---

### Task 11: 手工验收与交付说明

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-aisoc-overview-cyber-theme-design.md`（仅在验收偏差需回写时）
- Create: `docs/superpowers/plans/2026-05-27-aisoc-overview-cyber-theme-acceptance.md`（可选验收记录）

- [ ] **Step 1: 手工链路验证**

Run server and verify:
1. 登录 -> 默认进入 `/overview`
2. Overview 模块全部加载和交互
3. Sessions 详情仅消息、无 system
4. Chat WS/PTY 可用

- [ ] **Step 2: 记录发现并修复（若有）**

将偏差按模块记录并逐个修复，必要时补自动化测试。

- [ ] **Step 3: 最终验证命令**

Run:
- `pytest tests/aisoc/backend/test_overview_service.py tests/aisoc/backend/test_overview_routes.py -v`
- `cd aisoc/frontend && ./node_modules/.bin/tsc -b`
- `cd aisoc/frontend && npm test`

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat(aisoc): ship overview dashboard and global cyber theme"
```

- [ ] **Step 5: 交付摘要**

输出:
- 变更文件清单
- 测试结果
- 已知风险与后续建议

---

## Plan Review Notes
- 结构自检通过:
  - 无 TBD/TODO 占位
  - 接口与已批准 spec 对齐
  - 每任务有明确文件、测试、实现、验证、提交
- 说明: 当前会话未收到“允许委派 sub-agent”的显式指令，因此本轮采用主线程自审；进入执行阶段后若你选择 Subagent-Driven 模式，我再按你的授权使用多代理执行。

## Rollback Strategy
1. 如果 overview 接口不稳定，可仅回退 `server.py` 中 overview router 注册并保留代码。
2. 如果全站样式影响可用性，可先回退 `styles.css` 到上一版并保持 overview 功能可用。
3. 保证每个任务独立 commit，支持按任务粒度 `git revert <commit>`。

## Definition of Done
1. 登录后默认进入 `/overview`。
2. `/api/overview/*` 全部可用且受认证保护。
3. overview 元素和交互完整复刻（包含 3 类弹窗下钻）。
4. `login/overview/chat/sessions/cron/skills/memory` 完成赛博风统一。
5. `sessions` 详情只展示消息，且过滤 system。
6. 自动化验证通过（后端测试 + 前端 typecheck/test）。
