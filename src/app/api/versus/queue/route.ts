import { randomBytes } from 'node:crypto';
import { sameOrigin } from '@/lib/http';
import { versusFailure, versusPlayer, versusStore } from '@/lib/versus-store';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
const ticketId = (request: Request) => {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  return UUID.test(id) ? id : null;
};
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  try { return json(await versusStore().enqueue(await versusPlayer(), randomBytes(4).readUInt32LE() || 1)); }
  catch (error) { return versusFailure(error); }
}
export async function GET(request: Request) {
  const id = ticketId(request);
  if (!id) return Response.json({ error: '잘못된 매칭 요청입니다.' }, { status: 400 });
  try {
    const entry = await versusStore().poll(id, await versusPlayer());
    return entry ? json(entry) : Response.json({ error: '매칭이 만료되었어요. 다시 찾아 주세요.' }, { status: 404 });
  } catch (error) { return versusFailure(error); }
}
export async function DELETE(request: Request) {
  const id = ticketId(request);
  if (!sameOrigin(request) || !id) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  try { await versusStore().cancel(id, await versusPlayer()); return json({ ok: true }); }
  catch (error) { return versusFailure(error); }
}
