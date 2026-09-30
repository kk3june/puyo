import { NextResponse } from 'next/server';
import { sameOrigin, siteOrigin } from '@/lib/http';
import { SESSION_COOKIE } from '@/lib/kakao-session';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const response = NextResponse.redirect(siteOrigin(request), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
