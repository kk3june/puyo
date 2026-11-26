import { relayServers, STUN_SERVERS, TURN_TTL_SECONDS } from '@/lib/turn';
import { versusFailure, versusPlayer, versusStore } from '@/lib/versus-store';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (iceServers: RTCIceServer[]) => Response.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } });

// Short-lived TURN credentials, only for players of a match. The key stays on
// the server; without one (or if Cloudflare fails) the game falls back to STUN.
export async function GET(request: Request) {
  const matchId = new URL(request.url).searchParams.get('matchId') ?? '';
  if (!UUID.test(matchId)) return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  try {
    // Reading past every signal is a cheap membership check: it throws 403 for outsiders.
    await versusStore().readSignals(matchId, await versusPlayer(), Number.MAX_SAFE_INTEGER);
  } catch (error) { return versusFailure(error); }
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID, token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return json(STUN_SERVERS);
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`TURN credentials: HTTP ${response.status}`);
    return json([...STUN_SERVERS, ...relayServers(await response.json())]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'TURN credentials failed');
    return json(STUN_SERVERS);
  }
}
