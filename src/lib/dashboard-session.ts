import { NextResponse } from "next/server";
import { hmacHex, safeEqual } from "@/src/lib/crypto";
import type { Env } from "@/src/lib/env";
import { getEnv } from "@/src/lib/env";

export const DASHBOARD_SESSION_COOKIE = "robur_dashboard_session";
export const DASHBOARD_SESSION_TTL_SECONDS = 8 * 60 * 60;

const SESSION_VERSION = "v1";

export function createDashboardSessionValue(now = Date.now(), env: Env = getEnv()): string {
  const issuedAt = now.toString(36);
  const payload = `${SESSION_VERSION}.${issuedAt}`;
  const signature = hmacHex("sha256", env.APPROVAL_SECRET, payload);

  return `${payload}.${signature}`;
}

export function isValidDashboardSession(
  value: string | null | undefined,
  now = Date.now(),
  env: Env = getEnv()
): boolean {
  if (!value) return false;

  const [version, issuedAtRaw, signature] = value.split(".");
  if (version !== SESSION_VERSION || !issuedAtRaw || !signature) return false;

  const issuedAt = Number.parseInt(issuedAtRaw, 36);
  if (!Number.isFinite(issuedAt)) return false;

  const ageMs = now - issuedAt;
  const maxAgeMs = DASHBOARD_SESSION_TTL_SECONDS * 1000;
  if (ageMs < -60_000 || ageMs > maxAgeMs) return false;

  const payload = `${version}.${issuedAtRaw}`;
  const expectedSignature = hmacHex("sha256", env.APPROVAL_SECRET, payload);

  return safeEqual(signature, expectedSignature);
}

export function setDashboardSessionCookie(response: NextResponse, env: Env = getEnv()): void {
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: createDashboardSessionValue(Date.now(), env),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: DASHBOARD_SESSION_TTL_SECONDS
  });
}

export function clearDashboardSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
}
