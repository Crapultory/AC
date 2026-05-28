import { Link, Outlet, useLocation } from "react-router-dom";

import { clearStoredToken } from "../lib/auth";

const NAV_ITEMS: Array<{ path: string; label: string }> = [
  { path: "/overview", label: "Overview" },
  { path: "/chat", label: "Chat" },
  { path: "/sessions", label: "Sessions" },
  { path: "/cron", label: "Cron" },
  { path: "/skills", label: "Skills" },
  { path: "/memory", label: "Memory" },
];

export function AppShell() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <aside className="side-nav side-nav-workbench">
        <header className="side-nav-header">
          <p className="brand-kicker">Hermes</p>
          <h1>AISOC</h1>
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
        <Outlet />
      </main>
    </div>
  );
}
