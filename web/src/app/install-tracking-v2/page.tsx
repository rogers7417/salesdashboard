'use client';

import React, { useState, useEffect } from 'react';
import { fetchInstallTracking } from '@/lib/api';
import DataTable from '@/components/DataTable';
import TossBadge from '@/components/TossBadge';

export default function InstallTrackingV2Page() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string>('전체');
  const [statusFilter, setStatusFilter] = useState<string>('전체');
  const [stageFilter, setStageFilter] = useState<string>('전체');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchInstallTracking()
      .then(res => setData(res))
      .catch(err => setError('데이터를 불러오는데 실패했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  // 단계 목록
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

  // === Toss Badge 스타일 렌더 헬퍼 ===
  const sfOppLink = (name: string, row: any) => row.oppId ? (
    <a href={`https://torder.lightning.force.com/lightning/r/Opportunity/${row.oppId}/view`} target="_blank" rel="noopener noreferrer"
      style={{ color: '#3182F6', textDecoration: 'none', fontWeight: 500, fontSize: '0.92em' }}
    >{name}</a>
  ) : <span>{name}</span>;

  const dDayBadge = (v: number) => {
    if (v === null || v === undefined) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const label = v < 0 ? `D+${Math.abs(v)}` : v === 0 ? 'D-Day' : `D-${v}`;

    if (v < 0) return <TossBadge variant="fill" size="small" color="red">{label}</TossBadge>;
    if (v <= 3) return <TossBadge variant="fill" size="small" color="yellow">{label}</TossBadge>;
    if (v <= 7) return <TossBadge variant="weak" size="small" color="yellow">{label}</TossBadge>;
    return <TossBadge variant="weak" size="small" color="green">{label}</TossBadge>;
  };

  const statusBadge = (v: string) => {
    const colorMap: Record<string, 'green' | 'yellow' | 'red' | 'elephant'> = {
      '양호': 'green',
      '주의': 'yellow',
      '위험': 'red',
    };
    const color = colorMap[v] || 'elephant';
    return <TossBadge variant={v === '양호' ? 'weak' : 'fill'} size="small" color={color}>{v}</TossBadge>;
  };

  const sectionBadge = (v: string) => {
    const color = v === '인바운드' ? 'blue' : 'teal';
    return <TossBadge variant="weak" size="small" color={color as any}>{v}</TossBadge>;
  };

  const contractBadge = (v: boolean) => (
    v
      ? <TossBadge variant="weak" size="xsmall" color="green">완료</TossBadge>
      : <span style={{ color: '#B0B8C1', fontWeight: 500 }}>-</span>
  );

  const taskCountBadge = (v: boolean, row: any) => {
    const count = row.openTaskCount || 0;
    if (v) return <TossBadge variant="weak" size="xsmall" color="blue">{count}건</TossBadge>;
    return <TossBadge variant="fill" size="xsmall" color="red">없음</TossBadge>;
  };

  const nextTaskRender = (v: string | null, row: any) => {
    if (!v) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const date = row.nextTaskDate;
    return (
      <div style={{ fontSize: '0.88em', lineHeight: 1.4 }}>
        <div style={{ fontWeight: 600, color: '#191F28' }}>{v}</div>
        {date && <div style={{ color: '#8B95A1', fontSize: '0.9em' }}>{date}</div>}
      </div>
    );
  };

  const daysSinceRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#B0B8C1' }}>-</span>;
    if (v <= 3) return <TossBadge variant="weak" size="xsmall" color="green">{v}일</TossBadge>;
    if (v <= 7) return <TossBadge variant="weak" size="xsmall" color="yellow">{v}일</TossBadge>;
    return <TossBadge variant="weak" size="xsmall" color="red">{v}일</TossBadge>;
  };

  const stageBadge = (v: string) => {
    const stageConfig: Record<string, { color: 'blue' | 'teal' | 'green' | 'red' | 'yellow' | 'elephant'; variant: 'fill' | 'weak' }> = {
      'SQL': { color: 'blue', variant: 'weak' },
      'Negotiation': { color: 'yellow', variant: 'weak' },
      '출고진행': { color: 'teal', variant: 'weak' },
      '설치진행': { color: 'green', variant: 'weak' },
      'Closed Won': { color: 'green', variant: 'fill' },
    };
    const cfg = stageConfig[v] || { color: 'elephant' as const, variant: 'weak' as const };
    return <TossBadge variant={cfg.variant} size="xsmall" color={cfg.color}>{v}</TossBadge>;
  };

  // === 테이블 컬럼 ===
  const columns = [
    { key: 'dDay', header: 'D-Day', align: 'center' as const, render: dDayBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'trackingStatus', header: '상태', align: 'center' as const, render: statusBadge },
    { key: 'name', header: '기회명', render: sfOppLink },
    { key: 'section', header: '구분', align: 'center' as const, render: sectionBadge },
    { key: 'boUser', header: 'BO담당', render: (v: string) => <span style={{ fontWeight: 600, color: '#333D4B' }}>{v}</span> },
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
      ? { background: '#FFF0F0' }
      : o.trackingStatus === '주의'
        ? { background: '#FFF8E6' }
        : undefined,
  }));

  // Toss 스타일 필터 버튼
  const filterBtn = (label: string, active: boolean, onClick: () => void, color?: 'blue' | 'red' | 'yellow' | 'green' | 'elephant') => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: '6px 14px',
        border: active ? 'none' : '1px solid #E5E8EB',
        borderRadius: '20px',
        background: active ? (
          color === 'red' ? '#F04452' :
          color === 'yellow' ? '#FFC426' :
          color === 'green' ? '#20C997' :
          '#3182F6'
        ) : '#fff',
        color: active ? (color === 'yellow' ? '#191F28' : '#fff') : '#6B7684',
        fontWeight: active ? 700 : 500,
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {label}
    </button>
  );

  const summary = data?.summary || {};

  // Toss 스타일 요약 카드
  const TossStatsCard = ({ title, value, subtitle, color, loading: isLoading }: {
    title: string;
    value: string | number;
    subtitle?: string;
    color: 'blue' | 'red' | 'yellow' | 'green';
    loading?: boolean;
  }) => {
    const colorMap = {
      blue: { bg: '#E8F3FF', accent: '#3182F6', text: '#3182F6' },
      red: { bg: '#FFF0F0', accent: '#F04452', text: '#F04452' },
      yellow: { bg: '#FFF8E6', accent: '#FFC426', text: '#B98900' },
      green: { bg: '#EBFBEE', accent: '#20C997', text: '#12B886' },
    };
    const c = colorMap[color];

    if (isLoading) {
      return (
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '24px',
          minHeight: '120px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }} className="metro-loading" />
      );
    }

    return (
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        borderTop: `3px solid ${c.accent}`,
      }}>
        <div style={{ fontSize: '13px', color: '#8B95A1', fontWeight: 500, marginBottom: '8px' }}>{title}</div>
        <div style={{ fontSize: '32px', fontWeight: 700, color: c.text, lineHeight: 1.2 }}>{value}</div>
        {subtitle && <div style={{ fontSize: '12px', color: '#B0B8C1', marginTop: '8px' }}>{subtitle}</div>}
      </div>
    );
  };

  return (
    <div style={{ padding: '30px 40px', background: '#F9FAFB', minHeight: '100vh' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '1.8em', fontWeight: 700, color: '#191F28', letterSpacing: '-0.5px' }}>
              설치 트래킹
            </h1>
            <TossBadge variant="weak" size="small" color="blue">v2 Toss Style</TossBadge>
          </div>
          <p style={{ color: '#8B95A1', marginTop: '8px', fontSize: '14px' }}>
            설치희망일이 설정된 전체 진행중 영업기회 관리 현황
            {data?.extractedAt && ` · 마지막 동기화: ${new Date(data.extractedAt).toLocaleString('ko-KR')}`}
          </p>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div style={{
          background: '#FFF0F0',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <TossBadge variant="fill" size="small" color="red">오류</TossBadge>
          <span style={{ color: '#F04452', fontSize: '14px' }}>{error}</span>
        </div>
      )}

      {/* 요약 카드 - Toss 스타일 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
        <TossStatsCard title="설치 예정 전체" value={summary.total ?? '-'} color="blue" loading={loading}
          subtitle={`기준일: ${data?.asOfDate || '-'}`} />
        <TossStatsCard title="설치일 초과" value={summary.overdue ?? '-'} color="red" loading={loading}
          subtitle="설치희망일 지남" />
        <TossStatsCard title="7일 이내" value={summary.imminent ?? '-'} color="yellow" loading={loading}
          subtitle="D-7 이내 임박" />
        <TossStatsCard title="미관리 (위험)" value={summary.unmanaged ?? '-'} color="red" loading={loading}
          subtitle="트래킹 필요" />
      </div>

      {/* 필터 - Toss 스타일 (pill 형태) */}
      <div style={{
        display: 'flex',
        gap: '24px',
        marginBottom: '20px',
        flexWrap: 'wrap',
        background: '#fff',
        padding: '16px 20px',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#8B95A1', fontWeight: 600 }}>구분</span>
          {['전체', '인바운드', '채널'].map(s =>
            filterBtn(s, sectionFilter === s, () => setSectionFilter(s))
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#8B95A1', fontWeight: 600 }}>상태</span>
          {filterBtn('전체', statusFilter === '전체', () => setStatusFilter('전체'))}
          {filterBtn('위험', statusFilter === '위험', () => setStatusFilter('위험'), 'red')}
          {filterBtn('주의', statusFilter === '주의', () => setStatusFilter('주의'), 'yellow')}
          {filterBtn('양호', statusFilter === '양호', () => setStatusFilter('양호'), 'green')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#8B95A1', fontWeight: 600 }}>단계</span>
          {stageList.map(s =>
            filterBtn(s, stageFilter === s, () => setStageFilter(s))
          )}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '13px', color: '#8B95A1', alignSelf: 'center', fontWeight: 500 }}>
          <span style={{ color: '#3182F6', fontWeight: 700 }}>{filteredOpps.length}</span>건 표시 / 전체 {data?.opportunities?.length || 0}건
        </div>
      </div>

      {/* 메인 테이블 - Toss 스타일 래퍼 */}
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
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
