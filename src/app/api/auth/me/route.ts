import { authConfigured, rankingConfigured } from '@/lib/supabase/server';
import { currentSession } from '@/lib/kakao-session';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!authConfigured()) return Response.json({ user: null, configured: false, ranking: false });
  const session = await currentSession();
  return Response.json({ configured: true, ranking: rankingConfigured(), user: session ? { name: session.name } : null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
