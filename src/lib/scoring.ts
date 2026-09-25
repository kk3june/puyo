/**
 * Standard scoring reference (not Fever character-specific scoring):
 * https://puyopuyo.fandom.com/ko/wiki/득점_계산
 * https://puyopuyo.fandom.com/ko/wiki/낙하_보너스
 * The game uses four colors; the reference table includes all five.
 */
export const CHAIN_BONUS = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512] as const;
export const GROUP_BONUS = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10] as const;
export const COLOR_BONUS = [0, 0, 3, 6, 12, 24] as const;
export const MAX_DROP_BONUS = 11;

export function scoreClear(chain: number, groupSizes: number[], colors: number) {
  if (!Number.isInteger(chain) || chain < 1 || chain >= CHAIN_BONUS.length ||
      !Number.isInteger(colors) || colors < 1 || colors >= COLOR_BONUS.length ||
      colors > groupSizes.length || !groupSizes.length ||
      groupSizes.some(size => !Number.isInteger(size) || size < 4)) {
    throw new Error('Invalid scoring group');
  }
  const cleared = groupSizes.reduce((sum, size) => sum + size, 0);
  const groupBonus = groupSizes.reduce((sum, size) => sum + GROUP_BONUS[Math.min(11, size)], 0);
  // A zero combined bonus is treated as one. Disconnected groups are counted separately.
  const multiplier = Math.max(1, CHAIN_BONUS[chain] + groupBonus + COLOR_BONUS[colors]);
  return { cleared, multiplier, points: cleared * 10 * multiplier };
}
