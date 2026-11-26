// ICE servers for the versus connection. Public STUN finds direct routes; a
// TURN relay (Cloudflare Realtime) carries the game when no direct route works.
export const STUN_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

/** Relay credentials last this long; a match and its rematches fit well inside. */
export const TURN_TTL_SECONDS = 2 * 60 * 60;

const url = (value: unknown): value is string => typeof value === 'string' && /^(stun|turns?):/.test(value);

/**
 * Keeps the usable entries of Cloudflare's generate-ice-servers response.
 * Port 53 URLs are dropped: browsers block that port and the attempt only
 * delays ICE. Returns [] for anything malformed.
 */
export function relayServers(response: unknown): RTCIceServer[] {
  const raw = (response as { iceServers?: unknown })?.iceServers;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const servers: RTCIceServer[] = [];
  for (const entry of list as { urls?: unknown; username?: unknown; credential?: unknown }[]) {
    const urls = (Array.isArray(entry?.urls) ? entry.urls : [entry?.urls]).filter(url).filter(u => !/:53(\?|$)/.test(u));
    if (!urls.length || !urls.some(u => u.startsWith('turn'))) continue;
    if (typeof entry.username !== 'string' || typeof entry.credential !== 'string') continue;
    servers.push({ urls, username: entry.username, credential: entry.credential });
  }
  return servers;
}
