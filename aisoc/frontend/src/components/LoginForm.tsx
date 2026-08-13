import { FormEvent, useState } from "react";

import { fetchJSON } from "../lib/api";
import { setStoredToken } from "../lib/auth";

type LoginFormProps = {
  onSuccess: () => void;
};

type LoginResponse = {
  authenticated: boolean;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetchJSON<LoginResponse>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ token }),
        },
        false,
      );
      if (!response.authenticated) {
        setError("Token validation failed.");
        return;
      }
      setStoredToken(token);
      onSuccess();
    } catch {
      setError("Authentication failed. Please verify your token.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-[calc(10px*var(--density-scale))]" onSubmit={handleSubmit}>
      <label htmlFor="token-input">Session Token</label>
      <input
        id="token-input"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="Paste AISOC token"
        required
      />
      <button
        type="submit"
        disabled={pending}
        className="min-h-[calc(40px*var(--density-scale))] cursor-pointer rounded-[var(--aisoc-radius-sm)] border border-transparent bg-aisoc-accent px-[calc(12px*var(--density-scale))] py-[calc(10px*var(--density-scale))] font-bold text-aisoc-on-accent transition-colors duration-[160ms] hover:bg-aisoc-accent-strong disabled:cursor-not-allowed disabled:opacity-55"
      >
        {pending ? "Verifying..." : "Sign In"}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}

