import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Ruleset } from './game';
export type Ticket = { id: string; seed: number; issued: number; guest: string; rules: Ruleset };
function signature(body: string, secret: string) { return createHmac('sha256', secret).update(body).digest('base64url'); }
export function signTicket(ticket: Ticket, secret: string) {
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return `${body}.${signature(body, secret)}`;
}
export function verifyTicket(token: string, guest: string, secret: string, now = Date.now()): Ticket {
  if (token.length > 2048) throw new Error('잘못된 게임 인증입니다.');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('잘못된 게임 인증입니다.');
  const [body, sig] = parts;
  const expected = Buffer.from(signature(body, secret));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('게임 인증에 실패했습니다.');
  const ticket = JSON.parse(Buffer.from(body, 'base64url').toString()) as Ticket;
  if (ticket.guest !== guest || !['sprint-v1','sprint-v2','sprint-v3'].includes(ticket.rules) || !Number.isSafeInteger(ticket.issued) || ticket.issued > now || now - ticket.issued > 86_400_000) throw new Error('게임 인증이 만료되었습니다. 새 게임을 시작해 주세요.');
  return ticket;
}
