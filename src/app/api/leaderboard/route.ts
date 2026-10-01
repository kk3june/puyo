import { database, rankingConfigured } from '@/lib/supabase/server';
import { currentSession } from '@/lib/kakao-session';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!rankingConfigured()) return Response.json({ configured: false, entries: [], me: null });
  const period = new URL(request.url).searchParams.get('period') === 'week' ? 'week' : 'all';
  const session = await currentSession();
  const { data, error } = await database().rpc('get_leaderboard', { p_period: period, p_user_id: session?.userId ?? null });
  if (error) { console.error('leaderboard', error.code); return Response.json({ error: '랭킹을 불러오지 못했습니다.' }, { status: 503 }); }
  return Response.json({ configured: true, entries: data.entries, me: data.me }, { headers: { 'Cache-Control': 'private, no-store' } });
}
