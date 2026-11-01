import { sameOrigin } from '@/lib/http';
import { versusFailure, versusPlayer, versusStore } from '@/lib/versus-store';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
// Relays the WebRTC offer/answer (with gathered ICE candidates) between the two players.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 16_000) return Response.json({ error: '연결 정보가 너무 큽니다.' }, { status: 413 });
    const body = JSON.parse(text);
    if (typeof body?.matchId !== 'string' || !UUID.test(body.matchId) || typeof body.payload !== 'object' || !body.payload) throw new Error();
    await versusStore().postSignal(body.matchId, await versusPlayer(), body.payload);
    return json({ ok: true });
  } catch (error) { return versusFailure(error); }
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const matchId = params.get('matchId') ?? '', after = Number(params.get('after') ?? 0);
  if (!UUID.test(matchId) || !Number.isSafeInteger(after) || after < 0) return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  try { return json(await versusStore().readSignals(matchId, await versusPlayer(), after)); }
  catch (error) { return versusFailure(error); }
}
