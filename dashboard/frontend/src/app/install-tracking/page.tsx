'use client';

import React, { useState, useEffect } from 'react';
import { fetchInstallTracking } from '@/lib/api';
import StatsCard from '@/components/StatsCard';
import DataTable from '@/components/DataTable';

export default function InstallTrackingPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string>('전체');
  const [statusFilter, setStatusFilter] = useState<string>('전체');
  const [stageFilter, setStageFilter] = useState<string>('전체');

  // 데이터 로드 (월 파라미터 없이 전체 오픈 Opp 조회)
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchInstallTracking()
      .then(res => setData(res))
      .catch(err => setError('데이터를 불러오는데 실패했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  // 단계 목록 (데이터에서 동적 추출)
  const stageList = React.useMemo(() => {
    const stages = new Set<string>();
    (data?.opportunities || []).forEach((o: any) => {
      if (o.stageName) stages.add(o.stageName);
    });
    return ['전체', ...Array.from(stages)];
  }, [data]);

  // 필터링
  const filteredOpps = (data?.opportunities || []).filter((o: any) => {
    if (sectionFilter !== '전체' && o.section !== sectionFilter) return false;
    if (statusFilter !== '전체' && o.trackingStatus !== statusFilter) return false;
    if (stageFilter !== '전체' && o.stageName !== stageFilter) return false;
    return true;
  });

  // === 렌더 헬퍼 ===
  const sfOppLink = (name: string, row: any) => row.oppId ? (
    <a href={`https://torder.lightning.force.com/lightning/r/Opportunity/${row.oppId}/view`} target="_blank" rel="noopener noreferrer"
      style={{ color: '#1565c0', textDecoration: 'none', borderBottom: '1px dashed #90caf9', fontSize: '0.92em' }}
    >{name}</a>
  ) : <span>{name}</span>;

  const dDayBadge = (v: number) => {
    if (v === null || v === undefined) return <span>-</span>;
    const label = v < 0 ? `D+${Math.abs(v)}` : v === 0 ? 'D-Day' : `D-${v}`;
    const bg = v < 0 ? '#e81123' : v <= 3 ? '#ff8c00' : v <= 7 ? '#fff3e0' : '#e8f5e9';
    const color = v < 0 ? '#fff' : v <= 3 ? '#fff' : v <= 7 ? '#e65100' : '#2e7d32';
    return (
      <span style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: '4px',
        fontWeight: 700,
        fontSize: '0.88em',
        minWidth: '52px',
        textAlign: 'center',
        background: bg,
        color,
      }}>{label}</span>
    );
  };

  const statusBadge = (v: string) => {
    const config: Record<string, { bg: string; color: string }> = {
      '양호': { bg: '#e8f5e9', color: '#2e7d32' },
      '주의': { bg: '#fff3e0', color: '#e65100' },
      '위험': { bg: '#ffebee', color: '#c62828' },
    };
    const c = config[v] || { bg: '#f5f5f5', color: '#666' };
    return (
      <span style={{
        padding: '3px 10px',
        borderRadius: '4px',
        fontWeight: 700,
        fontSize: '0.88em',
        background: c.bg,
        color: c.color,
      }}>{v}</span>
    );
  };

  const sectionBadge = (v: string) => {
    const bg = v === '인바운드' ? '#e3f2fd' : '#f3e5f5';
    const color = v === '인바운드' ? '#1565c0' : '#7b1fa2';
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: '3px',
        fontSize: '0.85em',
        fontWeight: 600,
        background: bg,
        color,
      }}>{v}</span>
    );
  };

  const contractBadge = (v: boolean) => (
    <span style={{ color: v ? '#2e7d32' : '#ccc', fontWeight: 600 }}>{v ? '✓' : '-'}</span>
  );

  const taskCountBadge = (v: boolean, row: any) => {
    const count = row.openTaskCount || 0;
    if (v) return <span style={{ color: '#1565c0', fontWeight: 600 }}>{count}건</span>;
    return <span style={{ color: '#e81123', fontWeight: 600 }}>없음</span>;
  };

  const nextTaskRender = (v: string | null, row: any) => {
    if (!v) return <span style={{ color: '#ccc' }}>-</span>;
    const date = row.nextTaskDate;
    return (
      <div style={{ fontSize: '0.88em', lineHeight: 1.4 }}>
        <div style={{ fontWeight: 600, color: '#333' }}>{v}</div>
        {date && <div style={{ color: '#888', fontSize: '0.9em' }}>{date}</div>}
      </div>
    );
  };

  const daysSinceRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#ccc' }}>-</span>;
    const color = v <= 3 ? '#2e7d32' : v <= 7 ? '#e65100' : '#c62828';
    return <span style={{ color, fontWeight: 600 }}>{v}일</span>;
  };

  const stageBadge = (v: string) => {
    const stageColors: Record<string, string> = {
      'SQL': '#1565c0',
      'Negotiation': '#e65100',
      '출고진행': '#2e7d32',
      '설치진행': '#2e7d32',
      'Closed Won': '#2e7d32',
    };
    const color = stageColors[v] || '#555';
    return <span style={{ color, fontWeight: 600, fontSize: '0.9em' }}>{v}</span>;
  };

  // === 테이블 컬럼 ===
  const columns = [
    { key: 'dDay', header: 'D-Day', align: 'center' as const, render: dDayBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'trackingStatus', header: '상태', align: 'center' as const, render: statusBadge },
    { key: 'name', header: '기회명', render: sfOppLink },
    { key: 'section', header: '구분', align: 'center' as const, render: sectionBadge },
    { key: 'boUser', header: 'BO담당', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'fieldUser', header: 'Field담당' },
    { key: 'stageName', header: '단계', render: stageBadge },
    { key: 'hasContract', header: '계약', align: 'center' as const, render: contractBadge },
    { key: 'daysSinceLastTask', header: 'Task경과', align: 'right' as const, render: daysSinceRender },
    { key: 'hasOpenTask', header: '미완Task', align: 'center' as const, render: taskCountBadge },
    { key: 'nextTaskSubject', header: '다음 과업', render: nextTaskRender },
    { key: 'daysSinceVisit', header: '방문경과(역일)', align: 'right' as const, render: daysSinceRender },
    { key: 'bizDaysSinceVisit', header: '방문경과(영업일)', align: 'right' as const, render: daysSinceRender },
  ];

  // 행 스타일
  const rowStyled = filteredOpps.map((o: any) => ({
    ...o,
    _rowStyle: o.trackingStatus === '위험'
      ? { background: '#fff5f5' }
      : o.trackingStatus === '주의'
        ? { background: '#fffbf0' }
        : undefined,
  }));

  // 필터 버튼 스타일
  const filterBtn = (label: string, active: boolean, onClick: () => void, color?: string) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: '6px 16px',
        border: active ? 'none' : '1px solid #ddd',
        borderRadius: '4px',
        background: active ? (color || '#0078d4') : '#fff',
        color: active ? '#fff' : '#555',
        fontWeight: active ? 700 : 400,
        fontSize: '0.9em',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      {label}
    </button>
  );

  const summary = data?.summary || {};

  return (
    <div style={{ padding: '30px 40px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2em', fontWeight: 300 }}>설치 트래킹</h1>
          <p style={{ color: '#666', marginTop: '8px', fontSize: '0.95em' }}>
            설치희망일이 설정된 전체 진행중 영업기회 관리 현황
            {data?.extractedAt && ` · 마지막 동기화: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`}
          </p>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="metro-card red" style={{ marginBottom: '20px' }}>
          <p style={{ color: '#e81123' }}>{error}</p>
        </div>
      )}

      {/* 요약 카드 */}
      <div className="metro-grid metro-grid-4" style={{ marginBottom: '30px' }}>
        <StatsCard title="설치 예정 전체" value={summary.total ?? '-'} color="blue" loading={loading}
          subtitle={`기준일: ${data?.asOfDate || '-'}`} />
        <StatsCard title="설치일 초과" value={summary.overdue ?? '-'} color="red" loading={loading}
          subtitle="설치희망일 지남" />
        <StatsCard title="7일 이내" value={summary.imminent ?? '-'} color="orange" loading={loading}
          subtitle="D-7 이내 임박" />
        <StatsCard title="미관리 (위험)" value={summary.unmanaged ?? '-'} color="red" loading={loading}
          subtitle="트래킹 필요" />
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.9em', color: '#666', fontWeight: 600 }}>구분:</span>
          {['전체', '인바운드', '채널'].map(s =>
            filterBtn(s, sectionFilter === s, () => setSectionFilter(s))
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.9em', color: '#666', fontWeight: 600 }}>상태:</span>
          {filterBtn('전체', statusFilter === '전체', () => setStatusFilter('전체'))}
          {filterBtn('위험', statusFilter === '위험', () => setStatusFilter('위험'), '#e81123')}
          {filterBtn('주의', statusFilter === '주의', () => setStatusFilter('주의'), '#ff8c00')}
          {filterBtn('양호', statusFilter === '양호', () => setStatusFilter('양호'), '#107c10')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.9em', color: '#666', fontWeight: 600 }}>단계:</span>
          {stageList.map(s =>
            filterBtn(s, stageFilter === s, () => setStageFilter(s))
          )}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '0.9em', color: '#666', alignSelf: 'center' }}>
          {filteredOpps.length}건 표시 / 전체 {data?.opportunities?.length || 0}건
        </div>
      </div>

      {/* 메인 테이블 */}
      <div className="metro-card" style={{ padding: '0' }}>
        <DataTable
          columns={columns}
          data={rowStyled}
          loading={loading}
          className="daily-raw"
        />
      </div>
    </div>
  );
}
