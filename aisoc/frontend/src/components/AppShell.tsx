import { Link, Outlet, useLocation } from "react-router-dom";

import { clearStoredToken } from "../lib/auth";

const NAV_ITEMS: Array<{ path: string; label: string }> = [
  { path: "/chat", label: "Chat" },
  { path: "/sessions", label: "Sessions" },
  { path: "/cron", label: "Cron" },
  { path: "/skills", label: "Skills" },
  { path: "/memory", label: "Memory" },
  { path: "/logs", label: "Logs" },
];

export function AppShell() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div>
          <p className="brand-kicker">Hermes</p>
          <h1>AISOC</h1>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={location.pathname.startsWith(item.path) ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </nav>
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
      </aside>
      <main className="main-panel">
        <Outlet />
      </main>
    </div>
  );
}

