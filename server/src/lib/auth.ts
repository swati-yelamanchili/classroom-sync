import { createHmac, timingSafeEqual } from 'node:crypto';
import { parse as parseCookies } from 'cookie';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../config';
import { ApiError } from './errors';

export const AUTH_COOKIE = 'aac_teacher';
export const AUTH_TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Compare fixed-length digests so neither content nor length leaks through timing.
  const ha = createHmac('sha256', 'compare').update(a).digest();
  const hb = createHmac('sha256', 'compare').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function issueTeacherToken(config: AppConfig, nowMs = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ role: 'teacher', exp: nowMs + AUTH_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, config.authSecret)}`;
}

export function isValidTeacherToken(config: AppConfig, token: string | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, config.authSecret))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { role?: string; exp?: number };
    return data.role === 'teacher' && typeof data.exp === 'number' && data.exp > nowMs;
  } catch {
    return false;
  }
}

export function checkPasscode(config: AppConfig, passcode: string): boolean {
  return safeEqual(passcode, config.teacherPasscode);
}

export function isTeacherCookieHeader(config: AppConfig, cookieHeader: string | undefined): boolean {
  return isValidTeacherToken(config, parseCookies(cookieHeader ?? '')[AUTH_COOKIE]);
}

export function requireTeacher(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    if (!isTeacherCookieHeader(config, req.headers.cookie)) {
      throw new ApiError(401, 'unauthorised', 'Teacher sign-in required.');
    }
    next();
  };
}
