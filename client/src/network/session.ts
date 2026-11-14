const TOKEN_KEY = "df_token";

export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? "";
export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${getToken()}` });
