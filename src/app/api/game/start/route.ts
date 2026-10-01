import { randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { rankingConfigured } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/http';
import { signTicket } from '@/lib/ticket';
import { RULESET } from '@/lib/game';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const seed = randomBytes(4).readUInt32LE() || 1;
  if (!rankingConfigured()) return Response.json({ seed, token: null, ranked: false }, { headers: { 'Cache-Control': 'no-store' } });
  const jar = await cookies();
  const guest = jar.get('puyo_guest')?.value || randomUUID();
  jar.set('puyo_guest', guest, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 86400 * 7 });
  const token = signTicket({ id: randomUUID(), seed, guest, issued: Date.now(), rules: RULESET }, process.env.GAME_SIGNING_SECRET!);
  return Response.json({ seed, token, ranked: true }, { headers: { 'Cache-Control': 'no-store' } });
}
