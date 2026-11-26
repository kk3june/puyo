import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayServers } from '../src/lib/turn';

test('keeps Cloudflare TURN entries and drops port 53', () => {
  const servers = relayServers({ iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
  ] });
  assert.deepEqual(servers, [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }]);
});

test('accepts the single-object response shape', () => {
  assert.deepEqual(relayServers({ iceServers: { urls: 'turn:turn.cloudflare.com:3478', username: 'u', credential: 'c' } }),
    [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }]);
});

test('ignores malformed or credential-less entries', () => {
  assert.deepEqual(relayServers(null), []);
  assert.deepEqual(relayServers({ iceServers: [{ urls: ['turn:x:3478'] }, { urls: ['http://x'], username: 'u', credential: 'c' }, 'junk'] }), []);
});
