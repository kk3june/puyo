'use client';
import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import { WIDTH, type Action } from '@/lib/game';
import { BoardGesture } from '@/lib/touch-gesture';

const REPEAT_DELAY_MS = 170;
const REPEAT_MS = 60;
const KEYS: Record<string, Action> = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'rotate', ArrowDown:'down', ' ':'drop', x:'rotate', X:'rotate' };

/** Keyboard, touch-pad buttons and board gestures, all feeding one input queue. */
export function useGameControls(input: (action: Action) => boolean, enabled: boolean) {
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
  const boardPointer = {
    onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => {
      if (!enabled || !event.isPrimary || event.pointerType === 'mouse') return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = BoardGesture.start(event.clientX, event.clientY, event.timeStamp, event.currentTarget.getBoundingClientRect().width / WIDTH);
    },
    onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => { if (event.isPrimary) gesture.current?.move(event.clientX, event.clientY, input); },
    onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => {
      if (!event.isPrimary) return;
      gesture.current?.end(event.clientX, event.clientY, event.timeStamp, input); gesture.current = null;
    },
    onPointerCancel: () => { gesture.current = null; },
  };
  return { press, boardPointer };
}
