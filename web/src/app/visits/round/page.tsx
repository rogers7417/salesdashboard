'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || '';
const SF_BASE = 'https://torder.lightning.force.com/lightning/r/Opportunity';

type Pt = {
  lat: number; lng: number; store: string; addr: string; phone: string;
  tablets: number; stage: string; stageAge: number | null; status: string;
  field: string; visit: string | null; visitStatus: string;
  daysSinceVisit: number | null; category: string; channelType: string | null; daysInStage: number; created: string; link: string;
};

declare global { interface Window { kakao: any } }

function loadKakaoSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject('no window');
    if (window.kakao?.maps) return resolve();
    const existing = document.getElementById('kakao-sdk-clusterer') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener('load', () => window.kakao.maps.load(() => resolve())); return; }
    const s = document.createElement('script');
    s.id = 'kakao-sdk-clusterer';
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=drawing&autoload=false`;
    s.async = true;
    s.onload = () => window.kakao.maps.load(() => resolve());
    s.onerror = () => reject('Kakao SDK 로드 실패');
    document.head.appendChild(s);
  });
}

function pinImage(p: Pt) {
  const fill = p.category === '채널' ? (p.channelType === '프랜차이즈' ? '#7C3AED' : '#2563EB') : (p.status === '운영중' ? '#15803D' : (p.status === '오픈전' ? '#F59E0B' : '#64748B'));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34"><path d="M13 0C6 0 .5 5.4 .5 12.2.5 21 13 34 13 34s12.5-13 12.5-21.8C25.5 5.4 20 0 13 0z" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/><circle cx="13" cy="12" r="4.5" fill="#fff"/></svg>`;
  return new window.kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), new window.kakao.maps.Size(26, 34), { offset: new window.kakao.maps.Point(13, 34) });
}

function infoHtml(p: Pt) {
  const sb = p.status === '운영중' ? '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:4px;background:#DCFCE7;color:#15803D">운영중</span>'
    : (p.status === '오픈전' ? '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:4px;background:#FEF3C7;color:#B45309">오픈전</span>' : '');
  return `<div style="padding:10px 12px;font-size:12px;line-height:1.5;min-width:200px;max-width:270px;font-family:Pretendard,sans-serif">
    <b style="font-size:13px">${p.store}</b>${sb}
    <div style="color:#5C7088;margin-top:3px">${p.stage}${p.stageAge != null ? ' · 단계 ' + p.stageAge + '일' : ''} · ${p.tablets || 0}대 · 담당 ${p.field}</div>
    <div style="color:#5C7088;margin-top:3px">📍 ${p.addr || '-'}${p.phone ? '<br>☎ ' + p.phone : ''}</div>
    ${p.category === '채널'
      ? `<div style="color:#1E40AF;font-weight:600;margin-top:3px">📋 견적 ${p.daysInStage}일 체류 · ${p.channelType}</div>`
      : `<div style="color:#B91C1C;font-weight:600;margin-top:3px">🚶 방문 ${p.daysSinceVisit}일 경과 (${p.visit}${p.visitStatus ? ' · ' + p.visitStatus : ''})</div>`}
    <div style="margin-top:4px"><a href="${p.link}" target="_blank" style="color:#2563EB;text-decoration:none;font-weight:600">Salesforce 열기 ›</a></div>
  </div>`;
}

function haversineKm(a: Pt, b: Pt): number {
  const R = 6371, toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

type Route = { id: string; name: string; color: string; points: Pt[] };
const PALETTE = ['#1E40AF', '#B91C1C', '#15803D', '#B45309', '#7C3AED', '#0891B2', '#DB2777', '#4D7C0F'];

export default function VisitRoundPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const iw = useRef<any>(null);
  const polylines = useRef<any[]>([]);
  const labels = useRef<any[]>([]);
  const routesRef = useRef<Route[]>([]);
  const activeIdRef = useRef<string>('');
  const routeModeRef = useRef(false);
  const idCounter = useRef(0);
  const assignAreaRef = useRef<(b: any) => void>(() => { });
  const areaModeRef = useRef(false);
  const shownRef = useRef<Pt[]>([]);
  const cornerA = useRef<any>(null);   // 첫 번째 꼭짓점
  const cornerDot = useRef<any>(null); // 첫 꼭짓점 표시
  const previewRect = useRef<any>(null); // 드래그 미리보기 사각형
  const [pts, setPts] = useState<Pt[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [asOf, setAsOf] = useState('');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [catF, setCatF] = useState<'all' | '인바운드' | '채널'>('all');
  const [createdFrom, setCreatedFrom] = useState('2026-05-01');
  const [statusF, setStatusF] = useState<'all' | '운영중' | '오픈전'>('all');
  const [fieldF, setFieldF] = useState('');
  const [routeMode, setRouteMode] = useState(false);
  const [areaMode, setAreaMode] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeId, setActiveId] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => { routeModeRef.current = routeMode; }, [routeMode]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // 모든 담당자 루트(폴리라인 + 순번 오버레이) 다시 그리기 — 색상=담당자
  const redrawRoutes = useCallback((rs: Route[]) => {
    polylines.current.forEach(pl => pl.setMap(null)); polylines.current = [];
    labels.current.forEach(o => o.setMap(null)); labels.current = [];
    rs.forEach(r => {
      if (r.points.length >= 2) {
        const pl = new window.kakao.maps.Polyline({ path: r.points.map(p => new window.kakao.maps.LatLng(p.lat, p.lng)), strokeWeight: 4, strokeColor: r.color, strokeOpacity: 0.85, strokeStyle: 'solid' });
        pl.setMap(map.current); polylines.current.push(pl);
      }
      r.points.forEach((p, i) => {
        const el = `<div style="width:24px;height:24px;border-radius:12px;background:${r.color};color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)">${i + 1}</div>`;
        const ov = new window.kakao.maps.CustomOverlay({ position: new window.kakao.maps.LatLng(p.lat, p.lng), content: el, yAnchor: 2.1, xAnchor: 0.5, zIndex: 10 });
        ov.setMap(map.current); labels.current.push(ov);
      });
    });
  }, []);

  // 활성 담당자에게 마커 배정/해제 (한 매장 = 한 사람)
  const assignToActive = useCallback((p: Pt) => {
    const aid = activeIdRef.current; if (!aid) return;
    const rs = routesRef.current.map(r => ({ ...r, points: r.points.slice() }));
    const active = rs.find(r => r.id === aid); if (!active) return;
    const i = active.points.findIndex(x => x.link === p.link);
    if (i >= 0) active.points.splice(i, 1);
    else { rs.forEach(r => { const j = r.points.findIndex(x => x.link === p.link); if (j >= 0) r.points.splice(j, 1); }); active.points.push(p); }
    routesRef.current = rs; setRoutes(rs); redrawRoutes(rs);
  }, [redrawRoutes]);

  const onMarkerClick = useCallback((p: Pt, mk: any) => {
    if (routeModeRef.current && activeIdRef.current) assignToActive(p);
    else { iw.current.setContent(infoHtml(p)); iw.current.open(map.current, mk); }
  }, [assignToActive]);

  const addPerson = useCallback((name: string) => {
    const nm = name.trim(); if (!nm) return;
    const id = String(++idCounter.current);
    const color = PALETTE[routesRef.current.length % PALETTE.length];
    const rs = [...routesRef.current, { id, name: nm, color, points: [] as Pt[] }];
    routesRef.current = rs; setRoutes(rs); setActiveId(id); setNewName(''); setRouteMode(true);
  }, []);

  const removePerson = useCallback((id: string) => {
    const rs = routesRef.current.filter(r => r.id !== id);
    routesRef.current = rs; setRoutes(rs); redrawRoutes(rs);
    if (activeIdRef.current === id) setActiveId(rs[0]?.id || '');
  }, [redrawRoutes]);

  const undoActive = useCallback(() => {
    const aid = activeIdRef.current;
    const rs = routesRef.current.map(r => r.id === aid ? { ...r, points: r.points.slice(0, -1) } : r);
    routesRef.current = rs; setRoutes(rs); redrawRoutes(rs);
  }, [redrawRoutes]);

  // 사각형 영역 안의 (현재 표시중) 매장을 활성 담당자에게 일괄 배정 — 북→남 정렬
  const assignArea = useCallback((bounds: any) => {
    const aid = activeIdRef.current; if (!aid) return;
    const inside = shownRef.current.filter(p => bounds.contain(new window.kakao.maps.LatLng(p.lat, p.lng)));
    if (!inside.length) return;
    inside.sort((a, b) => (b.lat - a.lat) || (a.lng - b.lng));
    const rs = routesRef.current.map(r => ({ ...r, points: r.points.slice() }));
    const active = rs.find(r => r.id === aid); if (!active) return;
    inside.forEach(p => { rs.forEach(r => { const j = r.points.findIndex(x => x.link === p.link); if (j >= 0) r.points.splice(j, 1); }); active.points.push(p); });
    routesRef.current = rs; setRoutes(rs); redrawRoutes(rs);
  }, [redrawRoutes]);
  useEffect(() => { assignAreaRef.current = assignArea; }, [assignArea]);

  // 영역 할당 모드 off → 진행중인 사각형/꼭짓점 정리
  useEffect(() => {
    areaModeRef.current = areaMode;
    if (!areaMode) {
      cornerA.current = null;
      if (cornerDot.current) { cornerDot.current.setMap(null); cornerDot.current = null; }
      if (previewRect.current) { previewRect.current.setMap(null); previewRect.current = null; }
    }
  }, [areaMode]);

  // 지도 + 데이터 로드
  useEffect(() => {
    (async () => {
      try {
        if (!KAKAO_KEY) { setErr('NEXT_PUBLIC_KAKAO_JS_KEY 미설정'); return; }
        await loadKakaoSdk();
        if (!mapRef.current) return;
        // 초기 중심: 서울 구로구 (구로구청 기준)
        map.current = new window.kakao.maps.Map(mapRef.current, { center: new window.kakao.maps.LatLng(37.49542, 126.88765), level: 6 });
        iw.current = new window.kakao.maps.InfoWindow({ removable: true });
        const K = window.kakao.maps;
        // 영역 할당: 빈 지도 클릭 2번(꼭짓점) → 사각형 영역 내 매장 일괄 배정 (라이브러리 의존 X)
        K.event.addListener(map.current, 'click', (e: any) => {
          if (!areaModeRef.current || !activeIdRef.current) return;
          const ll = e.latLng;
          if (!cornerA.current) {
            cornerA.current = ll;
            cornerDot.current = new K.CustomOverlay({ position: ll, content: '<div style="width:14px;height:14px;border-radius:7px;background:#1E40AF;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', map: map.current, zIndex: 20 });
          } else {
            const bounds = new K.LatLngBounds(cornerA.current, ll);
            assignAreaRef.current(bounds);
            cornerA.current = null;
            if (cornerDot.current) { cornerDot.current.setMap(null); cornerDot.current = null; }
            if (previewRect.current) { previewRect.current.setMap(null); previewRect.current = null; }
          }
        });
        // 첫 꼭짓점 이후 마우스 따라 미리보기 사각형
        K.event.addListener(map.current, 'mousemove', (e: any) => {
          if (!areaModeRef.current || !cornerA.current) return;
          const b = new K.LatLngBounds(cornerA.current, e.latLng);
          if (!previewRect.current) previewRect.current = new K.Rectangle({ bounds: b, strokeWeight: 2, strokeColor: '#1E40AF', strokeOpacity: 0.9, strokeStyle: 'shortdash', fillColor: '#1E40AF', fillOpacity: 0.12 });
          else previewRect.current.setBounds(b);
          previewRect.current.setMap(map.current);
        });
        const res = await fetch('/inbound-quote-round.json', { cache: 'no-store' });
        const data = await res.json();
        setPts(data.points || []);
        setStats(data.stats || null);
        setAsOf(data.asOf || '');
        setReady(true);
      } catch (e: unknown) { setErr((e as Error).message || String(e)); }
    })();
  }, []);

  // 필터 변경 → 마커 재렌더
  useEffect(() => {
    if (!ready || !map.current) return;
    const list = pts.filter(p => (catF === 'all' || p.category === catF) && (p.created >= createdFrom) && (statusF === 'all' || p.status === statusF) && (!fieldF || p.field === fieldF));
    shownRef.current = list;
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = list.map(p => {
      const mk = new window.kakao.maps.Marker({ position: new window.kakao.maps.LatLng(p.lat, p.lng), image: pinImage(p), title: p.store, map: map.current });
      window.kakao.maps.event.addListener(mk, 'click', () => onMarkerClick(p, mk));
      return mk;
    });
    // 초기/필터 시 자동 전체맞춤 안 함 — 구로구 중심 유지 (전국 보기는 ⤢ 버튼)
  }, [ready, pts, catF, createdFrom, statusF, fieldF, onMarkerClick]);

  // 줌 컨트롤
  const zoomOut = useCallback(() => { if (map.current) map.current.setLevel(map.current.getLevel() + 1); }, []);
  const zoomIn = useCallback(() => { if (map.current) map.current.setLevel(Math.max(1, map.current.getLevel() - 1)); }, []);
  const fitAll = useCallback(() => {
    const list = pts.filter(p => (catF === 'all' || p.category === catF) && (p.created >= createdFrom) && (statusF === 'all' || p.status === statusF) && (!fieldF || p.field === fieldF));
    if (!map.current || !list.length) return;
    const b = new window.kakao.maps.LatLngBounds(); list.forEach(p => b.extend(new window.kakao.maps.LatLng(p.lat, p.lng))); map.current.setBounds(b);
  }, [pts, catF, createdFrom, statusF, fieldF]);

  const shown = pts.filter(p => (catF === 'all' || p.category === catF) && (p.created >= createdFrom) && (statusF === 'all' || p.status === statusF) && (!fieldF || p.field === fieldF)).length;
  const routeKmOf = (pp: Pt[]) => pp.reduce((s, p, i) => i ? s + haversineKm(pp[i - 1], p) : 0, 0);
  const activeRoute = routes.find(r => r.id === activeId) || null;
  const naverUrl = (p: Pt) => 'https://map.naver.com/v5/search/' + encodeURIComponent((p.store + ' ' + (p.addr || '')).trim());
  const inp: React.CSSProperties = { flex: 1, minWidth: 0, border: '1px solid #CBD5E1', borderRadius: 6, padding: '5px 8px', fontSize: 12 };
  const lnk = (bg: string): React.CSSProperties => ({ color: '#fff', background: bg, borderRadius: 6, padding: '4px 10px', textDecoration: 'none', fontWeight: 700, fontSize: 11.5 });
  const btn: React.CSSProperties = { border: '1px solid #CBD5E1', background: '#fff', color: '#475569', borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
  const zbtn: React.CSSProperties = { width: 40, height: 40, borderRadius: 8, border: '1px solid #E0E6EF', background: 'rgba(255,255,255,.96)', color: '#1B2A3D', fontSize: 20, fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.15)', lineHeight: 1 };
  const totalAssigned = routes.reduce((s, r) => s + r.points.length, 0);
  const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const downloadCsv = () => {
    const header = ['담당자', '순번', '구분', '채널유형', '매장명', '매장상태', '단계', '단계경과(일)', '태블릿', '담당(필드)', '방문일', '방문경과(일)', '견적체류(일)', '생성일', '주소', '연락처', 'Salesforce', '네이버지도'];
    const rows = [header.join(',')];
    routes.forEach(r => r.points.forEach((p, i) => {
      rows.push([r.name, i + 1, p.category, p.channelType ?? '', p.store, p.status, p.stage, p.stageAge ?? '', p.tablets || 0, p.field, p.visit ?? '', p.daysSinceVisit ?? '', p.daysInStage ?? '', p.created ?? '', p.addr, p.phone, p.link, naverUrl(p)].map(csvCell).join(','));
    }));
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `맥아더작전_순회_${asOf || 'export'}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 0px)', minHeight: 520 }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', bottom: 24, right: 16, zIndex: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={zoomIn} title="확대" style={zbtn}>＋</button>
        <button onClick={zoomOut} title="축소" style={zbtn}>－</button>
        <button onClick={fitAll} title="전체 보기" style={{ ...zbtn, fontSize: 16 }}>⤢</button>
      </div>
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 5, background: 'rgba(255,255,255,.97)', border: '1px solid #E0E6EF', borderRadius: 12, padding: '14px 16px', boxShadow: '0 4px 16px rgba(0,0,0,.12)', width: 340, maxHeight: 'calc(100vh - 28px)', overflowY: 'auto', fontFamily: 'Pretendard,sans-serif' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1B2A3D' }}>📍 견적 순회 지도</div>
        <div style={{ fontSize: 11, color: '#5C7088', marginTop: 4, lineHeight: 1.5 }}>{asOf} · <b style={{ color: '#15803D' }}>인바운드</b>(방문후 3일+) + <b style={{ color: '#2563EB' }}>채널</b>(견적 3일+ 체류)</div>
        {stats && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <Stat v={shown} l="표시" />
            <Stat v={stats.inbound} l="인바운드" c="#15803D" />
            <Stat v={stats.channel} l="채널" c="#2563EB" />
            <Stat v={stats.tablets} l="태블릿" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Toggle on={catF === 'all'} onClick={() => setCatF('all')}>전체</Toggle>
          <Toggle on={catF === '인바운드'} onClick={() => setCatF('인바운드')}>🟢 인바운드</Toggle>
          <Toggle on={catF === '채널'} onClick={() => setCatF('채널')}>🔵 채널</Toggle>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11.5, color: '#5C7088' }}>
          <span>생성일</span>
          <select value={createdFrom} onChange={e => setCreatedFrom(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 6, padding: '4px 7px', fontSize: 11.5, fontWeight: 700, color: '#1B2A3D' }}>
            <option value="2026-05-01">2026-05</option>
            <option value="2026-04-01">2026-04</option>
            <option value="2026-03-01">2026-03</option>
            <option value="2026-01-01">2026-01(전체)</option>
          </select>
          <span>이후 생성분만</span>
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E0E6EF' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Toggle on={routeMode} onClick={() => { setRouteMode(v => !v); setAreaMode(false); }}>🧭 클릭 할당</Toggle>
            <Toggle on={areaMode} onClick={() => { setAreaMode(v => !v); setRouteMode(false); }}>⬚ 영역 할당</Toggle>
          </div>
          <div style={{ fontSize: 11, color: areaMode ? '#1E40AF' : '#5C7088', marginTop: 5 }}>
            {areaMode ? (activeRoute ? `빈 지도 ①②  두 꼭짓점 클릭 → 영역 내 매장이 ${activeRoute.name}에 배정` : '⚠ 담당자 추가/선택 먼저') : routeMode ? (activeRoute ? `마커 클릭 → ${activeRoute.name}에 배정` : '담당자 추가/선택 먼저') : '마커 클릭 = 상세보기'}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPerson(newName); }} placeholder="담당자 이름 (예: 김팀장)" style={inp} />
            <button onClick={() => addPerson(newName)} style={btn}>+ 추가</button>
          </div>
          {routes.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {routes.map(r => {
                const act = r.id === activeId;
                return (
                  <div key={r.id} onClick={() => setActiveId(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7, cursor: 'pointer', background: act ? '#F0F4FF' : '#F7F9FC', border: '1px solid ' + (act ? r.color : '#E5EBF3') }}>
                    <span style={{ width: 12, height: 12, borderRadius: 6, background: r.color, flexShrink: 0 }} />
                    <b style={{ fontSize: 12.5 }}>{r.name}</b>
                    <span style={{ fontSize: 11, color: '#5C7088' }}>{r.points.length}곳 · {routeKmOf(r.points).toFixed(1)}km</span>
                    {act && <span style={{ fontSize: 10, color: r.color, fontWeight: 700, marginLeft: 'auto' }}>● 활성</span>}
                    <button onClick={(e) => { e.stopPropagation(); removePerson(r.id); }} style={{ ...btn, marginLeft: act ? 6 : 'auto', padding: '2px 7px' }} title="삭제">✕</button>
                  </div>
                );
              })}
            </div>
          )}
          {totalAssigned > 0 && (
            <button onClick={downloadCsv} style={{ ...btn, marginTop: 9, width: '100%', padding: '9px', color: '#fff', background: '#15803D', borderColor: '#15803D', fontSize: 12.5 }}>⬇ CSV 다운로드 (전체 {totalAssigned}곳 · {routes.length}명)</button>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#33485F', lineHeight: 1.7 }}>
          <Dot c="#15803D" />인바 운영중 · <Dot c="#F59E0B" />인바 오픈전 · <Dot c="#2563EB" />채널 파트너사 · <Dot c="#7C3AED" />채널 프랜차이즈<br />⬚ 영역 할당 = 빈 지도 두 꼭짓점 클릭으로 구역 일괄 배정
        </div>
        {err && <div style={{ marginTop: 8, fontSize: 11, color: '#B91C1C' }}>⚠️ {err}</div>}
        {!ready && !err && <div style={{ marginTop: 8, fontSize: 11, color: '#5C7088' }}>지도 로딩 중…</div>}
      </div>

      {activeRoute && activeRoute.points.length > 0 && (
        <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 5, background: '#fff', border: '1px solid #E0E6EF', borderRadius: 14, boxShadow: '0 6px 22px rgba(0,0,0,.16)', width: 400, maxHeight: 'calc(100vh - 28px)', display: 'flex', flexDirection: 'column', fontFamily: 'Pretendard,sans-serif' }}>
          <div style={{ padding: '15px 18px', borderBottom: '1px solid #EEF2F8', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 15, height: 15, borderRadius: 8, background: activeRoute.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1B2A3D' }}>{activeRoute.name} 순회 리스트</div>
              <div style={{ fontSize: 12.5, color: '#5C7088', marginTop: 2 }}>{activeRoute.points.length}곳 · 총 <b style={{ color: activeRoute.color }}>{routeKmOf(activeRoute.points).toFixed(1)} km</b> · 방문 순서</div>
            </div>
            <button onClick={undoActive} style={btn}>↩ 마지막</button>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {activeRoute.points.map((p, i) => (
              <div key={p.link} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 18px', borderBottom: '1px solid #F4F6FA' }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: activeRoute.color, color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1B2A3D' }}>{p.store} <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: p.category === '채널' ? '#DBEAFE' : (p.status === '운영중' ? '#DCFCE7' : '#FEF3C7'), color: p.category === '채널' ? '#1E40AF' : (p.status === '운영중' ? '#15803D' : '#B45309') }}>{p.category === '채널' ? p.channelType : p.status}</span></div>
                  <div style={{ fontSize: 12.5, color: '#5C7088', marginTop: 3 }}>{p.stage}{p.stageAge != null ? ` · 단계 ${p.stageAge}일` : ''} · {p.tablets || 0}대 · 담당 {p.field}</div>
                  <div style={{ fontSize: 12.5, color: '#33485F', marginTop: 3 }}>📍 {p.addr || '-'}{p.phone ? ` · ☎ ${p.phone}` : ''}</div>
                  {p.category === '채널'
                    ? <div style={{ fontSize: 12, color: '#1E40AF', fontWeight: 600, marginTop: 3 }}>📋 견적 {p.daysInStage}일 체류 · {p.channelType}</div>
                    : <div style={{ fontSize: 12, color: '#B91C1C', fontWeight: 600, marginTop: 3 }}>🚶 방문 {p.daysSinceVisit}일 경과{p.visit ? ` (${p.visit})` : ''}</div>}
                  <div style={{ display: 'flex', gap: 7, marginTop: 8, alignItems: 'center' }}>
                    <a href={p.link} target="_blank" rel="noreferrer" style={lnk('#2563EB')}>Salesforce ›</a>
                    <a href={naverUrl(p)} target="_blank" rel="noreferrer" style={lnk('#15803D')}>네이버지도 ›</a>
                    <button onClick={() => assignToActive(p)} style={{ ...btn, marginLeft: 'auto', color: '#B91C1C', borderColor: '#FCA5A5' }}>제거</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ v, l, c }: { v: number; l: string; c?: string }) {
  return <div style={{ background: c || '#1E40AF', color: '#fff', borderRadius: 7, padding: '6px 10px', fontSize: 11, fontWeight: 600 }}><b style={{ fontSize: 15, display: 'block', fontWeight: 800 }}>{(v || 0).toLocaleString('ko-KR')}</b>{l}</div>;
}
function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ border: '1px solid ' + (on ? '#1E40AF' : '#CBD5E1'), background: on ? '#1E40AF' : '#fff', color: on ? '#fff' : '#475569', borderRadius: 7, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{children}</button>;
}
function Dot({ c }: { c: string }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: c, verticalAlign: 'middle', marginRight: 3 }} />;
}
