import { Response } from "express";
import { isProduction } from "../config/env";

export const AUTH_COOKIE = "library_auth";
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

export function setAuthCookie(res: Response, token: string): void {
  const secure = isProduction ? "; Secure" : "";
  const sameSite = isProduction ? "None" : "Lax";
  const partitioned = isProduction ? "; Partitioned" : "";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SEVEN_DAYS_SEC}; SameSite=${sameSite}${secure}${partitioned}`
  );
}

export function clearAuthCookie(res: Response): void {
  const secure = isProduction ? "; Secure" : "";
  const sameSite = isProduction ? "None" : "Lax";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secure}`
  );
}
