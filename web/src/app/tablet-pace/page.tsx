'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { fetchTabletPace } from '@/lib/api';

// ============ Design Tokens (Toss 계열) ============
const C = {
  text: '#191F28', secondary: '#6B7684', muted: '#8B95A1', border: '#E5E8EB',
  bg: '#FFFFFF', bgSub: '#F9FAFB', green: '#00C950', red: '#F04452',
  blue: '#3182F6', orange: '#F59E0B', teal: '#0EA5E9', purple: '#8B5CF6', gray: '#8B95A1',
};
const TEAM_COLOR: Record<string, string> = { IBS: C.blue, OBS: C.purple, FR: C.teal, PT: C.green };
// 예상실적 오버레이 보색 (팀색의 보색 계열)
const EXPECTED_COLOR: Record<string, string> = { IBS: '#F59E0B', OBS: '#A3E635', FR: '#F97316', PT: '#EC4899' };
const EXPECTED_STAGES = ['선납금', '계약진행', '출고진행', '설치진행']; // 선납금 이후 = 예상실적에 포함
const TEAM_KEYS = ['IBS', 'OBS', 'FR', 'PT'];
// 영업단계 색상 (흐름: 초기→후기)
const STAGE_COLOR: Record<string, string> = {
  '방문배정': C.gray, '방문상담': C.gray, '견적': C.blue, '재견적': C.blue,
  '선납금': C.orange, '계약진행': C.orange, '출고진행': C.green, '설치진행': C.green,
};
const fmt = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('ko-KR'));
const STAGE_ORDER = ['방문배정', '방문상담', '견적', '재견적', '선납금', '계약진행', '출고진행', '설치진행'];
// 기간 필터(생성일) → 컷오프 날짜. asOf 기준 maxAge일 이전 생성건 제외
function cutoffDate(asOf: string, maxAge: number | null): string | null {
  if (maxAge == null || !asOf) return null;
  const d = new Date(asOf + 'T00:00:00');
  d.setDate(d.getDate() - maxAge);
  return d.toISOString().slice(0, 10);
}

function CardWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, ...style }}>{children}</div>;
}

// 진행 바 (실적 + 예상실적 오버레이 vs 페이스목표 vs 월목표)
function PaceBar({ actual, expected, paceTarget, monthTarget, color, expectedColor }: { actual: number; expected: number; paceTarget: number; monthTarget: number; color: string; expectedColor: string }) {
  const pct = (v: number) => monthTarget > 0 ? Math.min(100, (v / monthTarget) * 100) : 0;
  return (
    <div style={{ position: 'relative', height: 14, background: C.bgSub, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
      {/* 예상실적(계약진행 이후 포함) — 보색, 뒤에 깔림 */}
      <div title="예상실적 (계약진행 이후 단계 포함)" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(expected)}%`, background: expectedColor, opacity: 0.5, borderRadius: 8, transition: 'width .3s' }} />
      {/* 실적(CW) — 팀색, 위 */}
      <div title="실적 (CW)" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(actual)}%`, background: color, borderRadius: 8, transition: 'width .3s' }} />
      {/* 오늘 누적 목표(페이스) 마커 */}
      <div title="오늘까지 누적 목표" style={{ position: 'absolute', left: `${pct(paceTarget)}%`, top: -2, bottom: -2, width: 2, background: C.red }} />
    </div>
  );
}

function TeamCard({ t }: { t: any }) {
  const color = TEAM_COLOR[t.team] || C.blue;
  const expectedColor = EXPECTED_COLOR[t.team] || C.orange;
  const postContract = (t.pipeline?.stages || []).filter((s: any) => EXPECTED_STAGES.includes(s.stage)).reduce((a: number, s: any) => a + (s.tablets || 0), 0);
  const expected = t.expectedActual ?? (t.actualMTD + postContract);
  const behind = t.gap < 0;
  return (
    <CardWrap>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color }}>{t.label}</div>
        <div style={{ fontSize: 12, color: C.muted }}>월 목표 {fmt(t.target)}대</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: C.text }}>{fmt(t.actualMTD)}</span>
        <span style={{ fontSize: 13, color: C.secondary }}>/ 오늘 누적목표 {fmt(t.cumTargetToday)}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: behind ? C.red : C.green, marginTop: 2 }}>
        {behind ? '▼ 페이스 미달 ' : '▲ 페이스 충족 '}{t.gap >= 0 ? '+' : ''}{fmt(t.gap)}대 · 페이스 달성률 {t.paceAttainment}%
      </div>
      <PaceBar actual={t.actualMTD} expected={expected} paceTarget={t.cumTargetToday} monthTarget={t.target} color={color} expectedColor={expectedColor} />
      <div style={{ fontSize: 11.5, color: C.secondary, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: expectedColor, opacity: 0.6, display: 'inline-block' }} />
        예상실적 <b style={{ color: C.text }}>{fmt(expected)}대</b>
        <span style={{ color: C.muted }}>· 선납금 이후 +{fmt(postContract)}대</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 14 }}>
        <Mini label="월 달성률" value={`${t.attainment}%`} />
        <Mini label="예상 마감" value={`${fmt(t.projected)}대`} valueColor={t.projected >= t.target ? C.green : C.red} />
        <Mini label="잔여" value={`${fmt(t.remaining)}대`} />
        <Mini label="필요 일일" value={`${fmt(t.requiredDaily)}대/일`} sub={`남은 ${t.remainingBizDays}영업일`} />
      </div>
    </CardWrap>
  );
}
function Mini({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ background: C.bgSub, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: C.secondary }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: valueColor || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted }}>{sub}</div>}
    </div>
  );
}

// CW 단계별 체류기간 (리드타임) 패널 — 기간 필터(생성일) 연동
function CwDwellPanel({ team, maxAge, asOf }: { team: any; maxAge: number | null; asOf: string }) {
  const cutoff = cutoffDate(asOf, maxAge);
  const opps = (team.cwDwellOpps || []).filter((o: any) => !cutoff || (o.created && o.created >= cutoff));
  const dwell = STAGE_ORDER.map((st) => {
    const vals = opps.map((o: any) => o.dwell?.[st]).filter((v: any) => v != null && v >= 0);
    return { stage: st, count: vals.length, median: +medianOf(vals).toFixed(1) };
  }).filter((d) => d.count > 0);
  const leadVals = opps.map((o: any) => STAGE_ORDER.reduce((s, st) => s + (o.dwell?.[st] || 0), 0)).filter((v: number) => v > 0);
  const leadTimeMedian = leadVals.length ? +medianOf(leadVals).toFixed(1) : null;
  const max = Math.max(...dwell.map((d) => d.median), 0.1);
  return (
    <CardWrap style={{ flex: 1, minWidth: 320 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>CW 단계별 체류기간</div>
        <div style={{ fontSize: 12, color: C.muted }}>중앙값 · 당월 마감 {opps.length}건</div>
      </div>
      <div style={{ fontSize: 12.5, color: C.secondary, margin: '4px 0 14px' }}>
        리드타임 중앙값 <b style={{ color: C.text, fontSize: 15 }}>{leadTimeMedian ?? '-'}일</b> <span style={{ color: C.muted }}>(생성 → 마감 · {maxAge == null ? '전체' : `최근 ${maxAge}일`})</span>
      </div>
      {dwell.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: '20px 0' }}>당월 마감 데이터 없음</div>
      ) : (
        dwell.map((d) => (
          <div key={d.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ width: 64, fontSize: 11.5, color: C.secondary, textAlign: 'right', flexShrink: 0 }}>{d.stage}</span>
            <div style={{ flex: 1, height: 18, background: C.bgSub, borderRadius: 5, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${d.median > 0 ? Math.max(d.median / max * 100, 4) : 0}%`, background: STAGE_COLOR[d.stage] || C.gray, borderRadius: 5 }} />
            </div>
            <span style={{ width: 76, fontSize: 11.5, fontWeight: 700, color: C.text, flexShrink: 0 }}>{d.median}일 <span style={{ color: C.muted, fontWeight: 400 }}>({d.count})</span></span>
          </div>
        ))
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>각 단계 머문 일수 중앙값 · (n)=해당 단계 경유 건수</div>
    </CardWrap>
  );
}

function medianOf(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 계류(열린) 단계별 체류기간 — 현재 단계 머문 일수(stageAge) 중앙값, 정체 감지
// 보드와 동일한 기간(생성일) 필터 적용 — 좀비 레거시건 제외
function OpenDwellPanel({ team, maxAge }: { team: any; maxAge: number | null }) {
  const rows = (team.pipeline?.stages || []).map((s: any) => {
    const opps = maxAge == null ? s.opps : s.opps.filter((o: any) => (o.age ?? 0) <= maxAge);
    const vals = opps.map((o: any) => o.stageAge).filter((v: any) => v != null && v >= 0);
    return { stage: s.stage, count: vals.length, median: +medianOf(vals).toFixed(1) };
  }).filter((r: any) => r.count > 0);
  const max = Math.max(...rows.map((r: any) => r.median), 0.1);
  const sev = (v: number) => (v >= 14 ? C.red : v >= 7 ? C.orange : C.teal);
  return (
    <CardWrap style={{ flex: 1, minWidth: 300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>계류 단계별 체류기간</div>
        <div style={{ fontSize: 12, color: C.muted }}>현재 계류 {team.pipeline?.count ?? 0}건</div>
      </div>
      <div style={{ fontSize: 12.5, color: C.secondary, margin: '4px 0 14px' }}>현재 단계에 머문 일수 중앙값 <span style={{ color: C.muted }}>(정체 감지 · {maxAge == null ? '전체 기간' : `최근 ${maxAge}일`})</span></div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: '20px 0' }}>계류 데이터 없음</div>
      ) : (
        rows.map((d: any) => (
          <div key={d.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ width: 64, fontSize: 11.5, color: C.secondary, textAlign: 'right', flexShrink: 0 }}>{d.stage}</span>
            <div style={{ flex: 1, height: 18, background: C.bgSub, borderRadius: 5, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${d.median > 0 ? Math.max(d.median / max * 100, 4) : 0}%`, background: sev(d.median), borderRadius: 5 }} />
            </div>
            <span style={{ width: 76, fontSize: 11.5, fontWeight: 700, color: C.text, flexShrink: 0 }}>{d.median}일 <span style={{ color: C.muted, fontWeight: 400 }}>({d.count})</span></span>
          </div>
        ))
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>7일+ 주황 · 14일+ 빨강 (정체) · (n)=계류 건수</div>
    </CardWrap>
  );
}

// CL 단계별 체류기간 — 이탈 건이 죽기 전 각 단계에 머문 일수(중앙값) · 기간 필터(생성일) 연동
function ClDistPanel({ team, maxAge, asOf }: { team: any; maxAge: number | null; asOf: string }) {
  const cutoff = cutoffDate(asOf, maxAge);
  const opps = (team.clDwellOpps || []).filter((o: any) => !cutoff || (o.created && o.created >= cutoff));
  const dwell = STAGE_ORDER.map((st) => {
    const vals = opps.map((o: any) => o.dwell?.[st]).filter((v: any) => v != null && v >= 0);
    return { stage: st, count: vals.length, median: +medianOf(vals).toFixed(1) };
  }).filter((d) => d.count > 0);
  const leadVals = opps.map((o: any) => STAGE_ORDER.reduce((s, st) => s + (o.dwell?.[st] || 0), 0)).filter((v: number) => v > 0);
  const leadTimeMedian = leadVals.length ? +medianOf(leadVals).toFixed(1) : null;
  const max = Math.max(...dwell.map((d) => d.median), 0.1);
  return (
    <CardWrap style={{ flex: 1, minWidth: 300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>CL 단계별 체류기간</div>
        <div style={{ fontSize: 12, color: C.muted }}>중앙값 · 당월 CL {fmt(opps.length)}건</div>
      </div>
      <div style={{ fontSize: 12.5, color: C.secondary, margin: '4px 0 14px' }}>
        CL까지 중앙값 <b style={{ color: C.text, fontSize: 15 }}>{leadTimeMedian ?? '-'}일</b> <span style={{ color: C.muted }}>(생성 → CL · {maxAge == null ? '전체' : `최근 ${maxAge}일`})</span>
      </div>
      {dwell.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: '20px 0' }}>당월 CL 데이터 없음</div>
      ) : (
        dwell.map((d) => (
          <div key={d.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <span style={{ width: 64, fontSize: 11.5, color: C.secondary, textAlign: 'right', flexShrink: 0 }}>{d.stage}</span>
            <div style={{ flex: 1, height: 18, background: C.bgSub, borderRadius: 5, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${d.median > 0 ? Math.max(d.median / max * 100, 4) : 0}%`, background: C.red, opacity: 0.4 + 0.6 * (d.median / max), borderRadius: 5 }} />
            </div>
            <span style={{ width: 76, fontSize: 11.5, fontWeight: 700, color: C.text, flexShrink: 0 }}>{d.median}일 <span style={{ color: C.muted, fontWeight: 400 }}>({d.count})</span></span>
          </div>
        ))
      )}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>CL 건이 죽기 전 각 단계 머문 일수 중앙값 · (n)=경유 건수</div>
    </CardWrap>
  );
}

// 영업단계 칸반 컬럼
function StageColumn({ stage, onlyTablet, maxAge }: { stage: any; onlyTablet: boolean; maxAge: number | null }) {
  const color = STAGE_COLOR[stage.stage] || C.gray;
  let opps = stage.opps as any[];
  if (onlyTablet) opps = opps.filter((o: any) => o.tablets > 0);
  if (maxAge != null) opps = opps.filter((o: any) => (o.age ?? 0) <= maxAge);
  const tabSum = opps.reduce((s: number, o: any) => s + o.tablets, 0);
  return (
    <div style={{ minWidth: 240, width: 240, flexShrink: 0, background: C.bgSub, borderRadius: 14, padding: 10, display: 'flex', flexDirection: 'column', maxHeight: '72vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{stage.stage}</span>
        </div>
        <span style={{ fontSize: 12, color: C.secondary, fontWeight: 700 }}>{opps.length}건 · {fmt(tabSum)}대</span>
      </div>
      <div className="no-scrollbar" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {opps.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: 8 }}>해당 없음</div>}
        {opps.map((o: any) => (
          <a key={o.id} href={o.link} target="_blank" rel="noreferrer"
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, textDecoration: 'none', display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>
                {o.account}{o.branch ? <span style={{ color: C.muted, fontWeight: 500 }}> {o.branch}</span> : ''}
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color, whiteSpace: 'nowrap' }}>{o.tablets > 0 ? `${o.tablets}대` : '—'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 11, color: C.secondary }}>
              {o.stageAge != null && <span style={{ color: o.stageAge >= 14 ? C.red : o.stageAge >= 7 ? C.orange : C.muted }}>⏱ 단계 {o.stageAge}일</span>}
              {o.companyStatus && <span>· {o.companyStatus}</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 11, color: C.secondary }}>
              <span>👤 소유 <b style={{ color: C.text, fontWeight: 600 }}>{o.ownerName || '-'}</b></span>
              <span>필드 <b style={{ color: C.text, fontWeight: 600 }}>{o.fieldUser || '-'}</b></span>
              <span>BO <b style={{ color: C.text, fontWeight: 600 }}>{o.boUser || '-'}</b></span>
            </div>
            {o.frHQ && <div style={{ marginTop: 4, fontSize: 11, color: C.secondary }}>🏢 {o.frHQ}</div>}
            {o.partner && <div style={{ marginTop: 4, fontSize: 11, color: C.secondary }}>🤝 {o.partner}</div>}
            {o.fromInbound && <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 700, color: C.purple, background: '#F3E8FF', borderRadius: 6, padding: '1px 6px' }}>인바운드→채널 보정</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function TabletPacePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<string>('IBS');
  const [onlyTablet, setOnlyTablet] = useState(false);
  const [maxAge, setMaxAge] = useState<number | null>(90); // 생성 경과일 컷오프 (기본: 최근 3개월)

  useEffect(() => {
    setLoading(true);
    fetchTabletPace()
      .then((d) => { if (!d) { setError('데이터가 아직 생성되지 않았습니다. 추출기를 먼저 실행하세요.'); } else { setData(d); } })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const teams = useMemo(() => (data ? TEAM_KEYS.map((k) => data.teams[k]).filter(Boolean) : []), [data]);
  const board = data?.teams?.[team];

  if (loading) return <div style={{ padding: 40, color: C.secondary }}>불러오는 중…</div>;
  if (error) return <div style={{ padding: 40, color: C.red }}>{error}</div>;

  return (
    <div style={{ padding: '24px 28px', background: 'linear-gradient(135deg, #EEF3FF 0%, #F5F7FB 45%, #EFF8F8 100%)', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>📟 Kanban</h1>
        <div style={{ fontSize: 13, color: C.secondary }}>
          {data.period} · 기준일 {data.asOf} · 영업일 {data.bizDaysElapsed}/{data.bizDaysTotal}일 경과
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: C.muted, margin: '6px 0 18px' }}>
        월 목표를 영업일로 소분한 누적 목표(빨간 선) 대비 마감 실적, 그리고 잔여 목표를 채울 계류 영업기회를 영업단계별로 트래킹합니다.
        실적(CW)은 계약시작일 + Closed Won 기준 (사내 /contracts API와 동일) · 퍼널/체류 분석은 영업기회 단계변경 기준.
      </p>

      {/* 팀 탭 — 선택한 팀만 표시 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {teams.map((t: any) => (
          <button key={t.team} onClick={() => setTeam(t.team)}
            style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${team === t.team ? TEAM_COLOR[t.team] : C.border}`, background: team === t.team ? TEAM_COLOR[t.team] : C.bg, color: team === t.team ? '#fff' : C.secondary, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 선택한 팀 지표 카드 + CW 단계 체류기간 */}
      {board && (
        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div style={{ width: 440, maxWidth: '100%' }}>
            <TeamCard t={board} />
          </div>
          <CwDwellPanel team={board} maxAge={maxAge} asOf={data.asOf} />
          <OpenDwellPanel team={board} maxAge={maxAge} />
          <ClDistPanel team={board} maxAge={maxAge} asOf={data.asOf} />
        </div>
      )}

      {/* 보드 컨트롤 (필터) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', margin: '20px 0 12px', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.secondary }}>
            기간(생성일)
            <select value={maxAge ?? ''} onChange={(e) => setMaxAge(e.target.value === '' ? null : Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: C.bg, cursor: 'pointer' }}>
              <option value="30">최근 1개월</option>
              <option value="90">최근 3개월</option>
              <option value="">전체 기간</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.secondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyTablet} onChange={(e) => setOnlyTablet(e.target.checked)} />
            태블릿 수량 있는 건만
          </label>
        </div>
      </div>

      {/* 영업단계 칸반 보드 */}
      {board && (() => {
        const shown = board.pipeline.stages.flatMap((s: any) => s.opps)
          .filter((o: any) => (!onlyTablet || o.tablets > 0) && (maxAge == null || (o.age ?? 0) <= maxAge));
        const shownTab = shown.reduce((s: number, o: any) => s + o.tablets, 0);
        const periodLabel = maxAge == null ? '전체 기간' : `최근 ${maxAge === 30 ? '1개월' : '3개월'}(생성 ${maxAge}일 이내)`;
        return (
          <>
            <div style={{ fontSize: 13, color: C.secondary, marginBottom: 10 }}>
              {board.label} · {periodLabel} · 표시 <b style={{ color: C.text }}>{fmt(shown.length)}건 · {fmt(shownTab)}대</b>
              <span style={{ color: C.muted }}> (전체 계류 {fmt(board.pipeline.count)}건) — 잔여 목표 {fmt(board.remaining)}대를 채울 후보</span>
            </div>
            <div className="no-scrollbar" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 14 }}>
              {board.pipeline.stages.map((s: any) => <StageColumn key={s.stage} stage={s} onlyTablet={onlyTablet} maxAge={maxAge} />)}
            </div>
          </>
        );
      })()}

      <div style={{ marginTop: 18, fontSize: 11, color: C.muted }}>
        원화(KRW) 기준 국내 영업기회만 — 해외(USD·CAD 등) {fmt(data.overseasExcluded?.open)}건 제외.
        분류: opp 소유 부서(Owner_Department__c) → 팀, 목표 외 부서(Biz-Ops·계약관리 등) {fmt(data.unclassified?.open?.count)}건 제외.
        추출 {new Date(data.extractedAt).toLocaleString('ko-KR')}.
      </div>
    </div>
  );
}
