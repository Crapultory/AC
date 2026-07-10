import { Link, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";

import { clearStoredToken } from "../lib/auth";
import { FloatingChat } from "./FloatingChat";

type NavIconName = "overview" | "chat" | "sessions" | "cron" | "skills" | "wiki" | "memory";

const NAV_ITEMS: Array<{ path: string; label: string; icon: NavIconName }> = [
  { path: "/overview", label: "Overview", icon: "overview" },
  { path: "/chat", label: "Chat", icon: "chat" },
  { path: "/sessions", label: "Sessions", icon: "sessions" },
  { path: "/cron", label: "Cron", icon: "cron" },
  { path: "/skills", label: "Skills", icon: "skills" },
  { path: "/wiki", label: "LLMWiki", icon: "wiki" },
  { path: "/memory", label: "Memory", icon: "memory" },
];

const NAV_COLLAPSED_STORAGE_KEY = "aisoc_nav_collapsed";
const BRAND_LOGO_SRC = `${import.meta.env.BASE_URL}aisoc-logo.svg?v=2`;

function readInitialNavCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "1";
}

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <svg viewBox="0 0 24 24" className="nav-icon-svg" aria-hidden="true" focusable="false">
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
    </svg>
  );
}

export function AppShell() {
  const location = useLocation();
  const [navCollapsed, setNavCollapsed] = useState<boolean>(readInitialNavCollapsed);
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

  return (
    <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`.trim()}>
      <aside className="side-nav side-nav-workbench">
        <header className="side-nav-header">
          <div className="brand-stack">
            <div className="brand-orb" aria-hidden="true">
              <img src={BRAND_LOGO_SRC} alt="" className="brand-orb-logo" />
            </div>
            <div className="brand-text">
              <p className="brand-kicker">Hermes</p>
              <h1>AISOC</h1>
            </div>
          </div>
          <button
            type="button"
            className="ghost-button side-nav-toggle"
            onClick={toggleNav}
            aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={navCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!navCollapsed}
          >
            {navCollapsed ? "▸" : "◂"}
          </button>
        </header>
        <div className="side-nav-groups">
          <section className="side-nav-group">
            <p className="side-nav-group-label">Workbench</p>
            <nav aria-label="Workbench navigation">
              {NAV_ITEMS.map((item) => {
                const isActive = location.pathname.startsWith(item.path);

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={isActive ? "active" : ""}
                    aria-current={isActive ? "page" : undefined}
                    title={item.label}
                  >
                    <span className="nav-link-icon">
                      <NavIcon name={item.icon} />
                    </span>
                    <span className="nav-link-label">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </section>
        </div>
        <footer className="side-nav-footer">
          <button
            className="ghost-button side-nav-footer-button"
            type="button"
            onClick={signOut}
            title="Sign Out"
          >
            <span className="nav-link-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="nav-icon-svg">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9"
                />
              </svg>
            </span>
            <span className="nav-link-label">Sign Out</span>
          </button>
        </footer>
      </aside>
      <main className="main-panel workbench-main">
        {showWorkbenchTopbar ? (
          <header className="workbench-topbar">
            <div className="workbench-topbar-copy">
              <div className="workbench-topbar-brandmark" aria-hidden="true">
                <img src={BRAND_LOGO_SRC} alt="" className="workbench-topbar-logo" />
              </div>
              <div className="workbench-topbar-copy-text">
                <p className="brand-kicker">AISOC Workbench</p>
                <h2>{activeItem.label}</h2>
              </div>
            </div>
            <div className="workbench-topbar-actions">
              <span className="status-badge status-live">Live</span>
              <button
                className="ghost-button workbench-topbar-signout"
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
        <FloatingChat />
      </main>
    </div>
  );
}
