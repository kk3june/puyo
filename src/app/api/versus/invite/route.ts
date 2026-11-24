import { randomBytes, randomInt } from 'node:crypto';
import { sameOrigin } from '@/lib/http';
import { INVITE_ALPHABET, INVITE_PATTERN } from '@/lib/versus-invite';
import { InviteTaken, versusFailure, versusPlayer, versusStore } from '@/lib/versus-store';
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
const code = () => Array.from({ length: 6 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');

// POST {} opens an invite for this player; POST { code } joins a friend's invite.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 200) return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    const body = text ? JSON.parse(text) : {};
    const store = versusStore(), player = await versusPlayer();
    if (body?.code !== undefined) {
      if (typeof body.code !== 'string' || !INVITE_PATTERN.test(body.code)) return Response.json({ error: '초대 코드가 올바르지 않아요.' }, { status: 400 });
      return json(await store.joinInvite(player, body.code, randomBytes(4).readUInt32LE() || 1));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return json(await store.createInvite(player, code())); }
      catch (error) { if (!(error instanceof InviteTaken)) throw error; }
    }
    return Response.json({ error: '초대를 만들지 못했어요. 다시 시도해 주세요.' }, { status: 503 });
  } catch (error) { return versusFailure(error); }
}
