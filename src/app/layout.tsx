import type { Metadata } from 'next';
import Analytics from '@/components/Analytics';
import './globals.css';
import './arcade-theme.css';
export const metadata: Metadata = { title: 'PUYO ROOM — 한 번 더, 한 연쇄 더', description: '로그인 없이 즐기는 3분 컬러 퍼즐. 같은 색 네 개를 연결하고 나만의 최고 기록에 도전하세요.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}<Analytics /></body></html>;
}
