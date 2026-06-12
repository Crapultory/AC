const TOKEN_KEY = 'aegis_session_token';

export function getStoredToken(): string {
  return window.localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function hasStoredToken(): boolean {
  return getStoredToken().trim().length > 0;
}
