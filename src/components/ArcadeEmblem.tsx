export function Crown({className = ''}: {className?: string}) {
  return <svg className={className} viewBox="0 0 64 48" fill="none" aria-hidden="true">
    <path d="m8 14 13 9L32 6l11 17 13-9-6 27H14L8 14Z" fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <circle cx="8" cy="11" r="4" fill="currentColor"/><circle cx="32" cy="5" r="4" fill="currentColor"/><circle cx="56" cy="11" r="4" fill="currentColor"/>
    <path d="M18 34h28" stroke="#5d3d85" strokeWidth="3" strokeLinecap="round"/><path d="m32 19 4 6-4 6-4-6 4-6Z" fill="#5d3d85"/>
  </svg>;
}
export function ArcadeEmblem() {
  return <div className="arcade-emblem" aria-label="PUYO ROOM SOLO CHALLENGE">
    <div className="emblem-stars" aria-hidden="true">✦ <Crown /> ✦</div>
    <strong>PUYO<span>CHALLENGE</span></strong>
    <span className="emblem-ribbon">3 MINUTES · YOUR HIGH SCORE</span>
  </div>;
}
