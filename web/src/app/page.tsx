'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 첫 진입(루트 /)은 KPI v2 대시보드로 보낸다
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/kpi-v2/');
  }, [router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#888', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '0.95em' }}>
      KPI 대시보드로 이동 중…
    </div>
  );
}
