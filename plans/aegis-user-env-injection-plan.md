# Aegis 用户级运行时环境变量与 `userenv` Tool 方案计划

## 目标

基于 `AIAgent` 已有的 `platform` / `user_id` / `user_name` 身份，在 **不污染进程级 `os.environ`**、**不改变现有 sandbox/container 复用语义** 的前提下，实现：

1. 从 `HERMES_HOME/users.env.json` 为当前平台下的当前用户加载一组稳定复用的运行时环境变量。
2. 让当前平台下当前用户的 tool 调用子进程在运行时看到这组变量。
3. 新增 `userenv` tool，仅允许用户管理**自己的** env。
4. 用户名变化后切换到新键，并在可判定时自动迁移旧键。
5. 不同 `platform` 上的相同 `user_id` 必须使用不同 env。

---

## 已确认约束

- 数据源固定为 `HERMES_HOME/users.env.json`
- 存储格式期望为：

```json
{
  "platform.user_id.user_name": {
    "KEY1": "VALUE1",
    "KEY2": "VALUE2"
  }
}
```

- 允许注入任意环境变量名和值，不做 allowlist / denylist
- 同一用户跨多轮稳定复用同一套 env
- `userenv` 只能操作当前会话用户自己的 env
- 不同 `platform` 上的相同 `user_id` 不共享 env
- `platform` / `user_name` 为空、缺失、包含 `.` / 换行等字符时，规范化后仍允许使用

---

## 为什么重写旧方案

旧版方案依赖 `tools/terminal_tool.py` 的 `_task_env_overrides`。这条路不适合用户 env，原因有三点：

1. `_task_env_overrides` 会影响 `_resolve_container_task_id()` 的折叠逻辑，改变 `"default"` 环境复用语义。
2. agent 实际传给工具的是每轮新生成的 `effective_task_id`，不是稳定的 `session_id`；把用户 env 挂到 `session_id` 上会错位。
3. 用户 env 需要“同轮立即生效”和“跨轮稳定复用”，但不能把 env 粘在复用中的 `LocalEnvironment` 实例上，否则会发生串味。

结论：**用户 env 必须走独立的持久层和独立的 runtime 绑定链路，不能复用 `_task_env_overrides`。**

---

## 方案摘要

采用确认后的 **方案 1：Agent 上下文直传 + 独立 users.env registry**。

核心结构拆成三层：

1. **持久层**：`users.env.json`
   - 存当前平台下当前用户的 env
   - 负责 key 规范化、读取、写回、迁移、原子写

2. **运行时绑定层**：当前 tool 调用线程的用户身份上下文
   - agent 在实际执行 tool 前把“当前平台用户身份”绑定到 `ContextVar`
   - tool / 后台进程在启动子进程时按当前身份即时读取 `users.env.json`
   - `userenv` tool 修改后，同轮后续调用天然读取新值
   - 只影响当前调用创建的子进程，不改进程级 `os.environ`

3. **消费层**：tool 子进程启动处
   - 前台 local 执行：`tools/environments/local.py`
   - local background 进程：`tools/process_registry.py`
   - 其它复用 local backend 的调用链：`terminal` / `execute_code`

---

## 范围

### V1 必做

- `TERMINAL_ENV=local` 的前台命令注入
- `TERMINAL_ENV=local` 的后台进程注入
- `terminal`、`execute_code` 通过 local backend 的一致行为
- `delegate_task` 子 agent 继承相同用户身份并重新加载相同 env
- `userenv` tool 的增删改查（list）

### V1 明确暂不做

- Docker / Singularity / Modal / Daytona / SSH 的用户 env 注入
- 管理其他用户 env
- 通过 tool 明文回显 env 值

说明：V1 的目标是先把“本机用户态运行时 env 注入”做正确。远端 / 容器后端需要逐个后端补“每次执行时的 env 注入”，不应和 V1 混在一起。

---

## 数据模型

### 1. 持久文件

文件路径：

- `get_hermes_home() / "users.env.json"`

建议创建时保证：

- 父目录存在
- JSON 内容 UTF-8
- 原子写：临时文件 + `os.replace()`
- 尽量设置为用户私有权限（POSIX 下 `0600`）

顶层结构：

```json
{
  "<normalized_user_key>": {
    "<ENV_KEY>": "<ENV_VALUE_AS_STRING>"
  }
}
```

约束：

- env 值统一落盘为字符串
- 删除最后一个变量后，移除该用户的顶层 key
- 不引入额外 metadata 到同一层，保持文件简单可读

### 2. 用户 key 规范化

不要直接做简单的 `f"{platform}.{user_id}.{user_name}"` 拼接。要做稳定组件规范化。

建议规则：

1. `platform`、`user_id`、`user_name` 都先做：
   - `str(...)`
   - 去首尾空白
2. 对每个组件分别做 `urllib.parse.quote(component, safe=".-_~")`
5. 最终 key：

```text
<quoted_platform>.<quoted_user_id>.<quoted_user_name>
```

这样：

- 原始值中的 `/`、空白等不安全字符会被稳定编码
- 原始值中的 `.` 允许保留，便于兼容既有可读 key
- 给定当前身份时可稳定命中与迁移

### 3. 用户名变更迁移

当前身份加载时执行：

1. 计算当前 key
2. 若当前 key 存在，直接使用
3. 若当前 key 不存在，则扫描所有顶层 key，解码后找出“同一 `platform` + 同一 `user_id`、不同 `user_name`”的候选
4. 若候选恰好 1 个，则：
   - 将旧 key 下的 env 原子迁移到新 key
   - 删除旧 key
   - 返回迁移后的 env
5. 若候选为 0 个，返回空 env
6. 若候选大于 1 个，不自动猜测，返回空 env 并打日志警告

原因：`user_name` 变更应切到新键，但平台维度不能跨平台合并，且不能在多个历史键同时存在时静默选错数据。

---

## 运行时设计

### 1. 独立 runtime 绑定模块

新增一个**不自注册为 tool** 的辅助模块，例如：

- `tools/user_env_runtime.py`

职责：

- 保存当前 tool 执行线程的用户身份上下文
- 暴露绑定 / 查询 / 重置 API
- 在需要时按当前身份读取持久层 env

建议 API：

```python
set_current_user_env_identity(platform: str, user_id: str, user_name: str, user_key: str) -> Token
reset_current_user_env_identity(token: Token) -> None
get_current_user_env_identity() -> UserEnvIdentity | None
get_current_user_env_values() -> dict[str, str]
bind_current_user_env_identity(...) -> contextmanager
```

注意：

- “当前用户身份”用 `ContextVar`
- 线程池 / 子线程依赖现有 `propagate_context_to_thread()` 自动继承上下文
- 不把 env 快照挂到复用中的 `LocalEnvironment` 实例上，避免跨用户串味

### 2. 绑定时机

在实际 tool dispatch 之前绑定用户身份：

1. 从 agent 读取 `platform` / `_user_id` / `_user_name`
2. 若任一关键身份缺失，则显式绑定空身份，避免线程复用造成脏数据残留
3. 在以下入口包裹绑定：
   - `agent/agent_runtime_helpers.py::invoke_tool()`，覆盖并发工具执行路径
   - `agent/tool_executor.py` 中直接调用 `handle_function_call()` 的顺序执行路径
4. 子线程依赖 `propagate_context_to_thread()` 自动继承绑定后的 `ContextVar`

在单次 tool 调用结束后通过 `ContextVar.reset()` 恢复：

- 不会把身份残留到后续无关工具调用
- 同一轮后续工具仍会基于同一身份重新读取同一份持久配置

### 3. 子 agent / `delegate_task`

`delegate_task` 子 agent 已经显式透传：

- `platform`
- `user_id`
- `user_id_alt`
- `user_name`

因此不需要传递 `_user_env_overrides` 这样的私有快照。

子 agent 只要沿用同一套 tool-dispatch 绑定逻辑，就会：

1. 用相同身份重新读取 `users.env.json`
2. 自动拿到同一用户的最新 env
3. 若父 turn 中先执行了 `userenv set`，子 agent 也能读到更新后的值

---

## 消费层设计

### 1. 前台 local 命令

修改：

- `tools/environments/local.py`

当前 `_make_run_env(env)` 已负责：

- provider 变量过滤
- `PATH` 注入
- `HOME` 隔离
- `gateway.session_context` 桥接

在其末尾追加：

1. 读取 `get_current_user_env_values()`
2. 将当前用户 env 覆盖写入最终运行环境

这样前台 local 命令每次执行都会按“当前平台 + 当前用户”即时加载最新 env。

原则：

- 用户 env 只进入子进程 `env=`
- 不写回 `os.environ`
- 不存进 `LocalEnvironment.env`

这点很关键：`LocalEnvironment` 可能被 `"default"` key 复用，**用户 env 不能粘在实例上**。

### 2. local background 进程

修改：

- `tools/process_registry.py`

`spawn_local()` 已有 `task_id` 参数，因此可在这里按 task 查询用户 env：

```python
bg_env = _sanitize_subprocess_env(os.environ, env_vars)
```

这样：

- background 进程和 foreground local 命令拿到同一套用户 env
- 注入逻辑复用 `_sanitize_subprocess_env()`，由它在末尾叠加当前用户 env
- 不依赖 `LocalEnvironment.env`
- 避免“前台生效、后台失效”

### 3. `execute_code`

V1 不要求它额外做专门桥接代码，前提是：

- 它走的是 local backend
- 它最终通过 `LocalEnvironment._run_bash()` 消费 env

因此在本方案中：

- `execute_code` 的 local 路径无须单独传 env，只要相关线程通过 `propagate_context_to_thread()` 继承 `ContextVar`

### 4. 非 local backend

V1 明确保持现状，不注入用户 env。

原因：

- Docker / Modal / SSH / Daytona / Singularity 依赖 snapshot 或远端命令包装
- 若做错，会把 env 固化进复用环境，副作用比 local 更大

后续扩展原则：

- 必须做成“每次执行时注入”，不能只在 backend 初始化时注入

---

## `userenv` Tool 设计

### 1. 文件与注册

新增：

- `tools/userenv_tool.py`

并在：

- `toolsets.py`

中新增：

1. 新 toolset，例如 `"userenv"`
2. 将 `"userenv"` 加入 `_HERMES_CORE_TOOLS`

这样 CLI / gateway 默认都能看到此工具。

### 2. 允许的 action

保持单工具、单 schema：

- `list`
- `set`
- `delete`

不建议首版增加更多动作，避免复杂化。

参数建议：

```json
{
  "action": "list | set | delete",
  "key": "ENV_VAR_NAME",
  "value": "string value for set"
}
```

语义：

- `list`: 返回当前平台下当前用户的 env 键列表及脱敏摘要
- `set`: 创建或覆盖当前平台下当前用户某个 env 键
- `delete`: 删除当前平台下当前用户某个 env 键

`set` 同时承担“新增”和“修改”。

### 3. 只允许当前用户管理自己

tool handler 不接受 `user_id` / `user_name` 参数。

它只能从 runtime 上下文读取当前平台下的当前用户身份：

- 若当前上下文没有 `user_id`，返回错误：
  - 当前会话无用户身份，无法管理用户 env

这保证：

- 模型无法伪造其它用户身份
- tool 自然满足“只允许操作自己的 env”

### 4. 返回值必须脱敏

`userenv` 不能把原始 value 回显到模型上下文、session 持久化、trajectory 或日志里。

这是首版的硬要求。

返回建议：

- `list`

```json
{
  "user_key": "<normalized key>",
  "count": 2,
  "variables": [
    {
      "key": "GITHUB_TOKEN",
      "masked_value": "******"
    }
  ]
}
```

- `set`

```json
{
  "updated": true,
  "user_key": "<normalized key>",
  "key": "GITHUB_TOKEN",
  "masked_value": "******",
  "count": 2
}
```

- `delete`

```json
{
  "deleted": true,
  "key": "GITHUB_TOKEN",
  "remaining": 1
}
```

其中：

- 不返回 raw value
- list 至少返回 key 列表与脱敏占位

这样用户仍然可以：

- 确认某个 key 是否存在
- 确认新值已被写入

但不会把 secret 原文写进会话。

### 5. 同轮立即生效

`userenv set/delete` 成功写盘后，不需要额外刷新内存映射。

因为后续调用会在子进程启动前重新读取持久层，所以同一轮后续的：

- `terminal`
- `execute_code`
- `delegate_task`

都能看到最新值，不必等下一轮。

---

## 建议新增/修改文件

### 新增文件

- `tools/user_env_store.py`
  - 持久层：带 `platform` 维度的 key 规范化、读取、写入、迁移、原子写

- `tools/user_env_runtime.py`
  - runtime 身份绑定与按身份读取 env

- `tools/userenv_tool.py`
  - `userenv` tool 的 schema 与 handler

### 修改文件

- `agent/agent_runtime_helpers.py`
  - 并发工具执行路径在 dispatch 前绑定/恢复当前平台用户身份

- `agent/tool_executor.py`
  - 顺序工具执行路径在 `handle_function_call()` 前绑定/恢复当前平台用户身份

- `tools/environments/local.py`
  - 在 `_make_run_env()` / `_sanitize_subprocess_env()` 中合并当前用户 env

- `tools/process_registry.py`
  - 无需单独维护用户 env 映射；复用 `_sanitize_subprocess_env()` 的注入结果

- `toolsets.py`
  - 注册新 toolset，并把 `userenv` 放进核心工具列表

### 明确无需修改

- `tools/terminal_tool.py`
  - 不再使用 `_task_env_overrides`

- `tools/file_tools.py`
  - 不属于运行时 env 注入消费面，无需修改

- `tools/code_execution_tool.py`
  - V1 local 路径依赖现有上下文传播，不需单独塞 env

---

## 验证清单

### 核心功能

1. 用户 A `set` 一个变量后，本轮后续 `terminal(command="env")` 能看到它
2. 同一用户下一轮仍能看到相同变量
3. 用户 B 看不到用户 A 的变量
4. `os.environ` 本身未被污染

### 复用安全

5. 同一个 `LocalEnvironment` 实例在不同用户上下文下执行时不会串味
6. local background 进程继承当前用户 env
7. `execute_code` 走 local backend 时能读到用户 env

### 身份与迁移

9. `user_name` 改变后，同一 `platform` 下的单一旧键会自动迁移到新键
10. 不同 `platform` 上相同 `user_id` 不共享 env
11. 多个历史旧键冲突时不自动猜测，只记录 warning
12. `platform` / `user_name` 为空或包含 `.` / 换行时，仍可稳定生成 key

### `userenv` tool

13. `list` / `set` / `delete` 都只作用于当前平台下的当前用户
14. tool 返回结果不包含 raw value
15. 删除最后一个变量后，顶层用户 key 被移除

---

## 测试建议

建议新增测试：

- `tests/tools/test_user_env_store.py`
  - key 规范化
  - 平台维度隔离
  - 自动迁移
  - 歧义迁移保护
  - 原子写/锁基础行为

- `tests/tools/test_userenv_tool.py`
  - `list` / `set` / `delete`
  - 无用户身份时报错
  - 返回值脱敏

- `tests/tools/test_local_user_env.py`
  - `_make_run_env()` 合并当前用户 env
  - 复用同一 `LocalEnvironment` 时不串味

- `tests/tools/test_process_registry.py`
  - `spawn_local()` 的 background 进程继承用户 env

- 已有 agent / delegate 身份透传链路做代码复核
  - 并发路径：`agent_runtime_helpers.invoke_tool()`
  - 顺序路径：`agent/tool_executor.py`
  - 子 agent：`tools/delegate_tool.py`
  - `execute_code`：`tools/code_execution_tool.py` 通过 `env.execute()` 和 `propagate_context_to_thread()` 复用同一路径

---

## 风险与注意事项

### 1. 不能把用户 env 粘到 environment 实例上

这是本需求的最大坑。

原因：

- `_active_environments["default"]` 可能复用
- 若把用户 env 存在 `self.env`，下一个用户会继承前一个用户的数据

因此：

- 只能在“每次启动子进程时”合并当前用户 env

### 2. `userenv` 不能明文回显 secret

否则：

- 会进入消息历史
- 会进入 session 持久化
- 会进入 trajectory
- 会进入日志

必须默认脱敏，只返回摘要。

### 3. 空/非法 shell 变量名的行为差异

需求侧希望允许尽可能宽松的 key，因此不做 allowlist / denylist。
但底层 `subprocess.Popen(env=...)` 仍有宿主约束：

- 名称不能包含 `=`
- 名称和值都不能包含 NUL

但要在计划中明确：

- `subprocess.Popen(env=...)` 可以携带大多数这类键（如空格等非 shell-safe 名称），但前述 `=` / NUL 例外
- shell 中只有合法标识符才能直接用 `$KEY` 展开
- 某些程序可通过 `getenv()` 读取非 POSIX-safe key

也就是说，“允许注入”不等于“保证 shell 里能按变量名展开”。

### 4. V1 是 local-first

这不是漏做，而是刻意控制 blast radius。

远端 / 容器后端若要接入，必须逐个 backend 审视：

- snapshot 何时生成
- env 是否会被固化
- 每次执行时如何注入

---

## 实施顺序

### Phase 1：持久层与 runtime 绑定

- 新增 `tools/user_env_store.py`
- 新增 `tools/user_env_runtime.py`
- 在 `agent/agent_runtime_helpers.py` 与 `agent/tool_executor.py` 的 tool dispatch 入口绑定/恢复当前用户身份

### Phase 2：local 消费层

- 修改 `tools/environments/local.py`
- 通过 `tools/process_registry.py` 复用 `_sanitize_subprocess_env()` 的注入结果覆盖 background 进程

### Phase 3：`userenv` tool

- 新增 `tools/userenv_tool.py`
- 更新 `toolsets.py`
- 依赖“子进程启动前重新读取持久层”保证同轮立即生效

### Phase 4：测试与回归

- 增补单元测试
- 验证 local foreground/background
- 验证子 agent 和跨轮复用

---

## 最终结论

这版设计的关键不是“把 env 塞进 terminal tool”，而是：

1. 用 `users.env.json` 作为当前平台用户 env 的唯一权威源
2. 用独立 runtime 上下文把“当前平台用户 env”绑定到“当前 turn / 当前 task”
3. 只在子进程 `env=` 边界消费，绝不污染进程全局环境
4. 用 `userenv` tool 让用户自助管理自己的 env，并默认脱敏返回

这能满足当前需求，同时避免旧方案里最危险的两个问题：

- 误用 `_task_env_overrides` 改坏环境复用语义
- 把用户 env 粘在复用环境实例上导致串味
