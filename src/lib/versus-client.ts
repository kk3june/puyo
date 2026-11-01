// Browser side of matchmaking and the WebRTC connection. The server only pairs
// players and relays one offer and one answer; gameplay then flows directly
// between the two browsers over a data channel.
export type Role = 'host' | 'guest';
export type Matched = { matchId: string; role: Role; seed: number };
type Entry = { id: string; status: 'waiting' | 'matched'; matchId: string | null; role: Role | null; seed: number | null };

// Public STUN only: no relay (TURN), so a few strict networks cannot connect.
export const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const POLL_MS = 1000;
const SIGNAL_POLL_MS = 600;
const GATHER_MS = 3000;
const OPEN_MS = 15_000;

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', stop, { once: true });
});

async function request<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { ...init, signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '매칭 서버에 연결하지 못했어요.');
  return data as T;
}

/** Joins the queue and resolves once paired; aborting leaves the queue. */
export async function findMatch(signal: AbortSignal): Promise<Matched> {
  let entry = await request<Entry>('/api/versus/queue', { method: 'POST' }, signal);
  try {
    while (entry.status !== 'matched') {
      await wait(POLL_MS, signal);
      entry = await request<Entry>(`/api/versus/queue?id=${entry.id}`, {}, signal);
    }
  } catch (error) {
    if (signal.aborted) void fetch(`/api/versus/queue?id=${entry.id}`, { method: 'DELETE', keepalive: true });
    throw error;
  }
  return { matchId: entry.matchId!, role: entry.role!, seed: entry.seed! };
}

function signaling(matchId: string, signal: AbortSignal) {
  let after = 0;
  return {
    send: (payload: RTCSessionDescriptionInit) => request('/api/versus/signal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId, payload }),
    }, signal),
    async next(type: RTCSdpType): Promise<RTCSessionDescriptionInit> {
      while (true) {
        const signals = await request<{ id: number; payload: RTCSessionDescriptionInit }[]>(`/api/versus/signal?matchId=${matchId}&after=${after}`, {}, signal);
        for (const item of signals) {
          after = Math.max(after, item.id);
          if (item.payload?.type === type && typeof item.payload.sdp === 'string') return { type, sdp: item.payload.sdp };
        }
        await wait(SIGNAL_POLL_MS, signal);
      }
    },
  };
}

// Without trickle ICE the whole exchange is one offer and one answer.
function gathered(peer: RTCPeerConnection) {
  return new Promise<void>(resolve => {
    if (peer.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(resolve, GATHER_MS);
    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
    });
  });
}

export async function connectPeer({ matchId, role }: Matched, signal: AbortSignal) {
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const relay = signaling(matchId, signal);
  const abort = () => peer.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    let channel: RTCDataChannel;
    if (role === 'host') {
      channel = peer.createDataChannel('versus', { ordered: true });
      await peer.setLocalDescription(await peer.createOffer());
      await gathered(peer);
      await relay.send(peer.localDescription!.toJSON());
      await peer.setRemoteDescription(await relay.next('answer'));
    } else {
      const incoming = new Promise<RTCDataChannel>(resolve => peer.addEventListener('datachannel', event => resolve(event.channel), { once: true }));
      await peer.setRemoteDescription(await relay.next('offer'));
      await peer.setLocalDescription(await peer.createAnswer());
      await gathered(peer);
      await relay.send(peer.localDescription!.toJSON());
      channel = await incoming;
    }
    if (channel.readyState !== 'open') {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('상대와 직접 연결하지 못했어요. 네트워크를 바꾸거나 다시 시도해 주세요.')), OPEN_MS);
        channel.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    }
    signal.removeEventListener('abort', abort);
    return { peer, channel };
  } catch (error) {
    peer.close();
    throw error;
  }
}
