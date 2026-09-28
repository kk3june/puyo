export type AnalyticsEvent = 'game_start' | 'game_end' | 'login' | 'login_click' | 'score_submit' | 'leaderboard_view';
declare global {
  interface Window { dataLayer: unknown[]; gtag?: (...args: unknown[]) => void; }
}
export const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';
export function track(event: AnalyticsEvent, params: Record<string, string | number | boolean> = {}) {
  if (!GA_ID || typeof window === 'undefined' || localStorage.getItem('puyo-analytics') !== 'granted') return;
  let attempts = 0;
  function send() {
    if (localStorage.getItem('puyo-analytics') !== 'granted') return;
    if (window.gtag) window.gtag('event', event, params);
    else if (attempts++ < 20) setTimeout(send, 250);
  }
  send();
}
