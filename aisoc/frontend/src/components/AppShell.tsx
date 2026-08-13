import { Link, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";

import { FloatingChatWidget } from "../chat/FloatingChatWidget";
import { AisocChatProvider, useOptionalChatRuntime } from "../chat/runtime/chatRuntime";
import { clearStoredToken } from "../lib/auth";

type NavIconName = "overview" | "chat" | "sessions" | "cron" | "skills" | "wiki" | "memory" | "ontology" | "settings";

interface NavChild {
  path: string;
  label: string;
  zh?: string;
}

interface NavEntry {
  path: string;
  label: string;
  icon: NavIconName;
  children?: NavChild[];
}

const NAV_ITEMS: NavEntry[] = [
  { path: "/overview", label: "Overview", icon: "overview" },
  { path: "/chat", label: "Chat", icon: "chat" },
  { path: "/sessions", label: "Sessions", icon: "sessions" },
  { path: "/cron", label: "Cron", icon: "cron" },
  { path: "/skills", label: "Skills", icon: "skills" },
  { path: "/wiki", label: "LLMWiki", icon: "wiki" },
  { path: "/memory", label: "Memory", icon: "memory" },
  {
    path: "/ontology",
    label: "Ontology",
    icon: "ontology",
    children: [
      { path: "/ontology/standard-graph", label: "Standard Graph", zh: "标准图谱" },
      { path: "/ontology/diff-overview", label: "Diff Overview", zh: "差异总览" },
    ],
  },
  { path: "/settings", label: "Settings", icon: "settings" },
];

const NAV_COLLAPSED_STORAGE_KEY = "aisoc_nav_collapsed";
const NAV_EXPANDED_PARENTS_KEY = "aisoc_nav_expanded_parents";
const BRAND_LOGO_SRC = `${import.meta.env.BASE_URL}aisoc-logo.svg?v=4`;

/* ── Tailwind class fragments (MASTER.md v3: near-black panels, cyan signal accent,
   active nav item = accent text + inset 2px signal bar, no glow shadows) ── */

/** Collapsed rail hides labels; below 920px the shell is single-column and labels return. */
const HIDE_WHEN_COLLAPSED =
  "pointer-events-none w-0 opacity-0 max-[920px]:pointer-events-auto max-[920px]:w-auto max-[920px]:opacity-100";

const NAV_ROW_BASE =
  "relative isolate flex items-center gap-[calc(10px*var(--density-scale))] rounded-lg border py-[calc(8px*var(--density-scale))] no-underline transition-colors duration-[160ms]";

const NAV_ROW_IDLE =
  "border-[rgba(34,211,238,0.08)] bg-[linear-gradient(115deg,rgba(9,13,19,0.48),rgba(7,9,13,0.28))] hover:border-aisoc-border-strong hover:bg-[linear-gradient(115deg,rgba(13,18,26,0.84),rgba(8,10,15,0.6))]";

const NAV_ROW_ACTIVE =
  "border-[rgba(34,211,238,0.4)] bg-[linear-gradient(120deg,rgba(15,20,30,0.9),rgba(10,13,19,0.84))] shadow-[inset_2px_0_0_var(--aisoc-accent)]";

const NAV_ICON_WRAP =
  "inline-flex h-[calc(22px*var(--density-scale))] w-[calc(22px*var(--density-scale))] shrink-0 items-center justify-center transition-colors duration-[160ms]";

const NAV_ICON_SVG = "h-[calc(20px*var(--density-scale))] w-[calc(20px*var(--density-scale))]";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(34,211,238,0.6)]";

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <svg viewBox="0 0 24 24" className={NAV_ICON_SVG} aria-hidden="true" focusable="false">
      {name === "overview" && (
        <>
          <path {...common} d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" />
        </>
      )}
      {name === "chat" && (
        <>
          <path
            {...common}
            d="M4 6.75a2.75 2.75 0 0 1 2.75-2.75h10.5A2.75 2.75 0 0 1 20 6.75v6.5A2.75 2.75 0 0 1 17.25 16H11l-3.5 3v-3H6.75A2.75 2.75 0 0 1 4 13.25v-6.5Z"
          />
        </>
      )}
      {name === "sessions" && (
        <>
          <path {...common} d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path {...common} d="M6.5 19.25a5.5 5.5 0 0 1 11 0" />
          <path {...common} d="M6.75 11.75A2.25 2.25 0 1 0 6.75 7.25M17.25 11.75A2.25 2.25 0 1 1 17.25 7.25" />
        </>
      )}
      {name === "cron" && (
        <>
          <path {...common} d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          <path {...common} d="M12 8v4l2.75 1.75" />
        </>
      )}
      {name === "skills" && (
        <>
          <path
            {...common}
            d="M14.5 4.5a3 3 0 1 1 4.24 4.24L10 17.5 6 18.5l1-4 7.5-10ZM13.5 7.5l3 3"
          />
        </>
      )}
      {name === "wiki" && (
        <>
          <path {...common} d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z" />
          <path {...common} d="M8 7h8M8 11h6M8 15h4" />
        </>
      )}
      {name === "memory" && (
        <>
          <path {...common} d="M3.75 7.5c0-1.66 3.7-3 8.25-3s8.25 1.34 8.25 3-3.7 3-8.25 3-8.25-1.34-8.25-3Z" />
          <path {...common} d="M3.75 7.5V16.5c0 1.66 3.7 3 8.25 3s8.25-1.34 8.25-3V7.5" />
          <path {...common} d="M3.75 12c0 1.66 3.7 3 8.25 3s8.25-1.34 8.25-3" />
        </>
      )}
      {name === "ontology" && (
        <>
          <path {...common} d="M12 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
          <path {...common} d="M5 15.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM19 15.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
          <path {...common} d="M10.25 7.5 6.5 14M13.75 7.5 17.5 14M7 18h10" />
        </>
      )}
      {name === "settings" && (
        <>
          <path {...common} d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" />
          <path {...common} d="M19.1 13.6a7.6 7.6 0 0 0 .05-1.6 7.6 7.6 0 0 0-.05-1.6l2-1.55-2-3.45-2.45 1a7.6 7.6 0 0 0-2.75-1.6L13.55 2h-4l-.4 2.8A7.6 7.6 0 0 0 6.4 6.4l-2.45-1-2 3.45 2 1.55A7.6 7.6 0 0 0 3.9 12a7.6 7.6 0 0 0 .05 1.6l-2 1.55 2 3.45 2.45-1a7.6 7.6 0 0 0 2.75 1.6l.4 2.8h4l.4-2.8a7.6 7.6 0 0 0 2.75-1.6l2.45 1 2-3.45-2-1.55Z" />
        </>
      )}
    </svg>
  );
}

function readInitialNavCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "1";
}

/** Per-parent expand state. Default: every parent expanded. User can collapse
 * via the chevron and the choice persists across reloads. */
function readInitialExpandedParents(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const item of NAV_ITEMS) {
    if (item.children?.length) defaults[item.path] = true;
  }
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(NAV_EXPANDED_PARENTS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { ...defaults, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

/** Chat 导航项的注意力徽标（未读 / 待审批 / 待澄清的会话数）。 */
function ChatNavBadge() {
  const runtime = useOptionalChatRuntime();
  const count = runtime?.chatAttentionCount || 0;
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} 个会话需要关注`}
      className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--aisoc-accent)] px-1 font-mono text-[9px] font-bold leading-none text-[var(--aisoc-on-accent)]"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppShell() {
  const location = useLocation();
  const [navCollapsed, setNavCollapsed] = useState<boolean>(readInitialNavCollapsed);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>(readInitialExpandedParents);

  function toggleParent(path: string): void {
    setExpandedParents((prev) => {
      const next = { ...prev, [path]: !prev[path] };
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(NAV_EXPANDED_PARENTS_KEY, JSON.stringify(next));
        } catch {
          /* ignore quota */
        }
      }
      return next;
    });
  }

  const activeItem =
    NAV_ITEMS.find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) ??
    NAV_ITEMS[0];
  const showWorkbenchTopbar = activeItem.path !== "/overview";

  function signOut(): void {
    clearStoredToken();
    window.location.href = "/login";
  }

  function toggleNav(): void {
    setNavCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  }

  // 统一聊天运行时：/chat 主视图可见。
  const isChatVisible = location.pathname.startsWith("/chat");

  const navLinkSizing = navCollapsed
    ? "min-h-[46px] justify-center px-[7px] max-[920px]:justify-start max-[920px]:px-[10px]"
    : "min-h-[calc(44px*var(--density-scale))] px-[calc(10px*var(--density-scale))]";

  return (
    <AisocChatProvider isChatVisible={isChatVisible}>
    <div
      className={`grid h-dvh overflow-hidden transition-[grid-template-columns] duration-[160ms] max-[920px]:grid-cols-1 ${
        navCollapsed
          ? "grid-cols-[calc(92px*var(--density-scale))_1fr]"
          : "grid-cols-[calc(286px*var(--density-scale))_1fr]"
      }`}
    >
      <aside
        data-testid="side-nav"
        className={`relative grid min-w-0 grid-rows-[auto_1fr_auto] gap-[calc(18px*var(--density-scale))] border-r border-aisoc-border bg-[linear-gradient(180deg,rgba(7,9,13,0.94),rgba(6,7,10,0.96)),radial-gradient(circle_at_18%_12%,rgba(34,211,238,0.1)_0,transparent_38%)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)] backdrop-blur-[14px] transition-[padding] duration-[160ms] max-[920px]:border-r-0 max-[920px]:border-b ${
          navCollapsed
            ? "px-2 py-4 max-[920px]:px-3"
            : "px-[calc(12px*var(--density-scale))] py-[calc(16px*var(--density-scale))]"
        }`}
      >
        <header
          className={`flex items-center gap-[calc(10px*var(--density-scale))] ${
            navCollapsed
              ? "flex-col justify-center max-[920px]:flex-row max-[920px]:justify-between"
              : "justify-between"
          }`}
        >
          <div className={`flex min-w-0 items-center gap-[calc(10px*var(--density-scale))] ${navCollapsed ? "justify-center" : ""}`}>
            <div
              className={`grid place-items-center overflow-hidden border border-aisoc-border-strong bg-[radial-gradient(circle_at_30%_25%,rgba(34,211,238,0.14)_0,transparent_60%),linear-gradient(145deg,rgba(17,23,34,0.9),rgba(7,9,13,0.92))] shadow-[var(--aisoc-shadow-soft)] transition-[width,height,border-radius] duration-[160ms] ${
                navCollapsed
                  ? "h-[calc(44px*var(--density-scale))] w-[calc(44px*var(--density-scale))] rounded-[calc(12px*var(--density-scale))]"
                  : "h-[calc(92px*var(--density-scale))] w-[calc(92px*var(--density-scale))] rounded-[calc(20px*var(--density-scale))]"
              }`}
              aria-hidden="true"
            >
              <img src={BRAND_LOGO_SRC} alt="" className="h-full w-full object-cover" />
            </div>
            <div className={`min-w-0 ${navCollapsed ? HIDE_WHEN_COLLAPSED : ""}`}>
              <p className="brand-kicker !mb-1">Hermes</p>
              <h1 className="!m-0 !text-[calc(28px*var(--density-scale))]">AISOC</h1>
            </div>
          </div>
          <button
            type="button"
            className={`ghost-button grid !min-h-[calc(38px*var(--density-scale))] min-w-[calc(38px*var(--density-scale))] place-items-center !p-0 !text-aisoc-muted hover:!text-aisoc-text ${FOCUS_RING}`}
            onClick={toggleNav}
            aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!navCollapsed}
          >
            {navCollapsed ? "▸" : "◂"}
          </button>
        </header>
        <div className="grid content-start gap-[calc(14px*var(--density-scale))]">
          <section className="grid gap-[calc(8px*var(--density-scale))]">
            <p
              className={`m-0 font-mono-aisoc text-[calc(10px*var(--density-scale))] font-bold uppercase tracking-[0.22em] text-aisoc-muted ${
                navCollapsed ? HIDE_WHEN_COLLAPSED : ""
              }`}
            >
              Workbench
            </p>
            <nav aria-label="Workbench navigation" className="grid gap-[calc(8px*var(--density-scale))]">
              {NAV_ITEMS.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                const hasChildren = !!item.children?.length;
                const expanded = hasChildren ? !!expandedParents[item.path] : false;
                const showChildren = hasChildren && expanded && !navCollapsed;

                return (
                  <div key={item.path} className="grid gap-[calc(4px*var(--density-scale))]">
                    <div className="relative">
                      {hasChildren ? (
                        <button
                          type="button"
                          className={`group w-full cursor-pointer text-left [font:inherit] bg-transparent ${NAV_ROW_BASE} ${navLinkSizing} ${
                            isActive ? `${NAV_ROW_ACTIVE} text-aisoc-accent` : `${NAV_ROW_IDLE} text-aisoc-text`
                          } ${FOCUS_RING}`}
                          onClick={() => toggleParent(item.path)}
                          aria-expanded={expanded}
                          aria-controls={`nav-children-${item.icon}`}
                          title={item.label}
                        >
                          <span
                            className={`${NAV_ICON_WRAP} ${
                              isActive
                                ? "text-aisoc-accent"
                                : "text-[rgba(203,213,225,0.95)] group-hover:text-[rgba(103,232,249,0.98)]"
                            }`}
                          >
                            <NavIcon name={item.icon} />
                          </span>
                          <span
                            className={`truncate ${navCollapsed ? HIDE_WHEN_COLLAPSED : ""} ${
                              isActive ? "text-aisoc-accent" : "group-hover:text-[#f1f5f9]"
                            }`}
                          >
                            {item.label}
                          </span>
                          {!navCollapsed ? (
                            <span
                              className={`ml-auto inline-flex shrink-0 items-center justify-center transition-transform duration-[180ms] ${
                                expanded ? "" : "-rotate-90"
                              } ${isActive ? "text-inherit" : "text-aisoc-muted group-hover:text-inherit"}`}
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 12 12" width="10" height="10" focusable="false">
                                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                              </svg>
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <Link
                          to={item.path}
                          className={`group ${NAV_ROW_BASE} ${navLinkSizing} ${
                            isActive
                              ? `${NAV_ROW_ACTIVE} !text-aisoc-accent`
                              : `${NAV_ROW_IDLE} !text-aisoc-text`
                          }`}
                          aria-current={isActive ? "page" : undefined}
                          title={item.label}
                        >
                          <span
                            className={`${NAV_ICON_WRAP} ${
                              isActive
                                ? "text-aisoc-accent"
                                : "text-[rgba(203,213,225,0.95)] group-hover:text-[rgba(103,232,249,0.98)]"
                            }`}
                          >
                            <NavIcon name={item.icon} />
                          </span>
                          <span
                            className={`truncate ${navCollapsed ? HIDE_WHEN_COLLAPSED : ""} ${
                              isActive ? "text-aisoc-accent" : "group-hover:text-[#f1f5f9]"
                            }`}
                          >
                            {item.label}
                          </span>
                          {item.path === "/chat" ? <ChatNavBadge /> : null}
                        </Link>
                      )}
                    </div>
                    {showChildren ? (
                      <div
                        id={`nav-children-${item.icon}`}
                        className="ml-[calc(22px*var(--density-scale))] grid animate-[nav-children-in_220ms_ease-out] gap-[calc(2px*var(--density-scale))] border-l border-[rgba(34,211,238,0.18)] pl-[calc(10px*var(--density-scale))]"
                        role="group"
                        aria-label={`${item.label} sub-views`}
                      >
                        {item.children!.map((child) => {
                          const childActive = location.pathname === child.path
                            || location.pathname.startsWith(`${child.path}/`);
                          return (
                            <Link
                              key={child.path}
                              to={child.path}
                              className={`relative flex min-h-[calc(30px*var(--density-scale))] items-center gap-[calc(8px*var(--density-scale))] rounded-md border px-[calc(8px*var(--density-scale))] py-[calc(4px*var(--density-scale))] no-underline transition-colors duration-[160ms] ${
                                childActive
                                  ? "border-[rgba(34,211,238,0.32)] bg-[linear-gradient(120deg,rgba(15,20,30,0.7),rgba(10,13,19,0.66))] !text-aisoc-accent shadow-[inset_2px_0_0_var(--aisoc-accent)]"
                                  : "border-transparent bg-transparent !text-aisoc-muted hover:border-[rgba(34,211,238,0.18)] hover:bg-[linear-gradient(115deg,rgba(9,13,19,0.32),rgba(7,9,13,0.18))] hover:!text-aisoc-text"
                              }`}
                              aria-current={childActive ? "page" : undefined}
                              title={child.zh ? `${child.label} · ${child.zh}` : child.label}
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${childActive ? "opacity-100" : "opacity-50"}`}
                                aria-hidden="true"
                              />
                              <span className="flex min-w-0 flex-col overflow-hidden leading-[1.15]">
                                <span className="truncate text-[calc(12px*var(--density-scale))] font-medium">{child.label}</span>
                                {child.zh ? (
                                  <span
                                    className={`mt-px truncate text-[calc(10px*var(--density-scale))] ${
                                      childActive ? "text-[rgba(103,232,249,0.7)]" : "text-aisoc-muted"
                                    }`}
                                  >
                                    {child.zh}
                                  </span>
                                ) : null}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </nav>
          </section>
        </div>
        <footer className="flex">
          <button
            className={`ghost-button group flex w-full items-center gap-[calc(10px*var(--density-scale))] ${
              navCollapsed
                ? "justify-center !px-[7px] !min-h-[46px] max-[920px]:justify-start max-[920px]:!px-[10px]"
                : "justify-start"
            }`}
            type="button"
            onClick={signOut}
            title="Sign Out"
          >
            <span
              className="inline-flex h-[calc(24px*var(--density-scale))] w-[calc(24px*var(--density-scale))] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(140deg,rgba(23,30,43,0.55),rgba(12,15,23,0.7))] text-aisoc-accent group-hover:text-aisoc-accent-strong"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className={NAV_ICON_SVG}>
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9"
                />
              </svg>
            </span>
            <span className={`truncate ${navCollapsed ? HIDE_WHEN_COLLAPSED : ""}`}>Sign Out</span>
          </button>
        </footer>
      </aside>
      <main className="main-panel workbench-main flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.05)_0,transparent_24%),linear-gradient(180deg,rgba(3,4,7,0.44),rgba(3,4,7,0))] px-[calc(24px*var(--density-scale))] pb-[calc(24px*var(--density-scale))] pt-[calc(18px*var(--density-scale))] animate-[aisoc-fade-in_320ms_ease] max-[920px]:p-[22px]">
        {showWorkbenchTopbar ? (
          <header className="mb-[calc(10px*var(--density-scale))] flex min-h-[calc(44px*var(--density-scale))] items-center justify-between gap-[calc(10px*var(--density-scale))] rounded-[var(--aisoc-radius-md)] border border-[rgba(34,211,238,0.14)] bg-[linear-gradient(180deg,rgba(9,13,19,0.86),rgba(7,8,12,0.92)),var(--aisoc-line)] px-[calc(14px*var(--density-scale))] py-[calc(8px*var(--density-scale))] shadow-[var(--aisoc-shadow-soft)] backdrop-blur-[14px]">
            <div className="flex min-w-0 items-center gap-[calc(10px*var(--density-scale))]">
              <div
                className="grid h-[calc(30px*var(--density-scale))] w-[calc(30px*var(--density-scale))] shrink-0 place-items-center overflow-hidden rounded-[calc(9px*var(--density-scale))] border border-[rgba(34,211,238,0.2)] bg-[linear-gradient(180deg,rgba(12,16,23,0.92),rgba(7,9,14,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                aria-hidden="true"
              >
                <img src={BRAND_LOGO_SRC} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="brand-kicker !mb-0.5 !text-[calc(10px*var(--density-scale))]">AISOC Workbench</p>
                <h2 className="!m-0 !text-[calc(18px*var(--density-scale))] leading-[1.05]">{activeItem.label}</h2>
              </div>
            </div>
            <div className="flex items-center gap-[calc(8px*var(--density-scale))]">
              <span className="status-badge status-live !min-h-[calc(28px*var(--density-scale))] !bg-[linear-gradient(180deg,rgba(11,14,21,0.94),rgba(7,9,14,0.98))] !px-[calc(12px*var(--density-scale))] !py-[calc(4px*var(--density-scale))] !text-[#f1f5f9] tracking-[0.05em]">
                Live
              </span>
              <button
                className="ghost-button !min-h-[calc(28px*var(--density-scale))] !px-[calc(10px*var(--density-scale))] !py-[calc(4px*var(--density-scale))] text-[calc(12px*var(--density-scale))]"
                type="button"
                onClick={signOut}
                title="Sign Out"
              >
                Sign Out
              </button>
            </div>
          </header>
        ) : null}
        <Outlet />
      </main>
    </div>
    {/* 悬浮聊天入口渲染在 grid 布局外层，避免被 <main>/外层容器的
        overflow-hidden 裁掉，保证真正贴在浏览器视口右下角。 */}
    <FloatingChatWidget />
    </AisocChatProvider>
  );
}
