import { useNavigate } from "react-router-dom";

import { LoginForm } from "../components/LoginForm";

export function LoginPage() {
  const navigate = useNavigate();

  return (
    <section className="login-page">
      <div className="login-card">
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
