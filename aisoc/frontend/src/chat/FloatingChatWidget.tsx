/**
 * 右下角悬浮聊天入口（统一聊天运行时版）：
 * - 悬浮球：有需要关注的会话时显示 chatAttentionCount 徽标；
 * - 点击展开小型聊天面板（380×560），复用 MessageStream / Composer，
 *   操作的是与 /chat 页同一个活跃会话（同一 AisocChatProvider）；
 * - /chat 路由下不渲染（主视图已在）。
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, Plus, X } from 'lucide-react';

import { Composer, MessageStream } from './components';
import { useChatRuntime } from './runtime/chatRuntime';

const BRAND_LOGO_SRC = `${import.meta.env.BASE_URL}aisoc-logo.svg?v=4`;

export function FloatingChatWidget() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeConversation, chatAttentionCount, createConversation } = useChatRuntime();
  const [open, setOpen] = useState(false);

  // /chat 主视图自带完整聊天界面，悬浮球不再出现。
  if (location.pathname.startsWith('/chat')) {
    return null;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开聊天"
        title="打开聊天"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 overflow-hidden rounded-2xl border border-[var(--aisoc-border)] shadow-[0_10px_30px_rgba(6,8,12,0.5)] transition-transform hover:scale-105 hover:border-[var(--aisoc-border-strong)]"
      >
        <img src={BRAND_LOGO_SRC} alt="" className="h-full w-full object-cover" />
        {chatAttentionCount > 0 ? (
          <span
            aria-label={`${chatAttentionCount} 个会话需要关注`}
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--aisoc-accent)] px-1 font-mono text-[10px] font-bold leading-none text-[var(--aisoc-on-accent)]"
          >
            {chatAttentionCount > 99 ? '99+' : chatAttentionCount}
          </span>
        ) : null}
      </button>
    );
  }

  const title = activeConversation?.title || '新对话';

  return (
    <div
      role="dialog"
      aria-label="悬浮聊天面板"
      className="fixed bottom-6 right-6 z-50 flex h-[560px] max-h-[calc(100vh-3rem)] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[var(--aisoc-radius-lg)] border border-[var(--aisoc-border)] bg-[var(--aisoc-bg)] text-[var(--aisoc-text)] shadow-[0_18px_48px_rgba(6,8,12,0.55)]"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-[var(--aisoc-border)] bg-[var(--aisoc-bg-alt)] px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={createConversation}
          aria-label="新建会话"
          title="新建会话"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--aisoc-radius-sm)] text-[var(--aisoc-muted)] transition-colors hover:bg-[var(--aisoc-accent-soft)] hover:text-[var(--aisoc-accent)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate('/chat');
          }}
          aria-label="在完整视图打开"
          title="在完整视图打开"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--aisoc-radius-sm)] text-[var(--aisoc-muted)] transition-colors hover:bg-[var(--aisoc-accent-soft)] hover:text-[var(--aisoc-accent)]"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="关闭聊天面板"
          title="关闭聊天面板"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--aisoc-radius-sm)] text-[var(--aisoc-muted)] transition-colors hover:bg-[var(--aisoc-accent-soft)] hover:text-[var(--aisoc-accent)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageStream />
        <Composer />
      </div>
    </div>
  );
}
