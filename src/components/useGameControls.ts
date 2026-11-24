'use client';
import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { WIDTH, type Action } from '@/lib/game';
import { BoardGesture } from '@/lib/touch-gesture';

const REPEAT_DELAY_MS = 170;
const REPEAT_MS = 60;
const KEYS: Record<string, Action> = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'rotate', ArrowDown:'down', ' ':'drop', x:'rotate', X:'rotate' };

/** Keyboard, touch-pad buttons and board gestures, all feeding one input queue.
 *  Gestures only run when the player chose gesture controls. */
export function useGameControls(input: (action: Action) => boolean, enabled: boolean, gestures = true) {
  const gesture = useRef<BoardGesture | null>(null);
  const repeat = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopRepeat = useCallback(() => { clearTimeout(repeat.current); repeat.current = undefined; }, []);
  useEffect(() => stopRepeat, [enabled, stopRepeat]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!enabled || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
      if (KEYS[event.key]) { event.preventDefault(); if (!event.repeat || !['drop','rotate'].includes(KEYS[event.key])) input(KEYS[event.key]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, input]);
  // Pointer-down fires at once; movement buttons auto-repeat while held.
  const press = (action: Action) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault(); stopRepeat(); input(action);
      if (action === 'rotate' || action === 'drop') return;
      const again = (delay: number) => { repeat.current = setTimeout(() => { input(action); again(REPEAT_MS); }, delay); };
      again(REPEAT_DELAY_MS);
    },
    onPointerUp: stopRepeat, onPointerCancel: stopRepeat, onPointerLeave: stopRepeat,
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
    // Keyboard activation (detail 0) still works for assistive tech.
    onClick: (event: MouseEvent) => { if (event.detail === 0) input(action); },
    disabled: !enabled,
  });
  // The whole play area is the gesture surface, not just the canvas, so a
  // swipe that starts beside the board still moves the piece. One cell of
  // finger travel is one column of the player's own (first) board.
  const boardPointer = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!enabled || !gestures || !event.isPrimary || event.pointerType === 'mouse') return;
      if (event.target instanceof Element && event.target.closest('button, a')) return;
      const board = event.currentTarget instanceof HTMLCanvasElement ? event.currentTarget : event.currentTarget.querySelector('canvas');
      const cell = (board ?? event.currentTarget).getBoundingClientRect().width / WIDTH;
      if (!(cell > 0)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = BoardGesture.start(event.clientX, event.clientY, event.timeStamp, cell);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (event.isPrimary) gesture.current?.move(event.clientX, event.clientY, event.timeStamp, input); },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!event.isPrimary) return;
      gesture.current?.end(event.clientX, event.clientY, event.timeStamp, input); gesture.current = null;
    },
    onPointerCancel: () => { gesture.current = null; },
  };
  return { press, boardPointer };
}
