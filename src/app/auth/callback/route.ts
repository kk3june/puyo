import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authConfigured, database } from '@/lib/supabase/server';
import { siteOrigin } from '@/lib/http';
import { createSessionToken, OAUTH_STATE_COOKIE, SESSION_COOKIE, sessionCookieOptions } from '@/lib/kakao-session';

type KakaoToken = { access_token?: string };
type KakaoUser = { id?: number };

export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const jar = await cookies();
  const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value;
  if (!authConfigured() || !code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/?auth_error=callback_failed`);
  }
  try {
    const tokenResponse = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: process.env.KAKAO_REST_API_KEY!,
        client_secret: process.env.KAKAO_CLIENT_SECRET!, redirect_uri: `${origin}/auth/callback`, code,
      }),
      cache: 'no-store',
    });
    const token = await tokenResponse.json() as KakaoToken;
    if (!tokenResponse.ok || !token.access_token) throw new Error('Kakao token exchange failed');
    const userResponse = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store',
    });
    const kakao = await userResponse.json() as KakaoUser;
    if (!userResponse.ok || !kakao.id) throw new Error('Kakao user lookup failed');

    const kakaoId = String(kakao.id);
    const db = database();
    const { data: existing, error: lookupError } = await db.from('kakao_accounts')
      .select('user_id, display_name').eq('kakao_id', kakaoId).maybeSingle();
    if (lookupError) throw lookupError;
    let userId = existing?.user_id as string | undefined;
    let name = existing?.display_name as string | undefined;
    if (!userId || !name) {
      const { data: created, error: createError } = await db.auth.admin.createUser({
        email: `kakao.${kakaoId}@accounts.puyo.invalid`, email_confirm: true,
        app_metadata: { provider: 'kakao', providers: ['kakao'], kakao_id: kakaoId },
      });
      if (createError || !created.user) throw createError ?? new Error('Account creation failed');
      userId = created.user.id;
      name = `젤리-${userId.replaceAll('-', '').slice(0, 8)}`;
      const { error: insertError } = await db.from('kakao_accounts').insert({ kakao_id: kakaoId, user_id: userId, display_name: name });
      if (insertError) throw insertError;
    }
    const response = NextResponse.redirect(`${origin}/?login=success`);
    response.cookies.set(SESSION_COOKIE, createSessionToken({ userId, kakaoId, name }), sessionCookieOptions);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error('kakao callback', error instanceof Error ? error.message : 'unknown');
    return NextResponse.redirect(`${origin}/?auth_error=callback_failed`);
  }
}
