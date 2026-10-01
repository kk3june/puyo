import { cookies } from 'next/headers';
import { database, rankingConfigured } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/http';
import { verifyTicket } from '@/lib/ticket';
import { replay, TICK_MS } from '@/lib/game';
import { currentSession } from '@/lib/kakao-session';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  if (!rankingConfigured()) return Response.json({ error: '랭킹 서비스 연결 전입니다. 자유롭게 연습해 주세요.' }, { status: 503 });
  const session = await currentSession();
  if (!session) return Response.json({ error: '카카오 로그인이 필요합니다.' }, { status: 401 });
  try {
    // Stream-cap the body, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new Error('게임 기록이 없습니다.');
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 200_000) { await reader.cancel(); return Response.json({ error: '기록이 너무 큽니다.' }, { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (typeof body.token !== 'string') throw new Error('게임 인증이 없습니다.');
    const guest = (await cookies()).get('puyo_guest')?.value ?? '';
    const ticket = verifyTicket(body.token, guest, process.env.GAME_SIGNING_SECRET!);
    const result = replay(ticket.seed, body.moves, body.ticks, ticket.rules);
    if (Date.now() - ticket.issued + 1000 < result.tick * TICK_MS) throw new Error('게임 진행 시간이 올바르지 않습니다.');
    const db = database();
    const { error: insertError } = await db.from('scores').insert({
      session_id: ticket.id, user_id: session.userId, score: result.score,
      max_chain: result.maxChain, cleared: result.cleared, ticks: result.tick, ruleset: ticket.rules,
    });
    if (insertError && insertError.code !== '23505') {
      console.error('score insert', insertError.code);
      return Response.json({ error: '기록 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
    }
    if (insertError?.code === '23505') return Response.json({ error: '이미 등록한 게임입니다.' }, { status: 409 });
    return Response.json({ score: result.score, maxChain: result.maxChain });
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? '기록 형식이 올바르지 않습니다.' : error instanceof Error ? error.message : '기록 검증에 실패했습니다.' }, { status: 400 });
  }
}
