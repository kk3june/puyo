import type { Action } from './game';

// Board gestures map onto the same five engine actions as the keyboard, so
// recorded moves stay verifiable by the server replay.
export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 280;
// A flick is judged by how fast the finger moves just before release, not by
// the whole gesture: resting the finger first or starting slowly still counts.
export const FLICK_WINDOW_MS = 100;
export const FLICK_MIN_SPEED = 0.6; // px per ms, downward, near release
export const FLICK_MIN_CELLS = 0.5; // total downward travel
export const STEP_LEAD = 0.4; // first step fires after 60% of a cell

type Mode = 'pending' | 'move' | 'soft';
type Sample = { x: number; y: number; t: number };
export type Emit = (action: Action) => boolean;

export class BoardGesture {
  private mode: Mode = 'pending';
  private issuedX = 0;
  private issuedY = 0;
  private samples: Sample[];
  private constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly time: number,
    private readonly cell: number,
  ) { this.samples = [{ x, y, t: time }]; }

  static start(x: number, y: number, time: number, cell: number) {
    if (!(cell > 0)) throw new Error('Invalid cell size');
    return new BoardGesture(x, y, time, cell);
  }

  private steps(distance: number) {
    return Math.sign(distance) * Math.floor(Math.abs(distance) / this.cell + STEP_LEAD);
  }

  private record(x: number, y: number, t: number) {
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && this.samples[1].t < t - FLICK_WINDOW_MS * 2) this.samples.shift();
  }

  /** Fastest downward speed from any recent sample to the latest one. */
  private downSpeed() {
    const last = this.samples[this.samples.length - 1];
    let best = 0;
    for (const sample of this.samples) {
      const dt = last.t - sample.t;
      if (dt < 16 || dt > FLICK_WINDOW_MS) continue;
      const dy = last.y - sample.y, dx = Math.abs(last.x - sample.x);
      if (dy > dx) best = Math.max(best, dy / dt);
    }
    return best;
  }

  private softTo(dy: number, emit: Emit) {
    const target = Math.max(0, this.steps(dy));
    while (this.issuedY < target && emit('down')) this.issuedY++;
  }

  // Only accepted actions advance the issued count, so a full input queue
  // retries on the next move instead of drifting from the finger.
  move(x: number, y: number, time: number, emit: Emit) {
    this.record(x, y, time);
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
    } else if (this.downSpeed() < FLICK_MIN_SPEED) {
      // Soft drop follows a slow drag; a fast one may be a flick, so wait.
      this.softTo(dy, emit);
    }
  }

  end(x: number, y: number, time: number, emit: Emit) {
    this.record(x, y, time);
    const dx = x - this.x, dy = y - this.y, duration = Math.max(1, time - this.time);
    if (this.mode === 'pending' && duration <= TAP_MAX_MS && Math.hypot(dx, dy) < TAP_SLOP_PX) {
      emit('rotate');
    } else if (this.mode !== 'move' && dy >= this.cell * FLICK_MIN_CELLS && this.downSpeed() >= FLICK_MIN_SPEED) {
      emit('drop');
    } else if (this.mode === 'soft') {
      this.softTo(dy, emit); // a fast drag that slowed before release
    }
  }
}
