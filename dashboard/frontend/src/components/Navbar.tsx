'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const navItems = [
  { href: '/kpi-v2', label: 'KPI v2' },
  { href: '/kpi-v2?tab=score', label: '🏆 스코어' },
  { href: '/inbound', label: '인바운드 세일즈' },
  { href: '/channel', label: '채널 세일즈' },
  { href: '/kpi', label: 'KPI' },
  { href: '/install-tracking', label: '설치 트래킹' },
  { href: '/install-tracking-v2', label: '트래킹 v2' },
];

function NavbarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fullPath = searchParams.get('tab') ? `${pathname}?tab=${searchParams.get('tab')}` : pathname;

  return (
    <nav style={{
      background: '#0078d4',
      color: '#fff',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
            <Link href="/" style={{ fontSize: '1.3em', fontWeight: 300, color: '#fff', textDecoration: 'none' }}>
              Sales Dashboard
            </Link>
            <div style={{ display: 'flex', gap: '4px' }}>
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: '8px 16px',
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: '0.95em',
                    background: fullPath === item.href ? 'rgba(255,255,255,0.2)' : 'transparent',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (fullPath !== item.href) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (fullPath !== item.href) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div style={{ fontSize: '0.85em', opacity: 0.8 }}>
            Salesforce Report
          </div>
        </div>
      </div>
    </nav>
  );
}

export default function Navbar() {
  return (
    <Suspense fallback={
      <nav style={{ background: '#0078d4', color: '#fff', height: '56px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
    }>
      <NavbarInner />
    </Suspense>
  );
}
