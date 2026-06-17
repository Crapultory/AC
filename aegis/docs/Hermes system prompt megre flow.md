第一层：原生 System Prompt（一次构建，全局缓存）

agent/system_prompt.py:build_system_prompt_parts() 将 system prompt 分为 *三个 tier*，用 \n\n 拼成一条字符串：

┌─────────────────────────────────────────┐
│  Stable tier（不变）                      │
│  ├── SOUL.md / DEFAULT_AGENT_IDENTITY    │  ← 你的 Aegis 身份
│  ├── tool guidance（memory/skill 等）     │
│  ├── skills prompt                       │
│  ├── environment hints（macOS, Python）   │
│  ├── platform hints                      │
│  └── model operational guidance          │
├─────────────────────────────────────────┤
│  Context tier（会话级稳定）                 │
│  ├── context files（AGENTS.md 等）        │
│  └── system_message（如果有）             │
├─────────────────────────────────────────┤
│  Volatile tier（变化）                     │
│  ├── memory snapshot                     │
│  ├── USER profile                        │
│  ├── external memory provider block       │
│  └── timestamp / session_id / model      │
└─────────────────────────────────────────┘




*这整个是一条 {"role": "system", "content": "..."}*，被缓存为 agent._cached_system_prompt。

第二层：Ephemeral System Prompt（每次请求动态添加）

Gateway 在 run.py 第 17005-17010 行组装：

python
combined_ephemeral = context_prompt or ""                   # ← Current Session Context 块
                    + event_channel_prompt                   # ← 频道自定义 prompt
                    + self._ephemeral_system_prompt          # ← 全局 ephemeral 配置




第三层：API 调用时合并（conversation_loop.py 第 1000-1004 行）

python
effective_system = active_system_prompt or ""            # ← 原生 system prompt（缓存的整块）
if agent.ephemeral_system_prompt:
    effective_system = (effective_system + "\n\n" + agent.ephemeral_system_prompt).strip()
if effective_system:
    api_messages = [{"role": "system", "content": effective_system}] + api_messages




最终发给 LLM 的是 一条 system 消息，结构如下：

[原生 stable tier]
[原生 context tier]
[原生 volatile tier]
                    ← \n\n 分隔
[ephemeral: Current Session Context]
[ephemeral: channel_prompt]
[ephemeral: gateway configured]




架构设计意图

| 层级 | 缓存策略 | 目的 |
|------|----------|------|
| 原生 system prompt | 缓存到 session DB，跨轮次复用 | 保持 upstream prefix cache 命中 |
| ephemeral | 只拼接到 API 请求中，*不入 DB* | 不影响缓存，每次可以变化 |

context_prompt（Current Session Context）并没有替换或合并到原生 system prompt 里，它是在 API 调用时刻被附加到原生 system prompt 末尾的。 两者最终组成一条 {"role": "system"} 消息，用 \n\n 分隔。