import type { Metadata } from 'next';
import Versus from '@/components/Versus';
export const metadata: Metadata = { title: '1:1 대전 — PUYO ROOM', description: '다른 플레이어와 실시간으로 연쇄를 주고받는 1:1 온라인 친선전.' };
export default function VersusPage() { return <Versus />; }
