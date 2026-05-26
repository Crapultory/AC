import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { ChatPage } from "./pages/ChatPage";
import { CronPage } from "./pages/CronPage";
import { LoginPage } from "./pages/LoginPage";
import { LogsPage } from "./pages/LogsPage";
import { MemoryPage } from "./pages/MemoryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SkillsPage } from "./pages/SkillsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/cron" element={<CronPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

