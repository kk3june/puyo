// Deterministic 1:1 match: both boards, attacks and nuisance drops advance in
// one fixed order, so any peer (or a server) replaying the same inputs agrees.
import { advance, BATTLE_MAX_TICKS, BATTLE_RULESET, createGame, TICK_MS, type Action, type Game } from './game';
import { applyAttack, createBattle, eliminatePlayer, takeGarbageDrop, type BattleState } from './battle';

export type Side = 0 | 1;
export type VersusInput = { tick: number; side: Side; action: Action };
export type VersusMatch = {
  seed: number; tick: number; games: [Game, Game]; battle: BattleState;
  ended: boolean; winner: Side | null; // null with ended = draw
};
const IDS = ['p0', 'p1'] as const;
const ACTIONS = new Set(['left', 'right', 'rotate', 'down', 'drop']);

export function createMatch(seed: number): VersusMatch {
  // Both players receive the same piece sequence, as in the original game.
  return {
    seed, tick: 0, games: [createGame(seed, BATTLE_RULESET), createGame(seed, BATTLE_RULESET)],
    battle: createBattle([{ id: IDS[0], team: 0 }, { id: IDS[1], team: 1 }]), ended: false, winner: null,
  };
}

export function cloneMatch(match: VersusMatch): VersusMatch {
  return structuredClone(match);
}

export function pendingGarbage(match: VersusMatch, side: Side) {
  return match.battle.players[side].pendingGarbage;
}

/** Advances both boards by one 50ms tick; side 0 always resolves first. */
export function advanceMatch(match: VersusMatch, actions: [Action | undefined, Action | undefined]) {
  if (match.ended) return match;
  match.tick++;
  const elapsed = (match.tick - 1) * TICK_MS / 1000;
  for (const side of [0, 1] as const) {
    advance(match.games[side], actions[side], result => {
      if (result.chain > 0) { applyAttack(match.battle, IDS[side], result.score, elapsed, result.allClear); return 0; }
      return takeGarbageDrop(match.battle, IDS[side]);
    });
  }
  const lost = ([0, 1] as const).filter(side => match.games[side].ended);
  if (lost.length === 2 || match.tick >= BATTLE_MAX_TICKS) {
    match.ended = true; match.winner = lost.length === 1 ? (1 - lost[0]) as Side : null;
  } else if (lost.length === 1) {
    match.ended = true;
    match.winner = eliminatePlayer(match.battle, IDS[lost[0]]) as Side;
  }
  if (match.ended) for (const game of match.games) game.ended = true;
  return match;
}

export function validInput(value: unknown): value is VersusInput {
  const input = value as VersusInput;
  return !!input && Number.isInteger(input.tick) && input.tick > 0 && input.tick <= BATTLE_MAX_TICKS &&
    (input.side === 0 || input.side === 1) && ACTIONS.has(input.action);
}

/** Replays a full input log; at most one action per side per tick. */
export function replayMatch(seed: number, inputs: unknown, ticks: number): VersusMatch {
  if (!Array.isArray(inputs) || !Number.isInteger(ticks) || ticks < 1 || ticks > BATTLE_MAX_TICKS) throw new Error('잘못된 대전 기록입니다.');
  const previous = [0, 0];
  for (const input of inputs) {
    if (!validInput(input) || input.tick <= previous[input.side] || input.tick > ticks) throw new Error('잘못된 대전 조작 기록입니다.');
    previous[input.side] = input.tick;
  }
  const byTick = new Map<number, [Action | undefined, Action | undefined]>();
  for (const input of inputs as VersusInput[]) {
    const slot = byTick.get(input.tick) ?? [undefined, undefined];
    slot[input.side] = input.action; byTick.set(input.tick, slot);
  }
  const match = createMatch(seed);
  while (match.tick < ticks && !match.ended) advanceMatch(match, byTick.get(match.tick + 1) ?? [undefined, undefined]);
  return match;
}
