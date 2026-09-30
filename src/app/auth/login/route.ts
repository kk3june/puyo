import { NextResponse } from 'next/server';
import { authConfigured } from '@/lib/supabase/server';
import { sameOrigin, siteOrigin } from '@/lib/http';
import { createOAuthState, OAUTH_STATE_COOKIE } from '@/lib/kakao-session';
export async function POST(request: Request) {
  const origin = siteOrigin(request);
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  if (!authConfigured()) return NextResponse.redirect(`${origin}/?auth_error=not_configured`, 303);
  const state = createOAuthState();
  const authorize = new URL('https://kauth.kakao.com/oauth/authorize');
  authorize.searchParams.set('client_id', process.env.KAKAO_REST_API_KEY!);
  authorize.searchParams.set('redirect_uri', `${origin}/auth/callback`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('state', state);
  const response = NextResponse.redirect(authorize, 303);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  });
  return response;
}
