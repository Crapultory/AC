AISOC / A2A / Aegis 自重启与设置页方案
Summary
为 AISOC Web Server、AISOC A2A、Aegis 三个入口增加“重启自身服务”能力，统一采用共享的自重启 watcher 机制。
重启语义是：当前服务触发重启请求后，启动一个脱离当前进程的 watcher，等待旧进程退出，再按同样启动路径与参数重新拉起。
不额外处理认证态保持问题；重启后若服务使用启动期生成的 token/JWT，变化视为正常结果。
Key Changes
共享重启能力：
抽出一个共享的 self-restart 辅助层，负责记录当前进程的 argv、cwd、必要环境变量，并在旧 PID 退出后重放启动命令。
支持 hermes ...、python xxx/main.py ...、python -m ... 三类启动形式。
重启执行链固定为：鉴权通过 -> 防重入标记 -> 启动 detached watcher -> 当前进程优雅退出 -> watcher 拉起新进程。
不注入额外的 token/JWT 保持环境；仅继承当前正常进程环境。

AISOC Web Server：
新增 POST /api/system/restart，沿用现有 AISOC Bearer Token 鉴权。
在现有 React Workbench 中新增 Settings 菜单和 /settings 页面。
设置页包含运行状态摘要和危险操作区，提供“重启 AISOC”按钮。
点击后采用两阶段确认：先弹危险确认，再输入确认词 RESTART AISOC 才真正发起请求。
请求成功后前端进入 restarting 状态，禁用按钮并轮询 /health，服务恢复后刷新页面。

AISOC A2A：
新增独立管理口令环境变量 AISOC_A2A_ADMIN_TOKEN，仅用于 /man 管理能力，不复用 A2A 通信 token。
在 A2A 服务内提供 /man 管理页及配套接口：GET /man
POST /man/api/auth
POST /man/api/restart

/man 登录要求输入管理 token，不接受通信 token。
授权成功后才启用重启按钮；重启交互同样采用两阶段确认，确认词为 RESTART A2A。
若 AISOC_A2A_ADMIN_TOKEN 未配置，则 /man 页面显示管理未启用，不允许执行重启。

Aegis：
新增 POST /api/system/restart，复用现有 JWT 登录体系，但仅允许管理员调用。
在现有前端中实现 settings tab/path，并把侧边栏 System Settings 从占位改为真实管理员页。
非管理员完全隐藏该菜单，且直接访问设置页会被拦回 overview。
右上角设置按钮跳转到设置页。
设置页提供“重启 Aegis”按钮，采用两阶段确认，确认词为 RESTART AEGIS。

Public Interfaces
新增 API：AISOC: POST /api/system/restart
Aegis: POST /api/system/restart
统一返回 202 Accepted，响应体包含：accepted
already_requested
service
pid


新增 A2A 管理接口：POST /man/api/auth，请求 { token }
POST /man/api/restart，要求短时效管理 bearer token

新增环境变量：AISOC_A2A_ADMIN_TOKEN

Test Plan
共享重启层：
覆盖三类启动形式的 argv 重建。
覆盖防重入，确保重复点击不会启动多个 watcher。
增加子进程级 smoke test，验证旧进程退出后能按原命令重启。

AISOC：
后端测试 POST /api/system/restart 的认证、202 响应和防重入。
前端测试新增 /settings 导航、两阶段确认、重启中的禁用态和恢复轮询。

A2A：
测试 /man 认证只认 AISOC_A2A_ADMIN_TOKEN，不认通信 token。
测试管理未启用时的页面和接口表现。
测试 /man/api/restart 的授权与防重入。

Aegis：
后端测试未登录 401、非管理员 403、管理员 202。
前端测试管理员可见设置页、普通用户完全隐藏且禁止直达。
前端测试两阶段确认与重启请求流程。

Assumptions
重启后认证 token / JWT 变化无需兼容处理，前端或客户端重新认证是可接受行为。
Aegis 的 System Settings 对非管理员完全隐藏，不提供只读页。
A2A 管理授权成功后的 access token 只保存在浏览器内存中。
本次设置页仅承载运行状态与重启能力，不顺带扩展其他系统配置编辑功能。