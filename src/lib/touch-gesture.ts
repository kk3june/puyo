import type { Action } from './game';

// Board gestures map onto the same five engine actions as the keyboard, so
// recorded moves stay verifiable by the server replay.
export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 280;
export const FLICK_MAX_MS = 260;
export const FLICK_MIN_SPEED = 0.7; // px per ms
export const STEP_LEAD = 0.4; // first step fires after 60% of a cell

type Mode = 'pending' | 'move' | 'soft';
export type Emit = (action: Action) => boolean;

export class BoardGesture {
  private mode: Mode = 'pending';
  private issuedX = 0;
  private issuedY = 0;
  private constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly time: number,
    private readonly cell: number,
  ) {}

  static start(x: number, y: number, time: number, cell: number) {
    if (!(cell > 0)) throw new Error('Invalid cell size');
    return new BoardGesture(x, y, time, cell);
  }

  private steps(distance: number) {
    return Math.sign(distance) * Math.floor(Math.abs(distance) / this.cell + STEP_LEAD);
  }

  // Only accepted actions advance the issued count, so a full input queue
  // retries on the next move instead of drifting from the finger.
  move(x: number, y: number, emit: Emit) {
    const dx = x - this.x, dy = y - this.y;
    if (this.mode === 'pending') {
      if (Math.abs(dx) >= TAP_SLOP_PX && Math.abs(dx) >= Math.abs(dy)) this.mode = 'move';
      else if (dy >= TAP_SLOP_PX && dy > Math.abs(dx)) this.mode = 'soft';
      else return;
    }
    if (this.mode === 'move') {
      const target = this.steps(dx);
      while (this.issuedX !== target) {
        const step = Math.sign(target - this.issuedX);
        if (!emit(step < 0 ? 'left' : 'right')) break;
        this.issuedX += step;
      }
    } else {
      const target = Math.max(0, this.steps(dy));
      while (this.issuedY < target && emit('down')) this.issuedY++;
    }
  }

  end(x: number, y: number, time: number, emit: Emit) {
    const dx = x - this.x, dy = y - this.y, duration = Math.max(1, time - this.time);
    if (this.mode === 'pending' && duration <= TAP_MAX_MS && Math.hypot(dx, dy) < TAP_SLOP_PX) {
      emit('rotate');
    } else if (this.mode !== 'move' && duration <= FLICK_MAX_MS && dy >= this.cell && dy / duration >= FLICK_MIN_SPEED) {
      emit('drop');
    }
  }
}
