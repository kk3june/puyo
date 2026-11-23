'use client';
import { useCallback, useEffect, useState, type RefObject } from 'react';

// On touch devices the player picks one way to play: on-screen buttons or
// board gestures. Keyboard always works. The choice is a per-device setting.
export type ControlMode = 'buttons' | 'gesture';
const KEY = 'puyo-controls';
const TOUCH = '(hover: none) and (pointer: coarse)';

export function useControlMode() {
  const [mode, setMode] = useState<ControlMode>('buttons');
  useEffect(() => {
    try { const saved = localStorage.getItem(KEY); if (saved === 'buttons' || saved === 'gesture') setMode(saved); } catch {}
  }, []);
  const choose = useCallback((next: ControlMode) => {
    setMode(next);
    try { localStorage.setItem(KEY, next); } catch {}
  }, []);
  return [mode, choose] as const;
}

export function ControlModeToggle({ mode, onChange, disabled }: { mode: ControlMode; onChange: (mode: ControlMode) => void; disabled: boolean }) {
  return <div className="control-mode" role="group" aria-label="조작 방식">
    {(['buttons', 'gesture'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={disabled} onClick={() => onChange(value)}>{value === 'buttons' ? '버튼' : '제스처'}</button>)}
  </div>;
}

/** The game card already fills the screen; starting a game only brings it to the top. */
export function usePlayViewport(card: RefObject<HTMLElement | null>, playing: boolean) {
  useEffect(() => {
    // An exact offset: scrollIntoView would honour the page's scroll-padding-top.
    if (playing && card.current && matchMedia(TOUCH).matches) window.scrollTo({ top: card.current.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
  }, [card, playing]);
}
