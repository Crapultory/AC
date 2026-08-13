import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { hasStoredToken } from "../lib/auth";
import { LoginForm } from "../components/LoginForm";

export function LoginPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (hasStoredToken()) {
      navigate("/overview", { replace: true });
    }
  }, [navigate]);

  return (
    <section className="grid h-full place-items-center p-[calc(24px*var(--density-scale))]">
      <div className="w-[min(520px,95vw)] rounded-[var(--aisoc-radius-lg)] border border-aisoc-border bg-aisoc-panel p-[calc(28px*var(--density-scale))] shadow-[var(--aisoc-shadow)] backdrop-blur-[14px] animate-[aisoc-fade-in_340ms_ease]">
        <p className="brand-kicker">AISOC Access</p>
        <h1>Authenticate to Continue</h1>
        <p className="subtle-copy">
          Enter the token from `AISOC_SESSION_TOKEN` or the startup log output.
        </p>
        <LoginForm onSuccess={() => navigate("/overview", { replace: true })} />
      </div>
    </section>
  );
}
