'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4003';
const S3_DATA_URL = process.env.NEXT_PUBLIC_S3_DATA_URL || '';
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || '';
const SF_BASE = 'https://torder.lightning.force.com/lightning/r/Opportunity';

// 부서 → 파일 슬러그
const DEPT_SLUG: Record<string, string> = {
  '아웃바운드세일즈': 'outbound',
  '인바운드세일즈': 'inbound',
  '채널매니지먼트': 'channel',
  '리텐션': 'retention',
  '마케팅': 'marketing',
  '채널세일즈': 'channel-sales',
  'SE': 'se',
};

// 데이터 로드:
//  - S3 + 부서 지정 → 그 팀 파일만 (가벼움)
//  - S3 + 부서 미지정 → tracking 전체 (호환용)
//  - 로컬 dev → /api/visits/all (전체)
async function loadTracking(dept?: string): Promise<{ records: any[] }> {
  if (S3_DATA_URL && dept && DEPT_SLUG[dept]) {
    const url = `${S3_DATA_URL}/visits/team-${DEPT_SLUG[dept]}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${dept} 팀 파일 로드 실패 (${res.status})`);
    return res.json();
  }
  const url = S3_DATA_URL
    ? `${S3_DATA_URL}/visits/tracking.json`
    : `${API}/api/visits/all`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`tracking 로드 실패 (${res.status})`);
  return res.json();
}

// Haversine 거리(km)
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 풀 필터 (정체 + 견적 + 예정)
function inPool(r: any): boolean {
  return !!r.lat && !!r.lng && (!!r.isStuck || r.stage === '견적' || !!r.hasUpcomingVisit);
}

// raw record → Pin
function toPin(r: any): Pin {
  return {
    oppId: r.oppId,
    name: r.name,
    account: r.account,
    visitor: r.lastVisitor || r.owner,
    visitorDept: r.lastVisitorDept || r.dept,
    lastVisitDate: r.lastVisitDate,
    oppOwner: r.oppOwner,
    oppOwnerDept: r.oppOwnerDept,
    stage: r.stage,
    lat: r.lat,
    lng: r.lng,
    sido: r.sido,
    sigugun: r.sigugun,
    address: r.roadAddress || r.rawAddress,
    firstVisit: r.firstVisit,
    lastTaskDate: r.lastTaskDate,
    daysSinceLastTask: r.daysSinceLastTask,
    lastTaskSubject: r.lastTaskSubject,
    hasOpenTask: r.hasOpenTask,
    isStuck: !!r.isStuck,
    contact: r.contact,
    naverMapUrl: r.naverMapUrl,
    naverPlaceUrl: r.naverPlaceUrl,
    nextScheduledVisit: r.nextScheduledVisit,
    hasUpcomingVisit: !!r.hasUpcomingVisit,
    visitsCount: r.visitsCount || 0,
    lightningUrl: `${SF_BASE}/${r.oppId}/view`,
  };
}

type Contact = {
  communicationName?: string;
  communicationPhone?: string;
  communicationType?: string;
  presidentName?: string;
  presidentPhone?: string;
  mainContactPhone?: string;
};
type ScheduledVisit = {
  visitId: string;
  visitor?: string;
  visitDate?: string;
  visitDateTime?: string;
};
type VisitDetail = {
  visitId: string;
  visitor?: string;
  visitDate?: string;
  visitDateTime?: string;
  conselStart?: string;
  conselEnd?: string;
  durationMin?: number | null;
  isComplete: boolean;
  status?: string;
  communicationName?: string;
  communicationPhone?: string;
  communicationType?: string;
  naverMapUrl?: string;
};
type TaskDetail = {
  id: string;
  subject: string;
  description?: string;
  activityDate?: string;
  createdAt?: string;
  completedAt?: string;
  status?: string;
  owner?: string;
  ownerDept?: string;
  isVisit: boolean;
};
type LastTaskSummary = {
  subject?: string;
  description?: string;
  date?: string;
  owner?: string;
  status?: string;
};
type Pin = {
  oppId: string;
  name: string;
  account: string;
  visitor: string;
  visitorDept: string;
  lastVisitDate?: string;
  oppOwner?: string;
  oppOwnerDept?: string;
  stage: string;
  lat: number;
  lng: number;
  sido: string;
  sigugun: string;
  address: string;
  firstVisit?: string;
  lastTaskDate?: string;
  daysSinceLastTask?: number;
  lastTaskSubject?: string;
  isStuck: boolean;
  contact?: Contact | null;
  naverMapUrl?: string | null;
  naverPlaceUrl?: string | null;
  nextScheduledVisit?: ScheduledVisit | null;
  hasUpcomingVisit?: boolean;
  visitsCount?: number;
  lightningUrl: string;
};
type NearbyItem = Pin & { distanceKm: number; lastTask?: LastTaskSummary | null };
type DeptEntry = { dept: string; members: string[]; count: number };

declare global { interface Window { kakao: any } }

function loadKakaoSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject('no window');
    if (window.kakao?.maps) return resolve();
    const existing = document.getElementById('kakao-sdk') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => window.kakao.maps.load(() => resolve()));
      return;
    }
    const s = document.createElement('script');
    s.id = 'kakao-sdk';
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services&autoload=false`;
    s.async = true;
    s.onload = () => window.kakao.maps.load(() => resolve());
    s.onerror = () => reject('Kakao SDK 로드 실패');
    document.head.appendChild(s);
  });
}

export default function VisitRoutePage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const nearbyMarkersRef = useRef<any[]>([]);
  const centerMarkerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const openInfoWindow = useRef<any>(null);

  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [deptFilter, setDeptFilter] = useState<string>('아웃바운드세일즈');
  const [ownerFilter, setOwnerFilter] = useState<string>('');
  const [myOnly, setMyOnly] = useState(false);
  const [radius, setRadius] = useState<number>(2);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Pin | null>(null);
  const [showTimeline, setShowTimeline] = useState(true);
  const [nearby, setNearby] = useState<NearbyItem[]>([]);
  const [detail, setDetail] = useState<{ visits: VisitDetail[]; tasks: TaskDetail[] } | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deptOptions, setDeptOptions] = useState<{ dept: string; open: number }[]>([]);
  // 들렀다 가기 후보 풀 — 부서 무관 전 팀 (팀 파일과 별개로 1회 로드)
  const [poolRecords, setPoolRecords] = useState<any[]>([]);

  // 후보 풀 로드 — deptFilter와 무관하게 마운트 시 1회
  useEffect(() => {
    if (!S3_DATA_URL) return; // 로컬 dev는 /api/visits/all이 이미 전체라 allRecords로 폴백
    fetch(`${S3_DATA_URL}/visits/nearby-pool.json`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => setPoolRecords(j.records || []))
      .catch(() => { /* 폴백: allRecords(선택 팀)로 계산 */ });
  }, []);

  // 부서 드롭다운 목록 — 현재 로드된 팀과 무관하게 summary(전 부서)에서 채운다
  useEffect(() => {
    const url = S3_DATA_URL ? `${S3_DATA_URL}/visits/summary.json` : `${API}/api/visits/summary`;
    fetch(url, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => setDeptOptions(
        ((j.byDept || j.deptCount || []) as { dept: string; open: number }[])
          .filter(d => DEPT_SLUG[d.dept] && d.open > 0)
          .map(d => ({ dept: d.dept, open: d.open }))
          .sort((a, b) => b.open - a.open)
      ))
      .catch(() => { /* 폴백: deptIndex 사용 */ });
  }, []);

  // 지도 초기화
  useEffect(() => {
    (async () => {
      try {
        if (!KAKAO_KEY) { setErr('NEXT_PUBLIC_KAKAO_JS_KEY 미설정'); return; }
        await loadKakaoSdk();
        if (!mapRef.current) return;
        mapInstance.current = new window.kakao.maps.Map(mapRef.current, {
          center: new window.kakao.maps.LatLng(36.5, 127.8),
          level: 13,
        });
        setReady(true);
      } catch (e: unknown) { setErr((e as Error).message || String(e)); }
    })();
  }, []);

  // 부서 변경 시 — 그 팀 파일 fetch + 기존 선택 초기화
  useEffect(() => {
    setOwnerFilter('');
    setSelected(null);
    setNearby([]);
    setAllRecords([]); // stale 데이터 잠시 비우기
    loadTracking(deptFilter)
      .then(d => setAllRecords(d.records || []))
      .catch(e => setErr(e.message));
  }, [deptFilter]);

  // 풀 → Pin 매핑 (필터 없음, 전체 풀)
  const pins = useMemo<Pin[]>(() => allRecords.filter(inPool).map(toPin), [allRecords]);

  // 부서별 멤버 인덱스 (lastVisitor 기준)
  const deptIndex = useMemo<DeptEntry[]>(() => {
    const map: Record<string, Set<string>> = {};
    for (const r of allRecords.filter(inPool)) {
      const v = r.lastVisitor; const dp = r.lastVisitorDept;
      if (!v || !dp) continue;
      if (!map[dp]) map[dp] = new Set();
      map[dp].add(v);
    }
    return Object.entries(map)
      .map(([dept, set]) => ({ dept, members: [...set].sort(), count: set.size }))
      .sort((a, b) => b.count - a.count);
  }, [allRecords]);

  const currentMembers = useMemo(
    () => deptIndex.find(d => d.dept === deptFilter)?.members || [],
    [deptIndex, deptFilter]
  );

  // 필터링된 리스트 (정체 우선 + 정체일 내림차순, 그다음 견적 활성 최근 task 오름차순)
  const filteredList = useMemo(() => {
    let list = pins;
    if (deptFilter) list = list.filter(p => p.visitorDept === deptFilter);
    if (ownerFilter) list = list.filter(p => p.visitor === ownerFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.visitor || '').toLowerCase().includes(q) ||
        (p.sigugun || '').toLowerCase().includes(q) ||
        (p.sido || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      // 1순위: 방문 예정 (날짜 오름차순 — 임박한 것부터)
      if (!!a.hasUpcomingVisit !== !!b.hasUpcomingVisit) return a.hasUpcomingVisit ? -1 : 1;
      if (a.hasUpcomingVisit && b.hasUpcomingVisit) {
        return (a.nextScheduledVisit?.visitDate || '').localeCompare(b.nextScheduledVisit?.visitDate || '');
      }
      // 2순위: 정체 (일수 내림차순)
      if (a.isStuck !== b.isStuck) return a.isStuck ? -1 : 1;
      return (b.daysSinceLastTask || 0) - (a.daysSinceLastTask || 0);
    });
  }, [pins, deptFilter, ownerFilter, search]);

  const stuckCount = filteredList.filter(p => p.isStuck).length;
  const upcomingCount = filteredList.filter(p => p.hasUpcomingVisit).length;

  // '내 매장만 보기' — 선택한 영업기회의 방문담당자 기준으로 주변 매장 필터
  const myVisitor = selected?.visitor || '';
  const visibleNearby = useMemo(
    () => (myOnly && myVisitor) ? nearby.filter(n => n.visitor === myVisitor) : nearby,
    [nearby, myOnly, myVisitor]
  );

  // 지도 핀 렌더 (필터 결과 기준)
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (openInfoWindow.current) { openInfoWindow.current.close(); openInfoWindow.current = null; }
    for (const p of filteredList) {
      const pinColor = p.isStuck ? '#f57c00' : (p.hasUpcomingVisit ? '#1565c0' : '#455a64');
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(p.lat, p.lng),
        image: new window.kakao.maps.MarkerImage(
          `data:image/svg+xml;utf8,${encodeURIComponent(svgPin(pinColor))}`,
          new window.kakao.maps.Size(26, 34),
          { offset: new window.kakao.maps.Point(13, 34) }
        ),
        title: p.name,
        clickable: true,
      });
      marker.setMap(mapInstance.current);
      window.kakao.maps.event.addListener(marker, 'click', () => focusPin(p));
      markersRef.current.push(marker);
    }
    // 자동 줌 fit
    if (filteredList.length && !selected) {
      const bounds = new window.kakao.maps.LatLngBounds();
      filteredList.forEach(p => bounds.extend(new window.kakao.maps.LatLng(p.lat, p.lng)));
      mapInstance.current.setBounds(bounds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filteredList]);

  // nearby (들렀다 가기 후보) 마커 — 다른 부서 매장도 풀에 포함되니 별도 렌더
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    nearbyMarkersRef.current.forEach(m => m.setMap(null));
    nearbyMarkersRef.current = [];
    const inMain = new Set(filteredList.map(p => p.oppId));
    for (const n of visibleNearby) {
      if (inMain.has(n.oppId)) continue; // 메인 풀에 이미 있으면 스킵 (중복 방지)
      const color = n.isStuck ? '#f57c00' : (n.hasUpcomingVisit ? '#1565c0' : '#90a4ae');
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(n.lat, n.lng),
        image: new window.kakao.maps.MarkerImage(
          `data:image/svg+xml;utf8,${encodeURIComponent(svgPinRing(color))}`,
          new window.kakao.maps.Size(22, 30),
          { offset: new window.kakao.maps.Point(11, 30) }
        ),
        title: n.name + ' · ' + (n.visitorDept || ''),
        clickable: true,
        zIndex: 5,
      });
      marker.setMap(mapInstance.current);
      window.kakao.maps.event.addListener(marker, 'click', () => focusPin(n as Pin));
      nearbyMarkersRef.current.push(marker);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visibleNearby, filteredList]);

  // 매장 선택 → 지도 이동, 반경, nearby
  const focusPin = useCallback((p: Pin) => {
    if (!mapInstance.current) return;
    setSelected(p);
    setShowTimeline(true);
    const pos = new window.kakao.maps.LatLng(p.lat, p.lng);
    mapInstance.current.setCenter(pos);
    mapInstance.current.setLevel(6);
    if (centerMarkerRef.current) centerMarkerRef.current.setMap(null);
    centerMarkerRef.current = new window.kakao.maps.Marker({
      position: pos,
      image: new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;utf8,${encodeURIComponent(svgPin('#2e7d32', true))}`,
        new window.kakao.maps.Size(38, 50),
        { offset: new window.kakao.maps.Point(19, 50) }
      ),
      zIndex: 99,
    });
    centerMarkerRef.current.setMap(mapInstance.current);
    if (circleRef.current) circleRef.current.setMap(null);
    circleRef.current = new window.kakao.maps.Circle({
      center: pos,
      radius: radius * 1000,
      strokeWeight: 3,
      strokeColor: '#e53935',
      strokeOpacity: 0.85,
      strokeStyle: 'shortdash',
      fillColor: '#e53935',
      fillOpacity: 0.08,
    });
    circleRef.current.setMap(mapInstance.current);

    // InfoWindow (스타일 정돈 + removable)
    if (openInfoWindow.current) openInfoWindow.current.close();
    const iw = new window.kakao.maps.InfoWindow({
      content: infoHtml(p),
      removable: true,
    });
    iw.open(mapInstance.current, centerMarkerRef.current);
    openInfoWindow.current = iw;

    // nearby — 클라이언트 사이드 거리 계산 (들렀다 가기는 풀 전체, 부서 무관)
    // nearby-pool.json = 전 부서 후보. 로드 실패/로컬 dev면 선택 팀(allRecords)으로 폴백
    const nearbySource = poolRecords.length > 0 ? poolRecords : allRecords;
    const nearbyItems: NearbyItem[] = nearbySource
      .filter(inPool)
      .filter(r => r.oppId !== p.oppId)
      .map(r => {
        const distanceKm = Math.round(haversineKm(p.lat, p.lng, r.lat, r.lng) * 10) / 10;
        return { ...toPin(r), distanceKm, lastTask: r.lastTask } as NearbyItem;
      })
      .filter(n => n.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    setNearby(nearbyItems);

    // detail — allRecords 직접 lookup
    const rec = allRecords.find(r => r.oppId === p.oppId);
    if (rec) setDetail({ visits: rec.visits || [], tasks: rec.tasks || [] });
    else setDetail(null);
  }, [radius, deptFilter, allRecords, poolRecords]);

  // 반경/부서/데이터 바뀌면 nearby 재계산 (후보 풀 뒤늦게 도착해도 갱신)
  useEffect(() => {
    if (selected) focusPin(selected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, deptFilter, allRecords, poolRecords]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr 360px', height: 'calc(100vh - 56px)' }}>
      {/* 좌측 패널 */}
      <div style={{ background: '#fafafa', borderRight: '1px solid #e0e0e0', overflow: 'auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #e0e0e0', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: '1.05em', fontWeight: 700 }}>
              {upcomingCount > 0 && <><span style={{ color: '#1565c0' }}>📅{upcomingCount}</span> · </>}
              <span style={{ color: '#ff9800' }}>{stuckCount}</span>
              <span style={{ color: '#999', fontWeight: 400, fontSize: '0.82em', marginLeft: 4 }}>/ {filteredList.length}</span>
            </h2>
            <span style={{ fontSize: '0.78em', color: '#666' }}>예정 → 정체 순</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={selectStyle}>
              <option value="">전체 부서</option>
              {(deptOptions.length ? deptOptions.map(d => ({ dept: d.dept, count: d.open })) : deptIndex).map(d => <option key={d.dept} value={d.dept}>{d.dept}</option>)}
            </select>
            <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} style={selectStyle} disabled={!currentMembers.length}>
              <option value="">{currentMembers.length ? '전체 담당자' : '(부서 선택)'}</option>
              {currentMembers.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="매장·담당·지역 검색"
            style={{ ...inputStyle, width: '100%', marginBottom: 6 }}
          />
          <div style={{ fontSize: '0.78em', color: '#666' }}>반경 {radius}km
            <input type="range" min={1} max={10} step={1} value={radius} onChange={e => setRadius(Number(e.target.value))} style={{ marginLeft: 8, verticalAlign: 'middle', width: 160 }} />
          </div>
        </div>

        {/* 메인 리스트 */}
        <div>
          {filteredList.map(p => (
            <ListRow key={p.oppId} p={p} selected={selected?.oppId === p.oppId} onClick={() => focusPin(p)} />
          ))}
          {!filteredList.length && <div style={{ padding: 30, textAlign: 'center', color: '#999', fontSize: '0.85em' }}>결과 없음</div>}
        </div>

      </div>

      {/* 중앙 지도 */}
      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#eee' }} />
        {err && <div style={overlay}>오류: {err}</div>}
        {!err && !ready && <div style={overlay}>지도 로드 중…</div>}
        {/* 범례 */}
        <div style={{ position: 'absolute', top: 12, right: 12, background: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: '0.78em', color: '#444', border: '1px solid #e0e0e0', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <span><span style={dot('#1565c0')}/>방문 예정</span>
          <span style={{ marginLeft: 12 }}><span style={dot('#f57c00')}/>정체 (8일+)</span>
          <span style={{ marginLeft: 12 }}><span style={dot('#455a64')}/>견적 진행중</span>
          <span style={{ marginLeft: 12 }}><span style={ringDot('#90a4ae')}/>주변(타팀)</span>
          <span style={{ marginLeft: 12 }}><span style={dot('#2e7d32')}/>선택</span>
          <span style={{ marginLeft: 12, color: '#e53935' }}>───</span><span style={{ marginLeft: 4 }}>반경</span>
        </div>
        {/* 선택 매장 방문·활동 이력 — 지도 위 플로팅 (좌하단) */}
        {selected && detail && showTimeline && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, width: 330, maxHeight: '58%', background: 'rgba(255,255,255,0.97)', borderRadius: 8, border: '1px solid #e0e0e0', boxShadow: '0 2px 12px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', zIndex: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eee' }}>
              <span style={{ fontSize: '0.82em', fontWeight: 700, color: '#444' }}>
                방문·활동 이력 <span style={{ color: '#999', fontWeight: 400 }}>{(detail.visits?.length || 0) + (detail.tasks?.length || 0)}건</span>
              </span>
              <button onClick={() => setShowTimeline(false)} title="닫기" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.2em', color: '#999', lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
            <div style={{ padding: '10px 12px', overflow: 'auto' }}>
              <div style={{ fontSize: '0.82em', fontWeight: 600, color: '#2e7d32', marginBottom: 8 }}>📍 {selected.name}</div>
              <Timeline visits={detail.visits} tasks={detail.tasks} />
            </div>
          </div>
        )}
        {selected && detail && !showTimeline && (
          <button onClick={() => setShowTimeline(true)} style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 20, padding: '7px 13px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, boxShadow: '0 1px 5px rgba(0,0,0,0.14)', fontSize: '0.8em', fontWeight: 600, color: '#444', cursor: 'pointer' }}>📋 활동이력 보기</button>
        )}
      </div>

      {/* 우측: 들렀다 가기 전용 패널 */}
      <div style={{ background: '#fff', borderLeft: '1px solid #e0e0e0', overflow: 'auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {!selected ? (
          <div style={{ padding: 14 }}>
            <h2 style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 12, color: '#2e7d32' }}>들렀다 가기</h2>
            <div style={{ padding: '40px 14px', textAlign: 'center', color: '#999', fontSize: '0.85em', lineHeight: 1.6, background: '#fafafa', borderRadius: 6, border: '1px dashed #ddd' }}>
              왼쪽 리스트나 지도에서<br />
              매장을 클릭하면<br />
              주변 {radius}km 안에서<br />
              <strong style={{ color: '#666' }}>들릴 만한 매장</strong>이<br />
              여기에 나타납니다.
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: 14, borderBottom: '3px solid #2e7d32', background: '#f1f8f4', position: 'sticky', top: 0, zIndex: 5 }}>
              <h2 style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 8, color: '#2e7d32' }}>들렀다 가기</h2>
              <div style={{ fontSize: '0.88em', fontWeight: 600, marginBottom: 3 }}>📍 {selected.name}</div>
              <div style={{ fontSize: '0.78em', color: '#666' }}>
                방문담당 {selected.visitor || '?'}{selected.lastVisitDate && <span style={{ color: '#999' }}> ({selected.lastVisitDate})</span>}
                {selected.isStuck && <span style={{ color: '#ff9800', marginLeft: 6, fontWeight: 600 }}>정체 {selected.daysSinceLastTask}일</span>}
              </div>
              {selected.hasUpcomingVisit && selected.nextScheduledVisit?.visitDate && (
                <div style={{ fontSize: '0.78em', color: '#2e7d32', fontWeight: 700, marginTop: 4 }}>
                  📅 다음 방문 {selected.nextScheduledVisit.visitDate}
                  {selected.nextScheduledVisit.visitor && ` · ${selected.nextScheduledVisit.visitor}`}
                </div>
              )}
              {selected.contact?.communicationPhone && (
                <div style={{ fontSize: '0.78em', color: '#444', marginTop: 4 }}>
                  📞 <span style={{ color: '#999' }}>{selected.contact.communicationType || '담당'}</span>{' '}
                  <a href={`tel:${selected.contact.communicationPhone}`} style={{ color: '#1976d2', textDecoration: 'none', fontWeight: 600 }}>{selected.contact.communicationPhone}</a>
                </div>
              )}
              <a href={naverSearchUrl(selected.name)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 6, padding: '4px 10px', background: '#03c75a', color: '#fff', textDecoration: 'none', borderRadius: 4, fontSize: '0.78em', fontWeight: 600 }}>N 지도 → {storeName(selected.name)}</a>
              <div style={{ fontSize: '0.78em', color: '#666', marginTop: 6, padding: '6px 8px', background: '#fff', borderRadius: 4 }}>
                반경 <strong>{radius}km</strong> 안 <strong>{visibleNearby.length}건</strong>
                {myOnly && myVisitor && <span style={{ color: '#2e7d32', marginLeft: 4, fontWeight: 600 }}>(내 매장)</span>}
                {visibleNearby.length > 0 && <span style={{ color: '#ff9800', marginLeft: 4 }}>(정체 {visibleNearby.filter(n => n.isStuck).length})</span>}
              </div>
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: '0.82em', fontWeight: 700, color: '#444' }}>주변 매장</span>
                <label
                  title={myVisitor ? '' : '방문담당이 없는 매장입니다'}
                  style={{ fontSize: '0.76em', fontWeight: 600, color: myVisitor ? '#2e7d32' : '#bbb', display: 'flex', alignItems: 'center', gap: 4, cursor: myVisitor ? 'pointer' : 'not-allowed', userSelect: 'none' }}
                >
                  <input type="checkbox" checked={myOnly && !!myVisitor} disabled={!myVisitor} onChange={e => setMyOnly(e.target.checked)} style={{ cursor: 'inherit', margin: 0 }} />
                  내 매장만{myVisitor ? ` · ${myVisitor}` : ''}
                </label>
              </div>
              {!visibleNearby.length && (
                <div style={{ padding: 30, textAlign: 'center', color: '#999', fontSize: '0.82em' }}>
                  {myOnly && myVisitor && nearby.length > 0 ? (
                    <>반경 {radius}km 안에 <strong>{myVisitor}</strong> 담당 매장이 없습니다.<br />
                    &lsquo;내 매장만&rsquo;을 끄면 {nearby.length}건이 보입니다.</>
                  ) : (
                    <>주변 {radius}km 안에 들릴 매장이 없습니다.<br />
                    반경을 늘려보세요.</>
                  )}
                </div>
              )}
              {visibleNearby.map(n => <NearbyCard key={n.oppId} n={n} onSelect={() => focusPin(n as Pin)} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ListRow({ p, selected, onClick }: { p: Pin; selected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick}
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid #eee',
        cursor: 'pointer',
        background: selected ? '#e8f5e9' : '#fff',
        borderLeft: `4px solid ${p.isStuck ? '#ff9800' : (p.hasUpcomingVisit ? '#1565c0' : 'transparent')}`,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#f5f5f5'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = '#fff'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 6 }}>
        <span style={{ fontSize: '0.9em', fontWeight: 600 }}>{p.name}</span>
        {p.hasUpcomingVisit && p.nextScheduledVisit?.visitDate
          ? <span style={{ color: '#1565c0', fontSize: '0.78em', fontWeight: 700, whiteSpace: 'nowrap' }}>📅 {p.nextScheduledVisit.visitDate}</span>
          : p.isStuck && <span style={{ color: '#ff9800', fontSize: '0.78em', fontWeight: 700, whiteSpace: 'nowrap' }}>{p.daysSinceLastTask}일</span>
        }
      </div>
      <div style={{ fontSize: '0.78em', color: '#666', marginBottom: 2 }}>
        방문담당 <strong>{p.visitor || '?'}</strong>
        {p.lastVisitDate && <span style={{ color: '#999', marginLeft: 4 }}>({p.lastVisitDate})</span>}
        <span style={{ marginLeft: 6 }}>· {p.stage}</span>
      </div>
      <div style={{ fontSize: '0.76em', color: '#999' }}>{p.sido} {p.sigugun}</div>
      {p.hasUpcomingVisit && p.nextScheduledVisit?.visitDate && (
        <div style={{ fontSize: '0.76em', color: '#2e7d32', fontWeight: 600, marginTop: 3 }}>
          📅 다음 방문 {p.nextScheduledVisit.visitDate}{p.nextScheduledVisit.visitor ? ` · ${p.nextScheduledVisit.visitor}` : ''}
        </div>
      )}
    </div>
  );
}

function NearbyCard({ n, onSelect }: { n: NearbyItem; onSelect?: (n: NearbyItem) => void }) {
  return (
    <div
      onClick={() => onSelect?.(n)}
      style={{
        background: '#fff',
        border: `1px solid ${n.isStuck ? '#ffb74d' : '#e0e0e0'}`,
        borderLeft: `4px solid ${n.isStuck ? '#ff9800' : (n.hasUpcomingVisit ? '#1565c0' : '#9e9e9e')}`,
        borderRadius: 6,
        padding: 9,
        marginBottom: 6,
        fontSize: '0.83em',
        cursor: 'pointer',
        transition: 'box-shadow 0.12s, transform 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontWeight: 600 }}>{n.name}</span>
        <span style={{ color: '#2e7d32', fontWeight: 700, fontSize: '0.88em' }}>{n.distanceKm}km</span>
      </div>
      <div style={{ color: '#666', fontSize: '0.82em' }}>
        방문담당 <strong>{n.visitor || '?'}</strong><DeptBadge dept={n.visitorDept} />
        {n.lastVisitDate && <span style={{ color: '#999', marginLeft: 4 }}>({n.lastVisitDate})</span>}
        <span style={{ marginLeft: 4 }}>· {n.stage}</span>
        {n.isStuck && <span style={{ color: '#ff9800', marginLeft: 4, fontWeight: 600 }}>정체 {n.daysSinceLastTask}일</span>}
      </div>
      <div style={{ color: '#999', fontSize: '0.76em', marginTop: 2 }}>{n.sido} {n.sigugun}</div>
      {n.hasUpcomingVisit && n.nextScheduledVisit?.visitDate && (
        <div style={{ fontSize: '0.76em', color: '#2e7d32', fontWeight: 600, marginTop: 3 }}>
          📅 다음 방문 {n.nextScheduledVisit.visitDate}
        </div>
      )}
      {n.contact?.communicationPhone && (
        <div style={{ fontSize: '0.76em', color: '#555', marginTop: 3 }}>
          <span style={{ color: '#999' }}>{n.contact.communicationType || '담당'}</span> {n.contact.communicationName?.split('_').pop() || ''} · <a href={`tel:${n.contact.communicationPhone}`} style={{ color: '#1976d2', textDecoration: 'none', fontWeight: 600 }}>{n.contact.communicationPhone}</a>
        </div>
      )}
      {n.lastTask?.subject && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: '#fafafa', borderRadius: 4, fontSize: '0.76em', borderLeft: '2px solid #ddd' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontWeight: 600, color: '#333' }}>최근 {n.lastTask.subject}</span>
            <span style={{ color: '#999', whiteSpace: 'nowrap' }}>{n.lastTask.date}</span>
          </div>
          {n.lastTask.owner && <div style={{ color: '#888', marginTop: 1 }}>{n.lastTask.owner}{n.lastTask.status && n.lastTask.status !== 'Completed' && <span style={{ color: '#ff9800', marginLeft: 4 }}>· {n.lastTask.status}</span>}</div>}
          {n.lastTask.description && n.lastTask.description.trim() && (
            <div style={{ marginTop: 3, color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 60, overflow: 'hidden', lineHeight: 1.4, position: 'relative' }}>
              {n.lastTask.description.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').slice(0, 150)}{n.lastTask.description.length > 150 ? '…' : ''}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }} onClick={e => e.stopPropagation()}>
        <a href={n.lightningUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2', fontSize: '0.76em', textDecoration: 'none', padding: '3px 8px', border: '1px solid #1976d2', borderRadius: 3, fontWeight: 600 }}>SF</a>
        <a href={naverSearchUrl(n.name)} target="_blank" rel="noopener noreferrer" style={{ color: '#fff', fontSize: '0.76em', textDecoration: 'none', padding: '3px 8px', background: '#03c75a', borderRadius: 3, fontWeight: 600 }}>N 지도</a>
      </div>
    </div>
  );
}

type TimelineEntry = {
  kind: 'visit' | 'task';
  date: string;
  rawDate: string;
  title: string;
  description?: string;
  owner?: string;
  status?: string;
  isComplete?: boolean;
  durationMin?: number | null;
};

function Timeline({ visits, tasks }: { visits: VisitDetail[]; tasks: TaskDetail[] }) {
  const entries: TimelineEntry[] = [];
  for (const v of (visits || [])) {
    if (!v.visitDate) continue;
    entries.push({
      kind: 'visit',
      date: v.visitDate,
      rawDate: v.visitDateTime || v.visitDate,
      title: v.isComplete ? '방문 완료' : (v.visitDate >= new Date().toISOString().slice(0, 10) ? '방문 예정' : '방문 미완료'),
      owner: v.visitor,
      isComplete: v.isComplete,
      status: v.status,
      durationMin: v.durationMin,
    });
  }
  for (const t of (tasks || [])) {
    const d = t.activityDate || t.createdAt;
    if (!d) continue;
    entries.push({
      kind: 'task',
      date: d,
      rawDate: t.completedAt || t.createdAt || d,
      title: t.subject || '(제목없음)',
      description: t.description,
      owner: t.owner,
      isComplete: t.status === 'Completed',
      status: t.status,
    });
  }
  // 최신순
  entries.sort((a, b) => (b.rawDate || '').localeCompare(a.rawDate || ''));

  if (!entries.length) {
    return <div style={{ color: '#999', fontSize: '0.8em', padding: 8 }}>이력 없음</div>;
  }

  return (
    <div style={{ borderLeft: '2px solid #eee', paddingLeft: 12, marginLeft: 6 }}>
      {entries.map((e, i) => {
        const isVisit = e.kind === 'visit';
        const dotColor = isVisit
          ? (e.isComplete ? '#2e7d32' : '#03a9f4')
          : (e.isComplete ? '#9e9e9e' : '#ff9800');
        return (
          <div key={i} style={{ position: 'relative', marginBottom: 9, fontSize: '0.78em', lineHeight: 1.45 }}>
            <span style={{ position: 'absolute', left: -19, top: 4, width: 10, height: 10, borderRadius: '50%', background: dotColor, border: '2px solid #fff', boxShadow: '0 0 0 1px ' + dotColor }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontWeight: isVisit ? 700 : 500, color: isVisit ? '#1b5e20' : '#333' }}>
                {isVisit && <span style={{ display: 'inline-block', padding: '1px 6px', background: e.isComplete ? '#e8f5e9' : '#e1f5fe', color: e.isComplete ? '#2e7d32' : '#0277bd', borderRadius: 8, fontSize: '0.85em', marginRight: 4, fontWeight: 700 }}>방문</span>}
                {e.title}
                {e.durationMin != null && e.durationMin > 0 && <span style={{ color: '#666', fontWeight: 400, marginLeft: 4 }}>({e.durationMin}분)</span>}
              </span>
              <span style={{ color: '#999', whiteSpace: 'nowrap' }}>{e.date}</span>
            </div>
            <div style={{ color: '#777', fontSize: '0.88em' }}>
              {e.owner || '(?)'} {e.status && !e.isComplete && <span style={{ color: '#ff9800', marginLeft: 4 }}>· {e.status}</span>}
            </div>
            {e.description && e.description.trim() && (
              <div style={{
                marginTop: 4,
                padding: '6px 8px',
                background: '#f7f7f7',
                borderRadius: 4,
                fontSize: '0.92em',
                color: '#444',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5,
                maxHeight: 110,
                overflow: 'auto',
                fontFamily: 'inherit',
              }}>
                {e.description.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const DEPT_ABBREV: Record<string, { short: string; color: string; bg: string }> = {
  '아웃바운드세일즈': { short: 'FS', color: '#bf360c', bg: '#fff3e0' },
  '인바운드세일즈': { short: 'IS', color: '#1565c0', bg: '#e3f2fd' },
  '채널매니지먼트': { short: 'CM', color: '#6a1b9a', bg: '#f3e5f5' },
  '리텐션': { short: 'RT', color: '#00695c', bg: '#e0f2f1' },
  '마케팅': { short: 'MK', color: '#37474f', bg: '#eceff1' },
  '채널세일즈': { short: 'CS', color: '#558b2f', bg: '#f1f8e9' },
};
function DeptBadge({ dept }: { dept?: string }) {
  if (!dept) return null;
  const meta = DEPT_ABBREV[dept] || { short: dept.slice(0, 2), color: '#555', bg: '#eee' };
  return (
    <span title={dept} style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 8,
      background: meta.bg, color: meta.color, fontSize: '0.74em', fontWeight: 700,
      marginLeft: 4, letterSpacing: 0.3,
    }}>{meta.short}</span>
  );
}

// Opp 이름에서 상호명만 추출 (첫 "_" 앞 + 괄호 안 지점명 제거)
function storeName(oppName: string): string {
  return (oppName || '').split('_')[0].replace(/\s*\([^)]*\)\s*/g, '').trim();
}
function naverSearchUrl(oppName: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(storeName(oppName))}`;
}

function escapeHtml(s: string) {
  return s ? s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c) : '';
}

function infoHtml(p: Pin) {
  const stageBadge = p.isStuck
    ? `<span style="display:inline-flex;align-items:center;padding:3px 9px;background:#fff3e0;color:#e65100;border-radius:11px;font-size:11px;font-weight:700;letter-spacing:-0.2px">⚠ 정체 ${p.daysSinceLastTask}일</span>`
    : `<span style="display:inline-flex;align-items:center;padding:3px 9px;background:#e3f2fd;color:#1565c0;border-radius:11px;font-size:11px;font-weight:600">${escapeHtml(p.stage)}</span>`;
  const stageBadge2 = p.isStuck
    ? `<span style="display:inline-flex;align-items:center;padding:3px 9px;background:#f5f5f5;color:#555;border-radius:11px;font-size:11px;font-weight:500;margin-left:4px">${escapeHtml(p.stage)}</span>`
    : '';
  const upcomingBadge = p.hasUpcomingVisit && p.nextScheduledVisit?.visitDate
    ? `<span style="display:inline-flex;align-items:center;padding:3px 9px;background:#e8f5e9;color:#2e7d32;border-radius:11px;font-size:11px;font-weight:600;margin-left:4px">📅 ${p.nextScheduledVisit.visitDate} 예정</span>`
    : '';
  const visitDate = p.lastVisitDate
    ? `<span style="color:#999;font-weight:400;margin-left:4px;font-size:11px">${p.lastVisitDate}</span>`
    : '';
  const oppOwnerRow = p.oppOwner && p.oppOwner !== p.visitor
    ? `<div style="display:flex;align-items:center;gap:4px;color:#888;font-size:11px;margin-bottom:3px"><span style="color:#aaa">Opp 담당</span>${escapeHtml(p.oppOwner)}</div>`
    : '';
  // 현장 컨택
  const c = p.contact || {};
  const phoneRow = (label: string, name: string | undefined | null, phone: string | undefined | null) => {
    if (!phone) return '';
    return `<div style="display:flex;align-items:baseline;gap:6px;font-size:11.5px;color:#333;margin-bottom:2px">
      <span style="color:#999;font-size:11px;font-weight:500;min-width:40px">${label}</span>
      <span>${name ? escapeHtml(name) + ' · ' : ''}<a href="tel:${escapeHtml(phone)}" style="color:#1976d2;text-decoration:none;font-weight:600">${escapeHtml(phone)}</a></span>
    </div>`;
  };
  const contactSection = (c.communicationPhone || c.presidentPhone) ? `
    <div style="background:#fafafa;border-radius:6px;padding:8px 10px;margin-bottom:10px">
      <div style="font-size:10px;color:#999;font-weight:600;letter-spacing:0.5px;margin-bottom:4px;text-transform:uppercase">현장 컨택</div>
      ${phoneRow(c.communicationType || '담당', c.communicationName, c.communicationPhone)}
      ${phoneRow('대표자', c.presidentName, c.presidentPhone)}
    </div>` : '';
  const naverBtn = `<a href="${escapeHtml(naverSearchUrl(p.name))}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:3px;padding:6px 10px;background:#03c75a;color:#fff;text-decoration:none;border-radius:4px;font-size:11.5px;font-weight:600;margin-left:6px">N 지도 →</a>`;
  return `<div style="
    padding:14px 18px 13px;
    min-width:300px;
    max-width:360px;
    font-family:-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif;
    line-height:1.5;
    color:#222
  ">
    <div style="font-weight:700;font-size:13.5px;color:#1a1a1a;margin-bottom:9px;padding-right:18px;letter-spacing:-0.3px">
      ${escapeHtml(p.name)}
    </div>
    <div style="margin-bottom:10px">
      ${stageBadge}${stageBadge2}${upcomingBadge}
    </div>
    <div style="font-size:12px;color:#333;margin-bottom:4px;display:flex;align-items:baseline;gap:5px">
      <span style="color:#999;font-size:11px;font-weight:500">방문담당</span>
      <strong style="color:#222;font-weight:600">${escapeHtml(p.visitor || '?')}</strong>
      ${visitDate}
    </div>
    ${oppOwnerRow}
    <div style="font-size:11px;color:#999;margin-top:6px;margin-bottom:10px;padding-top:6px;border-top:1px solid #eee">
      ${escapeHtml(p.address || '')}
    </div>
    ${contactSection}
    <div style="display:flex;flex-wrap:wrap;align-items:center">
      <a href="${p.lightningUrl}" target="_blank" rel="noopener" style="
        display:inline-flex;align-items:center;gap:4px;
        padding:6px 11px;background:#1976d2;color:#fff;text-decoration:none;
        border-radius:4px;font-size:11.5px;font-weight:600;letter-spacing:-0.1px
      ">Salesforce <span style="font-size:13px">→</span></a>
      ${naverBtn}
    </div>
  </div>`;
}

function svgPin(fill: string, big = false) {
  const w = big ? 38 : 26, h = big ? 50 : 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 32 42">
    <defs><filter id="s${big?'b':'s'}" x="-30%" y="-20%" width="160%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-opacity="0.35"/></filter></defs>
    <path filter="url(#s${big?'b':'s'})" fill="${fill}" stroke="#fff" stroke-width="2.5" d="M16 1 C8 1 1 8 1 16 c0 11 15 25 15 25 s15 -14 15 -25 C31 8 24 1 16 1z"/>
    <circle cx="16" cy="16" r="5.2" fill="#fff"/>
  </svg>`;
}
// 다른 부서 풀 마커 — 속이 빈 링 형태로 메인 풀과 구분
function svgPinRing(fill: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 32 42">
    <defs><filter id="sr" x="-30%" y="-20%" width="160%" height="140%"><feDropShadow dx="0" dy="1.2" stdDeviation="1" flood-opacity="0.3"/></filter></defs>
    <path filter="url(#sr)" fill="#fff" stroke="${fill}" stroke-width="3" d="M16 1 C8 1 1 8 1 16 c0 11 15 25 15 25 s15 -14 15 -25 C31 8 24 1 16 1z"/>
    <circle cx="16" cy="16" r="4.5" fill="${fill}"/>
  </svg>`;
}

function dot(color: string): React.CSSProperties {
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 4, verticalAlign: 'middle' };
}
function ringDot(color: string): React.CSSProperties {
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff', border: `2px solid ${color}`, marginRight: 4, verticalAlign: 'middle', boxSizing: 'border-box' };
}

const inputStyle: React.CSSProperties = { padding: '6px 9px', fontSize: '0.85em', border: '1px solid #ccc', borderRadius: 4 };
const selectStyle: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: '0.85em', border: '1px solid #ccc', borderRadius: 4, background: '#fff' };
const overlay: React.CSSProperties = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', padding: '12px 20px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: '0.9em' };
