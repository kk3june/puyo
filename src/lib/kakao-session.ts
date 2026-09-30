import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'puyo_session';
export const OAUTH_STATE_COOKIE = 'puyo_oauth_state';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type KakaoSession = {
  userId: string;
  kakaoId: string;
  name: string;
  exp: number;
};

function secret() {
  const value = process.env.GAME_SIGNING_SECRET;
  if (!value || value.length < 32) throw new Error('Session signing is not configured');
  return value;
}

function signature(payload: string) {
  return createHmac('sha256', secret()).update(`puyo-session.${payload}`).digest('base64url');
}

export function createOAuthState() {
  return randomBytes(24).toString('base64url');
}

export function createSessionToken(session: Omit<KakaoSession, 'exp'>) {
  const payload = Buffer.from(JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifySessionToken(token?: string): KakaoSession | null {
  if (!token) return null;
  const [payload, provided, extra] = token.split('.');
  if (!payload || !provided || extra) return null;
  const expected = signature(payload);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as KakaoSession;
    if (!value.userId || !/^\d+$/.test(value.kakaoId) || !value.name || value.exp <= Math.floor(Date.now() / 1000)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function currentSession() {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_SECONDS,
};
