'use client';
import { useEffect, useState } from 'react';
import Script from 'next/script';
import { GA_ID } from '@/lib/analytics';
export default function Analytics() {
  const [consent, setConsent] = useState<string | null>('loading');
  const [settings, setSettings] = useState(false);
  useEffect(() => { setConsent(localStorage.getItem('puyo-analytics')); }, []);
  function choose(value: 'granted' | 'denied') {
    localStorage.setItem('puyo-analytics', value);
    setConsent(value); setSettings(false);
    window.gtag?.('consent', 'update', { analytics_storage: value, ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    if (value === 'denied') {
      // Reload removes the already-loaded GA runtime after withdrawal.
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.trim().split('=')[0];
        if (!name.startsWith('_ga')) return;
        const parts = location.hostname.split('.');
        document.cookie = `${name}=; Max-Age=0; path=/`;
        for (let i = 0; i < parts.length - 1; i++) document.cookie = `${name}=; Max-Age=0; path=/; domain=.${parts.slice(i).join('.')}`;
      });
      if (window.gtag) location.reload();
    }
  }
  if (!/^G-[A-Z0-9]+$/.test(GA_ID)) return null;
  return <>
    {consent === 'granted' && <>
      <Script id="analytics-config" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        window.gtag = function(){dataLayer.push(arguments);};
        gtag('consent', 'default', {analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
        gtag('js', new Date());
        gtag('config', '${GA_ID}', {send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});
        gtag('event','page_view',{page_location:location.origin + location.pathname,page_title:document.title});
      `}</Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
    </>}
    {(consent === null || settings) && <aside className="consent" aria-label="방문 분석 설정">
      <div><strong>더 즐거운 플레이를 위해</strong><p>동의하면 Google Analytics로 이용 통계를 수집합니다. 동의하지 않아도 모든 기능을 이용할 수 있어요. <a href="/privacy">자세히</a></p></div>
      <button className="button small" onClick={() => choose('denied')}>거절</button>
      <button className="button primary small" onClick={() => choose('granted')}>분석 허용</button>
    </aside>}
    <button className="text-button analytics-settings" onClick={() => setSettings(v => !v)}>분석 설정</button>
  </>;
}
