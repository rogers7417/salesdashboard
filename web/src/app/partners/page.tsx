'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4003';
const S3_DATA_URL = process.env.NEXT_PUBLIC_S3_DATA_URL || '';
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || '';

type Meeting = { id: string; subject: string; date: string; owner?: string };
type Partner = {
  accountId: string;
  name: string;
  owner: string;
  ownerDept: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  partnerType: string | null;
  partnerOrder: string | null;
  torderStoreQty: number;
  channelProgramName: string | null;
  channelProgramLevel: string | null;
  createdAt: string;
  ageInDays: number;
  lastMeetingDate: string | null;
  daysSinceLastMeeting: number | null;
  meetingCount90d: number;
  meetings: Meeting[];
  leadCount30d: number;
  leadCount90d: number;
  leadTotal: number;
  lastLeadDate: string | null;
  daysSinceLastLead: number | null;
  leadTier: 'top' | 'mid' | 'low' | 'zero';
  lastActivityDate: string | null;
  daysSinceLastActivity: number | null;
  isStuck: boolean;
  isLatent: boolean;
  isActive: boolean;
  isMultiStore: boolean;
  signal: 'stuck' | 'latent' | 'active' | 'cold' | 'idle';
  lightningUrl: string;
};

type Summary = {
  total: number;
  bySignal: Record<string, number>;
  byType: Record<string, number>;
  byOwner: { owner: string; total: number; stuck: number; latent: number; active: number; multiStore: number }[];
  multiStore: number;
  withPhone: number;
  withAddress: number;
  byTier: { top?: number; mid?: number; low?: number; zero?: number };
  totalLeads90d: number;
  totalLeads30d: number;
};

const TIER_META: Record<string, { label: string; color: string; bg: string }> = {
  top:  { label: 'Top',  color: '#5e35b1', bg: '#ede7f6' },
  mid:  { label: 'Mid',  color: '#1565c0', bg: '#e3f2fd' },
  low:  { label: 'Low',  color: '#558b2f', bg: '#f1f8e9' },
  zero: { label: 'Zero', color: '#999',    bg: '#fafafa' },
};

const SIGNAL_META: Record<string, { label: string; color: string; bg: string; desc: string }> = {
  stuck:  { label: '정체',   color: '#c62828', bg: '#ffebee', desc: '미팅 60일 이상 없음' },
  latent: { label: '잠재',   color: '#ef6c00', bg: '#fff3e0', desc: '신규 등록 90일 이내 + 미팅 0회' },
  active: { label: '활성',   color: '#2e7d32', bg: '#e8f5e9', desc: '최근 90일 안 미팅 있음' },
  cold:   { label: '미접촉', color: '#666',    bg: '#f5f5f5', desc: '등록 90일+ + 미팅 0회' },
  idle:   { label: '대기',   color: '#888',    bg: '#fafafa', desc: '기타' },
};

const SIDO_LIST = ['서울특별시', '경기도', '인천광역시', '강원특별자치도', '대전광역시', '충청남도', '충청북도', '세종특별자치시', '대구광역시', '부산광역시', '울산광역시', '경상남도', '경상북도', '광주광역시', '전라남도', '전라북도', '제주특별자치도'];
function sidoOf(addr: string | null): string | null {
  if (!addr) return null;
  for (const s of SIDO_LIST) {
    if (addr.startsWith(s)) return s;
    // 짧은 표기 호환
    const short = s.replace(/특별자치시|특별자치도|광역시|특별시|도$/, '');
    if (addr.startsWith(short + ' ') || addr.startsWith(short + '시 ')) return s;
  }
  return null;
}
const SIDO_SHORT: Record<string, string> = {
  '서울특별시': '서울', '경기도': '경기', '인천광역시': '인천', '강원특별자치도': '강원',
  '대전광역시': '대전', '충청남도': '충남', '충청북도': '충북', '세종특별자치시': '세종',
  '대구광역시': '대구', '부산광역시': '부산', '울산광역시': '울산',
  '경상남도': '경남', '경상북도': '경북', '광주광역시': '광주',
  '전라남도': '전남', '전라북도': '전북', '제주특별자치도': '제주',
};

declare global { interface Window { kakao: any } }

function loadKakaoSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject('no window');
    if (window.kakao?.maps) return resolve();
    const existing = document.getElementById('kakao-sdk');
    if (existing) { existing.addEventListener('load', () => window.kakao.maps.load(() => resolve())); return; }
    const s = document.createElement('script');
    s.id = 'kakao-sdk';
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services,clusterer&autoload=false`;
    s.async = true;
    s.onload = () => window.kakao.maps.load(() => resolve());
    s.onerror = () => reject('Kakao SDK 로드 실패');
    document.head.appendChild(s);
  });
}

async function loadTracking(): Promise<{ summary: Summary; records: Partner[] }> {
  const url = S3_DATA_URL ? `${S3_DATA_URL}/partners/tracking.json` : `${API}/api/partners/all`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`partner tracking 로드 실패 (${res.status})`);
  return res.json();
}

export default function PartnersPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const openInfoWindow = useRef<any>(null);

  const [data, setData] = useState<{ summary: Summary; records: Partner[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [signalFilter, setSignalFilter] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sidoFilter, setSidoFilter] = useState<string>('');
  const [selected, setSelected] = useState<Partner | null>(null);
  const [mapReady, setMapReady] = useState(false);

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
        clustererRef.current = new window.kakao.maps.MarkerClusterer({
          map: mapInstance.current,
          averageCenter: true,
          minLevel: 8,
          disableClickZoom: false,
          styles: [{
            width: '40px', height: '40px',
            background: 'rgba(198, 40, 40, 0.85)',
            borderRadius: '50%',
            color: '#fff', textAlign: 'center', lineHeight: '40px', fontWeight: '700',
          }],
        });
        setMapReady(true);
      } catch (e: unknown) {
        setErr((e as Error).message || String(e));
      }
    })();
  }, []);

  // 데이터 로드
  useEffect(() => {
    loadTracking().then(d => setData(d)).catch(e => setErr(e.message));
  }, []);

  const owners = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.records.map(r => r.owner))].filter(Boolean).sort();
  }, [data]);

  const types = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.records.map(r => r.partnerType || '(미입력)'))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.records;
    if (signalFilter === 'multi') list = list.filter(r => r.isMultiStore);
    else if (signalFilter) list = list.filter(r => r.signal === signalFilter);
    if (tierFilter) list = list.filter(r => r.leadTier === tierFilter);
    if (ownerFilter) list = list.filter(r => r.owner === ownerFilter);
    if (typeFilter) list = list.filter(r => (r.partnerType || '(미입력)') === typeFilter);
    if (sidoFilter) list = list.filter(r => sidoOf(r.address) === sidoFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r => (r.name || '').toLowerCase().includes(q) || (r.owner || '').toLowerCase().includes(q));
    }
    const rank = (r: Partner) => r.isStuck ? 0 : r.isLatent ? 1 : r.isMultiStore ? 2 : r.isActive ? 3 : r.signal === 'cold' ? 4 : 5;
    return [...list].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a.isStuck) return (b.daysSinceLastMeeting || 0) - (a.daysSinceLastMeeting || 0);
      return (b.torderStoreQty || 0) - (a.torderStoreQty || 0);
    });
  }, [data, signalFilter, tierFilter, ownerFilter, typeFilter, sidoFilter, search]);

  // 시도별 분포 (현재 필터 결과 기준, sido 필터 제외)
  const sidoDist = useMemo(() => {
    if (!data) return [];
    let pool = data.records;
    if (signalFilter === 'multi') pool = pool.filter(r => r.isMultiStore);
    else if (signalFilter) pool = pool.filter(r => r.signal === signalFilter);
    if (ownerFilter) pool = pool.filter(r => r.owner === ownerFilter);
    if (typeFilter) pool = pool.filter(r => (r.partnerType || '(미입력)') === typeFilter);
    const m: Record<string, { total: number; stuck: number }> = {};
    let noAddr = 0;
    for (const r of pool) {
      const sido = sidoOf(r.address);
      if (!sido) { noAddr++; continue; }
      if (!m[sido]) m[sido] = { total: 0, stuck: 0 };
      m[sido].total++;
      if (r.isStuck) m[sido].stuck++;
    }
    return { list: Object.entries(m).map(([sido, v]) => ({ sido, ...v })).sort((a, b) => b.total - a.total), noAddr };
  }, [data, signalFilter, ownerFilter, typeFilter]);

  // 지도 마커 렌더 (좌표 있는 것만)
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !data) return;
    if (clustererRef.current) clustererRef.current.clear();
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (openInfoWindow.current) { openInfoWindow.current.close(); openInfoWindow.current = null; }

    const withCoords = filtered.filter(r => r.lat && r.lng);
    const markers = withCoords.map(p => {
      const meta = SIGNAL_META[p.signal] || SIGNAL_META.idle;
      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(p.lat!, p.lng!),
        image: new window.kakao.maps.MarkerImage(
          `data:image/svg+xml;utf8,${encodeURIComponent(svgPin(meta.color))}`,
          new window.kakao.maps.Size(24, 32),
          { offset: new window.kakao.maps.Point(12, 32) }
        ),
        title: p.name,
        clickable: true,
      });
      window.kakao.maps.event.addListener(marker, 'click', () => {
        setSelected(p);
        if (openInfoWindow.current) openInfoWindow.current.close();
        const iw = new window.kakao.maps.InfoWindow({
          content: infoHtml(p),
          removable: true,
        });
        iw.open(mapInstance.current, marker);
        openInfoWindow.current = iw;
      });
      return marker;
    });
    markersRef.current = markers;
    clustererRef.current.addMarkers(markers);

    if (withCoords.length) {
      const bounds = new window.kakao.maps.LatLngBounds();
      withCoords.forEach(p => bounds.extend(new window.kakao.maps.LatLng(p.lat!, p.lng!)));
      mapInstance.current.setBounds(bounds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filtered]);

  // 리스트에서 선택 시 지도 이동
  function selectAndFocus(p: Partner) {
    setSelected(p);
    if (p.lat && p.lng && mapInstance.current) {
      mapInstance.current.setCenter(new window.kakao.maps.LatLng(p.lat, p.lng));
      mapInstance.current.setLevel(5);
    }
  }

  if (err) return <div style={{ padding: 40, color: '#d32f2f' }}>오류: {err}</div>;
  if (!data) return <div style={{ padding: 40 }}>불러오는 중…</div>;

  const s = data.summary;
  const withCoords = filtered.filter(r => r.lat && r.lng).length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr 380px', height: 'calc(100vh - 56px)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* 좌측 */}
      <div style={{ background: '#fafafa', borderRight: '1px solid #e0e0e0', overflow: 'auto' }}>
        <div style={{ padding: 14, background: '#fff', borderBottom: '1px solid #e0e0e0', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: '1.05em', fontWeight: 700 }}>
              파트너 라운드 <span style={{ color: '#999', fontWeight: 400, fontSize: '0.82em' }}>{filtered.length} / {s.total}</span>
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 6 }}>
            <SignalCard label="정체" count={s.bySignal.stuck || 0} active={signalFilter === 'stuck'} onClick={() => setSignalFilter(signalFilter === 'stuck' ? '' : 'stuck')} signal="stuck" />
            <SignalCard label="잠재" count={s.bySignal.latent || 0} active={signalFilter === 'latent'} onClick={() => setSignalFilter(signalFilter === 'latent' ? '' : 'latent')} signal="latent" />
            <SignalCard label="활성" count={s.bySignal.active || 0} active={signalFilter === 'active'} onClick={() => setSignalFilter(signalFilter === 'active' ? '' : 'active')} signal="active" />
            <SignalCard label="다매장" count={s.multiStore} active={signalFilter === 'multi'} onClick={() => setSignalFilter(signalFilter === 'multi' ? '' : 'multi')} signal="active" />
          </div>
          {/* Lead 산출 등급 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }}>
            <TierCard tier="top" count={s.byTier?.top || 0} active={tierFilter === 'top'} onClick={() => setTierFilter(tierFilter === 'top' ? '' : 'top')} />
            <TierCard tier="mid" count={s.byTier?.mid || 0} active={tierFilter === 'mid'} onClick={() => setTierFilter(tierFilter === 'mid' ? '' : 'mid')} />
            <TierCard tier="low" count={s.byTier?.low || 0} active={tierFilter === 'low'} onClick={() => setTierFilter(tierFilter === 'low' ? '' : 'low')} />
            <TierCard tier="zero" count={s.byTier?.zero || 0} active={tierFilter === 'zero'} onClick={() => setTierFilter(tierFilter === 'zero' ? '' : 'zero')} />
          </div>
          <div style={{ fontSize: '0.72em', color: '#666', marginBottom: 4 }}>
            Lead 산출 (90일): <strong>{s.totalLeads90d}</strong>건 · 최근 30일: <strong>{s.totalLeads30d}</strong>건
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} style={selectStyle}>
              <option value="">전체 담당자</option>
              {owners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={selectStyle}>
              <option value="">전체 구분</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·담당자 검색" style={{ ...inputStyle, width: '100%' }} />
          <div style={{ marginTop: 8, fontSize: '0.72em', color: '#999' }}>
            지도에 {withCoords}개 표시 · 주소 미입력 {filtered.length - withCoords}건 (리스트에서만 보임)
          </div>
        </div>

        <div>
          {filtered.map(r => (
            <PartnerRow key={r.accountId} p={r} selected={selected?.accountId === r.accountId} onClick={() => selectAndFocus(r)} />
          ))}
          {!filtered.length && <div style={{ padding: 30, textAlign: 'center', color: '#999' }}>결과 없음</div>}
        </div>
      </div>

      {/* 중앙: 지도 */}
      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%', background: '#eee' }} />
        {!mapReady && <div style={overlay}>지도 로드 중…</div>}
        {/* 시도별 분포 — 좌측 세로 패널 */}
        <div style={{
          position: 'absolute', top: 12, left: 12, background: '#fff',
          border: '1px solid #e0e0e0', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          fontSize: '0.78em', width: 170, maxHeight: 'calc(100% - 24px)', overflow: 'auto',
          zIndex: 100, pointerEvents: 'auto',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #eee', fontWeight: 700, color: '#444', display: 'flex', justifyContent: 'space-between' }}>
            <span>지역별 분포</span>
            {sidoFilter && <span onClick={() => setSidoFilter('')} style={{ color: '#1976d2', cursor: 'pointer', fontWeight: 400 }}>초기화</span>}
          </div>
          {sidoDist && (sidoDist as { list: Array<{sido: string; total: number; stuck: number}>; noAddr: number }).list.map(s => (
            <div key={s.sido}
              onClick={() => setSidoFilter(sidoFilter === s.sido ? '' : s.sido)}
              style={{
                padding: '5px 10px', cursor: 'pointer',
                background: sidoFilter === s.sido ? '#e3f2fd' : '#fff',
                borderBottom: '1px solid #f5f5f5',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <span style={{ fontWeight: sidoFilter === s.sido ? 700 : 500, color: '#333' }}>
                {SIDO_SHORT[s.sido] || s.sido}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {s.stuck > 0 && <span style={{ color: '#c62828', fontWeight: 700, fontSize: '0.9em' }}>{s.stuck}</span>}
                <span style={{ color: '#999', fontWeight: 600 }}>{s.total}</span>
              </span>
            </div>
          ))}
          {sidoDist && (sidoDist as { noAddr: number }).noAddr > 0 && (
            <div style={{ padding: '5px 10px', fontSize: '0.88em', color: '#aaa', borderTop: '1px solid #f0f0f0' }}>
              주소 미입력 {(sidoDist as { noAddr: number }).noAddr}건
            </div>
          )}
        </div>

        {/* 시그널 범례 + 기준 */}
        <div style={{ position: 'absolute', top: 12, right: 12, background: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: '0.76em', color: '#444', border: '1px solid #e0e0e0', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', maxWidth: 260, zIndex: 100 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#222' }}>시그널 기준</div>
          {Object.entries(SIGNAL_META).filter(([k]) => k !== 'idle').map(([k, m]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <span style={{ ...dot(m.color), marginRight: 2 }}/>
              <strong style={{ color: m.color, minWidth: 40 }}>{m.label}</strong>
              <span style={{ color: '#666' }}>{m.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 우측 */}
      <div style={{ background: '#fff', borderLeft: '1px solid #e0e0e0', overflow: 'auto' }}>
        {!selected ? (
          <div style={{ padding: 14 }}>
            <h3 style={{ fontSize: '0.95em', fontWeight: 700, marginBottom: 10, color: '#444' }}>담당자별 분포</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
              {s.byOwner.slice(0, 12).map(o => (
                <div key={o.owner} style={{ padding: '6px 8px', background: '#fafafa', borderRadius: 4, fontSize: '0.78em' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{o.owner}</span>
                    <span style={{ color: '#999' }}>{o.total}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {o.stuck > 0 && <Tag color="#c62828">정체 {o.stuck}</Tag>}
                    {o.latent > 0 && <Tag color="#ef6c00">잠재 {o.latent}</Tag>}
                    {o.active > 0 && <Tag color="#2e7d32">활성 {o.active}</Tag>}
                    {o.multiStore > 0 && <Tag color="#5d4037">다매장 {o.multiStore}</Tag>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : <PartnerDetail p={selected} />}
      </div>
    </div>
  );
}

function PartnerRow({ p, selected, onClick }: { p: Partner; selected: boolean; onClick: () => void }) {
  const meta = SIGNAL_META[p.signal] || SIGNAL_META.idle;
  return (
    <div onClick={onClick} style={{
      padding: '10px 14px', borderBottom: '1px solid #eee', cursor: 'pointer',
      background: selected ? '#e8f5e9' : '#fff', borderLeft: `4px solid ${meta.color}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
        <span style={{ fontSize: '0.92em', fontWeight: 600 }}>{p.name}</span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {!p.lat && <span title="좌표 없음" style={{ color: '#bbb', fontSize: '0.8em' }}>📍✗</span>}
          {p.isMultiStore && <span style={{ background: '#f3e5f5', color: '#5d4037', padding: '1px 6px', borderRadius: 8, fontSize: '0.7em', fontWeight: 700 }}>다매장 {p.torderStoreQty}</span>}
          <span style={{ background: meta.bg, color: meta.color, padding: '1px 6px', borderRadius: 8, fontSize: '0.7em', fontWeight: 700 }}>{meta.label}</span>
        </span>
      </div>
      <div style={{ fontSize: '0.78em', color: '#666' }}>
        {p.owner} {p.partnerType && <span style={{ color: '#999' }}>· {p.partnerType}</span>}
      </div>
      <div style={{ fontSize: '0.76em', color: '#888', marginTop: 2, display: 'flex', gap: 6 }}>
        <span>📋 미팅 {p.meetingCount90d}건</span>
        <span style={{ color: p.leadCount90d > 0 ? (TIER_META[p.leadTier]?.color || '#888') : '#888' }}>📨 Lead {p.leadCount90d}건</span>
        {p.lastActivityDate && <span style={{ color: '#aaa' }}>· 마지막 {p.daysSinceLastActivity}일 전</span>}
      </div>
    </div>
  );
}

function PartnerDetail({ p }: { p: Partner }) {
  const meta = SIGNAL_META[p.signal];
  return (
    <div>
      <div style={{ padding: 14, borderBottom: `3px solid ${meta.color}`, background: meta.bg }}>
        <h2 style={{ fontSize: '1.05em', fontWeight: 700, marginBottom: 6 }}>{p.name}</h2>
        <div style={{ fontSize: '0.82em', color: '#444' }}>
          담당 <strong>{p.owner}</strong>
          {p.partnerType && <span> · {p.partnerType}</span>}
          {p.isMultiStore && <span style={{ marginLeft: 6, color: '#5d4037', fontWeight: 600 }}>다매장 {p.torderStoreQty}</span>}
        </div>
      </div>
      <div style={{ padding: 14 }}>
        {p.phone && <Field label="전화"><a href={`tel:${p.phone}`} style={{ color: '#1976d2', fontWeight: 600 }}>{p.phone}</a></Field>}
        {p.address && <Field label="주소">{p.address}</Field>}
        <Field label="등록">{p.createdAt} ({p.ageInDays}일 전)</Field>
        <Field label="소개 매장">{p.torderStoreQty}건</Field>
        {p.partnerOrder && <Field label="분류">{p.partnerOrder}</Field>}
        {p.channelProgramName && <Field label="채널 프로그램">{p.channelProgramName}{p.channelProgramLevel && ` · ${p.channelProgramLevel}`}</Field>}
        <Field label="최근 90일 미팅">{p.meetingCount90d}건</Field>
        {p.lastMeetingDate && <Field label="마지막 미팅">{p.lastMeetingDate} ({p.daysSinceLastMeeting}일 전)</Field>}
        <Field label="Lead 산출">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              padding: '1px 8px', borderRadius: 8, fontSize: '0.78em', fontWeight: 700,
              background: TIER_META[p.leadTier].bg, color: TIER_META[p.leadTier].color,
            }}>{TIER_META[p.leadTier].label}</span>
            <span>최근 90일 <strong>{p.leadCount90d}</strong>건 · 30일 <strong>{p.leadCount30d}</strong>건 · 전체 <strong>{p.leadTotal}</strong></span>
          </span>
        </Field>
        {p.lastLeadDate && <Field label="마지막 Lead">{p.lastLeadDate} ({p.daysSinceLastLead}일 전)</Field>}

        {p.meetings.length > 0 && (
          <>
            <h3 style={{ fontSize: '0.88em', fontWeight: 700, marginTop: 14, marginBottom: 6, color: '#444' }}>최근 미팅</h3>
            {p.meetings.map(m => (
              <div key={m.id} style={{ padding: '6px 8px', background: '#fafafa', borderRadius: 4, marginBottom: 4, fontSize: '0.8em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>{m.subject || '(제목 없음)'}</span>
                  <span style={{ color: '#999' }}>{m.date}</span>
                </div>
                <div style={{ color: '#888' }}>{m.owner}</div>
              </div>
            ))}
          </>
        )}

        <a href={p.lightningUrl} target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-block', marginTop: 14, padding: '6px 12px',
          background: '#1976d2', color: '#fff', textDecoration: 'none', borderRadius: 4, fontSize: '0.85em', fontWeight: 600,
        }}>Salesforce 열기 →</a>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s ? s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c) : '';
}

function infoHtml(p: Partner) {
  const meta = SIGNAL_META[p.signal] || SIGNAL_META.idle;
  return `<div style="padding:12px 14px;font-family:system-ui;font-size:12px;max-width:260px;line-height:1.5">
    <div style="font-weight:700;font-size:13px;margin-bottom:6px">${escapeHtml(p.name)}</div>
    <div style="margin-bottom:6px">
      <span style="display:inline-block;padding:2px 8px;background:${meta.bg};color:${meta.color};border-radius:10px;font-size:11px;font-weight:700">${meta.label}</span>
      ${p.isMultiStore ? `<span style="display:inline-block;padding:2px 8px;background:#f3e5f5;color:#5d4037;border-radius:10px;font-size:11px;font-weight:700;margin-left:4px">다매장 ${p.torderStoreQty}</span>` : ''}
    </div>
    <div style="color:#555;font-size:11.5px">담당 <strong>${escapeHtml(p.owner)}</strong></div>
    ${p.phone ? `<div style="font-size:11.5px;margin-top:2px"><a href="tel:${escapeHtml(p.phone)}" style="color:#1976d2;font-weight:600">${escapeHtml(p.phone)}</a></div>` : ''}
    ${p.address ? `<div style="color:#888;font-size:11px;margin-top:4px">${escapeHtml(p.address)}</div>` : ''}
    <a href="${p.lightningUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;padding:5px 10px;background:#1976d2;color:#fff;text-decoration:none;border-radius:4px;font-size:11px;font-weight:600">Salesforce →</a>
  </div>`;
}

function svgPin(fill: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 32 42"><path fill="${fill}" stroke="#fff" stroke-width="2" d="M16 1 C8 1 1 8 1 16 c0 11 15 25 15 25 s15 -14 15 -25 C31 8 24 1 16 1z"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, padding: '4px 0', fontSize: '0.85em', borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ color: '#999', fontSize: '0.92em' }}>{label}</span>
      <span style={{ color: '#333' }}>{children}</span>
    </div>
  );
}

function SignalCard({ label, count, active, onClick, signal }: { label: string; count: number; active: boolean; onClick: () => void; signal: string }) {
  const meta = SIGNAL_META[signal] || SIGNAL_META.idle;
  return (
    <div onClick={onClick} style={{
      padding: '6px 8px', background: active ? meta.color : meta.bg, color: active ? '#fff' : meta.color,
      borderRadius: 4, cursor: 'pointer', textAlign: 'center',
    }}>
      <div style={{ fontSize: '0.7em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.05em', fontWeight: 700 }}>{count}</div>
    </div>
  );
}

function TierCard({ tier, count, active, onClick }: { tier: string; count: number; active: boolean; onClick: () => void }) {
  const meta = TIER_META[tier];
  return (
    <div onClick={onClick} style={{
      padding: '4px 6px', background: active ? meta.color : meta.bg, color: active ? '#fff' : meta.color,
      borderRadius: 4, cursor: 'pointer', textAlign: 'center',
      border: active ? `1px solid ${meta.color}` : `1px solid ${meta.color}30`,
    }}>
      <div style={{ fontSize: '0.65em', fontWeight: 600, opacity: 0.85 }}>Lead {meta.label}</div>
      <div style={{ fontSize: '0.95em', fontWeight: 700 }}>{count}</div>
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ padding: '1px 6px', background: color, color: '#fff', borderRadius: 3, fontSize: '0.78em', fontWeight: 700 }}>{children}</span>;
}

function dot(color: string): React.CSSProperties {
  return { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 4, verticalAlign: 'middle' };
}

const inputStyle: React.CSSProperties = { padding: '6px 9px', fontSize: '0.85em', border: '1px solid #ccc', borderRadius: 4 };
const selectStyle: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: '0.85em', border: '1px solid #ccc', borderRadius: 4, background: '#fff' };
const overlay: React.CSSProperties = { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', padding: '12px 20px', borderRadius: 6, border: '1px solid #e0e0e0', fontSize: '0.9em' };
