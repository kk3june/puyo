export const DEFAULT_TARGET_POINTS = 70;
export const DEFAULT_MARGIN_SECONDS = 96;
export const MARGIN_STEP_SECONDS = 16;
export const ALL_CLEAR_BONUS_POINTS = 2100;
export const MAX_GARBAGE_DROP = 30;

export type Team = 0 | 1;

export type BattlePlayer = {
  id: string;
  team: Team;
  pendingGarbage: number;
  attackRemainder: number;
  allClearPending: boolean;
  eliminated: boolean;
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
  if (players.length < 2 || new Set(players.map(player => player.id)).size !== players.length) {
    throw new Error('Battle players must have unique ids');
  }
  if (!players.some(player => player.team === 0) || !players.some(player => player.team === 1)) {
    throw new Error('Battle requires both teams');
  }
  return {
    players: players.map(player => ({
      ...player,
      pendingGarbage: 0,
      attackRemainder: 0,
      allClearPending: false,
      eliminated: false,
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

/**
 * Applies one completed attack event.
 *
 * The attacker neutralizes only their own queue. Any surplus is copied in
 * full to every living opponent; it is not divided between the opponents.
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
  const recipients = sent === 0
    ? []
    : state.players.filter(candidate => !candidate.eliminated && candidate.team !== attacker.team);
  for (const recipient of recipients) recipient.pendingGarbage += sent;

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

export function eliminatePlayer(state: BattleState, playerId: string) {
  const target = player(state, playerId);
  target.eliminated = true;
  const livingTeams = new Set(state.players.filter(candidate => !candidate.eliminated).map(candidate => candidate.team));
  return livingTeams.size === 1 ? [...livingTeams][0] : null;
}
