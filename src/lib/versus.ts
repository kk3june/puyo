// Deterministic 2-6 player match: every board, attack and nuisance drop
// advances in one fixed order, so any peer (or a server) replaying the same
// inputs agrees. Side 0 is the host's seat; the default is 1:1.
import { advance, BATTLE_MAX_TICKS, BATTLE_RULESET, createGame, TICK_MS, type Action, type Game } from './game';
import { applyAttack, createBattle, eliminatePlayer, livingTeams, MAX_BATTLE_PLAYERS, nextTarget, setTargeting, takeGarbageDrop, type BattleState, type Team } from './battle';

/** Seat index, 0 (host) to 5. */
export type Side = number;
/** Aim changes: cycle through opponents, or focus every attack on one seat. */
export type AimAction = 'cycle' | `focus${number}`;
export type VersusAction = Action | AimAction;
export type VersusInput = { tick: number; side: Side; action: VersusAction };
export type Slot = (VersusAction | undefined)[];
export type VersusMatch = {
  seed: number; tick: number; games: Game[]; battle: BattleState;
  /** Tick on which each seat was eliminated; null while still playing. */
  out: (number | null)[];
  ended: boolean; winner: Team | null; // null with ended = draw
};
export const ONE_ON_ONE: readonly Team[] = [0, 1];
const MOVES = new Set(['left', 'right', 'rotate', 'down', 'drop']);
const FOCUS = /^focus([0-5])$/;
const id = (side: Side) => `p${side}`;

export const isAim = (action: VersusAction): action is AimAction => action === 'cycle' || FOCUS.test(action);
export const focusOn = (side: Side): AimAction => `focus${side}`;

/** Team per seat: 2-6 seats, at least two teams, teams numbered 0-5. */
export function validTeams(teams: unknown): teams is Team[] {
  return Array.isArray(teams) && teams.length >= 2 && teams.length <= MAX_BATTLE_PLAYERS &&
    teams.every(team => Number.isInteger(team) && team >= 0 && team < MAX_BATTLE_PLAYERS) && new Set(teams).size >= 2;
}

export function createMatch(seed: number, teams: readonly Team[] = ONE_ON_ONE): VersusMatch {
  if (!validTeams([...teams])) throw new Error('Invalid teams');
  // Every player receives the same piece sequence, as in the original game.
  return {
    seed, tick: 0, games: teams.map(() => createGame(seed, BATTLE_RULESET)),
    battle: createBattle(teams.map((team, side) => ({ id: id(side), team }))),
    out: teams.map(() => null), ended: false, winner: null,
  };
}

export function cloneMatch(match: VersusMatch): VersusMatch {
  return structuredClone(match);
}

export const teamOf = (match: VersusMatch, side: Side) => match.battle.players[side].team;

export function pendingGarbage(match: VersusMatch, side: Side) {
  return match.battle.players[side].pendingGarbage;
}

/** Seat the side's next attack goes to (null when no opponent is left). */
export function targetOf(match: VersusMatch, side: Side) {
  return nextTarget(match.battle, id(side));
}

/** Whether the side has picked one opponent rather than cycling. */
export function focusing(match: VersusMatch, side: Side) {
  return match.battle.players[side].targeting.mode === 'focus';
}

/** Living seats whose next attack is aimed at this side. */
export function aimedAt(match: VersusMatch, side: Side) {
  return match.games.map((_, other) => other).filter(other => !match.battle.players[other].eliminated && targetOf(match, other) === side);
}

/** A tick with no input from anyone. */
export const emptySlot = (match: VersusMatch): Slot => match.games.map(() => undefined);

/**
 * Advances every board by one 50ms tick. Aim changes apply first, then boards
 * resolve in seat order. A seat that tops out is eliminated; the match ends
 * when one team is left (that team wins) or none is (a draw).
 */
export function advanceMatch(match: VersusMatch, actions: Slot) {
  if (match.ended) return match;
  match.tick++;
  const elapsed = (match.tick - 1) * TICK_MS / 1000;
  const sides = match.games.map((_, side) => side);
  for (const side of sides) {
    const action = actions[side];
    if (action && isAim(action)) {
      const focus = FOCUS.exec(action);
      setTargeting(match.battle, id(side), focus ? id(Number(focus[1])) : null);
    }
  }
  for (const side of sides) {
    if (match.out[side] !== null) continue;
    const action = actions[side];
    advance(match.games[side], action && !isAim(action) ? action : undefined, result => {
      if (result.chain > 0) { applyAttack(match.battle, id(side), result.score, elapsed, result.allClear); return 0; }
      return takeGarbageDrop(match.battle, id(side));
    });
  }
  const lost = sides.filter(side => match.out[side] === null && match.games[side].ended);
  for (const side of lost) { match.out[side] = match.tick; eliminatePlayer(match.battle, id(side)); }
  if (lost.length) {
    const teams = livingTeams(match.battle);
    if (teams.length <= 1) { match.ended = true; match.winner = teams[0] ?? null; }
  }
  if (!match.ended && match.tick >= BATTLE_MAX_TICKS) { match.ended = true; match.winner = null; }
  if (match.ended) for (const game of match.games) game.ended = true;
  return match;
}

/** Shape check only; the seat count is checked against a match by the caller. */
export function validInput(value: unknown): value is VersusInput {
  const input = value as VersusInput;
  return !!input && Number.isInteger(input.tick) && input.tick > 0 && input.tick <= BATTLE_MAX_TICKS &&
    Number.isInteger(input.side) && input.side >= 0 && input.side < MAX_BATTLE_PLAYERS &&
    typeof input.action === 'string' && (MOVES.has(input.action) || isAim(input.action));
}

/** Replays a full input log; at most one action per side per tick. */
export function replayMatch(seed: number, inputs: unknown, ticks: number, teams: readonly Team[] = ONE_ON_ONE): VersusMatch {
  if (!Array.isArray(inputs) || !Number.isInteger(ticks) || ticks < 1 || ticks > BATTLE_MAX_TICKS) throw new Error('잘못된 대전 기록입니다.');
  const previous = teams.map(() => 0);
  for (const input of inputs) {
    if (!validInput(input) || input.side >= teams.length || input.tick <= previous[input.side] || input.tick > ticks) throw new Error('잘못된 대전 조작 기록입니다.');
    previous[input.side] = input.tick;
  }
  const match = createMatch(seed, teams);
  const byTick = new Map<number, Slot>();
  for (const input of inputs as VersusInput[]) {
    const slot = byTick.get(input.tick) ?? emptySlot(match);
    slot[input.side] = input.action; byTick.set(input.tick, slot);
  }
  while (match.tick < ticks && !match.ended) advanceMatch(match, byTick.get(match.tick + 1) ?? emptySlot(match));
  return match;
}
