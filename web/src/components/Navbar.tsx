'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

type NavChild = { href: string; label: string };
type NavItem = { href: string; label: string; children?: NavChild[] };

const navItems: NavItem[] = [
  { href: '/kpi-v2', label: 'KPI v2' },
  { href: '/kpi-v2?tab=score', label: '🏆 스코어' },
  { href: '/tablet-pace', label: '📟 Kanban' },
  // 숨김 (필요 시 복원): { href: '/inbound', label: '인바운드 세일즈' }, { href: '/channel', label: '채널 세일즈' },
  { href: '/kpi', label: 'KPI' },
  // 숨김 (필요 시 복원): { href: '/exception-tm', label: 'Exception TM' },
  { href: '/install-tracking', label: '설치 트래킹' },
  { href: '/install-tracking-v2', label: '트래킹 v2' },
  { href: '/visits', label: '방문 트래킹' },
  {
    href: '/visits/route', label: '들렀다 가기', children: [
      { href: '/visits/round', label: '🎖️ 맥아더 작전' },
    ]
  },
  { href: '/partners', label: '파트너 라운드' },
];

function NavLinkItem({ item, fullPath }: { item: NavItem; fullPath: string | null }) {
  const [open, setOpen] = useState(false);
  const active = fullPath === item.href || !!item.children?.some(c => c.href === fullPath);
  const base: React.CSSProperties = {
    padding: '8px 16px', color: '#fff', textDecoration: 'none', fontSize: '0.95em',
    background: active ? 'rgba(255,255,255,0.2)' : 'transparent', transition: 'background 0.2s',
  };

  if (!item.children) {
    return (
      <Link href={item.href} style={base}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
        {item.label}
      </Link>
    );
  }

  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Link href={item.href} style={{ ...base, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {item.label} <span style={{ fontSize: '0.65em', opacity: 0.85 }}>▾</span>
      </Link>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, background: '#0078d4', boxShadow: '0 6px 16px rgba(0,0,0,0.22)', borderRadius: '0 0 8px 8px', minWidth: 180, zIndex: 50, overflow: 'hidden', paddingTop: 2 }}>
          {item.children.map((c) => {
            const cActive = fullPath === c.href;
            return (
              <Link key={c.href} href={c.href} style={{
                display: 'block', padding: '11px 16px', color: '#fff', textDecoration: 'none', fontSize: '0.9em',
                background: cActive ? 'rgba(255,255,255,0.22)' : 'transparent', whiteSpace: 'nowrap',
              }}
                onMouseEnter={(e) => { if (!cActive) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
                onMouseLeave={(e) => { if (!cActive) e.currentTarget.style.background = 'transparent'; }}>
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
      <div style={{ width: '100%', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
            <Link href="/" style={{ fontSize: '1.3em', fontWeight: 300, color: '#fff', textDecoration: 'none' }}>
              Sales Dashboard
            </Link>
            <div style={{ display: 'flex', gap: '4px' }}>
              {navItems.map((item) => (
                <NavLinkItem key={item.href} item={item} fullPath={fullPath} />
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
