import { Link, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";

import { clearStoredToken } from "../lib/auth";

const NAV_ITEMS: Array<{ path: string; label: string }> = [
  { path: "/overview", label: "Overview" },
  { path: "/chat", label: "Chat" },
  { path: "/sessions", label: "Sessions" },
  { path: "/cron", label: "Cron" },
  { path: "/skills", label: "Skills" },
  { path: "/memory", label: "Memory" },
];

const NAV_COLLAPSED_STORAGE_KEY = "aisoc_nav_collapsed";

function readInitialNavCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "1";
}

export function AppShell() {
  const location = useLocation();
  const [navCollapsed, setNavCollapsed] = useState<boolean>(readInitialNavCollapsed);

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
          <div>
            <p className="brand-kicker">Hermes</p>
            <h1>AISOC</h1>
          </div>
          <button
            type="button"
            className="ghost-button side-nav-toggle"
            onClick={toggleNav}
            aria-label="Collapse navigation"
            title="Collapse navigation"
          >
            ◂
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
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </section>
        </div>
        <footer className="side-nav-footer">
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              clearStoredToken();
              window.location.href = "/login";
            }}
          >
            Sign Out
          </button>
        </footer>
      </aside>
      <main className="main-panel workbench-main">
        <div className="workbench-shell-toolbar">
          <button
            type="button"
            className="ghost-button side-nav-toggle"
            onClick={toggleNav}
            aria-label={navCollapsed ? "Show navigation" : "Hide navigation"}
            title={navCollapsed ? "Show navigation" : "Hide navigation"}
            aria-expanded={!navCollapsed}
          >
            {navCollapsed ? "☰ Menu" : "Hide Menu"}
          </button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
