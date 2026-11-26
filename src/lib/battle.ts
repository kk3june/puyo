export const DEFAULT_TARGET_POINTS = 70;
export const DEFAULT_MARGIN_SECONDS = 96;
export const MARGIN_STEP_SECONDS = 16;
export const ALL_CLEAR_BONUS_POINTS = 2100;
export const MAX_GARBAGE_DROP = 30;

export const MAX_BATTLE_PLAYERS = 6;

/** Team index; free-for-all gives every player a team of their own. */
export type Team = number;

/**
 * Where a player's attacks go. `cycle` sends each attack to the next living
 * opponent in seat order; `focus` sends everything to one chosen opponent and
 * falls back to cycling once that opponent is eliminated.
 */
export type Targeting = { mode: 'cycle' } | { mode: 'focus'; target: string };

export type BattlePlayer = {
  id: string;
  team: Team;
  pendingGarbage: number;
  attackRemainder: number;
  allClearPending: boolean;
  eliminated: boolean;
  targeting: Targeting;
  /** Seat index of the last cycled recipient; starts at the player's own seat. */
  cursor: number;
};

export type BattleState = {
  players: BattlePlayer[];
};

export type AttackResult = {
  attackerId: string;
  score: number;
  targetPoints: number;
  generated: number;
  offset: number;
  sent: number;
  recipients: string[];
};

function assertNonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

export function createBattle(players: ReadonlyArray<{ id: string; team: Team }>): BattleState {
  if (players.length < 2 || players.length > MAX_BATTLE_PLAYERS || new Set(players.map(player => player.id)).size !== players.length) {
    throw new Error('Battle needs 2-6 players with unique ids');
  }
  if (!players.every(player => Number.isInteger(player.team) && player.team >= 0 && player.team < MAX_BATTLE_PLAYERS)) {
    throw new Error('Invalid battle team');
  }
  if (new Set(players.map(player => player.team)).size < 2) throw new Error('Battle requires at least two teams');
  return {
    players: players.map((player, seat) => ({
      id: player.id,
      team: player.team,
      pendingGarbage: 0,
      attackRemainder: 0,
      allClearPending: false,
      eliminated: false,
      targeting: { mode: 'cycle' },
      cursor: seat,
    })),
  };
}

// Tsu margin time: first reduction at 96 seconds, then every 16 seconds.
// Each value is floored. Later steps use half of the value from two steps ago.
export function targetPointsAt(
  elapsedSeconds: number,
  initialTargetPoints = DEFAULT_TARGET_POINTS,
  marginSeconds = DEFAULT_MARGIN_SECONDS,
) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new Error('Invalid elapsed time');
  if (!Number.isInteger(initialTargetPoints) || initialTargetPoints < 1) throw new Error('Invalid target points');
  if (!Number.isFinite(marginSeconds) || marginSeconds < 0) throw new Error('Invalid margin time');
  if (elapsedSeconds < marginSeconds) return initialTargetPoints;

  const requestedIterations = 1 + Math.floor((elapsedSeconds - marginSeconds) / MARGIN_STEP_SECONDS);
  let target = initialTargetPoints;
  let previous = 0;
  for (let iteration = 0; iteration < Math.min(14, requestedIterations) && target > 1; iteration++) {
    const current = target;
    target = iteration === 0
      ? Math.floor(initialTargetPoints * 0.75)
      : Math.floor(previous / 2);
    previous = current;
    target = Math.max(1, target);
  }
  return target;
}

// The carry is a fraction of one Garbage Puyo, not raw score points. This
// distinction matters when margin time changes targetPoints between attacks.
export function convertAttackScore(score: number, targetPoints: number, remainder = 0) {
  assertNonNegativeInteger(score, 'score');
  if (!Number.isInteger(targetPoints) || targetPoints < 1) throw new Error('Invalid target points');
  if (!Number.isFinite(remainder) || remainder < 0 || remainder >= 1) throw new Error('Invalid attack remainder');
  const attack = score / targetPoints + remainder;
  const garbage = Math.floor(attack);
  return { garbage, remainder: attack - garbage };
}

function player(state: BattleState, id: string) {
  const found = state.players.find(candidate => candidate.id === id);
  if (!found) throw new Error('Unknown battle player');
  return found;
}

const opponents = (state: BattleState, attacker: BattlePlayer) =>
  state.players.filter(candidate => !candidate.eliminated && candidate.team !== attacker.team);

/** Seat of the opponent the player's next attack goes to, or null if none is left. */
export function nextTarget(state: BattleState, attackerId: string) {
  const attacker = player(state, attackerId);
  const living = opponents(state, attacker);
  if (!living.length) return null;
  const { targeting } = attacker;
  if (targeting.mode === 'focus') {
    const focused = living.find(candidate => candidate.id === targeting.target);
    if (focused) return state.players.indexOf(focused);
  }
  const seats = living.map(candidate => state.players.indexOf(candidate));
  return seats.find(seat => seat > attacker.cursor) ?? seats[0];
}

/**
 * Chooses how the player's attacks are aimed: a living opponent's id to focus
 * on, or null to cycle. Returns false (and changes nothing) for anyone else.
 */
export function setTargeting(state: BattleState, playerId: string, targetId: string | null) {
  const attacker = player(state, playerId);
  if (attacker.eliminated) return false;
  if (targetId === null) { attacker.targeting = { mode: 'cycle' }; return true; }
  if (!opponents(state, attacker).some(candidate => candidate.id === targetId)) return false;
  attacker.targeting = { mode: 'focus', target: targetId };
  return true;
}

/**
 * Applies one completed attack event.
 *
 * The attacker neutralizes only their own queue. Any surplus goes whole to a
 * single living opponent chosen by the attacker's targeting.
 */
export function applyAttack(
  state: BattleState,
  attackerId: string,
  chainScore: number,
  elapsedSeconds: number,
  achievedAllClear = false,
): AttackResult {
  assertNonNegativeInteger(chainScore, 'chainScore');
  const attacker = player(state, attackerId);
  if (attacker.eliminated) throw new Error('Eliminated player cannot attack');

  const targetPoints = targetPointsAt(elapsedSeconds);
  const score = chainScore + (attacker.allClearPending ? ALL_CLEAR_BONUS_POINTS : 0);
  const converted = convertAttackScore(score, targetPoints, attacker.attackRemainder);
  attacker.attackRemainder = converted.remainder;
  attacker.allClearPending = achievedAllClear;

  const offset = Math.min(converted.garbage, attacker.pendingGarbage);
  attacker.pendingGarbage -= offset;
  const sent = converted.garbage - offset;
  const seat = sent === 0 ? null : nextTarget(state, attackerId);
  const recipients = seat === null ? [] : [state.players[seat]];
  for (const recipient of recipients) recipient.pendingGarbage += sent;
  if (seat !== null && attacker.targeting.mode === 'cycle') attacker.cursor = seat;

  return {
    attackerId,
    score,
    targetPoints,
    generated: converted.garbage,
    offset,
    sent,
    recipients: recipients.map(recipient => recipient.id),
  };
}

export function takeGarbageDrop(state: BattleState, playerId: string) {
  const target = player(state, playerId);
  if (target.eliminated) return 0;
  const dropped = Math.min(MAX_GARBAGE_DROP, target.pendingGarbage);
  target.pendingGarbage -= dropped;
  return dropped;
}

/** Teams that still have a living player. */
export function livingTeams(state: BattleState) {
  return [...new Set(state.players.filter(candidate => !candidate.eliminated).map(candidate => candidate.team))];
}

/** Marks a player out; anyone focusing on them goes back to cycling. Returns the winning team, if decided. */
export function eliminatePlayer(state: BattleState, playerId: string) {
  const target = player(state, playerId);
  target.eliminated = true;
  for (const other of state.players) {
    if (other.targeting.mode === 'focus' && other.targeting.target === playerId) other.targeting = { mode: 'cycle' };
  }
  const teams = livingTeams(state);
  return teams.length === 1 ? teams[0] : null;
}
