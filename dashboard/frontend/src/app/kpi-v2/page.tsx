'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchKPIReport, fetchKPIMonths, fetchChannelSales } from '@/lib/api';
import DataTable from '@/components/DataTable';
import TossBadge from '@/components/TossBadge';
import LeadHeatmap from '@/components/LeadHeatmap';

// ============ 유틸리티 ============

function fmtFrt(minutes: number): string {
  if (!minutes && minutes !== 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// ============ 프로세스 스텝 타입 ============

interface FlowStep {
  key: string;
  label: string;
  value: string;
  detail: string;
  target: string;
  met: boolean;
  color: 'blue' | 'teal' | 'green' | 'red';
  rawCount: number;
  icon: string;
}

// ============ 메인 페이지 ============

function KPIV2PageInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>('');
  const [months, setMonths] = useState<string[]>([]);
  const [activeGroup, setActiveGroup] = useState<'inbound' | 'channel' | 'score'>('inbound');
  const [activeTab, setActiveTab] = useState<'is' | 'fs' | 'bo'>('is');
  const [activeStep, setActiveStep] = useState<number>(0);
  const [fsActiveStep, setFsActiveStep] = useState<number>(0);
  const [boActiveStep, setBoActiveStep] = useState<number>(0);
  const [csActiveTab, setCsActiveTab] = useState<'ae' | 'am' | 'tm' | 'bo'>('ae');
  const [csAeActiveStep, setCsAeActiveStep] = useState<number>(0);
  const [csAmActiveStep, setCsAmActiveStep] = useState<number>(0);
  const [csTmActiveStep, setCsTmActiveStep] = useState<number>(0);
  const [csBoActiveStep, setCsBoActiveStep] = useState<number>(0);
  const [negoListTab, setNegoListTab] = useState<'partner' | 'hq'>('partner');
  const [csData, setCsData] = useState<any>(null);
  const [csLoading, setCsLoading] = useState(false);
  const [taskModal, setTaskModal] = useState<{ oppName: string; tasks: any[] } | null>(null);
  const [meetingModal, setMeetingModal] = useState<{ accountId: string; accountName: string; accountIds?: string[] } | null>(null);
  const [csTaskModal, setCsTaskModal] = useState<{ accountId: string; accountName: string; accountIds?: string[] } | null>(null);
  const [onboardModal, setOnboardModal] = useState<{ partner: any } | null>(null);
  const [leadTaskModal, setLeadTaskModal] = useState<{ leadName: string; tasks: any[] } | null>(null);
  const [amActivePartnerTab, setAmActivePartnerTab] = useState<'partner' | 'hq'>('partner');
  const [csLeadViewTab, setCsLeadViewTab] = useState<'heatmap' | 'partners' | 'owners'>('heatmap');
  const [csLeadPartnerTab, setCsLeadPartnerTab] = useState<'partner' | 'hq'>('partner');
  const [csChurnedTab, setCsChurnedTab] = useState<'partner' | 'hq' | 'storeCX'>('partner');
  const [csOnboardTab, setCsOnboardTab] = useState<'partner' | 'hq'>('partner');
  const [csOnboardSettledOpen, setCsOnboardSettledOpen] = useState<Record<string, boolean>>({});
  const [scoreTab, setScoreTab] = useState<'is' | 'fs' | 'bo' | 'ae' | 'am' | 'tm' | 'csbo'>('is');

  // URL tab 파라미터 동기화
  useEffect(() => {
    if (tabParam === 'score') setActiveGroup('score');
    else if (activeGroup === 'score' && !tabParam) setActiveGroup('inbound');
  }, [tabParam]);

  // CS 데이터 lazy-load (채널 탭 + 스코어 탭에서 AE/AM 사용)
  useEffect(() => {
    if (activeGroup !== 'channel' && activeGroup !== 'score') return;
    setCsLoading(true);
    fetchChannelSales(month)
      .then(res => setCsData(res))
      .catch(() => {})
      .finally(() => setCsLoading(false));
  }, [activeGroup, month]);

  // 월 목록 로드
  useEffect(() => {
    fetchKPIMonths()
      .then(res => {
        const m = res?.months || [];
        setMonths(m);
        if (m.length > 0) setMonth(m[0]);
      })
      .catch(() => setError('월 목록을 불러오는데 실패했습니다.'));
  }, []);

  // 데이터 로드
  useEffect(() => {
    if (!month) return;
    setLoading(true);
    setError(null);
    fetchKPIReport(month)
      .then(res => setData(res))
      .catch(() => setError('데이터를 불러오는데 실패했습니다.'))
      .finally(() => setLoading(false));
  }, [month]);

  // 모달 열기/닫기: ESC 키 + 배경 스크롤 방지
  useEffect(() => {
    if (!taskModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTaskModal(null);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [taskModal]);

  // CS Task 모달 ESC + 스크롤 방지
  useEffect(() => {
    if (!csTaskModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCsTaskModal(null);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [csTaskModal]);

  // 미팅 모달 ESC + 스크롤 방지
  useEffect(() => {
    if (!meetingModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMeetingModal(null);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [meetingModal]);

  // 온보딩 모달 ESC + 스크롤 방지
  useEffect(() => {
    if (!onboardModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOnboardModal(null);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onboardModal]);

  const is = data?.inbound?.insideSales;
  const rawData = is?.rawData;
  const fs = data?.inbound?.fieldSales;
  const ibo = data?.inbound?.backOffice;

  // IS 담당자 이름 Set
  const isOwnerNames = useMemo(() =>
    new Set((is?.byOwner || []).map((o: any) => o.name)),
    [is]
  );

  // Daily Task: IS 담당자만 필터
  const filteredDailyTask = useMemo(() =>
    (is?.dailyTask?.byOwner || []).filter((o: any) => isOwnerNames.has(o.name)),
    [is, isOwnerNames]
  );

  const avgDailyTask = useMemo(() => {
    if (filteredDailyTask.length === 0) return '-';
    return (filteredDailyTask.reduce((s: number, o: any) => s + o.avgDaily, 0) / filteredDailyTask.length).toFixed(1);
  }, [filteredDailyTask]);

  // 프로세스 플로우 데이터 계산
  const frtOk = is?.frt?.frtOk ?? 0;
  const frtTotal = is?.frt?.totalWithTask ?? 0;
  const frtRate = frtTotal > 0 ? +((frtOk / frtTotal) * 100).toFixed(1) : 0;
  const frtByTimeSlot = is?.frt?.byTimeSlot;

  const flowSteps: FlowStep[] = useMemo(() => {
    if (!is) return [];
    return [
      {
        key: 'frt',
        label: 'FRT 준수',
        value: `${frtRate}%`,
        detail: `영업 ${frtByTimeSlot?.biz?.rate ?? '-'}% · 영업외 ${frtByTimeSlot?.offHour?.rate ?? '-'}% · 주말 ${frtByTimeSlot?.weekend?.rate ?? '-'}%`,
        target: '목표 80%',
        met: frtRate >= 80,
        color: frtRate >= 80 ? 'green' : 'red',
        rawCount: rawData?.frtOver20?.length ?? 0,
        icon: '⚡',
      },
      {
        key: 'task',
        label: 'Task 생성',
        value: `${avgDailyTask}건`,
        detail: '인당 일평균',
        target: '목표 30건/일',
        met: parseFloat(avgDailyTask as string) >= 30,
        color: 'teal',
        rawCount: 0,
        icon: '📋',
      },
      {
        key: 'visit',
        label: '방문 완료',
        value: `${is?.visitCount ?? '-'}건`,
        detail: `완료율 ${is?.visitRate ?? '-'}%`,
        target: '목표 75건/월',
        met: (is?.visitCount ?? 0) >= 75,
        color: (is?.visitCount ?? 0) >= 75 ? 'green' : 'red',
        rawCount: rawData?.noVisitSQL?.length ?? 0,
        icon: '🏃',
      },
      {
        key: 'sql',
        label: 'SQL 전환율',
        value: `${is?.sqlConversionRate ?? '-'}%`,
        detail: `MQL ${is?.mql ?? 0} → SQL ${is?.sql ?? 0}`,
        target: '목표 90%',
        met: (is?.sqlConversionRate ?? 0) >= 90,
        color: (is?.sqlConversionRate ?? 0) >= 90 ? 'green' : 'blue',
        rawCount: rawData?.unconvertedMQL?.length ?? 0,
        icon: '🎯',
      },
    ];
  }, [is, frtRate, frtOk, frtTotal, avgDailyTask, rawData]);

  // ============ 렌더 헬퍼 ============

  const sfLink = (name: string, row: any) => row.leadId ? (
    <a href={`https://torder.lightning.force.com/lightning/r/Lead/${row.leadId}/view`} target="_blank" rel="noopener noreferrer"
      style={{ color: '#3182F6', textDecoration: 'none', fontWeight: 500, fontSize: '1.0em' }}
    >{name}</a>
  ) : <span style={{ fontSize: '1.0em' }}>{name}</span>;

  const sfOppLink = (name: string, row: any) => {
    const id = row.oppId || row.leadId;
    const type = row.oppId ? 'Opportunity' : 'Lead';
    return id ? (
      <a href={`https://torder.lightning.force.com/lightning/r/${type}/${id}/view`} target="_blank" rel="noopener noreferrer"
        style={{ color: '#3182F6', textDecoration: 'none', fontWeight: 500, fontSize: '1.0em' }}
      >{name}</a>
    ) : <span style={{ fontSize: '1.0em' }}>{name}</span>;
  };

  const statusBadge = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    const colorMap: Record<string, 'green' | 'blue' | 'yellow' | 'red' | 'elephant'> = {
      'MQL': 'blue',
      'SQL': 'green',
      'Qualified': 'green',
      'Recycled': 'yellow',
      'Unqualified': 'red',
      '종료': 'elephant',
    };
    return <TossBadge variant="weak" size="xsmall" color={colorMap[v] || 'elephant'}>{v}</TossBadge>;
  };

  const frtBadgeRender = (v: number) => {
    if (!v && v !== 0) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const color = v >= 60 ? 'red' : v >= 30 ? 'red' : 'yellow';
    return <TossBadge variant="fill" size="xsmall" color={color as any}>{fmtFrt(v)}</TossBadge>;
  };

  const ownerBold = (v: string) => <span style={{ fontWeight: 600, color: '#191F28' }}>{v || '-'}</span>;

  const lastTouchRender = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    // 7일 이상 경과 시 경고
    const diff = Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
    if (diff >= 7) return <TossBadge variant="weak" size="xsmall" color="red">{v}</TossBadge>;
    return <span style={{ fontSize: '0.95em', color: '#4E5968' }}>{v}</span>;
  };

  const lossReasonLabelMap: Record<string, string> = {
    'LossReasonContract': '타사계약',
    'LossReasonProcess': '미도입',
  };

  const reasonBadge = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    const label = lossReasonLabelMap[v] || v;
    return <TossBadge variant="weak" size="xsmall" color="red">{label}</TossBadge>;
  };

  const stageBadge = (v: string) => {
    if (!v) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const colorMap: Record<string, 'green' | 'blue' | 'teal' | 'red' | 'elephant'> = {
      '미팅확정': 'green',
      '제안': 'blue',
      '계약': 'teal',
      'Closed Won': 'green',
      'Closed Lost': 'red',
    };
    return <TossBadge variant="weak" size="xsmall" color={colorMap[v] || 'elephant'}>{v}</TossBadge>;
  };

  const groupLabel = (_: any, row: any) => {
    if (row.group === 'qualified') return <TossBadge variant="weak" size="xsmall" color="green">전환</TossBadge>;
    if (row.group === 'closed') return <TossBadge variant="weak" size="xsmall" color="elephant">종료</TossBadge>;
    return <TossBadge variant="weak" size="xsmall" color="yellow">계류</TossBadge>;
  };

  const nextTaskRender = (_: any, row: any) => {
    if (row.group === 'closed' || row.group === 'qualified') return <span style={{ color: '#B0B8C1' }}>-</span>;
    if (!row.hasOpenTask) {
      return <TossBadge variant="fill" size="xsmall" color="red">과업 없음</TossBadge>;
    }
    const tasks = row.openTaskList && row.openTaskList.length > 0 ? row.openTaskList : null;
    if (tasks) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {tasks.map((t: any, i: number) => {
            return (
              <div key={i}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); setLeadTaskModal({ leadName: row.name || row.contactName || '-', tasks }); }}
                >
                  <TossBadge variant="weak" size="xsmall" color="green">
                    {t.subject !== '-' ? t.subject : '과업'}
                    {t.date && t.date !== '-' ? ` (${t.date})` : ''}
                  </TossBadge>
                  {t.owner && t.owner !== '-' && (
                    <span style={{ fontSize: '11px', color: '#8B95A1', whiteSpace: 'nowrap' }}>{t.owner}</span>
                  )}
                  {t.description && t.description !== '-' && (
                    <span style={{ fontSize: '11px', color: '#3182F6' }}>💬</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <TossBadge variant="weak" size="xsmall" color="green">
        {row.nextTaskSubject !== '-' ? row.nextTaskSubject : '있음'}
        {row.nextTaskDate && row.nextTaskDate !== '-' ? ` (${row.nextTaskDate})` : ''}
      </TossBadge>
    );
  };

  // 취소사유 세부/상세 렌더러
  const lossReasonSubRender = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    return <TossBadge variant="weak" size="xsmall" color="elephant">{v}</TossBadge>;
  };

  const lossReasonDetailRender = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    return (
      <div style={{
        maxWidth: '200px',
        fontSize: '0.85em',
        color: '#333D4B',
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {v}
      </div>
    );
  };

  // 인입시간 구분 렌더러: 주말 / 영업외(19~10시) / 영업시간
  const timeSlotRender = (_: any, row: any) => {
    const dow = row.createdDow; // 0=일, 6=토
    const hour = row.createdHour;
    if (dow === null || dow === undefined || hour === null || hour === undefined) {
      return <span style={{ color: '#B0B8C1' }}>-</span>;
    }
    if (dow === 0 || dow === 6) {
      return <TossBadge variant="weak" size="xsmall" color="elephant">주말</TossBadge>;
    }
    if (hour < 10 || hour >= 19) {
      return <TossBadge variant="weak" size="xsmall" color="blue">영업외</TossBadge>;
    }
    return <TossBadge variant="weak" size="xsmall" color="green">영업</TossBadge>;
  };

  // ============ Raw 데이터 테이블 컬럼 ============

  const frtOver20Columns = [
    { key: 'name', header: '이름', render: sfLink },
    { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
    { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
    { key: 'frtMinutes', header: 'FRT', align: 'right' as const, render: (v: number) => frtBadgeRender(v) },
    { key: 'createdHour', header: '인입시간', render: timeSlotRender },
    { key: 'lossReason', header: '취소사유', render: (v: string) => reasonBadge(v) },
    { key: 'lossReasonSub', header: '세부항목', render: (v: string) => lossReasonSubRender(v) },
    { key: 'lossReasonDetail', header: '취소 상세', render: (v: string) => lossReasonDetailRender(v) },
    { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
    { key: 'lastTaskDate', header: '마지막 터치', render: (v: string) => lastTouchRender(v) },
  ];

  const unconvertedMQLColumns = [
    { key: 'name', header: '이름', render: sfLink },
    { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
    { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
    { key: 'lossReason', header: '취소사유', render: (v: string) => reasonBadge(v) },
    { key: 'lossReasonSub', header: '세부항목', render: (v: string) => lossReasonSubRender(v) },
    { key: 'lossReasonDetail', header: '취소 상세', render: (v: string) => lossReasonDetailRender(v) },
    { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
    { key: 'lastTaskDate', header: '마지막 터치', render: (v: string) => lastTouchRender(v) },
  ];

  // 파트너/브랜드 렌더러 (채널 전용)
  const channelSourceRender = (_: any, row: any) => {
    const partner = row.partnerName;
    const brand = row.brandName;
    if (!partner && !brand) return <span style={{ color: '#B0B8C1' }}>-</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {partner && <TossBadge variant="weak" size="xsmall" color="blue">{partner}</TossBadge>}
        {brand && brand !== partner && <TossBadge variant="weak" size="xsmall" color="teal">{brand}</TossBadge>}
      </div>
    );
  };

  // TM 전용 컬럼 (파트너/브랜드 포함)
  const tmFrtOver20Columns = [
    { key: 'name', header: '이름', render: sfLink },
    { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
    { key: 'channel', header: '채널', render: channelSourceRender },
    { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
    { key: 'frtMinutes', header: 'FRT', align: 'right' as const, render: (v: number) => frtBadgeRender(v) },
    { key: 'createdHour', header: '인입시간', render: timeSlotRender },
    { key: 'lossReason', header: '취소사유', render: (v: string) => reasonBadge(v) },
    { key: 'lossReasonSub', header: '세부항목', render: (v: string) => lossReasonSubRender(v) },
    { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
  ];

  const tmUnconvertedMQLColumns = [
    { key: 'name', header: '이름', render: sfLink },
    { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
    { key: 'channel', header: '채널', render: channelSourceRender },
    { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
    { key: 'lossReason', header: '취소사유', render: (v: string) => reasonBadge(v) },
    { key: 'lossReasonSub', header: '세부항목', render: (v: string) => lossReasonSubRender(v) },
    { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
  ];

  const noVisitSQLColumns = [
    { key: 'name', header: '이름', render: sfOppLink },
    { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
    { key: 'oppStage', header: 'Opp단계', render: (v: string) => stageBadge(v) },
    { key: 'lossReason', header: '취소사유', render: (v: string) => reasonBadge(v) },
    { key: 'lossReasonSub', header: '세부항목', render: (v: string) => lossReasonSubRender(v) },
    { key: 'lossReasonDetail', header: '취소 상세', render: (v: string) => lossReasonDetailRender(v) },
    { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
    { key: 'lastTaskDate', header: '마지막 터치', render: (v: string) => lastTouchRender(v) },
  ];

  // ============ 구성원 칩 렌더링 ============
  function renderMemberChips(members: any[] | undefined, color: string) {
    if (!members || members.length === 0) return null;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px',
        padding: '10px 14px', background: '#F9FAFB', borderRadius: '10px',
        border: '1px solid #E5E8EB',
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#6B7684', whiteSpace: 'nowrap' }}>👥 구성원</span>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {members.map((m: any, i: number) => (
            <span key={m.id} style={{ fontSize: '13px', fontWeight: 600, color: '#333D4B' }}>
              {m.name}{i < members.length - 1 ? ',' : ''}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ============ 직무별 그룹핑 유틸리티 ============

  function groupByTeam(owners: any[]) {
    const teamMap: Record<string, any[]> = {};
    owners.forEach((o: any) => {
      const team = o.team || '-';
      if (!teamMap[team]) teamMap[team] = [];
      teamMap[team].push(o);
    });
    return teamMap;
  }

  // members + byOwner 합쳐서 전원 표시 (데이터 없는 사람은 0)
  function getAllMembersWithData(byOwnerArr: any[], membersList: any[]) {
    const ownerMap = new Map((byOwnerArr || []).map((o: any) => [o.name, o]));
    // byOwner에 team이 있는 사람 중 가장 많은 team을 기본값으로
    const teamCounts: Record<string, number> = {};
    byOwnerArr?.forEach((o: any) => { if (o.team && o.team !== '-') teamCounts[o.team] = (teamCounts[o.team] || 0) + 1; });
    const defaultTeam = Object.entries(teamCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    return (membersList || []).map((m: any) => {
      const existing = ownerMap.get(m.name);
      if (existing) return { ...existing, team: existing.team || defaultTeam };
      return { name: m.name, team: defaultTeam, frtOk: 0, frtOver20: 0, avgFrt: 0, lead: 0, mql: 0, sql: 0, sqlConversionRate: 0, visitConverted: 0, visitTotal: 0, visitRate: 0 };
    });
  }

  function renderTeamFRTTable(owners: any[]) {
    const fullOwners = getAllMembersWithData(is?.byOwner, is?.members);
    const teamMap = groupByTeam(fullOwners.filter((o: any) => o.team && o.team !== '-'));
    const teams = Object.entries(teamMap);
    if (teams.length === 0) return null;
    return (
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>🏆 직무별 FRT 현황</span>
          <span style={{ fontSize: '13px', color: '#8B95A1' }}>시상용 스코어링</span>
        </div>
        {teams.map(([team, members]) => {
          const totalOk = members.reduce((s: number, m: any) => s + (m.frtOk ?? 0), 0);
          const totalOver = members.reduce((s: number, m: any) => s + (m.frtOver20 ?? 0), 0);
          const totalAll = totalOk + totalOver;
          const teamRate = totalAll > 0 ? +((totalOk / totalAll) * 100).toFixed(1) : 0;
          const teamAvgFrt = members.length > 0 ? members.reduce((s: number, m: any) => s + (m.avgFrt ?? 0), 0) / members.length : 0;
          return (
            <div key={team} style={{ marginBottom: '16px', border: '1px solid #E5E8EB', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ background: '#FFF8E1', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: '#191F28', fontSize: '15px' }}>📋 {team} ({members.length}명)</span>
                <span style={{ fontSize: '13px', color: '#6B7684' }}>
                  팀 준수율 <TossBadge variant={teamRate >= 80 ? 'weak' : 'fill'} size="xsmall" color={teamRate >= 80 ? 'green' : teamRate >= 50 ? 'yellow' : 'red'}>{teamRate}%</TossBadge>
                  {' '}평균 FRT <TossBadge variant="weak" size="xsmall" color={teamAvgFrt <= 20 ? 'green' : 'red'}>{fmtFrt(teamAvgFrt)}</TossBadge>
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>FRT 준수</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>FRT 초과</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>준수율</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>평균 FRT</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((o: any) => {
                    const total = (o.frtOk ?? 0) + (o.frtOver20 ?? 0);
                    const rate = total > 0 ? +((o.frtOk / total) * 100).toFixed(1) : 0;
                    return (
                      <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant="weak" size="xsmall" color="green">{o.frtOk ?? 0}건</TossBadge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {(o.frtOver20 ?? 0) > 0
                            ? <TossBadge variant="fill" size="xsmall" color="red">{o.frtOver20}건</TossBadge>
                            : <span style={{ color: '#B0B8C1' }}>0건</span>
                          }
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant={rate >= 80 ? 'weak' : 'fill'} size="xsmall" color={rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : 'red'}>
                            {rate}%
                          </TossBadge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant="weak" size="xsmall" color={(o.avgFrt ?? 0) <= 20 ? 'green' : 'red'}>
                            {fmtFrt(o.avgFrt ?? 0)}
                          </TossBadge>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#FFFDF5', borderTop: '2px solid #E5E8EB' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 700, color: '#6B7684' }}>소계</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{totalOk}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700, color: '#F04452' }}>{totalOver}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={teamRate >= 80 ? 'weak' : 'fill'} size="xsmall" color={teamRate >= 80 ? 'green' : teamRate >= 50 ? 'yellow' : 'red'}>
                        {teamRate}%
                      </TossBadge>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant="weak" size="xsmall" color={teamAvgFrt <= 20 ? 'green' : 'red'}>
                        {fmtFrt(teamAvgFrt)}
                      </TossBadge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTeamTaskTable(owners: any[], taskData: any[]) {
    const fullOwners = getAllMembersWithData(is?.byOwner, is?.members);
    const teamMap = groupByTeam(fullOwners.filter((o: any) => o.team && o.team !== '-'));
    const taskMap = new Map(taskData.map((t: any) => [t.name, t]));
    const teams = Object.entries(teamMap);
    if (teams.length === 0) return null;
    return (
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>🏆 직무별 Task 생성 현황</span>
          <span style={{ fontSize: '13px', color: '#8B95A1' }}>시상용 스코어링</span>
        </div>
        {teams.map(([team, members]) => {
          let teamTotalTasks = 0;
          let teamTotalAvgDaily = 0;
          members.forEach((m: any) => {
            const task = taskMap.get(m.name);
            teamTotalTasks += task?.totalTasks ?? 0;
            teamTotalAvgDaily += task?.avgDaily ?? 0;
          });
          const teamAvgDaily = members.length > 0 ? teamTotalAvgDaily / members.length : 0;
          return (
            <div key={team} style={{ marginBottom: '16px', border: '1px solid #E5E8EB', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ background: '#FFF8E1', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: '#191F28', fontSize: '15px' }}>📋 {team} ({members.length}명)</span>
                <span style={{ fontSize: '13px', color: '#6B7684' }}>
                  팀 일평균 <TossBadge variant={teamAvgDaily >= 30 ? 'weak' : 'fill'} size="xsmall" color={teamAvgDaily >= 30 ? 'green' : teamAvgDaily >= 20 ? 'yellow' : 'red'}>{teamAvgDaily.toFixed(1)}건</TossBadge>
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>총 Task</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>일평균</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>30건 이상 일수</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>달성도</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((o: any) => {
                    const task = taskMap.get(o.name);
                    const taskAvg = task?.avgDaily ?? 0;
                    const daysOver30 = task?.daysOver30 ?? 0;
                    const totalTasks = task?.totalTasks ?? 0;
                    return (
                      <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700, color: '#191F28' }}>{totalTasks}건</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant={taskAvg >= 30 ? 'weak' : 'fill'} size="xsmall" color={taskAvg >= 30 ? 'green' : taskAvg >= 20 ? 'yellow' : 'red'}>
                            {typeof taskAvg === 'number' ? taskAvg.toFixed(1) : taskAvg}건
                          </TossBadge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 600, color: '#191F28' }}>{daysOver30}일</span></td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{renderTaskBar(taskAvg)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#FFFDF5', borderTop: '2px solid #E5E8EB' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 700, color: '#6B7684' }}>소계</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{teamTotalTasks}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={teamAvgDaily >= 30 ? 'weak' : 'fill'} size="xsmall" color={teamAvgDaily >= 30 ? 'green' : teamAvgDaily >= 20 ? 'yellow' : 'red'}>
                        {teamAvgDaily.toFixed(1)}건
                      </TossBadge>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTeamVisitTable(owners: any[]) {
    const fullOwners = getAllMembersWithData(is?.byOwner, is?.members);
    const teamMap = groupByTeam(fullOwners.filter((o: any) => o.team && o.team !== '-'));
    const PER_PERSON_TARGET = 75;
    const teams = Object.entries(teamMap);
    if (teams.length === 0) return null;
    return (
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>🏆 직무별 방문 현황</span>
          <span style={{ fontSize: '13px', color: '#8B95A1' }}>목표: 인당 75건 × 인원수</span>
        </div>
        {teams.map(([team, members]) => {
          const teamConverted = members.reduce((s: number, m: any) => s + (m.visitConverted ?? 0), 0);
          const teamVisitTotal = members.reduce((s: number, m: any) => s + (m.visitTotal ?? 0), 0);
          const teamTarget = PER_PERSON_TARGET * members.length;
          const teamTargetRate = teamTarget > 0 ? +((teamConverted / teamTarget) * 100).toFixed(1) : 0;
          const teamRate = teamVisitTotal > 0 ? +((teamConverted / teamVisitTotal) * 100).toFixed(1) : 0;
          return (
            <div key={team} style={{ marginBottom: '16px', border: '1px solid #E5E8EB', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ background: '#FFF8E1', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: '#191F28', fontSize: '15px' }}>📋 {team} ({members.length}명)</span>
                <span style={{ fontSize: '13px', color: '#6B7684' }}>
                  팀 목표 {teamTarget}건{' '}
                  <TossBadge variant={teamTargetRate >= 100 ? 'weak' : 'fill'} size="xsmall" color={teamTargetRate >= 100 ? 'green' : teamTargetRate >= 70 ? 'yellow' : 'red'}>
                    달성 {teamTargetRate}%
                  </TossBadge>
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>방문 완료</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>방문 총건</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>완료율</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((o: any) => {
                    const rate = o.visitRate ?? 0;
                    return (
                      <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700, color: '#191F28' }}>{o.visitConverted ?? 0}건</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ color: '#6B7684' }}>{o.visitTotal ?? 0}건</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant={rate >= 90 ? 'weak' : 'fill'} size="xsmall" color={rate >= 90 ? 'green' : rate >= 70 ? 'yellow' : 'red'}>
                            {rate}%
                          </TossBadge>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#FFFDF5', borderTop: '2px solid #E5E8EB' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 700, color: '#6B7684' }}>소계 (목표 {teamTarget}건)</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{teamConverted}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 600, color: '#6B7684' }}>{teamVisitTotal}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={teamRate >= 90 ? 'weak' : 'fill'} size="xsmall" color={teamRate >= 90 ? 'green' : teamRate >= 70 ? 'yellow' : 'red'}>
                        {teamRate}%
                      </TossBadge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTeamSQLTable(owners: any[]) {
    const fullOwners = getAllMembersWithData(is?.byOwner, is?.members);
    const teamMap = groupByTeam(fullOwners.filter((o: any) => o.team && o.team !== '-'));
    const teams = Object.entries(teamMap);
    if (teams.length === 0) return null;
    return (
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>🏆 직무별 SQL 전환 현황</span>
          <span style={{ fontSize: '13px', color: '#8B95A1' }}>시상용 스코어링</span>
        </div>
        {teams.map(([team, members]) => {
          const teamLead = members.reduce((s: number, m: any) => s + (m.lead ?? 0), 0);
          const teamMql = members.reduce((s: number, m: any) => s + (m.mql ?? 0), 0);
          const teamSql = members.reduce((s: number, m: any) => s + (m.sql ?? 0), 0);
          const teamRate = teamMql > 0 ? +((teamSql / teamMql) * 100).toFixed(1) : 0;
          return (
            <div key={team} style={{ marginBottom: '16px', border: '1px solid #E5E8EB', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ background: '#FFF8E1', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: '#191F28', fontSize: '15px' }}>📋 {team} ({members.length}명)</span>
                <span style={{ fontSize: '13px', color: '#6B7684' }}>
                  팀 전환율 <TossBadge variant={teamRate >= 90 ? 'weak' : 'fill'} size="xsmall" color={teamRate >= 90 ? 'green' : teamRate >= 70 ? 'yellow' : 'red'}>{teamRate}%</TossBadge>
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Lead</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>MQL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((o: any) => {
                    const rate = o.sqlConversionRate ?? 0;
                    return (
                      <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ color: '#6B7684' }}>{o.lead ?? 0}건</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.mql ?? 0}건</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700, color: '#191F28' }}>{o.sql ?? 0}건</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant={rate >= 90 ? 'weak' : 'fill'} size="xsmall" color={rate >= 90 ? 'green' : rate >= 70 ? 'yellow' : 'red'}>
                            {rate}%
                          </TossBadge>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#FFFDF5', borderTop: '2px solid #E5E8EB' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 700, color: '#6B7684' }}>소계</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{teamLead}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{teamMql}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{teamSql}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={teamRate >= 90 ? 'weak' : 'fill'} size="xsmall" color={teamRate >= 90 ? 'green' : teamRate >= 70 ? 'yellow' : 'red'}>
                        {teamRate}%
                      </TossBadge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }

  // ============ 상세 패널 렌더러 ============

  function renderFRTDetail() {
    const owners = (is?.byOwner as any[] || []).filter((o: any) =>
      o.name && !/^[0-9a-zA-Z]/.test(o.name) && (isOwnerNames.has(o.name) || (o.lead ?? 0) > 0)
    );
    const frtItems = rawData?.frtOver20 || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {renderMemberChips(is?.members, '#F04452')}
        {/* 시간대별 FRT 준수율 */}
        {frtByTimeSlot && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>시간대별 FRT 준수율</span>
              <span style={{ fontSize: '14px', color: '#8B95A1' }}>영업시간: 평일 10:00~19:00</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {[
                { label: '영업시간', data: frtByTimeSlot.biz, color: '#20C997', bg: '#E3FAF0' },
                { label: '영업외', data: frtByTimeSlot.offHour, color: '#3182F6', bg: '#E8F3FF' },
                { label: '주말', data: frtByTimeSlot.weekend, color: '#8B95A1', bg: '#F2F4F6' },
              ].map(slot => (
                <div key={slot.label} style={{
                  flex: '1 1 150px', padding: '16px', borderRadius: '12px',
                  background: slot.bg, textAlign: 'center', minWidth: '140px',
                }}>
                  <div style={{ fontSize: '14px', color: '#6B7684', fontWeight: 600, marginBottom: '6px' }}>{slot.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: slot.color }}>{slot.data?.rate ?? '-'}%</div>
                  <div style={{ fontSize: '14px', color: '#8B95A1', marginTop: '4px' }}>
                    {slot.data?.ok ?? 0} / {slot.data?.total ?? 0}건
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 직무별 FRT 현황 */}
        {renderTeamFRTTable(owners)}

        {/* 담당자별 FRT 현황 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 FRT 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>FRT 준수</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>FRT 초과</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>준수율</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>평균 FRT</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o: any) => {
                  const total = (o.frtOk ?? 0) + (o.frtOver20 ?? 0);
                  const rate = total > 0 ? +((o.frtOk / total) * 100).toFixed(1) : 0;
                  return (
                    <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                      <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <TossBadge variant="weak" size="xsmall" color="green">{o.frtOk ?? 0}건</TossBadge>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {(o.frtOver20 ?? 0) > 0
                          ? <TossBadge variant="fill" size="xsmall" color="red">{o.frtOver20}건</TossBadge>
                          : <span style={{ color: '#B0B8C1' }}>0건</span>
                        }
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <TossBadge variant={rate >= 80 ? 'weak' : 'fill'} size="xsmall" color={rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : 'red'}>
                          {rate}%
                        </TossBadge>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <TossBadge variant="weak" size="xsmall" color={(o.avgFrt ?? 0) <= 20 ? 'green' : 'red'}>
                          {fmtFrt(o.avgFrt ?? 0)}
                        </TossBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* FRT 20분 초과 Raw 데이터 */}
        {frtItems.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>FRT 20분 초과 상세</span>
                <TossBadge variant="fill" size="small" color="red">{frtItems.length}건</TossBadge>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(() => {
                  const weekend = frtItems.filter((r: any) => r.createdDow === 0 || r.createdDow === 6).length;
                  const offHour = frtItems.filter((r: any) => r.createdDow !== null && r.createdDow !== 0 && r.createdDow !== 6 && (r.createdHour < 10 || r.createdHour >= 19)).length;
                  const bizHour = frtItems.length - weekend - offHour;
                  return (
                    <>
                      <TossBadge variant="weak" size="xsmall" color="green">영업 {bizHour}</TossBadge>
                      <TossBadge variant="weak" size="xsmall" color="blue">영업외 {offHour}</TossBadge>
                      <TossBadge variant="weak" size="xsmall" color="elephant">주말 {weekend}</TossBadge>
                    </>
                  );
                })()}
              </div>
            </div>
            <DataTable columns={frtOver20Columns} data={frtItems} loading={false} className="daily-raw daily-raw-red" />
          </div>
        )}
      </div>
    );
  }

  function renderTaskDetail() {
    const taskMap = new Map((filteredDailyTask || []).map((t: any) => [t.name, t]));
    const owners = (is?.byOwner as any[] || []).filter((o: any) =>
      o.name && !/^[0-9a-zA-Z]/.test(o.name) && (isOwnerNames.has(o.name) || (o.lead ?? 0) > 0)
    );

    return (
      <div>
        {renderMemberChips(is?.members, '#F04452')}
        {/* 직무별 Task 생성 현황 */}
        {renderTeamTaskTable(owners, is?.dailyTask?.byOwner || [])}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 Task 생성 현황</span>
          <TossBadge variant="weak" size="small" color="teal">팀 평균 {avgDailyTask}건/일</TossBadge>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle}>담당자</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>총 Task</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>일평균</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>30건 이상 일수</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>달성도</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o: any) => {
                const task = taskMap.get(o.name);
                const taskAvg = task?.avgDaily ?? 0;
                const daysOver30 = task?.daysOver30 ?? 0;
                const totalTasks = task?.totalTasks ?? 0;
                return (
                  <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, color: '#191F28' }}>{totalTasks}건</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={taskAvg >= 30 ? 'weak' : 'fill'} size="xsmall" color={taskAvg >= 30 ? 'green' : taskAvg >= 20 ? 'yellow' : 'red'}>
                        {typeof taskAvg === 'number' ? taskAvg.toFixed(1) : taskAvg}건
                      </TossBadge>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span style={{ fontWeight: 600, color: '#191F28' }}>{daysOver30}일</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {renderTaskBar(taskAvg)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderTaskBar(avgDaily: number) {
    const pct = Math.min((avgDaily / 30) * 100, 100);
    const color = avgDaily >= 30 ? '#20C997' : avgDaily >= 20 ? '#FFC426' : '#F04452';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '80px', height: '8px', background: '#F2F4F6', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
        </div>
        <span style={{ fontSize: '14px', color: '#8B95A1', fontWeight: 500 }}>{Math.round(pct)}%</span>
      </div>
    );
  }

  function renderVisitDetail() {
    const owners = (is?.byOwner as any[] || []).filter((o: any) =>
      o.name && !/^[0-9a-zA-Z]/.test(o.name) && (isOwnerNames.has(o.name) || (o.lead ?? 0) > 0)
    );
    const noVisitItems = rawData?.noVisitSQL || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {renderMemberChips(is?.members, '#F04452')}
        {/* 직무별 방문 현황 */}
        {renderTeamVisitTable(owners)}

        {/* 담당자별 방문 현황 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 방문 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>방문 완료</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>방문 총건</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>완료율</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o: any) => {
                  const rate = o.visitRate ?? 0;
                  return (
                    <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                      <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: '#191F28' }}>{o.visitConverted ?? 0}건</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ color: '#6B7684' }}>{o.visitTotal ?? 0}건</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <TossBadge variant={rate >= 90 ? 'weak' : 'fill'} size="xsmall" color={rate >= 90 ? 'green' : rate >= 70 ? 'yellow' : 'red'}>
                          {rate}%
                        </TossBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 방문 미완료 SQL Raw 데이터 */}
        {noVisitItems.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>방문 미완료 SQL</span>
                <TossBadge variant="fill" size="small" color="red">{noVisitItems.length}건</TossBadge>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <TossBadge variant="weak" size="xsmall" color="yellow">
                  계류 {noVisitItems.filter((r: any) => r.group === 'open').length}
                </TossBadge>
                <TossBadge variant="weak" size="xsmall" color="elephant">
                  종료 {noVisitItems.filter((r: any) => r.group === 'closed').length}
                </TossBadge>
              </div>
            </div>
            <DataTable columns={noVisitSQLColumns} data={noVisitItems} loading={false} className="daily-raw daily-raw-purple" />
          </div>
        )}
      </div>
    );
  }

  function renderSQLDetail() {
    const owners = (is?.byOwner as any[] || []).filter((o: any) =>
      o.name && !/^[0-9a-zA-Z]/.test(o.name) && (isOwnerNames.has(o.name) || (o.lead ?? 0) > 0)
    );
    const unconvertedItems = rawData?.unconvertedMQL || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {renderMemberChips(is?.members, '#F04452')}
        {/* 직무별 SQL 전환 현황 */}
        {renderTeamSQLTable(owners)}

        {/* 담당자별 SQL 전환 현황 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 SQL 전환 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Lead</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>MQL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o: any) => {
                  const rate = o.sqlConversionRate ?? 0;
                  return (
                    <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                      <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ color: '#6B7684' }}>{o.lead ?? 0}건</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ fontWeight: 600, color: '#191F28' }}>{o.mql ?? 0}건</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: '#191F28' }}>{o.sql ?? 0}건</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <TossBadge variant={rate >= 90 ? 'weak' : 'fill'} size="xsmall" color={rate >= 90 ? 'green' : rate >= 70 ? 'yellow' : 'red'}>
                          {rate}%
                        </TossBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 미전환 MQL Raw 데이터 */}
        {unconvertedItems.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>미전환 MQL 상세</span>
                <TossBadge variant="fill" size="small" color="yellow">{unconvertedItems.length}건</TossBadge>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <TossBadge variant="weak" size="xsmall" color="yellow">
                  계류 {unconvertedItems.filter((r: any) => r.group === 'open').length}
                </TossBadge>
                <TossBadge variant="weak" size="xsmall" color="elephant">
                  종료 {unconvertedItems.filter((r: any) => r.group === 'closed').length}
                </TossBadge>
              </div>
            </div>
            <DataTable columns={unconvertedMQLColumns} data={unconvertedItems} loading={false} className="daily-raw daily-raw-orange" />
          </div>
        )}
      </div>
    );
  }

  // ============ FS/BO 공통 렌더러 ============

  const cwBadge = (v: number) => v > 0
    ? <TossBadge variant="weak" size="xsmall" color="green">{v}건</TossBadge>
    : <span style={{ color: '#B0B8C1' }}>0</span>;

  const clBadge = (v: number) => v > 0
    ? <TossBadge variant="weak" size="xsmall" color="red">{v}건</TossBadge>
    : <span style={{ color: '#B0B8C1' }}>0</span>;

  const cwRateBadge = (v: number) => (
    <TossBadge variant={v >= 60 ? 'weak' : 'fill'} size="xsmall" color={v >= 60 ? 'green' : v >= 40 ? 'yellow' : 'red'}>{v}%</TossBadge>
  );

  const boStageBadge = (v: string) => {
    if (!v) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const colors: Record<string, { bg: string; color: string }> = {
      '미팅확정': { bg: '#e3f2fd', color: '#1565c0' },
      '제안': { bg: '#fff3e0', color: '#e65100' },
      '계약': { bg: '#e8f5e9', color: '#2e7d32' },
      'Closed Won': { bg: '#e8f5e9', color: '#1b5e20' },
      'Closed Lost': { bg: '#ffebee', color: '#b71c1c' },
    };
    const c = colors[v] || { bg: '#f5f5f5', color: '#666' };
    return <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.95em', fontWeight: 600, background: c.bg, color: c.color, whiteSpace: 'nowrap' as const }}>{v}</span>;
  };

  const contractBadge = (v: boolean) => v
    ? <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.92em', fontWeight: 700, background: '#e3f2fd', color: '#1565c0' }}>있음</span>
    : <span style={{ color: '#B0B8C1' }}>-</span>;

  const companyStatusBadge = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    const colors: Record<string, { bg: string; color: string }> = {
      '운영중': { bg: '#e8f5e9', color: '#2e7d32' },
      '폐업': { bg: '#ffebee', color: '#c62828' },
      '휴업': { bg: '#fff3e0', color: '#e65100' },
    };
    const c = colors[v] || { bg: '#f5f5f5', color: '#666' };
    return <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.95em', fontWeight: 600, background: c.bg, color: c.color }}>{v}</span>;
  };

  const resultBadge = (v: string) => {
    if (v === 'Closed Won') return <span style={{ padding: '3px 10px', borderRadius: '10px', fontWeight: 700, background: '#e8f5e9', color: '#1b5e20', fontSize: '0.95em' }}>CW</span>;
    if (v === 'Closed Lost') return <span style={{ padding: '3px 10px', borderRadius: '10px', fontWeight: 700, background: '#ffebee', color: '#b71c1c', fontSize: '0.95em' }}>CL</span>;
    return <span>{v || '-'}</span>;
  };

  const daysElapsedRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const bg = v > 14 ? '#b71c1c' : v > 7 ? '#e53935' : v > 3 ? '#ff7043' : v <= 1 ? '#66bb6a' : '#ffa726';
    return <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.95em', fontWeight: 700, background: bg, color: '#fff' }}>{v}일</span>;
  };

  // 과업 셀 클릭 핸들러
  const openTaskModal = (row: any) => {
    if (row.tasks && row.tasks.length > 0) {
      setTaskModal({ oppName: row.name, tasks: row.tasks });
    }
  };

  const visitDateRender = (_: any, row: any) => {
    const completeDate = row.visitCompleteDate;
    const scheduleDate = row.visitScheduleDate;
    if (completeDate) {
      return (
        <span style={{ padding: '3px 10px', borderRadius: '10px', fontWeight: 700, background: '#e8f5e9', color: '#1b5e20', fontSize: '0.95em', whiteSpace: 'nowrap' as const }}>
          {completeDate}
        </span>
      );
    }
    if (scheduleDate) {
      return (
        <span style={{ padding: '3px 10px', borderRadius: '10px', fontWeight: 600, background: '#e3f2fd', color: '#1565c0', fontSize: '0.92em', whiteSpace: 'nowrap' as const }}>
          {scheduleDate} <span style={{ fontSize: '0.85em' }}>예정</span>
        </span>
      );
    }
    return <span style={{ color: '#B0B8C1' }}>-</span>;
  };

  // 생성→방문 소요일 렌더러 (짧을수록 좋음)
  const daysToVisitRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const bg = v <= 1 ? '#66bb6a' : v <= 3 ? '#ffa726' : v <= 7 ? '#ff7043' : '#e53935';
    return <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.95em', fontWeight: 700, background: bg, color: '#fff', whiteSpace: 'nowrap' as const }}>{v}일</span>;
  };

  const visitDurationRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#B0B8C1' }}>-</span>;
    const h = Math.floor(v / 60); const m = v % 60;
    const text = h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
    const bg = v >= 60 ? '#e8f5e9' : v >= 30 ? '#fff3e0' : '#ffebee';
    const color = v >= 60 ? '#2e7d32' : v >= 30 ? '#e65100' : '#c62828';
    return <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.95em', fontWeight: 600, background: bg, color }}>{text}</span>;
  };

  const boReasonBadge = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    const label = lossReasonLabelMap[v] || v;
    return <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '0.95em', fontWeight: 600, background: '#fce4ec', color: '#c62828' }}>{label}</span>;
  };

  const boNextTaskRender = (_: any, row: any) => {
    const d = row.nextTaskDate;
    const s = row.nextTaskSubject;
    if (!d && !s) return <span style={{ color: '#B0B8C1' }}>-</span>;
    return <span style={{ fontSize: '0.95em', color: '#4E5968' }}>{s && s !== '-' ? s : ''}{d && d !== '-' ? ` (${d})` : ''}</span>;
  };

  const boLastTaskRender = (_: any, row: any) => {
    const d = row.lastTaskDate;
    if (!d || d === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (diff >= 7) return <TossBadge variant="weak" size="xsmall" color="red">{d}</TossBadge>;
    return <span style={{ fontSize: '0.95em', color: '#4E5968' }}>{d}</span>;
  };

  // Raw 테이블용 과업 렌더러 (date + subject + taskCount) — 클릭 시 모달
  const rawLastTaskRender = (_: any, row: any) => {
    const date = row.lastTaskDate;
    const subject = row.lastTaskSubject;
    const count = row.taskCount || 0;
    const hasTasks = row.tasks && row.tasks.length > 0;
    if (!date || date === '-') {
      if (hasTasks) return (
        <span onClick={() => openTaskModal(row)} style={{ color: '#8B95A1', fontSize: '0.95em', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' as const }}>
          📋 {count}건
        </span>
      );
      return <span style={{ color: '#B0B8C1' }}>-</span>;
    }
    return (
      <div onClick={() => openTaskModal(row)} style={{ lineHeight: 1.4, cursor: hasTasks ? 'pointer' : 'default' }}>
        <div style={{ fontSize: '1.0em', fontWeight: 600, color: '#333D4B', whiteSpace: 'nowrap' as const }}>{date}</div>
        {subject && subject !== '-' && (
          <div style={{ fontSize: '0.88em', color: '#8B95A1', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={subject}>{subject}</div>
        )}
        {count > 0 && <div style={{ fontSize: '0.88em', color: '#3182F6', marginTop: '1px' }}>📋 {count}건</div>}
      </div>
    );
  };

  const rawNextTaskRender = (_: any, row: any) => {
    const date = row.nextTaskDate;
    const subject = row.nextTaskSubject;
    const hasTasks = row.tasks && row.tasks.length > 0;
    if (!date || date === '-') {
      return (
        <span onClick={hasTasks ? () => openTaskModal(row) : undefined} style={{ cursor: hasTasks ? 'pointer' : 'default' }}>
          <TossBadge variant="fill" size="xsmall" color="red">과업 없음</TossBadge>
        </span>
      );
    }
    return (
      <div onClick={() => openTaskModal(row)} style={{ lineHeight: 1.4, cursor: hasTasks ? 'pointer' : 'default' }}>
        <div style={{ fontSize: '1.0em', fontWeight: 700, color: '#3182F6', whiteSpace: 'nowrap' as const }}>{date}</div>
        {subject && subject !== '-' && (
          <div style={{ fontSize: '0.88em', color: '#8B95A1', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={subject}>{subject}</div>
        )}
        {hasTasks && <div style={{ fontSize: '0.88em', color: '#3182F6', marginTop: '1px' }}>📋 {row.taskCount || 0}건</div>}
      </div>
    );
  };

  // ============ Field Sales 데이터 ============

  const fsUsers = useMemo(() => {
    const raw = fs?.cwConversionRate?.byUser || [];
    return raw.map((u: any) => {
      const coCW = u.carryoverCW ?? 0;
      const allCW = (u.thisMonthCW ?? 0) + coCW;
      return {
        ...u,
        thisMonthCWRate: u.cwRate ?? 0,
        combinedCWRate: u.total > 0 ? +((allCW / u.total) * 100).toFixed(1) : 0,
      };
    });
  }, [fs]);

  const fsTotalSQL = fsUsers.reduce((s: number, u: any) => s + (u.total ?? 0), 0);
  const fsTotalCW = fsUsers.reduce((s: number, u: any) => s + (u.thisMonthCW ?? 0), 0);
  const fsOverallCWRate = fsTotalSQL > 0 ? +((fsTotalCW / fsTotalSQL) * 100).toFixed(1) : 0;
  const fsGoldenTimeStale = fs?.goldenTime?.staleCount ?? fs?.goldenTime?.stale8plus ?? 0;
  const fsGoldenTimeTotal = fs?.goldenTime?.total ?? 0;
  const fsStaleVisitTotal = fs?.staleVisit?.total ?? 0;
  const fsStaleVisitOver14 = fs?.staleVisit?.over14 ?? 0;
  const fsObsTotal = fs?.obsLeadCount?.total ?? fs?.obsLeadCount ?? 0;

  const fsFlowSteps: FlowStep[] = useMemo(() => {
    if (!fs) return [];
    return [
      {
        key: 'goldenTime', label: 'Golden Time', value: `${fsGoldenTimeStale}건`,
        detail: `8일+ 미터치 / 전체 ${fsGoldenTimeTotal}건`,
        target: '목표 0건', met: fsGoldenTimeStale === 0,
        color: fsGoldenTimeStale === 0 ? 'green' : 'red', rawCount: fs?.goldenTime?.violations?.length ?? 0, icon: '⏰',
      },
      {
        key: 'staleVisit', label: '방문후 관리', value: `${fsStaleVisitTotal}건`,
        detail: `7일+ 경과 / 14일+ ${fsStaleVisitOver14}건`,
        target: '목표 0건', met: fsStaleVisitTotal === 0,
        color: fsStaleVisitTotal === 0 ? 'green' : 'red', rawCount: fs?.staleVisit?.opps?.length ?? 0, icon: '🏠',
      },
      {
        key: 'obsLead', label: 'OBS Lead', value: `${fsObsTotal}건`,
        detail: '필드 생산 Lead',
        target: '목표 200건', met: fsObsTotal >= 200,
        color: fsObsTotal >= 200 ? 'green' : 'red', rawCount: 0, icon: '📊',
      },
      {
        key: 'fsCW', label: 'CW 전환율', value: `${fsOverallCWRate}%`,
        detail: `SQL ${fsTotalSQL}건 중 CW ${fsTotalCW}건`,
        target: '목표 60%', met: fsOverallCWRate >= 60,
        color: fsOverallCWRate >= 60 ? 'green' : 'blue', rawCount: fs?.rawData?.rawOpenOpps?.length ?? 0, icon: '🎯',
      },
    ];
  }, [fs, fsGoldenTimeStale, fsGoldenTimeTotal, fsStaleVisitTotal, fsStaleVisitOver14, fsObsTotal, fsOverallCWRate, fsTotalSQL, fsTotalCW]);

  // FS 컬럼 정의
  const goldenTimeViolationColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => ownerBold(v) },
    { key: 'stageName', header: '단계', render: (v: string) => boStageBadge(v) },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'visitDurationMin', header: '방문소요', align: 'right' as const, render: visitDurationRender },
    { key: 'daysSinceLastTask', header: '미터치일수', align: 'right' as const, render: (v: number) => daysElapsedRender(v) },
    { key: 'ageInDays', header: 'Opp경과', align: 'right' as const, render: (v: number) => daysElapsedRender(v) },
  ];

  const staleVisitColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => ownerBold(v) },
    { key: 'stageName', header: '단계', render: (v: string) => boStageBadge(v) },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'visitDurationMin', header: '방문소요', align: 'right' as const, render: visitDurationRender },
    { key: 'daysSinceVisit', header: '경과일', align: 'right' as const, render: (v: number) => daysElapsedRender(v) },
  ];

  const fsRawOpenOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => ownerBold(v) },
    { key: 'stageName', header: '단계', render: (v: string) => boStageBadge(v) },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'daysToVisit', header: '생성→방문', align: 'right' as const, render: daysToVisitRender },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'closeDate', header: '마감일' },
    { key: 'lastTaskDate', header: '최근 과업', render: rawLastTaskRender },
    { key: 'nextTaskDate', header: '다음 과업', render: rawNextTaskRender },
  ];

  // FS 상세 패널
  function renderFSGoldenTimeDetail() {
    const violations = fs?.goldenTime?.violations || [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 전환 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>진행중</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                </tr>
              </thead>
              <tbody>
                {fsUsers.map((u: any) => (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.total ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.thisMonthCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{clBadge(u.thisMonthCL ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.open ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.thisMonthCWRate ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {violations.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>Golden Time 위반 (8일+ 미터치)</span>
              <TossBadge variant="fill" size="small" color="red">{violations.length}건</TossBadge>
            </div>
            <DataTable columns={goldenTimeViolationColumns} data={violations} loading={false} className="daily-raw daily-raw-red" />
          </div>
        )}
      </div>
    );
  }

  function renderFSStaleVisitDetail() {
    const opps = fs?.staleVisit?.opps || [];
    return (
      <div>
        {opps.length > 0 ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>방문후 미관리 (7일+)</span>
              <TossBadge variant="fill" size="small" color="red">{opps.length}건</TossBadge>
              <TossBadge variant="weak" size="xsmall" color="red">14일+ {fsStaleVisitOver14}건</TossBadge>
            </div>
            <DataTable columns={staleVisitColumns} data={opps} loading={false} className="daily-raw daily-raw-red" />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#8B95A1' }}>
            <div style={{ fontSize: '2em', marginBottom: '8px' }}>✅</div>
            방문후 미관리 건이 없습니다
          </div>
        )}
      </div>
    );
  }

  function renderFSOBSDetail() {
    const byUser = fs?.obsLeadCount?.byUser || [];
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 OBS Lead 현황</span>
          <TossBadge variant="weak" size="small" color={fsObsTotal >= 200 ? 'green' : 'red'}>합계 {fsObsTotal}건</TossBadge>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle}>담당자</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>OBS Lead</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(byUser) ? byUser : []).map((u: any) => (
                <tr key={u.name || u.fieldUser} style={{ borderBottom: '1px solid #F2F4F6' }}>
                  <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name || u.fieldUser}</span></td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: '#191F28' }}>{u.count ?? u.total ?? 0}건</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderFSCWDetail() {
    const openOpps = fs?.rawData?.rawOpenOpps || [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 전환 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>진행중</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>이월CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>합산전환율</th>
                </tr>
              </thead>
              <tbody>
                {fsUsers.map((u: any) => (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.total ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.thisMonthCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{clBadge(u.thisMonthCL ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.open ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.thisMonthCWRate ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.carryoverCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.combinedCWRate ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {openOpps.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>진행중 Opportunity</span>
              <TossBadge variant="weak" size="small" color="blue">{openOpps.length}건</TossBadge>
            </div>
            <DataTable columns={fsRawOpenOppColumns} data={openOpps} loading={false} className="daily-raw daily-raw-blue" />
          </div>
        )}
      </div>
    );
  }

  const fsDetailRenderers = [renderFSGoldenTimeDetail, renderFSStaleVisitDetail, renderFSOBSDetail, renderFSCWDetail];

  // ============ Back Office 데이터 ============

  const boUsers = useMemo(() => {
    const raw = ibo?.cwConversionRate?.byUser || [];
    // 데이터 소스별 맵 생성
    const contractByBO: Record<string, any> = {};
    (ibo?.contractSummary?.byBO || []).forEach((b: any) => { contractByBO[b.name] = b; });
    const cwByBO: Record<string, any> = {};
    (ibo?.cwWithCarryover?.byUser || []).forEach((u: any) => { cwByBO[u.name] = u; });
    const dcByBO: Record<string, any> = {};
    (ibo?.dailyClose?.byUser || []).forEach((u: any) => { dcByBO[u.name] = u; });
    const blByBO: Record<string, any> = {};
    (ibo?.sqlBacklog?.byUser || []).forEach((u: any) => { blByBO[u.name] = u; });

    return raw.map((u: any) => {
      const coCW = u.carryoverCW ?? 0;
      const allCW = (u.thisMonthCW ?? 0) + coCW;
      const ct = contractByBO[u.name] || {};
      const dc = dcByBO[u.name] || {};
      const bl = blByBO[u.name] || {};
      return {
        ...u,
        thisMonthCWRate: u.cwRate ?? 0,
        combinedCWRate: u.total > 0 ? +((allCW / u.total) * 100).toFixed(1) : 0,
        avgDailyClose: dc.avgDailyClose ?? 0,
        avgDailyCloseThisMonth: dc.avgDailyCloseThisMonth ?? 0,
        avgDailyCloseCarryover: dc.avgDailyCloseCarryover ?? 0,
        over7: bl.over7 ?? 0,
        contracts: ct.total ?? 0,
        contractsNew: ct.new ?? 0,
        contractsNewCarryover: ct.newCarryover ?? 0,
        contractsAddInstall: ct.addInstall ?? 0,
        contractTablets: ct.tablets ?? 0,
      };
    });
  }, [ibo]);

  const boTotalSQL = boUsers.reduce((s: number, u: any) => s + (u.total ?? 0), 0);
  const boTotalCW = boUsers.reduce((s: number, u: any) => s + (u.thisMonthCW ?? 0), 0);
  const boTotalCWCarryover = boUsers.reduce((s: number, u: any) => s + (u.carryoverCW ?? 0), 0);
  const boTotalCWAll = boTotalCW + boTotalCWCarryover;
  const boOverallCWRate = boTotalSQL > 0 ? +((boTotalCW / boTotalSQL) * 100).toFixed(1) : 0;
  const boOverallCWRateAll = boTotalSQL > 0 ? +((boTotalCWAll / boTotalSQL) * 100).toFixed(1) : 0;
  const boAvgDailyClose = useMemo(() => {
    const byUser = ibo?.dailyClose?.byUser || [];
    if (byUser.length === 0) return '-';
    return (byUser.reduce((s: number, u: any) => s + (u.avgDailyClose ?? 0), 0) / byUser.length).toFixed(1);
  }, [ibo]);
  const boAvgDailyCloseThisMonth = useMemo(() => {
    const byUser = ibo?.dailyClose?.byUser || [];
    if (byUser.length === 0) return '-';
    return (byUser.reduce((s: number, u: any) => s + (u.avgDailyCloseThisMonth ?? 0), 0) / byUser.length).toFixed(1);
  }, [ibo]);
  const boAvgDailyCloseCarryover = useMemo(() => {
    const byUser = ibo?.dailyClose?.byUser || [];
    if (byUser.length === 0) return '-';
    return (byUser.reduce((s: number, u: any) => s + (u.avgDailyCloseCarryover ?? 0), 0) / byUser.length).toFixed(1);
  }, [ibo]);
  const boCW = ibo?.cwWithCarryover;
  const boCarryoverRate = boCW?.totalCW > 0 ? +((boCW.totalCarryoverCW / boCW.totalCW) * 100).toFixed(0) : 0;

  const boFlowSteps: FlowStep[] = useMemo(() => {
    if (!ibo) return [];
    return [
      {
        key: 'dailyClose', label: '일평균 마감', value: `${boAvgDailyClose}`,
        detail: `이번달 ${boAvgDailyCloseThisMonth} + 이월 ${boAvgDailyCloseCarryover}`,
        target: '목표 5건', met: boAvgDailyClose !== '-' && parseFloat(boAvgDailyClose as string) >= 5,
        color: (boAvgDailyClose !== '-' && parseFloat(boAvgDailyClose as string) >= 5) ? 'green' : 'red',
        rawCount: 0, icon: '📅',
      },
      {
        key: 'sqlBacklog', label: 'SQL 잔량 (7일+)', value: `${ibo?.sqlBacklog?.totalOver7 ?? 0}건`,
        detail: `전체 진행중 ${ibo?.sqlBacklog?.totalOpen ?? 0}건`,
        target: '목표 ≤10건', met: (ibo?.sqlBacklog?.totalOver7 ?? 999) <= 10,
        color: (ibo?.sqlBacklog?.totalOver7 ?? 999) <= 10 ? 'green' : 'red',
        rawCount: ibo?.rawData?.rawOpenOpps?.length ?? 0, icon: '📦',
      },
      {
        key: 'carryover', label: '이월 비중', value: `${boCarryoverRate}%`,
        detail: `이월 ${boCW?.totalCarryoverCW ?? 0} / 전체 ${boCW?.totalCW ?? 0}`,
        target: '낮을수록 좋음', met: boCarryoverRate < 50,
        color: boCarryoverRate < 50 ? 'teal' : 'red', rawCount: 0, icon: '🔄',
      },
      {
        key: 'boCW', label: 'CW 전환율', value: `${boOverallCWRate}%`,
        detail: `당월 ${boTotalCW} + 이월 ${boTotalCWCarryover} = 합산 ${boTotalCWAll} / SQL ${boTotalSQL} (합산 ${boOverallCWRateAll}%)`,
        target: '목표 60%', met: boOverallCWRate >= 60,
        color: boOverallCWRate >= 60 ? 'green' : 'blue', rawCount: ibo?.rawData?.rawClosedOpps?.length ?? 0, icon: '🎯',
      },
    ];
  }, [ibo, boAvgDailyClose, boAvgDailyCloseThisMonth, boAvgDailyCloseCarryover, boCarryoverRate, boCW, boOverallCWRate, boOverallCWRateAll, boTotalSQL, boTotalCW, boTotalCWCarryover, boTotalCWAll]);

  // BO 단계별 그룹핑
  const stageOrder: Record<string, { order: number; color: string; bg: string }> = {
    '방문배정': { order: 1, color: '#7b1fa2', bg: '#f3e5f5' },
    '견적':     { order: 2, color: '#1565c0', bg: '#e3f2fd' },
    '재견적':   { order: 3, color: '#4527a0', bg: '#ede7f6' },
    '선납금':   { order: 4, color: '#e65100', bg: '#fff3e0' },
    '출고진행': { order: 5, color: '#2e7d32', bg: '#e8f5e9' },
    '설치진행': { order: 6, color: '#1b5e20', bg: '#f1f8e9' },
    '계약진행': { order: 7, color: '#00695c', bg: '#e0f2f1' },
  };

  const groupOppsByStage = (opps: any[]) => {
    const groups: Record<string, any[]> = {};
    opps.forEach(o => {
      const stage = o.stageName || '기타';
      if (!groups[stage]) groups[stage] = [];
      groups[stage].push(o);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => (stageOrder[a]?.order ?? 99) - (stageOrder[b]?.order ?? 99))
      .map(([stage, items]) => ({
        stage,
        items: items.sort((a: any, b: any) => b.ageInDays - a.ageInDays),
        color: stageOrder[stage]?.color || '#555',
        bg: stageOrder[stage]?.bg || '#f5f5f5',
      }));
  };

  // BO 컬럼 정의
  const boRawOpenOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'boUser', header: 'BO담당자', render: (v: string) => ownerBold(v) },
    { key: 'companyStatus', header: '매장상태', render: companyStatusBadge },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'daysToVisit', header: '생성→방문', align: 'right' as const, render: daysToVisitRender },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'daysSinceVisit', header: '방문후(일)', align: 'right' as const, render: (v: number) => daysElapsedRender(v) },
    { key: 'createdDate', header: '생성일' },
    { key: 'ageInDays', header: '경과일', align: 'right' as const, render: (v: number) => daysElapsedRender(v) },
    { key: 'lastTaskDate', header: '최근 과업', render: rawLastTaskRender },
    { key: 'nextTaskDate', header: '다음 과업', render: rawNextTaskRender },
  ];

  const boRawClosedOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'boUser', header: 'BO담당자', render: (v: string) => ownerBold(v) },
    { key: 'stageName', header: '결과', render: resultBadge },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'lossReason', header: '종료사유', render: boReasonBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'closeDate', header: '마감일' },
  ];

  // BO 상세 패널
  function renderBODailyCloseDetail() {
    const byUser = ibo?.dailyClose?.byUser || [];
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 일평균 마감</span>
          <TossBadge variant="weak" size="small" color="teal">팀 평균 {boAvgDailyClose}건/일</TossBadge>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle}>담당자</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>일평균 (전체)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>이번달분</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>이월분</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>달성도</th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((u: any) => {
                const avg = u.avgDailyClose ?? 0;
                const pct = Math.min((avg / 5) * 100, 100);
                const color = avg >= 5 ? '#20C997' : avg >= 3 ? '#FFC426' : '#F04452';
                return (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={avg >= 5 ? 'weak' : 'fill'} size="xsmall" color={avg >= 5 ? 'green' : avg >= 3 ? 'yellow' : 'red'}>
                        {avg.toFixed(1)}건
                      </TossBadge>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{(u.avgDailyCloseThisMonth ?? 0).toFixed(1)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{(u.avgDailyCloseCarryover ?? 0).toFixed(1)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                        <div style={{ width: '80px', height: '8px', background: '#F2F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px' }} />
                        </div>
                        <span style={{ fontSize: '14px', color: '#8B95A1' }}>{Math.round(pct)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderBOSQLBacklogDetail() {
    const byUser = ibo?.sqlBacklog?.byUser || [];
    const openOpps = ibo?.rawData?.rawOpenOpps || [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 SQL 잔량</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>7일+ 잔량</th>
                </tr>
              </thead>
              <tbody>
                {byUser.map((u: any) => (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {(u.over7 ?? 0) > 0
                        ? <TossBadge variant="fill" size="xsmall" color="red">{u.over7}건</TossBadge>
                        : <span style={{ color: '#B0B8C1' }}>0건</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {openOpps.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>진행중 Opportunity</span>
              <TossBadge variant="weak" size="small" color="blue">{openOpps.length}건</TossBadge>
            </div>
            {groupOppsByStage(openOpps).map(g => (
              <div key={g.stage} style={{ marginBottom: '4px' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 24px', background: g.bg, borderBottom: `2px solid ${g.color}40`,
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.95em', fontWeight: 700, color: g.color }}>{g.stage}</span>
                  <span style={{ fontSize: '0.88em', color: '#888' }}>{g.items.length}건</span>
                </div>
                <DataTable columns={boRawOpenOppColumns} data={g.items} loading={false} className="daily-raw daily-raw-blue" />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderBOCarryoverDetail() {
    const byUser = boCW?.byUser || [];
    const cs = ibo?.contractSummary;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {cs && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>계약 요약</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {[
                { label: '전체 계약', value: cs.total ?? 0, color: '#3182F6', bg: '#E8F3FF' },
                { label: '신규', value: cs.new ?? 0, color: '#20C997', bg: '#E3FAF0' },
                { label: '추가설치', value: cs.addInstall ?? 0, color: '#8B95A1', bg: '#F2F4F6' },
              ].map(item => (
                <div key={item.label} style={{ flex: '1 1 100px', padding: '14px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
                  <div style={{ fontSize: '14px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: item.color }}>{item.value}건</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 이월 CW 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>전체 CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>이번달 CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>이월 CW</th>
                </tr>
              </thead>
              <tbody>
                {byUser.map((u: any) => (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}><span style={{ fontWeight: 700 }}>{u.totalCW ?? 0}건</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.thisMonthCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {(u.carryoverCW ?? 0) > 0
                        ? <TossBadge variant="weak" size="xsmall" color="elephant">{u.carryoverCW}건</TossBadge>
                        : <span style={{ color: '#B0B8C1' }}>0</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderBOCWDetail() {
    const closedOpps = ibo?.rawData?.rawClosedOpps || [];
    const cwOppsIB = closedOpps.filter((o: any) => o.stageName === 'Closed Won');
    const totalCWIB = cwOppsIB.length;
    const monthStatusDistIB: Record<string, { total: number, open: number, propen: number }> = {};
    cwOppsIB.forEach((o: any) => {
      const m = o.createdMonth || '-';
      if (!monthStatusDistIB[m]) monthStatusDistIB[m] = { total: 0, open: 0, propen: 0 };
      monthStatusDistIB[m].total++;
      if ((o.companyStatus || '').includes('영업중')) monthStatusDistIB[m].open++;
      else if ((o.companyStatus || '').includes('오픈전') || (o.companyStatus || '').includes('오픈 전')) monthStatusDistIB[m].propen++;
    });
    const sortedMonthsIB = Object.entries(monthStatusDistIB).sort((a, b) => a[0].localeCompare(b[0]));
    const maxCountIB = Math.max(...sortedMonthsIB.map(([, d]) => d.total), 1);
    const currentMonthIB = sortedMonthsIB.length > 0 ? sortedMonthsIB[sortedMonthsIB.length - 1][0] : '';
    const threeMonthsAgoIB = (() => {
      if (!currentMonthIB || currentMonthIB === '-') return '0000-00';
      const [y, m] = currentMonthIB.split('-').map(Number);
      const d = new Date(y, m - 1 - 3, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const oldCwOppsIB = cwOppsIB.filter((o: any) => (o.createdMonth || '-') <= threeMonthsAgoIB && (o.createdMonth || '-') !== '-');
    const ibThS = { padding: '8px 10px', textAlign: 'left' as const, fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB', fontSize: '14px', whiteSpace: 'nowrap' as const };
    const ibTdS = { padding: '8px 10px', borderBottom: '1px solid #F2F4F6', fontSize: '14px' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* CW 생성월 분포 */}
        {sortedMonthsIB.length > 0 && (
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '4px' }}>CW 생성월 분포</div>
            <div style={{ fontSize: '13px', color: '#8B95A1', marginBottom: '16px' }}>이번달 마감된 CW {totalCWIB}건의 Opportunity 생성월 분석</div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '12px', color: '#6B7684' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#20C997', display: 'inline-block' }} /> 영업중</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#FFA726', display: 'inline-block' }} /> 오픈전</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#B0B8C1', display: 'inline-block' }} /> 기타</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sortedMonthsIB.map(([month, dist]) => {
                const count = dist.total;
                const pct = +((count / totalCWIB) * 100).toFixed(1);
                const barPct = Math.round((count / maxCountIB) * 100);
                const isCurrentMonth = month === currentMonthIB;
                const isOld = month <= threeMonthsAgoIB && month !== '-';
                const openPct = count > 0 ? (dist.open / count) * 100 : 0;
                const preopenPct = count > 0 ? (dist.propen / count) * 100 : 0;
                return (
                  <div key={month} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ width: '80px', fontSize: '14px', fontWeight: 600, color: isCurrentMonth ? '#3182F6' : isOld ? '#c62828' : '#191F28', textAlign: 'right' }}>
                      {month}
                    </span>
                    <div style={{ flex: 1, height: '28px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden', position: 'relative', display: 'flex' }}>
                      <div style={{ width: `${barPct * openPct / 100}%`, height: '100%', background: '#20C997' }} />
                      <div style={{ width: `${barPct * preopenPct / 100}%`, height: '100%', background: '#FFA726' }} />
                      <div style={{ width: `${barPct * (100 - openPct - preopenPct) / 100}%`, height: '100%', background: isOld ? '#F04452' : '#B0B8C1' }} />
                      <span style={{
                        position: 'absolute', left: `${Math.min(barPct + 1, 85)}%`, top: '50%',
                        transform: 'translateY(-50%)', fontSize: '13px', fontWeight: 700,
                        color: '#191F28', whiteSpace: 'nowrap',
                      }}>
                        {count}건 ({pct}%) — 영업중 {dist.open} · 오픈전 {dist.propen}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 3개월+ 이전 생성 CW */}
        {oldCwOppsIB.length > 0 && (() => {
          const sorted = [...oldCwOppsIB].sort((a: any, b: any) => (a.createdMonth || '').localeCompare(b.createdMonth || ''));
          const oldHeaders = [
            { label: '영업기회', align: 'left' },
            { label: '담당자', align: 'left' },
            { label: '생성월', align: 'center' },
            { label: '매장', align: 'center' },
            { label: 'CW 마감일', align: 'center' },
          ];
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>3개월+ 이전 생성 CW</span>
                <TossBadge variant="fill" size="small" color="red">{oldCwOppsIB.length}건</TossBadge>
                <span style={{ fontSize: '13px', color: '#8B95A1' }}>{threeMonthsAgoIB} 이전 생성된 Opportunity</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      {oldHeaders.map(h => (
                        <th key={h.label} style={{ ...ibThS, textAlign: h.align as any }}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((o: any, idx: number) => (
                      <tr key={o.oppId || idx} style={{ background: '#FFF8E1' }}>
                        <td style={{ ...ibTdS, minWidth: '200px' }}>
                          {sfOppLink(
                            (o.name || o.oppId || '').length > 30 ? (o.name || o.oppId || '').substring(0, 30) + '…' : (o.name || o.oppId),
                            o
                          )}
                        </td>
                        <td style={{ ...ibTdS }}>{o.boUser || '-'}</td>
                        <td style={{ ...ibTdS, textAlign: 'center' }}>
                          <TossBadge variant="fill" size="xsmall" color="red">{o.createdMonth}</TossBadge>
                        </td>
                        <td style={{ ...ibTdS, textAlign: 'center' }}>{companyStatusBadge(o.companyStatus)}</td>
                        <td style={{ ...ibTdS, textAlign: 'center', fontSize: '13px', color: '#4E5968' }}>{o.changeDate || o.closeDate || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
        {/* 담당자별 전환 현황 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 전환 현황</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>진행중</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>이월CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>합산전환율</th>
                </tr>
              </thead>
              <tbody>
                {boUsers.map((u: any) => (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.total ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.thisMonthCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{clBadge(u.thisMonthCL ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.open ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.thisMonthCWRate ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.carryoverCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.combinedCWRate ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {closedOpps.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>종료 Opportunity</span>
              <TossBadge variant="weak" size="small" color="elephant">{closedOpps.length}건</TossBadge>
            </div>
            <DataTable columns={boRawClosedOppColumns} data={closedOpps} loading={false} className="daily-raw" />
          </div>
        )}
      </div>
    );
  }

  const boDetailRenderers = [renderBODailyCloseDetail, renderBOSQLBacklogDetail, renderBOCarryoverDetail, renderBOCWDetail];

  // ============ Channel Sales 데이터 ============

  const csKpi = csData?.kpi;
  const csSummary = csData?.summary;
  const csMouStats = csData?.mouStats;
  const csPartnerStats = csData?.partnerStats;
  const csFranchiseHQList = csData?.franchiseHQList;

  // 브랜드 ID → 본사 이름/MOU 정보 매핑 (프랜차이즈 Event 매칭용)
  const brandIdMap = useMemo(() => {
    const map: Record<string, { hqName: string; hqId: string; mouStart: string; owner: string }> = {};
    (csFranchiseHQList || []).forEach((hq: any) => {
      (hq.brands || []).forEach((b: any) => {
        map[b.id] = { hqName: hq.hqName, hqId: hq.hqId, mouStart: hq.mouStart, owner: hq.owner };
      });
    });
    return map;
  }, [csFranchiseHQList]);

  // 네고 체류 Account enrichment (Task 매칭)
  const negoAccountsEnriched = useMemo(() => {
    if (!csData?.rawData) return [];
    const partners = csData.rawData.partners || [];
    const hqAccounts = csData.rawData.franchiseHQAccounts || [];
    const allAccounts = [...partners, ...hqAccounts];
    const negoAccounts = allAccounts.filter((a: any) => a.Progress__c === 'Negotiation');

    // Task 맵 구성: WhatId → tasks[]
    const tasks = csData.rawData.channelTasks || [];
    const taskMap: Record<string, any[]> = {};
    tasks.forEach((t: any) => {
      if (!taskMap[t.WhatId]) taskMap[t.WhatId] = [];
      taskMap[t.WhatId].push(t);
    });

    // Event 맵 구성
    const events = csData.rawData.channelEvents || [];
    const eventMap: Record<string, any[]> = {};
    events.forEach((e: any) => {
      if (!eventMap[e.WhatId]) eventMap[e.WhatId] = [];
      eventMap[e.WhatId].push(e);
    });

    const now = new Date();
    const thisMonth = month || '';  // 선택된 월 (예: '2026-03')
    return negoAccounts.map((a: any) => {
      const acctTasks = (taskMap[a.Id] || []).sort((x: any, y: any) =>
        new Date(y.CreatedDate).getTime() - new Date(x.CreatedDate).getTime()
      );
      const acctEvents = (eventMap[a.Id] || []).sort((x: any, y: any) =>
        new Date(y.CreatedDate).getTime() - new Date(x.CreatedDate).getTime()
      );

      // 이번달 기준 필터
      const thisMonthTasks = acctTasks.filter((t: any) => t.CreatedDate?.substring(0, 7) === thisMonth);
      const thisMonthEvents = acctEvents.filter((e: any) => e.ActivityDate?.substring(0, 7) === thisMonth);

      const lastTask = acctTasks[0];
      const lastEvent = acctEvents[0];
      const lastDate = lastTask?.CreatedDate || lastEvent?.CreatedDate;
      const daysSince = lastDate
        ? Math.floor((now.getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // 마지막 활동: Task와 Event 중 더 최근 것
      const lastTaskTime = lastTask ? new Date(lastTask.CreatedDate).getTime() : 0;
      const lastEventTime = lastEvent ? new Date(lastEvent.CreatedDate).getTime() : 0;
      const lastActivityDate = lastTaskTime >= lastEventTime
        ? lastTask?.CreatedDate?.split('T')[0] || '-'
        : lastEvent?.CreatedDate?.split('T')[0] || '-';
      const lastActivitySubject = lastTaskTime >= lastEventTime
        ? lastTask?.Subject || '-'
        : lastEvent?.Subject || '-';
      const lastActivityType = lastTaskTime >= lastEventTime
        ? (lastTask ? 'task' : null)
        : (lastEvent ? 'event' : null);

      return {
        id: a.Id,
        name: a.Name,
        owner: a.Owner?.Name || '-',
        type: a.fm_AccountType__c || '-',
        createdDate: a.CreatedDate?.split('T')[0] || '-',
        taskCount: acctTasks.length,
        eventCount: acctEvents.length,
        taskCountThisMonth: thisMonthTasks.length,
        eventCountThisMonth: thisMonthEvents.length,
        lastActivityDate,
        lastActivitySubject,
        lastActivityType,
        daysSince,
      };
    }).sort((a: any, b: any) => {
      // 활동없음 먼저, 그다음 오래된순
      if (a.daysSince === null && b.daysSince !== null) return -1;
      if (b.daysSince === null && a.daysSince !== null) return 1;
      if (a.daysSince === null && b.daysSince === null) {
        return new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime();
      }
      return (b.daysSince ?? 0) - (a.daysSince ?? 0);
    });
  }, [csData, month]);

  // AE 플로우 — 3스텝 (미팅 → 네고 체류 → MOU 체결)
  // 네고 체류 Account에서 집계한 미팅(Event) / Task 합산 — 이번달 기준
  const negoMeetingThisMonth = useMemo(() =>
    negoAccountsEnriched.reduce((s: number, a: any) => s + a.eventCountThisMonth, 0), [negoAccountsEnriched]);
  const negoTaskThisMonth = useMemo(() =>
    negoAccountsEnriched.reduce((s: number, a: any) => s + a.taskCountThisMonth, 0), [negoAccountsEnriched]);
  const negoWithMeetingThisMonth = useMemo(() =>
    negoAccountsEnriched.filter((a: any) => a.eventCountThisMonth > 0).length, [negoAccountsEnriched]);
  // 전체 기간 합산 (참고용)
  const negoMeetingTotal = useMemo(() =>
    negoAccountsEnriched.reduce((s: number, a: any) => s + a.eventCount, 0), [negoAccountsEnriched]);
  const negoTaskTotal = useMemo(() =>
    negoAccountsEnriched.reduce((s: number, a: any) => s + a.taskCount, 0), [negoAccountsEnriched]);

  // AE 관련 이번달 미팅 Raw 데이터 (MOU미완료 + 네고 Account 합집합)
  const aeMeetingRawThisMonth = useMemo(() => {
    if (!csData?.rawData?.channelEvents) return [];
    const thisMonth = month || '';
    const allAccounts = [
      ...(csData.rawData.partners || []),
      ...(csData.rawData.franchiseHQAccounts || []),
    ];
    // MOU미완료 Account IDs
    const nonMouIds = new Set(allAccounts.filter((a: any) => !a.MOUstartdate__c).map((a: any) => a.Id));
    // MOU미완료 브랜드 IDs도 추가
    Object.entries(brandIdMap).forEach(([brandId, info]) => {
      if (!info.mouStart || info.mouStart === '-') nonMouIds.add(brandId);
    });
    // 네고 Account IDs
    const negoIds = new Set(negoAccountsEnriched.map((a: any) => a.id));
    // AE 관련 = MOU미완료 OR 네고 (합집합 → 중복 제거)
    const aeAccountIds = new Set([...nonMouIds, ...negoIds]);
    const nameMap: Record<string, string> = {};
    allAccounts.forEach((a: any) => { nameMap[a.Id] = a.Name; });
    // 브랜드 ID → 본사 이름 매핑 추가
    Object.entries(brandIdMap).forEach(([brandId, info]) => {
      if (!nameMap[brandId]) nameMap[brandId] = info.hqName;
    });

    return (csData.rawData.channelEvents as any[])
      .filter((e: any) => aeAccountIds.has(e.WhatId) && e.ActivityDate?.substring(0, 7) === thisMonth)
      .sort((a: any, b: any) => new Date(b.ActivityDate || b.CreatedDate).getTime() - new Date(a.ActivityDate || a.CreatedDate).getTime())
      .map((e: any) => ({
        ...e,
        accountName: nameMap[e.WhatId] || '-',
        isNego: negoIds.has(e.WhatId),
        isMouIncomplete: nonMouIds.has(e.WhatId),
      }));
  }, [csData, negoAccountsEnriched, month, brandIdMap]);

  const csAeFlowSteps: FlowStep[] = useMemo(() => {
    if (!csKpi?.bd) return [];
    const bd = csKpi.bd;
    const negoTotal = bd.negoEntryThisMonth?.total ?? 0;
    const noActivity = negoAccountsEnriched.filter((a: any) => a.daysSince === null).length;
    const mouNew = bd.mouNewThisMonth?.value ?? 0;
    return [
      {
        key: 'csMeeting', label: '미팅 건수', value: `${aeMeetingRawThisMonth.length}건`,
        detail: `네고 ${aeMeetingRawThisMonth.filter((e: any) => e.isNego).length}건 · MOU전 ${aeMeetingRawThisMonth.filter((e: any) => !e.isNego).length}건`,
        target: '네고+MOU전 미팅 (이번달)', met: aeMeetingRawThisMonth.length > 0,
        color: aeMeetingRawThisMonth.length > 0 ? 'green' : 'red', rawCount: 0, icon: '📅',
      },
      {
        key: 'csNegoBacklog', label: '신규 네고 진입', value: `${bd.negoEntryThisMonth?.value ?? 0}건`,
        detail: `전체 ${negoTotal}건 · 활동없음 ${noActivity}건`,
        target: '목표 10건', met: (bd.negoEntryThisMonth?.value ?? 0) >= 10,
        color: (bd.negoEntryThisMonth?.value ?? 0) >= 10 ? 'green' : 'red', rawCount: noActivity > 0 ? noActivity : 0, icon: '🤝',
      },
      {
        key: 'csMOU', label: 'MOU 체결', value: `${mouNew}건`,
        detail: '이번달 신규 체결',
        target: '목표 4건/월', met: mouNew >= 4,
        color: mouNew >= 4 ? 'green' : 'red', rawCount: 0, icon: '📝',
      },
    ];
  }, [csKpi, negoAccountsEnriched, negoMeetingThisMonth, negoTaskThisMonth, negoWithMeetingThisMonth, aeMeetingRawThisMonth]);

  // 리드 끊긴 파트너 (최근 3개월간 리드 없는 MOU 파트너/프랜차이즈)
  const churnedPartners = useMemo(() => {
    const now = new Date();
    const classify = (p: any) => {
      if (!p.lastLeadDate) return { severity: 'critical' as const, label: '리드 이력 없음', days: null as number | null };
      const days = Math.floor((now.getTime() - new Date(p.lastLeadDate).getTime()) / (1000 * 60 * 60 * 24));
      if (days > 180) return { severity: 'critical' as const, label: '180일+ 경과', days };
      if (days > 90) return { severity: 'warning' as const, label: '90~180일 경과', days };
      return { severity: 'recent' as const, label: '90일 이내', days };
    };
    const isChurned = (p: any) => {
      const hasMOU = p.mouStart && p.mouStart !== '-';
      const hadLeadsEver = !!p.lastLeadDate;  // 리드 이력이 있는 파트너만
      const noLeads3Months = (p.last3MonthLeadCount ?? 0) === 0;
      return hasMOU && hadLeadsEver && noLeads3Months;
    };
    const partners = (csPartnerStats || []).filter(isChurned).map((p: any) => ({ ...p, _type: 'partner', ...classify(p) }))
      .sort((a: any, b: any) => (b.days ?? 9999) - (a.days ?? 9999));
    const hqs = (csFranchiseHQList || []).filter(isChurned).map((h: any) => ({ ...h, _type: 'hq', ...classify(h) }))
      .sort((a: any, b: any) => (b.days ?? 9999) - (a.days ?? 9999));
    const critical = partners.filter((p: any) => p.severity === 'critical').length + hqs.filter((h: any) => h.severity === 'critical').length;
    return { partners, hqs, total: partners.length + hqs.length, critical };
  }, [csPartnerStats, csFranchiseHQList]);

  // 소개매장 고객경험 집계
  const storeCXStats = useMemo(() => {
    const onboardingList = csMouStats?.onboarding?.partner?.list || [];
    let totalStores = 0, totalCases = 0, storesWithCases = 0;
    const caseTypeMap: Record<string, number> = {};
    const caseStatusMap: Record<string, number> = {};
    const allStoreRows: any[] = [];
    let totalLeadtime = 0, leadtimeCount = 0;

    onboardingList.forEach((partner: any) => {
      (partner.storeDetails || []).forEach((store: any) => {
        totalStores++;
        totalCases += store.caseCount ?? 0;
        if ((store.caseCount ?? 0) > 0) storesWithCases++;
        (store.caseSummary || []).forEach((c: any) => {
          const key = c.type2 && c.type2 !== '-' ? `${c.type}/${c.type2}` : c.type || '미분류';
          caseTypeMap[key] = (caseTypeMap[key] || 0) + 1;
          caseStatusMap[c.status || '미분류'] = (caseStatusMap[c.status || '미분류'] || 0) + 1;
          if (c.leadtime && c.leadtime > 0) { totalLeadtime += c.leadtime; leadtimeCount++; }
        });
        allStoreRows.push({ ...store, partnerName: partner.name, partnerOwner: partner.owner, isSettled: partner.isSettled || partner.settled });
      });
    });

    const caseRate = totalStores > 0 ? ((storesWithCases / totalStores) * 100).toFixed(1) : '0';
    const avgLeadtime = leadtimeCount > 0 ? Math.round(totalLeadtime / leadtimeCount) : 0;
    const topCaseTypes = Object.entries(caseTypeMap).sort(([,a], [,b]) => b - a).slice(0, 10);
    return { totalStores, totalCases, storesWithCases, caseRate, avgLeadtime, topCaseTypes, caseStatusMap, allStoreRows: allStoreRows.sort((a, b) => (b.caseCount ?? 0) - (a.caseCount ?? 0)), partnerCount: onboardingList.length };
  }, [csMouStats]);

  // AM 스토리 플로우 — 4스텝 (KPI 문서 기준)
  const csAmFlowSteps: FlowStep[] = useMemo(() => {
    if (!csKpi?.am) return [];
    const am = csKpi.am;
    const meetAvg = parseFloat(am.meetingsCompleteAvg?.value) || 0;
    const leadAvg = parseFloat(am.leadsDailyAvg?.value) || 0;

    // 신규 파트너 초기 안착률 (파트너 + 프랜차이즈 본사 통합)
    const partnerOnboard = csMouStats?.onboarding?.partner || { total: 0, settled: 0, rate: 0 };
    const hqOnboard = csMouStats?.onboarding?.franchiseHQ || { total: 0, settled: 0, rate: 0 };
    const onboardTotal = (partnerOnboard.total || 0) + (hqOnboard.total || 0);
    const onboardSettled = (partnerOnboard.settled || 0) + (hqOnboard.settled || 0);
    const onboardRate = onboardTotal > 0 ? parseFloat(((onboardSettled / onboardTotal) * 100).toFixed(1)) : 0;

    // 기존 파트너 활성 유지
    const active90d = am.activeChannels90d?.value ?? 0;

    return [
      {
        key: 'csMouMeeting', label: 'MOU 미팅', value: `${meetAvg}건/일`,
        detail: `이번달 합계 ${am.meetingsCompleteThisMonth?.value ?? 0}건`,
        target: '목표 2건/일', met: meetAvg >= 2,
        color: meetAvg >= 2 ? 'green' : 'red', rawCount: 0, icon: '🤝',
      },
      {
        key: 'csOnboard', label: '신규 파트너 초기 안착률', value: `${onboardRate}%`,
        detail: `안착 ${onboardSettled}/${onboardTotal} (파트너 ${partnerOnboard.settled || 0} + 본사 ${hqOnboard.settled || 0})`,
        target: '목표 80%', met: onboardRate >= 80,
        color: onboardRate >= 80 ? 'green' : 'red',
        rawCount: onboardTotal - onboardSettled, icon: '📈',
      },
      {
        key: 'csActive', label: '기존 파트너 활성 유지', value: `${active90d}개`,
        detail: `파트너 ${am.activeChannels90d?.partners ?? 0} + 본사 ${am.activeChannels90d?.hq ?? 0}`,
        target: '목표 70개', met: active90d >= 70,
        color: active90d >= 70 ? 'green' : 'red',
        rawCount: 0, icon: '🔄',
      },
      {
        key: 'csLeadResult', label: 'Lead 창출 (핵심)', value: `${leadAvg}건/일`,
        detail: `이번달 합계 ${am.leadsThisMonth?.value ?? 0}건`,
        target: '목표 20~25건/일', met: leadAvg >= 20,
        color: leadAvg >= 20 ? 'green' : 'red', rawCount: 0, icon: '📊',
      },
    ];
  }, [csKpi, csMouStats]);

  // AE 상세 패널 ──────────

  // 이번달 네고 Account 미팅 Raw 데이터
  const negoMeetingRawThisMonth = useMemo(() => {
    if (!csData?.rawData?.channelEvents) return [];
    const negoIds = new Set(negoAccountsEnriched.map((a: any) => a.id));
    const negoNameMap: Record<string, string> = {};
    negoAccountsEnriched.forEach((a: any) => { negoNameMap[a.id] = a.name; });
    const thisMonth = month || '';
    return (csData.rawData.channelEvents as any[])
      .filter((e: any) => negoIds.has(e.WhatId) && e.ActivityDate?.substring(0, 7) === thisMonth)
      .sort((a: any, b: any) => new Date(b.ActivityDate || b.CreatedDate).getTime() - new Date(a.ActivityDate || a.CreatedDate).getTime())
      .map((e: any) => ({ ...e, accountName: negoNameMap[e.WhatId] || '-' }));
  }, [csData, negoAccountsEnriched, month]);

  // MOU 완료 Account의 이번달 미팅 Raw 데이터
  const mouMeetingRawThisMonth = useMemo(() => {
    if (!csData?.rawData?.channelEvents || !csData?.rawData?.partners) return [];
    const thisMonth = month || '';
    // MOU 완료 Account = MOUstartdate__c 있는 파트너사 + 프랜차이즈본사
    const mouAccounts = [
      ...(csData.rawData.partners || []),
      ...(csData.rawData.franchiseHQAccounts || []),
    ].filter((a: any) => a.MOUstartdate__c);
    const mouIds = new Set(mouAccounts.map((a: any) => a.Id));
    // MOU 완료 본사의 브랜드 IDs도 추가
    Object.entries(brandIdMap).forEach(([brandId, info]) => {
      if (info.mouStart && info.mouStart !== '-') mouIds.add(brandId);
    });
    const mouNameMap: Record<string, string> = {};
    mouAccounts.forEach((a: any) => { mouNameMap[a.Id] = a.Name; });
    // 브랜드 ID → 본사 이름 매핑 추가
    Object.entries(brandIdMap).forEach(([brandId, info]) => {
      if (!mouNameMap[brandId]) mouNameMap[brandId] = info.hqName;
    });
    return (csData.rawData.channelEvents as any[])
      .filter((e: any) => mouIds.has(e.WhatId) && e.ActivityDate?.substring(0, 7) === thisMonth)
      .sort((a: any, b: any) => new Date(b.ActivityDate || b.CreatedDate).getTime() - new Date(a.ActivityDate || a.CreatedDate).getTime())
      .map((e: any) => ({ ...e, accountName: mouNameMap[e.WhatId] || '-' }));
  }, [csData, month, brandIdMap]);

  function renderCSMeetingDetail() {
    const acctNoActivity = negoAccountsEnriched.filter((a: any) => a.eventCount === 0 && a.taskCount === 0);
    const negoCount = aeMeetingRawThisMonth.filter((e: any) => e.isNego).length;
    const mouPreCount = aeMeetingRawThisMonth.filter((e: any) => !e.isNego).length;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '이번달 미팅', value: aeMeetingRawThisMonth.length, unit: '건', color: '#3182F6', bg: '#E8F3FF' },
            { label: '네고 미팅', value: negoCount, unit: '건', color: '#20C997', bg: '#E3FAF0' },
            { label: 'MOU전 파트너', value: mouPreCount, unit: '건', color: '#FF8800', bg: '#FFF4E6' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>{item.unit}</span></div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '13px', color: '#8B95A1', padding: '0 4px' }}>
          네고 Account 누적: 미팅 {negoMeetingTotal}건 · Task {negoTaskTotal}건
        </div>

        {/* 담당자별 AE KPI — 미팅 · 네고 · MOU */}
        {(() => {
          // 담당자별 3개 지표 집계
          const partnerMOUList = csMouStats?.partner?.thisMonthList || [];
          const hqMOUList = csMouStats?.franchiseHQ?.thisMonthList || [];
          const mouAll = [...partnerMOUList, ...hqMOUList];

          const owners = new Set<string>();
          aeMeetingRawThisMonth.forEach((e: any) => owners.add(e.Owner?.Name || '미배정'));
          negoAccountsEnriched.forEach((a: any) => owners.add(a.owner || '미배정'));
          mouAll.forEach((m: any) => owners.add(m.owner || '미배정'));

          const ownerKPI: Record<string, { meeting: number; nego: number; mou: number }> = {};
          owners.forEach(o => { ownerKPI[o] = { meeting: 0, nego: 0, mou: 0 }; });
          aeMeetingRawThisMonth.forEach((e: any) => {
            const o = e.Owner?.Name || '미배정';
            ownerKPI[o].meeting++;
          });
          negoAccountsEnriched.forEach((a: any) => {
            const o = a.owner || '미배정';
            ownerKPI[o].nego++;
          });
          mouAll.forEach((m: any) => {
            const o = m.owner || '미배정';
            ownerKPI[o].mou++;
          });

          const sorted = Object.entries(ownerKPI)
            .filter(([, v]) => v.meeting + v.nego + v.mou > 0)
            .sort((a, b) => (b[1].meeting + b[1].nego + b[1].mou) - (a[1].meeting + a[1].nego + a[1].mou));

          if (sorted.length === 0) return null;

          const maxMeeting = Math.max(...sorted.map(([, v]) => v.meeting), 1);
          const maxNego = Math.max(...sorted.map(([, v]) => v.nego), 1);
          const maxMou = Math.max(...sorted.map(([, v]) => v.mou), 1);

          return (
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '12px' }}>담당자별 AE 현황</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {sorted.map(([owner, kpi]) => (
                  <div key={owner} style={{
                    padding: '14px 16px', borderRadius: '12px', background: '#fff',
                    border: '1px solid #E5E8EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#191F28', marginBottom: '12px' }}>{owner}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* 미팅 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '48px', fontSize: '13px', color: '#6B7684', fontWeight: 600, flexShrink: 0 }}>미팅</div>
                        <div style={{ flex: 1, height: '20px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            width: `${Math.max((kpi.meeting / maxMeeting) * 100, kpi.meeting > 0 ? 8 : 0)}%`,
                            height: '100%', background: '#3182F6', borderRadius: '6px',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ width: '36px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: kpi.meeting > 0 ? '#3182F6' : '#B0B8C1' }}>{kpi.meeting}건</div>
                      </div>
                      {/* 네고 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '48px', fontSize: '13px', color: '#6B7684', fontWeight: 600, flexShrink: 0 }}>네고</div>
                        <div style={{ flex: 1, height: '20px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            width: `${Math.max((kpi.nego / maxNego) * 100, kpi.nego > 0 ? 8 : 0)}%`,
                            height: '100%', background: '#FF9F43', borderRadius: '6px',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ width: '36px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: kpi.nego > 0 ? '#FF9F43' : '#B0B8C1' }}>{kpi.nego}건</div>
                      </div>
                      {/* MOU */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '48px', fontSize: '13px', color: '#6B7684', fontWeight: 600, flexShrink: 0 }}>MOU</div>
                        <div style={{ flex: 1, height: '20px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            width: `${Math.max((kpi.mou / maxMou) * 100, kpi.mou > 0 ? 8 : 0)}%`,
                            height: '100%', background: '#20C997', borderRadius: '6px',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{ width: '36px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: kpi.mou > 0 ? '#20C997' : '#B0B8C1' }}>{kpi.mou}건</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* 이번달 전체 미팅 Raw 리스트 */}
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '10px' }}>
            이번달 미팅 내역 <TossBadge variant="weak" size="xsmall" color="blue">{aeMeetingRawThisMonth.length}건</TossBadge>
          </div>
          {aeMeetingRawThisMonth.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>미팅일</th>
                    <th style={thStyle}>구분</th>
                    <th style={thStyle}>제목</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>담당자</th>
                  </tr>
                </thead>
                <tbody>
                  {aeMeetingRawThisMonth.map((e: any, i: number) => (
                    <React.Fragment key={e.Id || i}>
                      <tr style={{ borderBottom: e.Description ? 'none' : '1px solid #F2F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {e.ActivityDate || e.CreatedDate?.split('T')[0] || '-'}
                        </td>
                        <td style={tdStyle}>
                          {e.isNego
                            ? <TossBadge variant="fill" size="xsmall" color="green">네고</TossBadge>
                            : <TossBadge variant="fill" size="xsmall" color="yellow">MOU전</TossBadge>
                          }
                        </td>
                        <td style={tdStyle}>{e.Subject || '-'}</td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600, color: '#191F28' }}>{e.accountName}</span>
                        </td>
                        <td style={tdStyle}>{ownerBold(e.Owner?.Name || '-')}</td>
                      </tr>
                      {e.Description && (
                        <tr style={{ borderBottom: '1px solid #F2F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                          <td colSpan={5} style={{ padding: '0 14px 12px 14px' }}>
                            <div style={{
                              fontSize: '13px', color: '#555', background: '#F8F9FA', borderRadius: '8px',
                              padding: '10px 14px', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              borderLeft: `3px solid ${e.isNego ? '#20C997' : '#FF8800'}`,
                            }}>
                              {e.Description}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: '#8B95A1', background: '#F9FAFB', borderRadius: '10px' }}>
              이번달 AE 관련 미팅이 없습니다
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCSNegoBacklogDetail() {
    const noActivity = negoAccountsEnriched.filter((a: any) => a.daysSince === null).length;
    const over7 = negoAccountsEnriched.filter((a: any) => a.daysSince !== null && a.daysSince > 7).length;
    const recent = negoAccountsEnriched.filter((a: any) => a.daysSince !== null && a.daysSince <= 7).length;
    const partnerCount = negoAccountsEnriched.filter((a: any) => a.type === '파트너사').length;
    const hqCount = negoAccountsEnriched.filter((a: any) => a.type === '프랜차이즈본사').length;
    const negoEntryThisMonth = csKpi?.bd?.negoEntryThisMonth?.value ?? 0;

    // 담당자별 요약
    const byOwner: Record<string, { total: number; noActivity: number; over7: number }> = {};
    negoAccountsEnriched.forEach((a: any) => {
      if (!byOwner[a.owner]) byOwner[a.owner] = { total: 0, noActivity: 0, over7: 0 };
      byOwner[a.owner].total++;
      if (a.daysSince === null) byOwner[a.owner].noActivity++;
      else if (a.daysSince > 7) byOwner[a.owner].over7++;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* 1행: 전체 / 이번달 진입 / 파트너사 / 본사 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '전체 네고', value: negoAccountsEnriched.length, color: '#191F28', bg: '#F2F4F6' },
            { label: '이번달 진입', value: negoEntryThisMonth, color: '#3182F6', bg: '#E8F3FF' },
            { label: '파트너사', value: partnerCount, color: '#20C997', bg: '#E3FAF0' },
            { label: '프랜차이즈본사', value: hqCount, color: '#00B8D9', bg: '#E3FAFC' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}건</div>
            </div>
          ))}
        </div>

        {/* 2행: 활동 상태 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '활동없음', value: noActivity, color: '#F04452', bg: '#FFF0F0' },
            { label: '7일+ 경과', value: over7, color: '#FF8800', bg: '#FFF8E8' },
            { label: '7일 이내', value: recent, color: '#20C997', bg: '#E3FAF0' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}건</div>
            </div>
          ))}
        </div>

        {/* 담당자별 이번달 네고 진입 */}
        {(() => {
          const negoEntryByOwner: Record<string, number> = {};
          negoAccountsEnriched
            .filter((a: any) => a.createdDate?.startsWith(month))
            .forEach((a: any) => {
              const o = a.owner || '미배정';
              negoEntryByOwner[o] = (negoEntryByOwner[o] || 0) + 1;
            });
          // 기존 담당자도 포함 (0건이라도 표시)
          Object.keys(byOwner).forEach(o => {
            if (!(o in negoEntryByOwner)) negoEntryByOwner[o] = 0;
          });
          const sorted = Object.entries(negoEntryByOwner)
            .sort((a, b) => b[1] - a[1]);
          const maxEntry = Math.max(...sorted.map(([, v]) => v), 1);

          return (
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '12px' }}>담당자별 이번달 네고 진입</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sorted.map(([owner, count]) => (
                  <div key={owner} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '80px', fontSize: '14px', fontWeight: 600, color: '#191F28', flexShrink: 0 }}>{owner}</div>
                    <div style={{ flex: 1, height: '24px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        width: `${Math.max((count / maxEntry) * 100, count > 0 ? 8 : 0)}%`,
                        height: '100%', background: '#3182F6', borderRadius: '6px',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <div style={{ width: '40px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: count > 0 ? '#3182F6' : '#B0B8C1' }}>{count}건</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Raw 리스트 — 파트너사 / 본사 탭 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>네고 체류 상세</span>
            {([
              { key: 'partner' as const, label: '파트너사', count: partnerCount, color: '#20C997' },
              { key: 'hq' as const, label: '프랜차이즈본사', count: hqCount, color: '#00B8D9' },
            ]).map(t => {
              const active = negoListTab === t.key;
              return (
                <button key={t.key} onClick={() => setNegoListTab(t.key)} style={{
                  padding: '6px 14px', borderRadius: '20px', fontSize: '14px', fontWeight: 600,
                  border: active ? `2px solid ${t.color}` : '1px solid #E5E8EB',
                  background: active ? `${t.color}12` : '#fff',
                  color: active ? t.color : '#6B7684',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {t.label} {t.count}건
                </button>
              );
            })}
          </div>
          {(() => {
            const filtered = negoListTab === 'partner'
              ? negoAccountsEnriched.filter((a: any) => a.type === '파트너사')
              : negoAccountsEnriched.filter((a: any) => a.type === '프랜차이즈본사');
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      <th style={thStyle}>Account</th>
                      <th style={thStyle}>담당자</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Task</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>미팅</th>
                      <th style={thStyle}>마지막 활동</th>
                      <th style={thStyle}>내용</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>경과일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a: any) => {
                      const isNoActivity = a.daysSince === null;
                      const isOld = a.daysSince !== null && a.daysSince > 7;
                      const rowBg = isNoActivity ? '#FFF5F5' : isOld ? '#FFFBE6' : 'transparent';
                      return (
                        <tr key={a.id} style={{ borderBottom: '1px solid #F2F4F6', background: rowBg }}>
                          <td style={tdStyle}>
                            <span style={{ fontWeight: 600, color: '#191F28' }}>{a.name}</span>
                          </td>
                          <td style={tdStyle}>{ownerBold(a.owner)}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {a.taskCount > 0
                              ? <TossBadge variant="weak" size="xsmall" color="blue">{a.taskCount}건</TossBadge>
                              : <span style={{ color: '#B0B8C1' }}>0</span>
                            }
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {a.eventCount > 0
                              ? <span
                                  onClick={() => setMeetingModal({ accountId: a.id, accountName: a.name })}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <TossBadge variant="weak" size="xsmall" color="teal">{a.eventCount}건</TossBadge>
                                </span>
                              : <span style={{ color: '#B0B8C1' }}>0</span>
                            }
                          </td>
                          <td style={tdStyle}>
                            {a.lastActivityDate !== '-' && (
                              <span style={{ marginRight: '4px' }}>
                                {a.lastActivityType === 'event' ? '📅' : '📞'}
                              </span>
                            )}
                            {a.lastActivityDate}
                          </td>
                          <td style={tdStyle}>
                            <span style={{ color: '#6B7684', fontSize: '13px' }}>{a.lastActivitySubject}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {isNoActivity
                              ? <TossBadge variant="fill" size="xsmall" color="red">활동없음</TossBadge>
                              : isOld
                                ? <TossBadge variant="fill" size="xsmall" color="yellow">{a.daysSince}일</TossBadge>
                                : <TossBadge variant="weak" size="xsmall" color="green">{a.daysSince}일</TossBadge>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  function renderCSMOUDetail() {
    const partnerList = csMouStats?.partner?.thisMonthList || [];
    const hqList = csMouStats?.franchiseHQ?.thisMonthList || [];
    const allMOUList = [
      ...partnerList.map((p: any) => ({ ...p, type: '파트너' })),
      ...hqList.map((h: any) => ({ ...h, type: '프랜차이즈' })),
    ];
    return (
      <div>
        {/* 요약 */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {[
            { label: '파트너 이번달', value: csMouStats?.partner?.thisMonth ?? 0, color: '#3182F6', bg: '#E8F3FF' },
            { label: '파트너 최근3개월', value: csMouStats?.partner?.last3Months ?? 0, color: '#6B7684', bg: '#F2F4F6' },
            { label: '프랜차이즈 이번달', value: csMouStats?.franchiseHQ?.thisMonth ?? 0, color: '#20C997', bg: '#E3FAF0' },
            { label: '프랜차이즈 최근3개월', value: csMouStats?.franchiseHQ?.last3Months ?? 0, color: '#8B95A1', bg: '#F2F4F6' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 100px', padding: '14px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '14px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: item.color }}>{item.value}건</div>
            </div>
          ))}
        </div>
        {/* 담당자별 MOU 체결 */}
        {(() => {
          const byOwner: Record<string, { partner: number; franchise: number }> = {};
          allMOUList.forEach((m: any) => {
            const owner = m.owner || '미배정';
            if (!byOwner[owner]) byOwner[owner] = { partner: 0, franchise: 0 };
            if (m.type === '파트너') byOwner[owner].partner++;
            else byOwner[owner].franchise++;
          });
          const sorted = Object.entries(byOwner)
            .sort((a, b) => (b[1].partner + b[1].franchise) - (a[1].partner + a[1].franchise));
          const maxP = Math.max(...sorted.map(([, v]) => v.partner), 1);
          const maxF = Math.max(...sorted.map(([, v]) => v.franchise), 1);

          return sorted.length > 0 ? (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '12px' }}>담당자별 MOU 체결</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {sorted.map(([owner, kpi]) => (
                  <div key={owner} style={{ padding: '14px 16px', borderRadius: '12px', background: '#fff', border: '1px solid #E5E8EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#191F28', marginBottom: '12px' }}>{owner}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '64px', fontSize: '13px', color: '#6B7684', fontWeight: 600, flexShrink: 0 }}>파트너</div>
                        <div style={{ flex: 1, height: '20px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max((kpi.partner / maxP) * 100, kpi.partner > 0 ? 8 : 0)}%`, height: '100%', background: '#3182F6', borderRadius: '6px', transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ width: '36px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: kpi.partner > 0 ? '#3182F6' : '#B0B8C1' }}>{kpi.partner}건</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '64px', fontSize: '13px', color: '#6B7684', fontWeight: 600, flexShrink: 0 }}>프랜차이즈</div>
                        <div style={{ flex: 1, height: '20px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max((kpi.franchise / maxF) * 100, kpi.franchise > 0 ? 8 : 0)}%`, height: '100%', background: '#20C997', borderRadius: '6px', transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ width: '36px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: kpi.franchise > 0 ? '#20C997' : '#B0B8C1' }}>{kpi.franchise}건</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null;
        })()}

        {/* 이번달 체결 리스트 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>이번달 MOU 체결</span>
          <TossBadge variant="weak" size="small" color="green">{allMOUList.length}건</TossBadge>
        </div>
        {allMOUList.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>이름</th>
                  <th style={thStyle}>유형</th>
                  <th style={thStyle}>MOU 시작일</th>
                  <th style={thStyle}>담당자</th>
                </tr>
              </thead>
              <tbody>
                {allMOUList.map((m: any, i: number) => (
                  <tr key={m.id || m.hqId || m.name || i} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{m.name || m.hqName || '-'}</span></td>
                    <td style={tdStyle}>
                      <TossBadge variant="weak" size="xsmall" color={m.type === '파트너' ? 'blue' : 'teal'}>{m.type}</TossBadge>
                    </td>
                    <td style={tdStyle}>{m.mouStart || '-'}</td>
                    <td style={tdStyle}>{ownerBold(m.owner || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#8B95A1' }}>
            <div style={{ fontSize: '2em', marginBottom: '8px' }}>📝</div>
            이번달 체결된 MOU가 없습니다
          </div>
        )}
      </div>
    );
  }

  const csAeDetailRenderers = [renderCSMeetingDetail, renderCSNegoBacklogDetail, renderCSMOUDetail];

  // AM 상세 패널 ──────────

  function renderCSLeadDetail() {
    const channelLeadsByOwner = csSummary?.channelLeadsByOwner;
    const am = csKpi?.am;
    const leadsThisMonth = am?.leadsThisMonth?.value ?? 0;
    const leadAvg = parseFloat(am?.leadsDailyAvg?.value) || 0;
    const amHeatmap = channelLeadsByOwner?.amHeatmap;

    // 활동 파트너사 / 프랜차이즈 본사 (이번달 Lead 발생)
    const activePartners = (csPartnerStats || []).filter((p: any) => (p.thisMonthLeadCount ?? 0) > 0)
      .sort((a: any, b: any) => (b.thisMonthLeadCount || 0) - (a.thisMonthLeadCount || 0));
    const activeHQs = (csFranchiseHQList || []).filter((h: any) => (h.thisMonthLeadCount ?? 0) > 0)
      .sort((a: any, b: any) => (b.thisMonthLeadCount || 0) - (a.thisMonthLeadCount || 0));

    const tabStyle = (active: boolean) => ({
      padding: '6px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: active ? 700 : 500,
      background: active ? '#191F28' : '#F2F4F6', color: active ? '#fff' : '#6B7684',
      border: 'none', cursor: 'pointer' as const,
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '이번달 합계', value: leadsThisMonth, unit: '건', color: '#3182F6', bg: '#E8F3FF' },
            { label: '일평균', value: leadAvg, unit: '건/일', color: '#191F28', bg: '#F2F4F6' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>{item.unit}</span></div>
            </div>
          ))}
        </div>

        {/* 탭 토글: AM 히트맵 | 활동 파트너사 | 담당자별 */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <button style={tabStyle(csLeadViewTab === 'heatmap')} onClick={() => setCsLeadViewTab('heatmap')}>AM 히트맵</button>
          <button style={tabStyle(csLeadViewTab === 'partners')} onClick={() => setCsLeadViewTab('partners')}>활동 파트너사</button>
          <button style={tabStyle(csLeadViewTab === 'owners')} onClick={() => setCsLeadViewTab('owners')}>담당자별</button>
        </div>

        {/* TAB: AM 히트맵 */}
        {csLeadViewTab === 'heatmap' && amHeatmap && (
          <div>
            <div style={{ fontSize: '13px', color: '#6B7684', marginBottom: '10px' }}>
              Account Owner 기준 일별 채널 리드 현황 · 색상 강도 = Lead 수
            </div>
            <LeadHeatmap data={amHeatmap.data} calendarMeta={amHeatmap.calendar} maxValue={amHeatmap.maxValue} />
          </div>
        )}

        {/* TAB: 활동 파트너사/프랜차이즈 */}
        {csLeadViewTab === 'partners' && (
          <div>
            {/* 파트너사/본사 서브탭 */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              <button
                style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csLeadPartnerTab === 'partner' ? 700 : 500, background: csLeadPartnerTab === 'partner' ? '#3182F6' : '#F2F4F6', color: csLeadPartnerTab === 'partner' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
                onClick={() => setCsLeadPartnerTab('partner')}
              >파트너사 ({activePartners.length})</button>
              <button
                style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csLeadPartnerTab === 'hq' ? 700 : 500, background: csLeadPartnerTab === 'hq' ? '#00B8D9' : '#F2F4F6', color: csLeadPartnerTab === 'hq' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
                onClick={() => setCsLeadPartnerTab('hq')}
              >프랜차이즈 본사 ({activeHQs.length})</button>
            </div>

            {/* 범례 */}
            <div style={{ display: 'flex', gap: '14px', marginBottom: '12px', fontSize: '12px', color: '#6B7684' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#ffb300' }} /> Lead
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#1976d2' }} /> 미팅
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#f0f0f0' }} /> 없음
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#fafafa', border: '1px dashed #ccc' }} /> 주말
              </div>
            </div>

            {/* 파트너사 카드 그리드 */}
            {csLeadPartnerTab === 'partner' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {activePartners.length === 0 ? (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#B0B8C1', padding: '20px', fontSize: '14px' }}>이번달 리드가 발생한 파트너사가 없습니다</div>
                ) : activePartners.map((partner: any) => {
                  const sparseActivity = partner.dailyActivity || [];
                  const actMap = new Map(sparseActivity.map((d: any) => [d.day, d]));
                  const today = new Date().getDate();
                  const activity = Array.from({ length: today }, (_, i) => {
                    const day = i + 1;
                    return actMap.get(day) || { day, leads: 0, meetings: 0, isWeekend: [0, 6].includes(new Date(new Date().getFullYear(), new Date().getMonth(), day).getDay()) };
                  });
                  const maxLead = Math.max(...activity.map((d: any) => d.leads || 0), 1);
                  return (
                    <div key={partner.id || partner.name} style={{ background: '#fff', borderRadius: '10px', border: '1px solid #E5E8EB', padding: '10px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '14px', color: '#191F28' }}>{partner.name}</span>
                          <span style={{ fontSize: '12px', color: '#6B7684', marginLeft: '6px' }}>{partner.owner}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', fontSize: '12px' }}>
                          <TossBadge variant="weak" size="xsmall" color="yellow">Lead {partner.thisMonthLeadCount ?? 0}</TossBadge>
                          {(partner.meetingCount ?? 0) > 0 && <TossBadge variant="weak" size="xsmall" color="blue">미팅 {partner.meetingCount}</TossBadge>}
                          <TossBadge variant="weak" size="xsmall" color="elephant">3개월 {partner.last3MonthLeadCount ?? 0}</TossBadge>
                        </div>
                      </div>
                      {activity.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ display: 'flex', gap: '2px', minWidth: 'fit-content' }}>
                            {activity.map((d: any) => {
                              const dow = new Date(new Date().getFullYear(), new Date().getMonth(), d.day).getDay();
                              const dayLabel = ['일','월','화','수','목','금','토'][dow];
                              const isWeekend = dow === 0 || dow === 6;
                              let leadBg = isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.leads > 0) {
                                const intensity = d.leads / maxLead;
                                leadBg = intensity <= 0.3 ? '#fff8e1' : intensity <= 0.6 ? '#ffe082' : '#ffb300';
                              }
                              let meetBg = isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.meetings > 0) meetBg = d.meetings >= 2 ? '#1565c0' : '#42a5f5';
                              return (
                                <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: '24px' }}>
                                  <div style={{ fontSize: '9px', fontWeight: 500, color: dow === 0 ? '#e53935' : dow === 6 ? '#1565c0' : '#999' }}>{d.day}</div>
                                  <div style={{ fontSize: '8px', color: dow === 0 ? '#e53935' : dow === 6 ? '#1565c0' : '#bbb', marginBottom: '1px' }}>{dayLabel}</div>
                                  <div title={`${d.day}일: Lead ${d.leads}건`} style={{
                                    width: '22px', height: '16px', borderRadius: '3px', background: leadBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '9px', fontWeight: d.leads > 0 ? 700 : 400,
                                    color: d.leads > 0 ? (leadBg === '#ffb300' ? '#fff' : '#e65100') : (isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.leads > 0 ? d.leads : (isWeekend ? '' : '·')}
                                  </div>
                                  <div title={`${d.day}일: 미팅 ${d.meetings}건`} style={{
                                    width: '22px', height: '16px', borderRadius: '3px', background: meetBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '9px', fontWeight: d.meetings > 0 ? 700 : 400,
                                    color: d.meetings > 0 ? '#fff' : (isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.meetings > 0 ? d.meetings : (isWeekend ? '' : '·')}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#B0B8C1', fontSize: '12px', textAlign: 'center', padding: '6px' }}>일별 데이터 없음</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 프랜차이즈 본사 카드 그리드 */}
            {csLeadPartnerTab === 'hq' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {activeHQs.length === 0 ? (
                  <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#B0B8C1', padding: '20px', fontSize: '14px' }}>이번달 리드가 발생한 프랜차이즈 본사가 없습니다</div>
                ) : activeHQs.map((hq: any) => {
                  const sparseActivity = hq.dailyActivity || [];
                  const actMap = new Map(sparseActivity.map((d: any) => [d.day, d]));
                  const today = new Date().getDate();
                  const activity = Array.from({ length: today }, (_, i) => {
                    const day = i + 1;
                    return actMap.get(day) || { day, leads: 0, meetings: 0, isWeekend: [0, 6].includes(new Date(new Date().getFullYear(), new Date().getMonth(), day).getDay()) };
                  });
                  const maxLead = Math.max(...activity.map((d: any) => d.leads || 0), 1);
                  return (
                    <div key={hq.hqId || hq.hqName} style={{ background: '#fff', borderRadius: '10px', border: '1px solid #E5E8EB', padding: '10px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '14px', color: '#191F28' }}>{hq.hqName}</span>
                          <span style={{ fontSize: '12px', color: '#6B7684', marginLeft: '6px' }}>{hq.owner}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', fontSize: '12px' }}>
                          <TossBadge variant="weak" size="xsmall" color="teal">Lead {hq.thisMonthLeadCount ?? 0}</TossBadge>
                          {(hq.meetingCount ?? 0) > 0 && <TossBadge variant="weak" size="xsmall" color="blue">미팅 {hq.meetingCount}</TossBadge>}
                          <TossBadge variant="weak" size="xsmall" color="elephant">3개월 {hq.last3MonthLeadCount ?? 0}</TossBadge>
                        </div>
                      </div>
                      {activity.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ display: 'flex', gap: '2px', minWidth: 'fit-content' }}>
                            {activity.map((d: any) => {
                              const dow = new Date(new Date().getFullYear(), new Date().getMonth(), d.day).getDay();
                              const dayLabel = ['일','월','화','수','목','금','토'][dow];
                              const isWeekend = dow === 0 || dow === 6;
                              let leadBg = isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.leads > 0) {
                                const intensity = d.leads / maxLead;
                                leadBg = intensity <= 0.3 ? '#fff8e1' : intensity <= 0.6 ? '#ffe082' : '#ffb300';
                              }
                              let meetBg = isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.meetings > 0) meetBg = d.meetings >= 2 ? '#1565c0' : '#42a5f5';
                              return (
                                <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: '24px' }}>
                                  <div style={{ fontSize: '9px', fontWeight: 500, color: dow === 0 ? '#e53935' : dow === 6 ? '#1565c0' : '#999' }}>{d.day}</div>
                                  <div style={{ fontSize: '8px', color: dow === 0 ? '#e53935' : dow === 6 ? '#1565c0' : '#bbb', marginBottom: '1px' }}>{dayLabel}</div>
                                  <div title={`${d.day}일: Lead ${d.leads}건`} style={{
                                    width: '22px', height: '16px', borderRadius: '3px', background: leadBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '9px', fontWeight: d.leads > 0 ? 700 : 400,
                                    color: d.leads > 0 ? (leadBg === '#ffb300' ? '#fff' : '#e65100') : (isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.leads > 0 ? d.leads : (isWeekend ? '' : '·')}
                                  </div>
                                  <div title={`${d.day}일: 미팅 ${d.meetings}건`} style={{
                                    width: '22px', height: '16px', borderRadius: '3px', background: meetBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '9px', fontWeight: d.meetings > 0 ? 700 : 400,
                                    color: d.meetings > 0 ? '#fff' : (isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.meetings > 0 ? d.meetings : (isWeekend ? '' : '·')}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#B0B8C1', fontSize: '12px', textAlign: 'center', padding: '6px' }}>일별 데이터 없음</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: 담당자별 */}
        {csLeadViewTab === 'owners' && channelLeadsByOwner?.data && channelLeadsByOwner.data.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {channelLeadsByOwner.data.map((o: any) => (
                <div key={o.owner} style={{ padding: '10px 14px', borderRadius: '10px', background: '#F9FAFB', border: '1px solid #E5E8EB', minWidth: '130px' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#191F28', marginBottom: '6px' }}>{o.owner}</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <TossBadge variant="weak" size="xsmall" color="elephant">{o.total ?? 0}건</TossBadge>
                    <TossBadge variant="weak" size="xsmall" color="green">파트너 {o.partner ?? 0}</TossBadge>
                    <TossBadge variant="weak" size="xsmall" color="teal">프랜차이즈 {o.franchise ?? 0}</TossBadge>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>파트너</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>프랜차이즈</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {channelLeadsByOwner.data.map((o: any) => (
                    <tr key={o.owner} style={{ borderBottom: '1px solid #F2F4F6' }}>
                      <td style={tdStyle}>{ownerBold(o.owner)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{o.partner ?? 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{o.franchise ?? 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={{ fontWeight: 700 }}>{o.total ?? 0}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderCSMeetAMDetail() {
    const meetingsByOwner = csKpi?.meetingsByOwner || [];
    const am = csKpi?.am;
    const meetAvg = parseFloat(am?.meetingsCompleteAvg?.value) || 0;
    const totalComplete = am?.meetingsCompleteThisMonth?.value ?? 0;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 요약 카드 — MOU완료 미팅만 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: 'MOU파트너 미팅', value: totalComplete, unit: '건', color: '#20C997', bg: '#E3FAF0' },
            { label: '일평균', value: meetAvg, unit: '건/일', color: '#191F28', bg: '#F2F4F6' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 120px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>{item.unit}</span></div>
            </div>
          ))}
        </div>

        {/* 담당자별 뱃지 — MOU완료 기준 */}
        {meetingsByOwner.length > 0 && (
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '10px' }}>담당자별 현황</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {meetingsByOwner.filter((o: any) => (o.mouComplete ?? 0) > 0).map((o: any) => (
                <div key={o.name} style={{ padding: '10px 14px', borderRadius: '10px', background: '#F9FAFB', border: '1px solid #E5E8EB', minWidth: '130px' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#191F28', marginBottom: '6px' }}>{o.name}</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <TossBadge variant="fill" size="xsmall" color="green">{o.mouComplete}건</TossBadge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw 미팅 리스트 */}
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '10px' }}>
            MOU완료 파트너 미팅 내역 <TossBadge variant="weak" size="xsmall" color="blue">{mouMeetingRawThisMonth.length}건</TossBadge>
          </div>
          {mouMeetingRawThisMonth.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>미팅일</th>
                    <th style={thStyle}>제목</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>담당자</th>
                  </tr>
                </thead>
                <tbody>
                  {mouMeetingRawThisMonth.map((e: any, i: number) => (
                    <React.Fragment key={e.Id || i}>
                      <tr style={{ borderBottom: e.Description ? 'none' : '1px solid #F2F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {e.ActivityDate || e.CreatedDate?.split('T')[0] || '-'}
                        </td>
                        <td style={tdStyle}>{e.Subject || '-'}</td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600, color: '#191F28' }}>{e.accountName}</span>
                        </td>
                        <td style={tdStyle}>{ownerBold(e.Owner?.Name || '-')}</td>
                      </tr>
                      {e.Description && (
                        <tr style={{ borderBottom: '1px solid #F2F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                          <td colSpan={4} style={{ padding: '0 14px 12px 14px' }}>
                            <div style={{
                              fontSize: '13px', color: '#555', background: '#F8F9FA', borderRadius: '8px',
                              padding: '10px 14px', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              borderLeft: '3px solid #00B8D9',
                            }}>
                              {e.Description}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: '#8B95A1', background: '#F9FAFB', borderRadius: '10px' }}>
              이번달 MOU완료 파트너 미팅이 없습니다
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCSOnboardDetail() {
    const partnerOnboard = csMouStats?.onboarding?.partner || { total: 0, settled: 0, rate: 0, list: [] };
    const hqOnboard = csMouStats?.onboarding?.franchiseHQ || { total: 0, settled: 0, rate: 0, list: [] };
    const combinedTotal = (partnerOnboard.total || 0) + (hqOnboard.total || 0);
    const combinedSettled = (partnerOnboard.settled || 0) + (hqOnboard.settled || 0);
    const combinedRate = combinedTotal > 0 ? ((combinedSettled / combinedTotal) * 100).toFixed(1) : '0';
    const list = csOnboardTab === 'partner' ? (partnerOnboard.list || []) : (hqOnboard.list || []);

    // 담당자별 그룹핑
    const byOwner: Record<string, { unsettled: any[]; settled: any[] }> = {};
    list.forEach((p: any) => {
      const owner = p.owner || '미지정';
      if (!byOwner[owner]) byOwner[owner] = { unsettled: [], settled: [] };
      const isSettled = p.isSettled || p.settled;
      if (isSettled) byOwner[owner].settled.push(p);
      else byOwner[owner].unsettled.push(p);
    });

    // 미안착 많은 순 정렬
    const ownerEntries = Object.entries(byOwner)
      .sort((a, b) => b[1].unsettled.length - a[1].unsettled.length);

    // 미팅 추천 뱃지
    const getMeetRec = (p: any) => {
      const events = p.eventCount || 0;
      const days = p.mouStart && p.mouStart !== '-'
        ? Math.floor((Date.now() - new Date(p.mouStart).getTime()) / 86400000)
        : 0;
      if (events === 0) return { label: '미팅 필요', color: '#FF6B6B', bg: '#FFF5F5', border: '#FFC9C9' };
      if (days > 30 && events < 3) return { label: '추가 미팅', color: '#F59F00', bg: '#FFF9DB', border: '#FFE066' };
      return { label: '팔로업', color: '#748FFC', bg: '#EDF2FF', border: '#BAC8FF' };
    };

    // 경과일 계산
    const getDaysSince = (dateStr: string) => {
      if (!dateStr || dateStr === '-') return 0;
      return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    };

    // 파트너 row 렌더 헬퍼
    const renderPartnerRow = (p: any, idx: number, isSettledRow: boolean) => {
      const displayName = csOnboardTab === 'partner' ? (p.name || '-') : (p.hqName || p.name || '-');
      const days = getDaysSince(p.mouStart);
      const rec = !isSettledRow ? getMeetRec(p) : null;
      const rowBg = isSettledRow
        ? (idx % 2 === 0 ? '#F8FFF8' : '#F0FAF0')
        : rec?.label === '미팅 필요'
          ? (idx % 2 === 0 ? '#FFF5F5' : '#FFF0F0')
          : (idx % 2 === 0 ? '#FFFBF0' : '#FFF9E6');

      return (
        <tr key={p.id || p.hqId || `r-${idx}`} style={{
          borderBottom: '1px solid #F2F4F6', background: rowBg,
          cursor: (p.leadCountWithinWindow > 0 || p.totalLeadCount > 0) ? 'pointer' : 'default',
        }}
          onClick={() => {
            if ((p.leadCountWithinWindow > 0 || p.totalLeadCount > 0) && csOnboardTab === 'partner') {
              setOnboardModal({ partner: p });
            }
          }}
        >
          <td style={{ ...tdStyle, fontWeight: 600 }}>{displayName}</td>
          <td style={tdStyle}>{p.mouStart || '-'}</td>
          <td style={{ ...tdStyle, textAlign: 'center' }}>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
              background: days >= 60 ? '#FFF0F0' : days >= 30 ? '#FFF9DB' : '#F2F4F6',
              color: days >= 60 ? '#F04452' : days >= 30 ? '#F59F00' : '#8B95A1',
            }}>{days}일</span>
          </td>
          <td style={{ ...tdStyle, textAlign: 'center' }}>
            {(p.eventCount ?? 0) > 0
              ? <span style={{ cursor: 'pointer' }} onClick={(ev) => {
                  ev.stopPropagation();
                  const ids = csOnboardTab === 'hq' ? [...(p.brands || []).map((b: any) => b.id), p.hqId].filter(Boolean) : [p.id];
                  setMeetingModal({ accountId: ids[0], accountName: displayName, accountIds: ids });
                }}><TossBadge variant="weak" size="xsmall" color="teal">{p.eventCount}건</TossBadge></span>
              : <span style={{ color: '#F04452', fontWeight: 700, fontSize: '13px' }}>0건</span>
            }
          </td>
          <td style={{ ...tdStyle, textAlign: 'center' }}>
            {(p.taskCount ?? 0) > 0
              ? <span style={{ cursor: 'pointer' }} onClick={(ev) => {
                  ev.stopPropagation();
                  const ids = csOnboardTab === 'hq' ? [...(p.brands || []).map((b: any) => b.id), p.hqId].filter(Boolean) : [p.id];
                  setCsTaskModal({ accountId: ids[0], accountName: displayName, accountIds: ids });
                }}><TossBadge variant="weak" size="xsmall" color="elephant">{p.taskCount}건</TossBadge></span>
              : <span style={{ color: '#B0B8C1' }}>0건</span>
            }
          </td>
          {isSettledRow ? (
            <td style={{ ...tdStyle, textAlign: 'center' }}>
              <TossBadge variant="weak" size="xsmall" color="blue">{p.leadCountWithinWindow || 0}건</TossBadge>
            </td>
          ) : (
            <td style={{ ...tdStyle, textAlign: 'center' }}>
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                background: rec!.bg, color: rec!.color, border: `1px solid ${rec!.border}`,
              }}>{rec!.label}</span>
            </td>
          )}
        </tr>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '신규 MOU', value: combinedTotal, unit: '개', color: '#191F28', bg: '#F2F4F6' },
            { label: '안착', value: combinedSettled, unit: '개', color: '#20C997', bg: '#E3FAF0' },
            { label: '미안착', value: combinedTotal - combinedSettled, unit: '개', color: '#F04452', bg: '#FFF0F0' },
            { label: '안착률', value: combinedRate, unit: '%', color: parseFloat(combinedRate) >= 80 ? '#20C997' : '#F04452', bg: parseFloat(combinedRate) >= 80 ? '#E3FAF0' : '#FFF0F0' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>{item.unit}</span></div>
            </div>
          ))}
        </div>

        {/* 파트너사/본사 탭 */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csOnboardTab === 'partner' ? 700 : 500, background: csOnboardTab === 'partner' ? '#191F28' : '#F2F4F6', color: csOnboardTab === 'partner' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
            onClick={() => setCsOnboardTab('partner')}
          >파트너사 ({partnerOnboard.settled || 0}/{partnerOnboard.total || 0})</button>
          <button
            style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csOnboardTab === 'hq' ? 700 : 500, background: csOnboardTab === 'hq' ? '#00B8D9' : '#F2F4F6', color: csOnboardTab === 'hq' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
            onClick={() => setCsOnboardTab('hq')}
          >프랜차이즈 본사 ({hqOnboard.settled || 0}/{hqOnboard.total || 0})</button>
        </div>

        {/* 담당자별 그룹핑 섹션 */}
        {ownerEntries.length > 0 ? ownerEntries.map(([owner, group]) => {
          const hasUnsettled = group.unsettled.length > 0;
          const settledOpen = csOnboardSettledOpen[`${csOnboardTab}-${owner}`] || false;

          // 미안착 정렬: 미팅 0건 우선 → 경과일 많은 순
          const sortedUnsettled = [...group.unsettled].sort((a, b) => {
            if ((a.eventCount || 0) === 0 && (b.eventCount || 0) > 0) return -1;
            if ((a.eventCount || 0) > 0 && (b.eventCount || 0) === 0) return 1;
            return new Date(a.mouStart || 0).getTime() - new Date(b.mouStart || 0).getTime();
          });

          return (
            <div key={owner} style={{
              borderRadius: '12px', border: '1px solid #E5E8EB', overflow: 'hidden',
              borderLeft: `4px solid ${hasUnsettled ? '#FF6B6B' : '#51CF66'}`,
            }}>
              {/* 담당자 헤더 */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', background: hasUnsettled ? '#FFFAF9' : '#F8FFF8',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#191F28' }}>👤 {owner}</span>
                  <TossBadge variant="weak" size="xsmall" color="elephant">MOU {group.unsettled.length + group.settled.length}</TossBadge>
                  {group.settled.length > 0 && <TossBadge variant="weak" size="xsmall" color="green">안착 {group.settled.length}</TossBadge>}
                  {group.unsettled.length > 0 && <TossBadge variant="fill" size="xsmall" color="red">미안착 {group.unsettled.length}</TossBadge>}
                </div>
              </div>

              {/* 미안착 — 미팅 추천 대상 */}
              {hasUnsettled && (
                <div>
                  <div style={{
                    padding: '8px 16px', background: '#FFF5F5',
                    fontSize: '13px', fontWeight: 700, color: '#F04452',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    borderTop: '1px solid #FFC9C9', borderBottom: '1px solid #FFC9C9',
                  }}>
                    ⚠️ 미팅 추천 대상 ({group.unsettled.length}개사)
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ background: '#FFF8F8' }}>
                          <th style={{ ...thStyle, fontSize: '13px' }}>{csOnboardTab === 'partner' ? '파트너명' : '본사명'}</th>
                          <th style={{ ...thStyle, fontSize: '13px' }}>MOU 시작</th>
                          <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>경과일</th>
                          <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>미팅</th>
                          <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>Task</th>
                          <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>추천</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedUnsettled.map((p: any, i: number) => renderPartnerRow(p, i, false))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 안착 완료 — 접기/펼치기 */}
              {group.settled.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: '8px 16px', background: '#F0FAF0',
                      fontSize: '13px', fontWeight: 600, color: '#20C997',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', borderTop: '1px solid #E5E8EB',
                      userSelect: 'none',
                    }}
                    onClick={() => setCsOnboardSettledOpen(prev => ({
                      ...prev,
                      [`${csOnboardTab}-${owner}`]: !settledOpen,
                    }))}
                  >
                    <span>✅ 안착 완료 ({group.settled.length}개사)</span>
                    <span style={{ fontSize: '12px', color: '#8B95A1' }}>{settledOpen ? '▲ 접기' : '▼ 펼치기'}</span>
                  </div>
                  {settledOpen && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead>
                          <tr style={{ background: '#F0FAF0' }}>
                            <th style={{ ...thStyle, fontSize: '13px' }}>{csOnboardTab === 'partner' ? '파트너명' : '본사명'}</th>
                            <th style={{ ...thStyle, fontSize: '13px' }}>MOU 시작</th>
                            <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>경과일</th>
                            <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>미팅</th>
                            <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>Task</th>
                            <th style={{ ...thStyle, fontSize: '13px', textAlign: 'center' }}>리드</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.settled.map((p: any, i: number) => renderPartnerRow(p, i, true))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#8B95A1', background: '#F9FAFB', borderRadius: '10px' }}>
            온보딩 대상이 없습니다
          </div>
        )}
      </div>
    );
  }

  function renderCSActiveDetail() {
    const allPartners = csPartnerStats || [];
    const allHQ = csFranchiseHQList || [];
    const am = csKpi?.am;
    const active90d = am?.activeChannels90d?.value ?? 0;
    const activePartners = am?.activeChannels90d?.partners ?? 0;
    const activeHQ = am?.activeChannels90d?.hq ?? 0;
    const now = new Date();

    // 활동 기반 분류 함수
    const classifyActivity = (lastDate: string | null | undefined): { status: string; days: number | null; color: string; bg: string } => {
      if (!lastDate) return { status: '활동없음', days: null, color: '#F04452', bg: '#FFF5F5' };
      const d = Math.floor((now.getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
      if (d > 90) return { status: '90일+', days: d, color: '#FF8800', bg: '#FFFBE6' };
      if (d > 30) return { status: '30~90일', days: d, color: '#6B7684', bg: 'transparent' };
      return { status: '활성', days: d, color: '#20C997', bg: 'transparent' };
    };

    // 파트너사 enrichment + 정렬
    const enrichedPartners = allPartners.map((p: any) => {
      const activity = classifyActivity(p.lastLeadDate);
      return { ...p, ...activity, _type: 'partner' as const };
    }).sort((a: any, b: any) => {
      if (a.days === null && b.days !== null) return -1;
      if (b.days === null && a.days !== null) return 1;
      return (b.days ?? 0) - (a.days ?? 0);
    });

    // 프랜차이즈 본사 enrichment + 정렬
    const enrichedHQ = allHQ.map((hq: any) => {
      const activity = classifyActivity(hq.lastLeadDate);
      return { ...hq, ...activity, _type: 'hq' as const };
    }).sort((a: any, b: any) => {
      if (a.days === null && b.days !== null) return -1;
      if (b.days === null && a.days !== null) return 1;
      return (b.days ?? 0) - (a.days ?? 0);
    });

    const currentList = amActivePartnerTab === 'partner' ? enrichedPartners : enrichedHQ;
    const noActivity = currentList.filter((p: any) => p.days === null).length;
    const over90 = currentList.filter((p: any) => p.days !== null && p.days > 90).length;
    const within30 = currentList.filter((p: any) => p.days !== null && p.days <= 30).length;

    // 전체 담당자별 요약
    const byOwner: Record<string, { total: number; noActivity: number; over90: number }> = {};
    currentList.forEach((p: any) => {
      const owner = p.owner || '-';
      if (!byOwner[owner]) byOwner[owner] = { total: 0, noActivity: 0, over90: 0 };
      byOwner[owner].total++;
      if (p.days === null) byOwner[owner].noActivity++;
      else if (p.days > 90) byOwner[owner].over90++;
    });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 기준 안내 */}
        <div style={{ fontSize: '13px', color: '#8B95A1', background: '#F9FAFB', padding: '8px 12px', borderRadius: '8px' }}>
          최근 90일 이내 Lead를 1건 이상 생성한 파트너 수 (목표: 월 70개)
        </div>

        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '전체 파트너', value: allPartners.length + allHQ.length, unit: '개', color: '#191F28', bg: '#F2F4F6' },
            { label: '활성 (90일)', value: active90d, unit: '개', color: active90d >= 70 ? '#20C997' : '#F04452', bg: active90d >= 70 ? '#E3FAF0' : '#FFF0F0' },
            { label: '활성 파트너사', value: activePartners, unit: '개', color: '#3182F6', bg: '#E8F3FF' },
            { label: '활성 본사', value: activeHQ, unit: '개', color: '#00B8D9', bg: '#E3FAFC' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>{item.unit}</span></div>
            </div>
          ))}
        </div>

        {/* 파트너사/본사 탭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {([
            { key: 'partner' as const, label: '파트너사', count: allPartners.length, color: '#3182F6' },
            { key: 'hq' as const, label: '프랜차이즈 본사', count: allHQ.length, color: '#00B8D9' },
          ]).map(t => {
            const active = amActivePartnerTab === t.key;
            return (
              <button key={t.key} onClick={() => setAmActivePartnerTab(t.key)} style={{
                padding: '6px 14px', borderRadius: '20px', fontSize: '14px', fontWeight: 600,
                border: active ? `2px solid ${t.color}` : '1px solid #E5E8EB',
                background: active ? `${t.color}12` : '#fff',
                color: active ? t.color : '#6B7684',
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {t.label} {t.count}개
              </button>
            );
          })}
        </div>

        {/* 활동 상태 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '활동없음', value: noActivity, color: '#F04452', bg: '#FFF0F0' },
            { label: '90일+ 경과', value: over90, color: '#FF8800', bg: '#FFF8E8' },
            { label: '30일 이내', value: within30, color: '#20C997', bg: '#E3FAF0' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '10px 8px', borderRadius: '10px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#6B7684', fontWeight: 600, marginBottom: '2px' }}>{item.label}</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: item.color }}>{item.value}개</div>
            </div>
          ))}
        </div>

        {/* 담당자별 뱃지 */}
        {Object.keys(byOwner).length > 0 && (
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '10px' }}>담당자별 현황</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {Object.entries(byOwner).sort((a, b) => b[1].noActivity - a[1].noActivity).map(([owner, s]) => (
                <div key={owner} style={{ padding: '10px 14px', borderRadius: '10px', background: '#F9FAFB', border: '1px solid #E5E8EB', minWidth: '130px' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#191F28', marginBottom: '6px' }}>{owner}</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <TossBadge variant="weak" size="xsmall" color="elephant">{s.total}개</TossBadge>
                    {s.noActivity > 0 && <TossBadge variant="fill" size="xsmall" color="red">활동없음 {s.noActivity}</TossBadge>}
                    {s.over90 > 0 && <TossBadge variant="weak" size="xsmall" color="yellow">90일+ {s.over90}</TossBadge>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw 파트너 테이블 */}
        {currentList.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>{amActivePartnerTab === 'partner' ? '파트너명' : '본사명'}</th>
                  <th style={thStyle}>담당자</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>이번달 리드</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>3개월 리드</th>
                  <th style={thStyle}>마지막 리드</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>경과일</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>미팅</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>{amActivePartnerTab === 'partner' ? '추천매장' : '브랜드'}</th>
                </tr>
              </thead>
              <tbody>
                {currentList.map((p: any, idx: number) => {
                  const isNoAct = p.days === null;
                  const isOld = p.days !== null && p.days > 90;
                  const rowBg = isNoAct ? '#FFF5F5' : isOld ? '#FFFBE6' : 'transparent';
                  const name = amActivePartnerTab === 'partner' ? p.name : (p.hqName || p.name);
                  const id = amActivePartnerTab === 'partner' ? p.id : p.hqId;
                  return (
                    <tr key={id || idx} style={{ borderBottom: '1px solid #F2F4F6', background: rowBg }}>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: '#191F28' }}>{name || '-'}</span>
                      </td>
                      <td style={tdStyle}>{ownerBold(p.owner || '-')}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {(p.thisMonthLeadCount ?? 0) > 0
                          ? <TossBadge variant="weak" size="xsmall" color="blue">{p.thisMonthLeadCount}건</TossBadge>
                          : <span style={{ color: '#B0B8C1' }}>0</span>
                        }
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {(p.last3MonthLeadCount ?? 0) > 0
                          ? <span style={{ fontWeight: 600 }}>{p.last3MonthLeadCount}</span>
                          : <span style={{ color: '#B0B8C1' }}>0</span>
                        }
                      </td>
                      <td style={tdStyle}>{p.lastLeadDate || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {isNoAct
                          ? <TossBadge variant="fill" size="xsmall" color="red">활동없음</TossBadge>
                          : isOld
                            ? <TossBadge variant="fill" size="xsmall" color="yellow">{p.days}일</TossBadge>
                            : p.days <= 30
                              ? <TossBadge variant="weak" size="xsmall" color="green">{p.days}일</TossBadge>
                              : <TossBadge variant="weak" size="xsmall" color="elephant">{p.days}일</TossBadge>
                        }
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {(p.meetingCount ?? 0) > 0
                          ? <span
                              onClick={(e) => {
                                e.stopPropagation();
                                if (amActivePartnerTab === 'partner') {
                                  setMeetingModal({ accountId: p.id, accountName: p.name });
                                }
                              }}
                              style={{ cursor: amActivePartnerTab === 'partner' ? 'pointer' : 'default' }}
                            >
                              <TossBadge variant="weak" size="xsmall" color="teal">{p.meetingCount}건</TossBadge>
                            </span>
                          : <span style={{ color: '#B0B8C1' }}>0</span>
                        }
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {amActivePartnerTab === 'partner'
                          ? (p.referredStoreCount ?? 0)
                          : (p.brands?.length ?? 0)
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#8B95A1', background: '#F9FAFB', borderRadius: '10px' }}>
            <div style={{ fontSize: '2em', marginBottom: '8px' }}>🔥</div>
            활성 파트너 데이터가 없습니다
          </div>
        )}
      </div>
    );
  }

  // Step 3: 리드 끊긴 파트너
  function renderCSChurnedDetail() {
    const list = csChurnedTab === 'partner' ? churnedPartners.partners : churnedPartners.hqs;
    const criticalCount = list.filter((p: any) => p.severity === 'critical').length;
    const warningCount = list.filter((p: any) => p.severity === 'warning').length;
    const recentCount = list.filter((p: any) => p.severity === 'recent').length;

    // 담당자별 집계
    const ownerMap: Record<string, { total: number; critical: number }> = {};
    list.forEach((p: any) => {
      const o = p.owner || '미지정';
      if (!ownerMap[o]) ownerMap[o] = { total: 0, critical: 0 };
      ownerMap[o].total++;
      if (p.severity === 'critical') ownerMap[o].critical++;
    });
    const owners = Object.entries(ownerMap).sort(([,a], [,b]) => b.critical - a.critical || b.total - a.total);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '전체 끊긴 파트너', value: churnedPartners.total, color: '#191F28', bg: '#F2F4F6' },
            { label: '파트너사', value: churnedPartners.partners.length, color: '#20C997', bg: '#E3FAF0' },
            { label: '프랜차이즈 본사', value: churnedPartners.hqs.length, color: '#00B8D9', bg: '#E3FAFC' },
            { label: '180일+ 위험', value: churnedPartners.critical, color: '#F04452', bg: '#FFF5F5' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>개</span></div>
            </div>
          ))}
        </div>

        {/* 심각도 카드 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { label: '180일+ 경과', count: criticalCount, color: '#F04452', bg: '#FFF5F5' },
            { label: '90~180일 경과', count: warningCount, color: '#FF9F43', bg: '#FFF8F0' },
            { label: '90일 이내', count: recentCount, color: '#20C997', bg: '#E3FAF0' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, padding: '10px', borderRadius: '10px', background: s.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#6B7684', fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.count}</div>
            </div>
          ))}
        </div>

        {/* 담당자별 뱃지 */}
        {owners.length > 0 && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '8px' }}>담당자별</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {owners.map(([owner, data]) => (
                <div key={owner} style={{ padding: '8px 12px', borderRadius: '10px', background: '#F9FAFB', border: '1px solid #E5E8EB' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#191F28', marginBottom: '4px' }}>{owner}</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <TossBadge variant="weak" size="xsmall" color="elephant">{data.total}개</TossBadge>
                    {data.critical > 0 && <TossBadge variant="weak" size="xsmall" color="red">위험 {data.critical}</TossBadge>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 파트너사/본사/소개매장 탭 */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csChurnedTab === 'partner' ? 700 : 500, background: csChurnedTab === 'partner' ? '#191F28' : '#F2F4F6', color: csChurnedTab === 'partner' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
            onClick={() => setCsChurnedTab('partner')}
          >파트너사 ({churnedPartners.partners.length})</button>
          <button
            style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csChurnedTab === 'hq' ? 700 : 500, background: csChurnedTab === 'hq' ? '#00B8D9' : '#F2F4F6', color: csChurnedTab === 'hq' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
            onClick={() => setCsChurnedTab('hq')}
          >프랜차이즈 본사 ({churnedPartners.hqs.length})</button>
          <button
            style={{ padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: csChurnedTab === 'storeCX' ? 700 : 500, background: csChurnedTab === 'storeCX' ? '#FF8800' : '#F2F4F6', color: csChurnedTab === 'storeCX' ? '#fff' : '#6B7684', border: 'none', cursor: 'pointer' }}
            onClick={() => setCsChurnedTab('storeCX')}
          >소개매장 고객경험 ({storeCXStats.storesWithCases}/{storeCXStats.totalStores})</button>
        </div>

        {/* 소개매장 고객경험 서브뷰 */}
        {csChurnedTab === 'storeCX' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '13px', color: '#8B95A1', background: '#F9FAFB', padding: '8px 12px', borderRadius: '8px' }}>
              온보딩 파트너(최근 3개월 MOU) {storeCXStats.partnerCount}개사의 소개매장 기준
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {[
                { label: '소개매장', value: storeCXStats.totalStores, unit: '개', color: '#191F28', bg: '#F2F4F6' },
                { label: '케이스 매장', value: storeCXStats.storesWithCases, unit: '개', color: '#F04452', bg: '#FFF5F5' },
                { label: '발생률', value: storeCXStats.caseRate, unit: '%', color: '#FF9F43', bg: '#FFF8F0' },
                { label: '평균 해결', value: storeCXStats.avgLeadtime, unit: '시간', color: '#3182F6', bg: '#E8F3FF' },
              ].map(item => (
                <div key={item.label} style={{ flex: '1 1 70px', padding: '10px 6px', borderRadius: '10px', background: item.bg, textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#6B7684', fontWeight: 600, marginBottom: '2px' }}>{item.label}</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '13px', fontWeight: 600 }}>{item.unit}</span></div>
                </div>
              ))}
            </div>
            {storeCXStats.topCaseTypes.length > 0 && (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '6px' }}>Case 유형 Top</div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  {storeCXStats.topCaseTypes.map(([type, count]: [string, number]) => (
                    <TossBadge key={type} variant="weak" size="xsmall" color={count > 5 ? 'red' : count > 2 ? 'yellow' : 'elephant'}>{type} {count}건</TossBadge>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(storeCXStats.caseStatusMap).length > 0 && (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '6px' }}>Case 상태</div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  {Object.entries(storeCXStats.caseStatusMap).sort(([,a]: any, [,b]: any) => b - a).map(([status, count]: any) => (
                    <TossBadge key={status} variant="weak" size="xsmall" color={status === 'Closed' ? 'green' : status === 'Open' ? 'red' : 'blue'}>{status} {count}건</TossBadge>
                  ))}
                </div>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead><tr style={{ background: '#F9FAFB' }}>
                  <th style={thStyle}>소개파트너</th><th style={thStyle}>매장명</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>생성일</th><th style={{ ...thStyle, textAlign: 'right' }}>Case</th>
                  <th style={thStyle}>주요 유형</th>
                </tr></thead>
                <tbody>
                  {storeCXStats.allStoreRows.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#B0B8C1', padding: '20px' }}>소개매장 데이터가 없습니다</td></tr>
                  ) : storeCXStats.allStoreRows.map((s: any, i: number) => {
                    const rowBg = (s.caseCount ?? 0) > 0 ? '#FFF5F5' : 'transparent';
                    const topType = (s.caseSummary || [])[0];
                    return (
                      <tr key={s.storeId || i} style={{ borderBottom: '1px solid #F2F4F6', background: rowBg }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600 }}>{s.partnerName || '-'}</span> <span style={{ fontSize: '12px', color: '#8B95A1' }}>{s.partnerOwner || ''}</span></td>
                        <td style={tdStyle}>{s.storeName || '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontSize: '13px', color: '#8B95A1' }}>{s.createdDate || '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{(s.caseCount ?? 0) > 0 ? <TossBadge variant="weak" size="xsmall" color="red">{s.caseCount}건</TossBadge> : <span style={{ color: '#B0B8C1' }}>0</span>}</td>
                        <td style={tdStyle}>{topType ? <span style={{ fontSize: '13px', color: '#6B7684' }}>{topType.type2 && topType.type2 !== '-' ? `${topType.type}/${topType.type2}` : topType.type || '-'}{topType.status && <span style={{ marginLeft: '4px', color: topType.status === 'Closed' ? '#20C997' : '#F04452' }}>({topType.status})</span>}</span> : <span style={{ color: '#B0B8C1' }}>-</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
        <>
        {/* 끊긴 파트너 테이블 */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle}>{csChurnedTab === 'partner' ? '파트너명' : '본사명'}</th>
                <th style={thStyle}>담당자</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>마지막 리드</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>경과일</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>3개월 리드</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>미팅</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>추천매장</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#B0B8C1', padding: '20px' }}>끊긴 파트너가 없습니다</td></tr>
              ) : list.map((p: any, i: number) => {
                const rowBg = p.severity === 'critical' ? '#FFF5F5' : p.severity === 'warning' ? '#FFFBF0' : 'transparent';
                return (
                  <tr key={p.id || p.hqId || i} style={{ borderBottom: '1px solid #F2F4F6', background: rowBg }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600 }}>{csChurnedTab === 'partner' ? p.name : p.hqName}</span>
                    </td>
                    <td style={tdStyle}>{p.owner || '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{p.lastLeadDate || '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {p.days != null ? (
                        <TossBadge variant="weak" size="xsmall" color={p.severity === 'critical' ? 'red' : p.severity === 'warning' ? 'yellow' : 'green'}>
                          {p.days}일
                        </TossBadge>
                      ) : <TossBadge variant="weak" size="xsmall" color="red">이력없음</TossBadge>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{p.last3MonthLeadCount ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {(p.meetingCount ?? 0) > 0 ? (
                        <span style={{ cursor: 'pointer' }} onClick={() => setMeetingModal({ accountId: p.id || p.hqId, accountName: csChurnedTab === 'partner' ? p.name : p.hqName })}>
                          <TossBadge variant="weak" size="xsmall" color="teal">{p.meetingCount}</TossBadge>
                        </span>
                      ) : <span style={{ color: '#B0B8C1' }}>0</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{p.referredStoreCount ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
        )}
      </div>
    );
  }

  // Step 4: 소개매장 고객경험
  function renderCSStoreCXDetail() {
    const { totalStores, totalCases, storesWithCases, caseRate, avgLeadtime, topCaseTypes, caseStatusMap, allStoreRows, partnerCount } = storeCXStats;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 범위 안내 */}
        <div style={{ fontSize: '13px', color: '#8B95A1', background: '#F9FAFB', padding: '8px 12px', borderRadius: '8px' }}>
          온보딩 파트너(최근 3개월 MOU) {partnerCount}개사의 소개매장 기준
        </div>

        {/* 요약 카드 */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            { label: '소개매장 합계', value: totalStores, unit: '개', color: '#191F28', bg: '#F2F4F6' },
            { label: '케이스 발생 매장', value: storesWithCases, unit: '개', color: '#F04452', bg: '#FFF5F5' },
            { label: '케이스 발생률', value: caseRate, unit: '%', color: '#FF9F43', bg: '#FFF8F0' },
            { label: '평균 해결시간', value: avgLeadtime, unit: '시간', color: '#3182F6', bg: '#E8F3FF' },
          ].map(item => (
            <div key={item.label} style={{ flex: '1 1 80px', padding: '12px 8px', borderRadius: '12px', background: item.bg, textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6B7684', fontWeight: 600, marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: item.color }}>{item.value}<span style={{ fontSize: '14px', fontWeight: 600 }}>{item.unit}</span></div>
            </div>
          ))}
        </div>

        {/* Case 유형 Top */}
        {topCaseTypes.length > 0 && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '8px' }}>Case 유형 Top</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {topCaseTypes.map(([type, count]) => (
                <TossBadge key={type} variant="weak" size="xsmall" color={count > 5 ? 'red' : count > 2 ? 'yellow' : 'elephant'}>
                  {type} {count}건
                </TossBadge>
              ))}
            </div>
          </div>
        )}

        {/* Case 상태 분포 */}
        {Object.keys(caseStatusMap).length > 0 && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '8px' }}>Case 상태</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {Object.entries(caseStatusMap).sort(([,a], [,b]) => b - a).map(([status, count]) => (
                <TossBadge key={status} variant="weak" size="xsmall" color={status === 'Closed' ? 'green' : status === 'Open' ? 'red' : 'blue'}>
                  {status} {count}건
                </TossBadge>
              ))}
            </div>
          </div>
        )}

        {/* 매장 테이블 */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle}>소개파트너</th>
                <th style={thStyle}>매장명</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>생성일</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Case</th>
                <th style={thStyle}>주요 유형</th>
              </tr>
            </thead>
            <tbody>
              {allStoreRows.length === 0 ? (
                <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#B0B8C1', padding: '20px' }}>소개매장 데이터가 없습니다</td></tr>
              ) : allStoreRows.map((s: any, i: number) => {
                const rowBg = (s.caseCount ?? 0) > 0 ? '#FFF5F5' : 'transparent';
                const topType = (s.caseSummary || [])[0];
                return (
                  <tr key={s.storeId || i} style={{ borderBottom: '1px solid #F2F4F6', background: rowBg }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600 }}>{s.partnerName || '-'}</span>
                      <span style={{ fontSize: '12px', color: '#8B95A1', marginLeft: '4px' }}>{s.partnerOwner || ''}</span>
                    </td>
                    <td style={tdStyle}>{s.storeName || '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontSize: '13px', color: '#8B95A1' }}>{s.createdDate || '-'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {(s.caseCount ?? 0) > 0
                        ? <TossBadge variant="weak" size="xsmall" color="red">{s.caseCount}건</TossBadge>
                        : <span style={{ color: '#B0B8C1' }}>0</span>}
                    </td>
                    <td style={tdStyle}>
                      {topType ? (
                        <span style={{ fontSize: '13px', color: '#6B7684' }}>
                          {topType.type2 && topType.type2 !== '-' ? `${topType.type}/${topType.type2}` : topType.type || '-'}
                          {topType.status && <span style={{ marginLeft: '4px', color: topType.status === 'Closed' ? '#20C997' : '#F04452' }}>({topType.status})</span>}
                        </span>
                      ) : <span style={{ color: '#B0B8C1' }}>-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const csAmDetailRenderers = [renderCSMeetAMDetail, renderCSOnboardDetail, renderCSActiveDetail, renderCSLeadDetail];

  // ============ 채널 TM 플로우 ============
  const csTm = data?.channel?.tm;

  const csTmFlowSteps: FlowStep[] = useMemo(() => {
    if (!csTm) return [];
    const dc = csTm.dailyConversion || {};
    const avgDailyPerPerson = dc.avgDailyPerPerson ?? 0;
    const totalActions = dc.total ?? 0;
    const visitAssigned = dc.visitAssigned ?? 0;
    const quoteSentCount = dc.quoteSent ?? 0;
    const tmMemberCount = dc.tmMemberCount ?? 1;
    const frtOver20 = csTm.frt?.frtOver20 ?? 0;
    const tmFrtByTimeSlot = csTm.frt?.byTimeSlot;
    const unconvertedCount = csTm.unconvertedMQL?.count ?? 0;
    const over7 = csTm.sqlBacklog?.over7 ?? 0;
    return [
      {
        key: 'csTmFrt', label: 'FRT', value: `${frtOver20}건 초과`,
        detail: tmFrtByTimeSlot
          ? `영업 ${tmFrtByTimeSlot.biz?.rate ?? '-'}% · 영업외 ${tmFrtByTimeSlot.offHour?.rate ?? '-'}% · 주말 ${tmFrtByTimeSlot.weekend?.rate ?? '-'}%`
          : `준수 ${csTm.frt?.frtOk ?? 0} / 전체 ${csTm.frt?.totalWithTask ?? 0}건`,
        target: '목표 0건', met: frtOver20 === 0,
        color: frtOver20 === 0 ? 'green' : 'red', rawCount: frtOver20, icon: '⏱️',
      },
      {
        key: 'csTmMql', label: 'MQL → SQL', value: `${unconvertedCount}건 미전환`,
        detail: `MQL ${csTm.unconvertedMQL?.funnel?.mql ?? 0} → SQL ${csTm.unconvertedMQL?.funnel?.sql ?? 0}`,
        target: '목표 0건', met: unconvertedCount === 0,
        color: unconvertedCount === 0 ? 'green' : 'red', rawCount: unconvertedCount, icon: '🚫',
      },
      {
        key: 'csTmBacklog', label: 'SQL → 견적', value: `${over7}건 (7일+)`,
        detail: `TM 구간 ${csTm.sqlBacklog?.openTotal ?? 0}건 중`,
        target: '목표 ≤10건', met: over7 <= 10,
        color: over7 <= 10 ? 'green' : 'red', rawCount: over7, icon: '📋',
      },
      {
        key: 'csTmConversion', label: '인당 전환', value: `${avgDailyPerPerson}건/일`,
        detail: `방문배정 ${visitAssigned} + 견적발송 ${quoteSentCount} (${tmMemberCount}명, ${dc.totalWeekdays ?? 0}일)`,
        target: '목표 5건/일', met: avgDailyPerPerson >= 5,
        color: avgDailyPerPerson >= 5 ? 'green' : 'red', rawCount: totalActions, icon: '🔄',
      },
    ];
  }, [csTm]);

  // TM 상세 1: 인당 전환 — 담당자별 KPI 카드
  function renderCSTmConversionDetail() {
    const dc = csTm?.dailyConversion || {};

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* KPI 산출 공식 */}
        <div style={{ padding: '12px 16px', background: '#F8F9FA', borderRadius: '10px', border: '1px solid #E5E8EB' }}>
          <div style={{ fontSize: '13px', color: '#6B7684', marginBottom: '6px' }}>KPI 산출 공식</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#191F28' }}>
            인당 전환 = (방문배정 {dc.visitAssigned ?? 0}건 + 견적발송 {dc.quoteSent ?? 0}건) ÷ {dc.totalWeekdays ?? 0}일 ÷ {dc.tmMemberCount ?? 1}명 = <span style={{ color: (dc.avgDailyPerPerson ?? 0) >= 5 ? '#20C997' : '#F04452' }}>{dc.avgDailyPerPerson ?? 0}건/일</span>
          </div>
        </div>

        {/* 담당자별 일별 실적 히트맵 (방문배정 + 견적발송 분리) */}
        {(() => {
          const dailyData = csTm?.rawData?.dailyByOwner || [];
          if (dailyData.length === 0) return null;

          const dateSet = new Set<string>();
          const ownerSet = new Set<string>();
          const pivot: Record<string, Record<string, { visit: number; quote: number; total: number }>> = {};
          const ownerTotals: Record<string, { visit: number; quote: number; total: number }> = {};

          dailyData.forEach((d: any) => {
            if (/^[0-9a-zA-Z]{15,}$/.test(d.ownerName)) return;
            dateSet.add(d.date);
            ownerSet.add(d.ownerName);
            if (!pivot[d.date]) pivot[d.date] = {};
            pivot[d.date][d.ownerName] = { visit: d.visit, quote: d.quote, total: d.total };
            if (!ownerTotals[d.ownerName]) ownerTotals[d.ownerName] = { visit: 0, quote: 0, total: 0 };
            ownerTotals[d.ownerName].visit += d.visit;
            ownerTotals[d.ownerName].quote += d.quote;
            ownerTotals[d.ownerName].total += d.total;
          });

          const dates = Array.from(dateSet).sort();
          const ownerNames = Array.from(ownerSet).sort((a, b) => (ownerTotals[b]?.total ?? 0) - (ownerTotals[a]?.total ?? 0));
          const weekdays = dates.filter(d => { const dow = new Date(d).getDay(); return dow !== 0 && dow !== 6; });
          const grandTotal = { visit: dc.visitAssigned ?? 0, quote: dc.quoteSent ?? 0, total: dc.total ?? 0 };

          // 히트맵 렌더 함수 (방문/견적 공용)
          const renderHeatmap = (
            type: 'visit' | 'quote',
            title: string,
            totalCount: number,
            accentColor: string,
            darkAccent: string,
            heatColors: { bg: string; fg: string }[]
          ) => {
            const heatBg = (val: number) => {
              if (val === 0) return '#F9FAFB';
              if (val >= 7) return heatColors[4].bg;
              if (val >= 5) return heatColors[3].bg;
              if (val >= 3) return heatColors[2].bg;
              if (val >= 2) return heatColors[1].bg;
              return heatColors[0].bg;
            };
            const heatFg = (val: number) => val >= 5 ? '#fff' : '#191F28';

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: darkAccent }}>{title}</span>
                  <TossBadge variant="fill" size="small" color={type === 'visit' ? 'green' : 'blue'}>{totalCount}건</TossBadge>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#8B95A1', marginLeft: 'auto' }}>
                    {heatColors.map((h, i) => (
                      <div key={i} style={{ width: '12px', height: '12px', background: h.bg, borderRadius: '2px' }} />
                    ))}
                    <span style={{ marginLeft: '2px' }}>낮음→높음</span>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '3px', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#6B7684', fontSize: '13px' }}>날짜</th>
                      {ownerNames.map(name => (
                        <th key={name} style={{ padding: '4px 6px', textAlign: 'center', minWidth: '56px' }}>
                          <div style={{ fontWeight: 700, color: '#191F28', fontSize: '13px' }}>{name}</div>
                        </th>
                      ))}
                      <th style={{ padding: '4px 6px', textAlign: 'center', minWidth: '44px' }}>
                        <div style={{ fontWeight: 600, color: '#6B7684', fontSize: '12px' }}>합계</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map(date => {
                      const dow = new Date(date).getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][dow];
                      const daySum = ownerNames.reduce((s, name) => s + (pivot[date]?.[name]?.[type] ?? 0), 0);
                      return (
                        <tr key={date}>
                          <td style={{ padding: '4px 10px', fontWeight: 500, whiteSpace: 'nowrap', fontSize: '14px' }}>
                            <span style={{ color: isWeekend ? '#F04452' : '#191F28' }}>{date.substring(5)}</span>
                            <span style={{ fontSize: '12px', color: isWeekend ? '#F04452' : '#B0B8C1', marginLeft: '3px' }}>{dayLabel}</span>
                          </td>
                          {ownerNames.map(name => {
                            const val = pivot[date]?.[name]?.[type] ?? 0;
                            return (
                              <td key={`${date}-${name}`} style={{ padding: '6px 4px', textAlign: 'center', background: heatBg(val), borderRadius: '5px' }}>
                                <div style={{ fontSize: '15px', fontWeight: 700, color: val > 0 ? heatFg(val) : '#D5D8DC' }}>{val || '-'}</div>
                              </td>
                            );
                          })}
                          <td style={{ padding: '6px 4px', textAlign: 'center', background: '#F2F4F6', borderRadius: '5px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28' }}>{daySum}</div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* 합계 행 */}
                    <tr>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#191F28', fontSize: '14px' }}>합계</td>
                      {ownerNames.map(name => {
                        const val = ownerTotals[name]?.[type] ?? 0;
                        return (
                          <td key={`t-${name}`} style={{ padding: '6px 4px', textAlign: 'center', background: darkAccent, borderRadius: '5px' }}>
                            <div style={{ fontSize: '16px', fontWeight: 800, color: '#fff' }}>{val}</div>
                          </td>
                        );
                      })}
                      <td style={{ padding: '6px 4px', textAlign: 'center', background: '#0f172a', borderRadius: '5px' }}>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#fff' }}>{totalCount}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {renderHeatmap('visit', '방문배정', grandTotal.visit, '#2e7d32', '#14532d',
                [{ bg: '#dcfce7', fg: '#191F28' }, { bg: '#86efac', fg: '#191F28' }, { bg: '#4ade80', fg: '#191F28' }, { bg: '#22c55e', fg: '#fff' }, { bg: '#15803d', fg: '#fff' }]
              )}
              {renderHeatmap('quote', '견적발송', grandTotal.quote, '#1d4ed8', '#1e3a5f',
                [{ bg: '#dbeafe', fg: '#191F28' }, { bg: '#93c5fd', fg: '#191F28' }, { bg: '#60a5fa', fg: '#191F28' }, { bg: '#3b82f6', fg: '#fff' }, { bg: '#1d4ed8', fg: '#fff' }]
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // TM 상세 2: FRT 초과 리스트
  function renderCSTmFrtDetail() {
    const tmTimeSlot = csTm?.frt?.byTimeSlot;
    const owners = (csTm?.byOwner as any[] || []).filter((o: any) =>
      o.lead >= 3 && o.name && !/^[0-9a-zA-Z]/.test(o.name)
    );
    const frtItems = csTm?.rawData?.frtOver20 || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* 시간대별 FRT 준수율 */}
        {tmTimeSlot && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>시간대별 FRT 준수율</span>
              <span style={{ fontSize: '14px', color: '#8B95A1' }}>영업시간: 평일 10:00~19:00</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {[
                { label: '영업시간', data: tmTimeSlot.biz, color: '#20C997', bg: '#E3FAF0' },
                { label: '영업외', data: tmTimeSlot.offHour, color: '#3182F6', bg: '#E8F3FF' },
                { label: '주말', data: tmTimeSlot.weekend, color: '#8B95A1', bg: '#F2F4F6' },
              ].map(slot => (
                <div key={slot.label} style={{
                  flex: '1 1 150px', padding: '16px', borderRadius: '12px',
                  background: slot.bg, textAlign: 'center', minWidth: '140px',
                }}>
                  <div style={{ fontSize: '14px', color: '#6B7684', fontWeight: 600, marginBottom: '6px' }}>{slot.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: slot.color }}>{slot.data?.rate ?? '-'}%</div>
                  <div style={{ fontSize: '14px', color: '#8B95A1', marginTop: '4px' }}>
                    {slot.data?.ok ?? 0} / {slot.data?.total ?? 0}건
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 담당자별 FRT 현황 */}
        {owners.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 FRT 현황</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>FRT 준수</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>FRT 초과</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>준수율</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>평균 FRT</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((o: any) => {
                    const total = (o.frtOk ?? 0) + (o.frtOver20 ?? 0);
                    const rate = total > 0 ? +((o.frtOk / total) * 100).toFixed(1) : 0;
                    return (
                      <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant="weak" size="xsmall" color="green">{o.frtOk ?? 0}건</TossBadge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {(o.frtOver20 ?? 0) > 0
                            ? <TossBadge variant="fill" size="xsmall" color="red">{o.frtOver20}건</TossBadge>
                            : <span style={{ color: '#B0B8C1' }}>0건</span>
                          }
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant={rate >= 80 ? 'weak' : 'fill'} size="xsmall" color={rate >= 80 ? 'green' : rate >= 50 ? 'yellow' : 'red'}>
                            {rate}%
                          </TossBadge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant="weak" size="xsmall" color={(o.avgFrt ?? 0) <= 20 ? 'green' : 'red'}>
                            {fmtFrt(o.avgFrt ?? 0)}
                          </TossBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* FRT 20분 초과 Raw 데이터 */}
        {frtItems.length > 0 ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>FRT 20분 초과 상세</span>
                <TossBadge variant="fill" size="small" color="red">{frtItems.length}건</TossBadge>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(() => {
                  const weekend = frtItems.filter((r: any) => r.createdDow === 0 || r.createdDow === 6).length;
                  const offHour = frtItems.filter((r: any) => r.createdDow !== null && r.createdDow !== 0 && r.createdDow !== 6 && (r.createdHour < 10 || r.createdHour >= 19)).length;
                  const bizHour = frtItems.length - weekend - offHour;
                  return (
                    <>
                      <TossBadge variant="weak" size="xsmall" color="green">영업 {bizHour}</TossBadge>
                      <TossBadge variant="weak" size="xsmall" color="blue">영업외 {offHour}</TossBadge>
                      <TossBadge variant="weak" size="xsmall" color="elephant">주말 {weekend}</TossBadge>
                    </>
                  );
                })()}
              </div>
            </div>
            <DataTable columns={tmFrtOver20Columns} data={frtItems} loading={false} className="daily-raw daily-raw-red" />
          </div>
        ) : (
          <div style={{ color: '#20C997', padding: '20px', textAlign: 'center', fontWeight: 600 }}>FRT 초과 건 없음 ✓</div>
        )}
      </div>
    );
  }

  // TM 상세 3: MQL 미전환 리스트
  function renderCSTmMqlDetail() {
    const owners = (csTm?.byOwner as any[] || []).filter((o: any) =>
      o.lead >= 3 && o.name && !/^[0-9a-zA-Z]/.test(o.name)
    );
    const unconvertedItems = csTm?.rawData?.unconvertedMQL || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* 담당자별 MQL→SQL 전환 현황 */}
        {owners.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 SQL 전환 현황</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '18px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    <th style={thStyle}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Lead</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>MQL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>미전환</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((o: any) => {
                    const rate = o.mql > 0 ? +((o.sql / o.mql) * 100).toFixed(1) : 0;
                    return (
                      <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: '#191F28' }}>{o.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <span style={{ color: '#6B7684' }}>{o.lead ?? 0}건</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <span style={{ fontWeight: 600, color: '#191F28' }}>{o.mql ?? 0}건</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <span style={{ fontWeight: 700, color: '#191F28' }}>{o.sql ?? 0}건</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <TossBadge variant={rate >= 90 ? 'weak' : 'fill'} size="xsmall" color={rate >= 90 ? 'green' : rate >= 70 ? 'yellow' : 'red'}>
                            {rate}%
                          </TossBadge>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {(o.unconvertedMQL ?? 0) > 0
                            ? <TossBadge variant="fill" size="xsmall" color="red">{o.unconvertedMQL}건</TossBadge>
                            : <span style={{ color: '#B0B8C1' }}>0건</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 미전환 MQL Raw 데이터 — 계류/종료 분리 */}
        {(() => {
          const openItems = unconvertedItems.filter((r: any) => r.group === 'open');
          const closedItems = unconvertedItems.filter((r: any) => r.group === 'closed');

          if (unconvertedItems.length === 0) {
            return <div style={{ color: '#20C997', padding: '20px', textAlign: 'center', fontWeight: 600 }}>미전환 MQL 없음 ✓</div>;
          }

          // 계류 건: 컨택 현황이 핵심
          const openColumns = [
            { key: 'name', header: '이름', render: sfLink },
            { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
            { key: 'channel', header: '채널', render: channelSourceRender },
            { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
            { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
            { key: 'lastTaskDate', header: '마지막 터치', render: (v: string) => lastTouchRender(v) },
          ];

          // 종료 건: 종료 사유가 핵심
          const closedColumns = [
            { key: 'name', header: '이름', render: sfLink },
            { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
            { key: 'channel', header: '채널', render: channelSourceRender },
            { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
            { key: 'lossReason', header: '취소사유', render: (v: string) => reasonBadge(v) },
            { key: 'lossReasonSub', header: '세부항목', render: (v: string) => lossReasonSubRender(v) },
            { key: 'lossReasonDetail', header: '취소 상세', render: (v: string) => lossReasonDetailRender(v) },
          ];

          return (
            <>
              {/* 계류 건 */}
              {openItems.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>📋 계류 건</span>
                    <TossBadge variant="fill" size="small" color="yellow">{openItems.length}건</TossBadge>
                    <span style={{ fontSize: '13px', color: '#8B95A1' }}>지속 컨택 여부 확인</span>
                  </div>
                  <DataTable columns={openColumns} data={openItems} loading={false} className="daily-raw daily-raw-orange" />
                </div>
              )}

              {/* 종료 건 */}
              {closedItems.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>🔒 종료 건</span>
                    <TossBadge variant="fill" size="small" color="elephant">{closedItems.length}건</TossBadge>
                    <span style={{ fontSize: '13px', color: '#8B95A1' }}>종료 사유 분석</span>
                  </div>
                  <DataTable columns={closedColumns} data={closedItems} loading={false} className="daily-raw" />
                </div>
              )}
            </>
          );
        })()}
      </div>
    );
  }

  // TM 상세 4: SQL 잔량 리스트 (FRT/MQL 패턴 적용)
  function renderCSTmBacklogDetail() {
    const backlogList = csTm?.rawData?.rawOpenOpps || [];
    const over7 = csTm?.sqlBacklog?.over7 ?? 0;
    const openTotal = csTm?.sqlBacklog?.openTotal ?? 0;
    const byOwner = csTm?.sqlBacklog?.byOwner || [];
    if (backlogList.length === 0 && openTotal === 0) return <div style={{ color: '#8B95A1', padding: '20px', textAlign: 'center' }}>SQL 잔량 없음 ✓</div>;

    // 담당자별 렌더러
    const stageRender = (v: any) => {
      if (!v || typeof v !== 'object') return <span style={{ color: '#B0B8C1' }}>-</span>;
      return (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {Object.entries(v).map(([stage, cnt]) => (
            <TossBadge key={stage} variant="weak" size="xsmall" color="blue">{stage} {String(cnt)}</TossBadge>
          ))}
        </div>
      );
    };

    // 경과일 렌더러
    const ageRender = (v: any) => {
      const days = v ?? 0;
      return <span style={{ color: days > 7 ? '#F04452' : '#4E5968', fontWeight: days > 7 ? 700 : 400 }}>{days}일</span>;
    };

    // 금액 렌더러
    const amountRender = (v: any) => {
      if (!v || v === 0) return <span style={{ color: '#B0B8C1' }}>-</span>;
      return <span style={{ color: '#4E5968' }}>{(v / 10000).toFixed(0)}만원</span>;
    };

    // 업체명 렌더러 (SF 링크)
    const nameRender = (_: any, row: any) => {
      const displayName = row.name || row.accountName || '-';
      if (row.oppId) {
        return <a href={`https://torder.lightning.force.com/lightning/r/Opportunity/${row.oppId}/view`} target="_blank" rel="noopener noreferrer" style={{ color: '#3182F6', textDecoration: 'none', fontWeight: 500 }}>{displayName}</a>;
      }
      return <span style={{ fontWeight: 500 }}>{displayName}</span>;
    };

    // 단계 뱃지 렌더러
    const stageBadgeRender = (v: string) => {
      if (!v || v === '-') return <span style={{ color: '#B0B8C1' }}>-</span>;
      const color = v === '견적' ? 'green' : v === '재견적' ? 'yellow' : 'blue';
      return <TossBadge variant="weak" size="xsmall" color={color}>{v}</TossBadge>;
    };

    // 방문 여부 렌더러
    const visitStatusRender = (_: any, row: any) => {
      if (row.visitCompleteDate) {
        return <TossBadge variant="fill" size="xsmall" color="green">방문 완료 ({row.visitCompleteDate})</TossBadge>;
      }
      if (row.visitScheduleDate) {
        const isPast = new Date(row.visitScheduleDate) < new Date(new Date().toDateString());
        return <TossBadge variant={isPast ? 'fill' : 'weak'} size="xsmall" color={isPast ? 'red' : 'blue'}>방문 예정 ({row.visitScheduleDate}){isPast ? ' ⚠' : ''}</TossBadge>;
      }
      return <TossBadge variant="fill" size="xsmall" color="red">미방문</TossBadge>;
    };

    // 단계별 분리
    const visitItems = backlogList.filter((r: any) => r.stageName === '방문배정');
    const quoteItems = backlogList.filter((r: any) => r.stageName === '견적' || r.stageName === '재견적');

    // 방문 후 경과일 렌더러
    const daysSinceVisitRender = (_: any, row: any) => {
      if (!row.visitCompleteDate) return <span style={{ color: '#B0B8C1' }}>미방문</span>;
      const days = row.daysSinceVisit ?? 0;
      return <span style={{ color: days > 7 ? '#F04452' : '#4E5968', fontWeight: days > 7 ? 700 : 400 }}>{days}일</span>;
    };

    // 방문배정 컬럼: 방문 갔냐 안갔냐가 핵심
    const visitColumns = [
      { key: 'name', label: '업체명', render: nameRender },
      { key: 'ownerName', label: '담당자' },
      { key: 'channel', label: '채널', render: channelSourceRender },
      { key: 'ageInDays', label: '경과일', render: ageRender },
      { key: 'visitStatus', label: '방문 여부', render: visitStatusRender },
      { key: 'nextTask', label: '다음 과업', render: nextTaskRender },
      { key: 'lastTouch', label: '마지막 터치' },
    ];

    // 견적 컬럼: 방문 후 경과일이 핵심
    const quoteColumns = [
      { key: 'name', label: '업체명', render: nameRender },
      { key: 'ownerName', label: '담당자' },
      { key: 'channel', label: '채널', render: channelSourceRender },
      { key: 'stageName', label: '단계', render: stageBadgeRender },
      { key: 'ageInDays', label: '경과일', render: ageRender },
      { key: 'daysSinceVisit', label: '방문 후 경과', render: daysSinceVisitRender },
      { key: 'nextTask', label: '다음 과업', render: nextTaskRender },
      { key: 'lastTouch', label: '마지막 터치' },
    ];

    return (
      <div>
        {/* 섹션 1: 담당자별 SQL 잔량 현황 */}
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '12px' }}>
          담당자별 SQL 잔량 현황
        </div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          <TossBadge variant="weak" size="small" color="elephant">전체 Open {openTotal}건</TossBadge>
          <TossBadge variant="fill" size="small" color={over7 <= 10 ? 'green' : 'red'}>7일+ 초과 {over7}건</TossBadge>
        </div>
        {byOwner.length > 0 && (
          <table className="metro-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', marginBottom: '24px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['담당자', '전체', '7일+ 초과', '단계별 분포'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: h === '단계별 분포' ? 'left' : 'center', fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o: any) => (
                <tr key={o.name} style={{ borderBottom: '1px solid #F2F4F6' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>{o.name}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{o.total}건</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <span style={{ color: o.over7 > 0 ? '#F04452' : '#4E5968', fontWeight: o.over7 > 0 ? 700 : 400 }}>{o.over7}건</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{stageRender(o.stages)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 섹션 2: 방문배정 */}
        {visitItems.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>🏃 방문배정</span>
              <TossBadge variant="weak" size="xsmall" color="blue">{visitItems.length}건</TossBadge>
              <span style={{ fontSize: '12px', color: '#8B95A1' }}>방문 진행 여부 확인</span>
            </div>
            <DataTable
              data={visitItems}
              columns={visitColumns}
              defaultSort="ageInDays"
              defaultSortDir="desc"
              pageSize={20}
              className="daily-raw daily-raw-orange"
            />
          </div>
        )}

        {/* 섹션 3: 견적 */}
        {quoteItems.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>📄 견적</span>
              <TossBadge variant="weak" size="xsmall" color="green">{quoteItems.length}건</TossBadge>
              <span style={{ fontSize: '12px', color: '#8B95A1' }}>견적 발송 후 경과일 관리</span>
            </div>
            <DataTable
              data={quoteItems}
              columns={quoteColumns}
              defaultSort="ageInDays"
              defaultSortDir="desc"
              pageSize={20}
              className="daily-raw daily-raw-orange"
            />
          </div>
        )}
      </div>
    );
  }

  const csTmDetailRenderers = [renderCSTmFrtDetail, renderCSTmMqlDetail, renderCSTmBacklogDetail, renderCSTmConversionDetail];

  // ============ 채널 BO 플로우 ============
  const csBo = data?.channel?.backOffice;

  const csBoFlowSteps: FlowStep[] = useMemo(() => {
    if (!csBo) return [];
    const users = csBo.cwConversionRate?.byUser || [];
    const totalSQL = users.reduce((s: number, u: any) => s + (u.total ?? 0), 0);
    const totalCWThisMonth = users.reduce((s: number, u: any) => s + (u.thisMonthCW ?? 0), 0);
    const totalCWCarryover = users.reduce((s: number, u: any) => s + (u.carryoverCW ?? 0), 0);
    const totalCWAll = totalCWThisMonth + totalCWCarryover;
    const cwRateThisMonth = totalSQL > 0 ? +((totalCWThisMonth / totalSQL) * 100).toFixed(1) : 0;
    const cwRateAll = totalSQL > 0 ? +((totalCWAll / totalSQL) * 100).toFixed(1) : 0;
    const dcUsers = csBo.dailyClose?.byUser || [];
    const avgDaily = dcUsers.length > 0 ? +(dcUsers.reduce((s: number, u: any) => s + (u.avgDailyCloseThisMonth ?? 0), 0) / dcUsers.length).toFixed(1) : 0;
    const over7 = csBo.sqlBacklog?.totalOver7 ?? 0;
    const openTotal = csBo.sqlBacklog?.totalOpen ?? 0;
    const ltOverdue = csBo.leadTime?.overdueCount ?? 0;
    const ltTotal = csBo.leadTime?.totalOpen ?? 0;
    const ltRate = csBo.leadTime?.sameDayRate ?? 100;
    return [
      {
        key: 'csBoLeadTime', label: 'BO 리드타임', value: `${ltOverdue}건`,
        detail: `Open ${ltTotal}건 중 1일+ 초과`,
        target: '당일 완료', met: ltOverdue === 0,
        color: ltOverdue === 0 ? 'green' : 'red', rawCount: ltOverdue, icon: '⏱️',
      },
      {
        key: 'csBoDailyClose', label: '일일 마감', value: `${avgDaily}건/인`,
        detail: `담당자 ${dcUsers.length}명 평균 (CW+CL)`,
        target: '목표 3건/인', met: avgDaily >= 3,
        color: avgDaily >= 3 ? 'green' : 'red', rawCount: 0, icon: '⚡',
      },
      {
        key: 'csBoBacklog', label: 'SQL 잔량 (7일+)', value: `${over7}건`,
        detail: `전체 Open ${openTotal}건 중`,
        target: '목표 ≤10건', met: over7 <= 10,
        color: over7 <= 10 ? 'green' : 'red', rawCount: over7, icon: '📋',
      },
      {
        key: 'csBoCwRate', label: 'SQL→CW 전환율', value: `${cwRateThisMonth}%`,
        detail: `당월 ${totalCWThisMonth} + 이월 ${totalCWCarryover} = 합산 ${totalCWAll} / SQL ${totalSQL} (합산 ${cwRateAll}%)`,
        target: '목표 60%', met: cwRateThisMonth >= 60,
        color: cwRateThisMonth >= 60 ? 'green' : 'red', rawCount: totalCWThisMonth, icon: '📈',
      },
    ];
  }, [csBo]);

  // BO 상세: SQL→CW 전환율 — 담당자별 현황 + CW 생성월 분포 + 3개월 이전 CW Raw
  function renderCSBoCwDetail() {
    const users = csBo?.cwConversionRate?.byUser || [];
    const closedOpps = csBo?.rawData?.rawClosedOpps || [];
    const thS = { padding: '8px 10px', textAlign: 'left' as const, fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB', fontSize: '14px', whiteSpace: 'nowrap' as const };
    const tdS = { padding: '8px 10px', borderBottom: '1px solid #F2F4F6', fontSize: '14px' };

    // CW 생성월 분포
    const cwOpps = closedOpps.filter((o: any) => o.stageName === 'Closed Won');
    const totalCWAll = cwOpps.length;
    const monthStatusDist: Record<string, { total: number, open: number, propen: number }> = {};
    cwOpps.forEach((o: any) => {
      const m = o.createdMonth || '-';
      if (!monthStatusDist[m]) monthStatusDist[m] = { total: 0, open: 0, propen: 0 };
      monthStatusDist[m].total++;
      if ((o.companyStatus || '').includes('영업중')) monthStatusDist[m].open++;
      else if ((o.companyStatus || '').includes('오픈전') || (o.companyStatus || '').includes('오픈 전')) monthStatusDist[m].propen++;
    });
    const sortedMonths = Object.entries(monthStatusDist).sort((a, b) => a[0].localeCompare(b[0]));
    const maxCount = Math.max(...sortedMonths.map(([, d]) => d.total), 1);

    // 3개월 이전 CW (현재 월에서 3개월 전 이전에 생성된 CW)
    const currentMonthStr = sortedMonths.length > 0 ? sortedMonths[sortedMonths.length - 1][0] : '';
    const threeMonthsAgo = (() => {
      if (!currentMonthStr || currentMonthStr === '-') return '0000-00';
      const [y, m] = currentMonthStr.split('-').map(Number);
      const d = new Date(y, m - 1 - 3, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    const oldCwOpps = cwOpps.filter((o: any) => (o.createdMonth || '-') <= threeMonthsAgo && (o.createdMonth || '-') !== '-');

    if (users.length === 0) return <div style={{ color: '#8B95A1', padding: '20px', textAlign: 'center' }}>담당자 데이터 없음</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* CW 생성월 분포 (빈티지 분석) — 가장 위에 배치 */}
        {sortedMonths.length > 0 && (
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '4px' }}>CW 생성월 분포</div>
            <div style={{ fontSize: '13px', color: '#8B95A1', marginBottom: '16px' }}>이번달 마감된 CW {totalCWAll}건의 Opportunity 생성월 분석</div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '12px', color: '#6B7684' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#20C997', display: 'inline-block' }} /> 영업중</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#FFA726', display: 'inline-block' }} /> 오픈전</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#B0B8C1', display: 'inline-block' }} /> 기타</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sortedMonths.map(([month, dist]) => {
                const count = dist.total;
                const pct = +((count / totalCWAll) * 100).toFixed(1);
                const barPct = Math.round((count / maxCount) * 100);
                const isCurrentMonth = month === currentMonthStr;
                const isOld = month <= threeMonthsAgo && month !== '-';
                const openPct = count > 0 ? (dist.open / count) * 100 : 0;
                const preopenPct = count > 0 ? (dist.propen / count) * 100 : 0;
                return (
                  <div key={month} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ width: '80px', fontSize: '14px', fontWeight: 600, color: isCurrentMonth ? '#3182F6' : isOld ? '#c62828' : '#191F28', textAlign: 'right' }}>
                      {month}
                    </span>
                    <div style={{ flex: 1, height: '28px', background: '#F2F4F6', borderRadius: '6px', overflow: 'hidden', position: 'relative', display: 'flex' }}>
                      <div style={{ width: `${barPct * openPct / 100}%`, height: '100%', background: '#20C997' }} />
                      <div style={{ width: `${barPct * preopenPct / 100}%`, height: '100%', background: '#FFA726' }} />
                      <div style={{ width: `${barPct * (100 - openPct - preopenPct) / 100}%`, height: '100%', background: isOld ? '#F04452' : '#B0B8C1' }} />
                      <span style={{
                        position: 'absolute', left: `${Math.min(barPct + 1, 85)}%`, top: '50%',
                        transform: 'translateY(-50%)', fontSize: '13px', fontWeight: 700,
                        color: '#191F28', whiteSpace: 'nowrap',
                      }}>
                        {count}건 ({pct}%) — 영업중 {dist.open} · 오픈전 {dist.propen}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 3개월 이전 생성 CW — 왜 늦게 전환되었는지 확인용 Raw 데이터 */}
        {oldCwOpps.length > 0 && (() => {
          const sorted = [...oldCwOpps].sort((a: any, b: any) => (a.createdMonth || '').localeCompare(b.createdMonth || ''));
          const oldHeaders = [
            { label: '영업기회', align: 'left' },
            { label: '파트너/FC', align: 'left' },
            { label: '생성월', align: 'center' },
            { label: '계약', align: 'center' },
            { label: '매장', align: 'center' },
            { label: 'CW 마감일', align: 'center' },
          ];
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>3개월+ 이전 생성 CW</span>
                <TossBadge variant="fill" size="small" color="red">{oldCwOpps.length}건</TossBadge>
                <span style={{ fontSize: '13px', color: '#8B95A1' }}>{threeMonthsAgo} 이전 생성된 Opportunity</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      {oldHeaders.map(h => (
                        <th key={h.label} style={{ ...thS, textAlign: h.align as any }}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((o: any, idx: number) => (
                      <tr key={o.oppId || idx} style={{ background: '#FFF8E1' }}>
                        <td style={{ ...tdS, minWidth: '200px' }}>
                          {sfOppLink(
                            (o.name || o.oppId || '').length > 30 ? (o.name || o.oppId || '').substring(0, 30) + '…' : (o.name || o.oppId),
                            o
                          )}
                        </td>
                        <td style={{ ...tdS, maxWidth: '100px' }}>{channelSourceRender(null, o)}</td>
                        <td style={{ ...tdS, textAlign: 'center' }}>
                          <TossBadge variant="fill" size="xsmall" color="red">{o.createdMonth}</TossBadge>
                        </td>
                        <td style={{ ...tdS, textAlign: 'center' }}>{contractBadge(o.hasContract)}</td>
                        <td style={{ ...tdS, textAlign: 'center' }}>{companyStatusBadge(o.companyStatus)}</td>
                        <td style={{ ...tdS, textAlign: 'center', fontSize: '13px', color: '#4E5968' }}>{o.changeDate || o.closeDate || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '12px' }}>담당자별 SQL→CW 전환 현황</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  {['담당자', 'SQL', 'CW', 'CL', 'Open', '전환율', '이월CW', '이월CL'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u: any, idx: number) => (
                  <tr key={u.name || idx} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#191F28' }}>{u.name}</td>
                    <td style={{ padding: '8px 12px' }}>{u.total ?? 0}</td>
                    <td style={{ padding: '8px 12px' }}><TossBadge variant="weak" size="small" color="green">{u.thisMonthCW ?? 0}</TossBadge></td>
                    <td style={{ padding: '8px 12px' }}><TossBadge variant="weak" size="small" color="red">{u.thisMonthCL ?? 0}</TossBadge></td>
                    <td style={{ padding: '8px 12px' }}>{u.open ?? 0}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ fontWeight: 700, color: (u.cwRate ?? 0) >= 60 ? '#2e7d32' : '#c62828' }}>{u.cwRate ?? 0}%</span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>{u.carryoverCW ?? 0}</td>
                    <td style={{ padding: '8px 12px' }}>{u.carryoverCL ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* 종료 Opportunity Raw 데이터 — 담당자별 그룹핑 */}
        {closedOpps.length > 0 && (() => {
          const cwOpps = closedOpps.filter((o: any) => o.stageName === 'Closed Won');
          const clOpps = closedOpps.filter((o: any) => o.stageName === 'Closed Lost');
          const grouped: Record<string, any[]> = {};
          closedOpps.forEach((o: any) => {
            const key = o.boUser || '(미배정)';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(o);
          });
          const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
          const headers = [
            { label: '영업기회', align: 'left' },
            { label: '파트너/FC', align: 'left' },
            { label: '결과', align: 'center' },
            { label: '계약', align: 'center' },
            { label: '매장', align: 'center' },
            { label: '종료사유', align: 'left' },
            { label: '설치희망일', align: 'center' },
            { label: '마감일', align: 'center' },
          ];
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>종료 Opportunity</span>
                <TossBadge variant="weak" size="small" color="elephant">{closedOpps.length}건</TossBadge>
                <TossBadge variant="weak" size="small" color="green">CW {cwOpps.length}건</TossBadge>
                <TossBadge variant="weak" size="small" color="red">CL {clOpps.length}건</TossBadge>
              </div>
              {sortedGroups.map(([boName, opps]) => {
                const cwCount = opps.filter((o: any) => o.stageName === 'Closed Won').length;
                const clCount = opps.filter((o: any) => o.stageName === 'Closed Lost').length;
                return (
                  <div key={boName} style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: '#191F28' }}>{boName}</span>
                      <TossBadge variant="weak" size="xsmall" color="elephant">{opps.length}건</TossBadge>
                      <TossBadge variant="weak" size="xsmall" color="green">CW {cwCount}</TossBadge>
                      <TossBadge variant="weak" size="xsmall" color="red">CL {clCount}</TossBadge>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#F9FAFB' }}>
                            {headers.map(h => (
                              <th key={h.label} style={{ ...thS, textAlign: h.align as any }}>{h.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {opps.map((o: any, idx: number) => {
                            const isCW = o.stageName === 'Closed Won';
                            return (
                              <tr key={o.oppId || idx} style={{ background: isCW ? '#F0FFF4' : '#FFF5F5' }}>
                                <td style={{ ...tdS, minWidth: '200px' }}>
                                  {sfOppLink(
                                    (o.name || o.oppId || '').length > 30 ? (o.name || o.oppId || '').substring(0, 30) + '…' : (o.name || o.oppId),
                                    o
                                  )}
                                </td>
                                <td style={{ ...tdS, maxWidth: '100px' }}>{channelSourceRender(null, o)}</td>
                                <td style={{ ...tdS, textAlign: 'center' }}>
                                  <TossBadge variant="fill" size="xsmall" color={isCW ? 'green' : 'red'}>{isCW ? 'CW' : 'CL'}</TossBadge>
                                </td>
                                <td style={{ ...tdS, textAlign: 'center' }}>{contractBadge(o.hasContract)}</td>
                                <td style={{ ...tdS, textAlign: 'center' }}>{companyStatusBadge(o.companyStatus)}</td>
                                <td style={{ ...tdS }}>
                                  {!isCW && o.lossReason && o.lossReason !== '-' ? (
                                    <TossBadge variant="weak" size="xsmall" color="red">{o.lossReason}</TossBadge>
                                  ) : <span style={{ color: '#B0B8C1', fontSize: '12px' }}>-</span>}
                                </td>
                                <td style={{ ...tdS, textAlign: 'center', fontSize: '13px', color: '#4E5968' }}>{o.installHopeDate !== '-' ? o.installHopeDate : '-'}</td>
                                <td style={{ ...tdS, textAlign: 'center', fontSize: '13px', color: '#4E5968' }}>{o.changeDate || o.closeDate || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  }

  // BO 상세 2: BO 배정 후 리드타임
  function renderCSBoLeadTimeDetail() {
    const lt = csBo?.leadTime;
    const ltUsers = lt?.byUser || [];
    const rawOpps = (csBo?.rawData?.rawOpenOpps || []).sort((a: any, b: any) => (b.currentStageDays ?? b.ageInDays ?? 0) - (a.currentStageDays ?? a.ageInDays ?? 0));
    if (ltUsers.length === 0 && rawOpps.length === 0) return <div style={{ color: '#8B95A1', padding: '20px', textAlign: 'center' }}>리드타임 데이터 없음</div>;
    const thStyle = { padding: '8px 10px', textAlign: 'left' as const, fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB', fontSize: '14px', whiteSpace: 'nowrap' as const };
    const tdStyle = { padding: '8px 10px', borderBottom: '1px solid #F2F4F6', fontSize: '14px' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* 담당자별 요약 */}
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '4px' }}>BO 배정 후 리드타임 현황</div>
          <div style={{ fontSize: '13px', color: '#8B95A1', marginBottom: '12px' }}>견적 이후 단계(선납금~) Open 건 중 현재 스테이지 체류 1일 초과 건</div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <TossBadge variant="weak" size="small" color="elephant">Open {lt?.totalOpen ?? 0}건</TossBadge>
            <TossBadge variant="fill" size="small" color={(lt?.overdueCount ?? 0) === 0 ? 'green' : 'red'}>1일+ 초과 {lt?.overdueCount ?? 0}건</TossBadge>
            <TossBadge variant="weak" size="small" color="blue">당일처리율 {lt?.sameDayRate ?? 0}%</TossBadge>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  {['담당자', 'Open', '1일+ 초과', '평균 체류일'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ltUsers.map((u: any, idx: number) => (
                  <tr key={u.name || idx} style={{ borderBottom: '1px solid #F2F4F6' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#191F28' }}>{u.name}</td>
                    <td style={{ padding: '8px 12px' }}>{u.open ?? 0}건</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ fontWeight: 700, color: (u.overdue ?? 0) > 0 ? '#c62828' : '#2e7d32' }}>{u.overdue ?? 0}건</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#4E5968' }}>{u.avgAge ?? 0}일</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Raw 데이터 — 담당자별 그룹핑 */}
        {rawOpps.length > 0 && (() => {
          const grouped: Record<string, any[]> = {};
          rawOpps.forEach((o: any) => {
            const key = o.boUser || '(미배정)';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(o);
          });
          const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>Open 영업기회 상세</span>
                <TossBadge variant="weak" size="small" color="elephant">{rawOpps.length}건</TossBadge>
              </div>
              {sortedGroups.map(([boName, opps]) => (
                <div key={boName} style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#191F28' }}>{boName}</span>
                    <TossBadge variant="weak" size="xsmall" color="elephant">{opps.length}건</TossBadge>
                    <span style={{ fontSize: '12px', color: '#8B95A1' }}>
                      1일+ 초과 {opps.filter((o: any) => (o.currentStageDays ?? o.ageInDays ?? 0) > 1).length}건
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#F9FAFB' }}>
                          {[
                            { label: '영업기회', align: 'left' },
                            { label: '파트너/FC', align: 'left' },
                            { label: '단계', align: 'center' },
                            { label: '계약', align: 'center' },
                            { label: '매장', align: 'center' },
                            { label: '체류일', align: 'center' },
                            { label: 'Open 과업', align: 'left' },
                            { label: '완료 과업', align: 'left' },
                          ].map(h => (
                            <th key={h.label} style={{ ...thStyle, textAlign: h.align as any }}>{h.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {opps.map((o: any, idx: number) => {
                          const stageDays = o.currentStageDays ?? o.ageInDays ?? 0;
                          const isOverdue = stageDays > 1;
                          return (
                            <tr key={o.oppId || idx} style={{ background: isOverdue ? '#FFF5F5' : undefined }}>
                              <td style={{ ...tdStyle, minWidth: '200px' }}>
                                {sfOppLink(
                                  (o.name || o.oppId || '').length > 30 ? (o.name || o.oppId || '').substring(0, 30) + '…' : (o.name || o.oppId),
                                  o
                                )}
                              </td>
                              <td style={{ ...tdStyle, maxWidth: '100px' }}>{channelSourceRender(null, o)}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>
                                <TossBadge variant="weak" size="xsmall" color="blue">{o.stageName || '-'}</TossBadge>
                              </td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{contractBadge(o.hasContract)}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{companyStatusBadge(o.companyStatus)}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>
                                <span style={{ fontWeight: 700, color: isOverdue ? '#c62828' : '#2e7d32' }}>{stageDays}일</span>
                              </td>
                              <td style={{ ...tdStyle, minWidth: '120px' }}>{nextTaskRender(null, o)}</td>
                              <td style={{ ...tdStyle, minWidth: '120px' }}>
                                {(() => {
                                  const allTasks = o.tasks || [];
                                  const completedTasks = allTasks.filter((t: any) => t.status === 'Completed');
                                  if (completedTasks.length === 0) return <span style={{ color: '#B0B8C1', fontSize: '12px' }}>-</span>;
                                  const last = completedTasks[completedTasks.length - 1];
                                  return (
                                    <div
                                      onClick={() => setTaskModal({ oppName: o.name || o.oppId, tasks: allTasks })}
                                      style={{ cursor: 'pointer', lineHeight: 1.4 }}
                                    >
                                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#333D4B', whiteSpace: 'nowrap' }}>
                                        {last.subject !== '-' ? last.subject : '완료'}
                                      </div>
                                      {last.createdDate && (
                                        <div style={{ fontSize: '11px', color: '#8B95A1' }}>{last.createdDate}</div>
                                      )}
                                      {completedTasks.length > 1 && (
                                        <div style={{ fontSize: '11px', color: '#3182F6', marginTop: '1px' }}>📋 완료 {completedTasks.length}건</div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    );
  }

  // BO 상세 3: 일평균 마감
  function renderCsBoDailyCloseDetail() {
    const dcUsers = csBo?.dailyClose?.byUser || [];
    if (dcUsers.length === 0) return <div style={{ color: '#8B95A1', padding: '20px', textAlign: 'center' }}>일평균 마감 데이터 없음</div>;
    return (
      <div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '12px' }}>담당자별 일평균 마감 현황</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['담당자', '이번달 일평균', '이월 일평균', '총 CW', '총 CL'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dcUsers.map((u: any, idx: number) => (
                <tr key={u.name || idx} style={{ borderBottom: '1px solid #F2F4F6' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600, color: '#191F28' }}>{u.name}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontWeight: 700, color: (u.avgDailyCloseThisMonth ?? 0) >= 3 ? '#2e7d32' : '#c62828' }}>
                      {u.avgDailyCloseThisMonth ?? 0}건/일
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{u.avgDailyCloseCarryover ?? 0}건/일</td>
                  <td style={{ padding: '8px 12px' }}><TossBadge variant="weak" size="small" color="green">{u.totalCW ?? 0}</TossBadge></td>
                  <td style={{ padding: '8px 12px' }}><TossBadge variant="weak" size="small" color="red">{u.totalCL ?? 0}</TossBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // BO 상세 4: SQL 잔량
  function renderCSBoBacklogDetail() {
    const backlogUsers = csBo?.sqlBacklog?.byUser || [];
    const over7 = csBo?.sqlBacklog?.totalOver7 ?? 0;
    const openTotal = csBo?.sqlBacklog?.totalOpen ?? 0;
    const rawOpps = (csBo?.rawData?.rawOpenOpps || []).filter((o: any) => (o.ageInDays ?? 0) > 7).sort((a: any, b: any) => (b.ageInDays ?? 0) - (a.ageInDays ?? 0));
    if (backlogUsers.length === 0 && openTotal === 0) return <div style={{ color: '#8B95A1', padding: '20px', textAlign: 'center' }}>SQL 잔량 없음 ✓</div>;
    const thS = { padding: '8px 10px', textAlign: 'left' as const, fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB', fontSize: '14px', whiteSpace: 'nowrap' as const };
    const tdS = { padding: '8px 10px', borderBottom: '1px solid #F2F4F6', fontSize: '14px' };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* 담당자별 요약 */}
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#191F28', marginBottom: '4px' }}>담당자별 SQL 잔량 현황</div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <TossBadge variant="weak" size="small" color="elephant">전체 Open {openTotal}건</TossBadge>
            <TossBadge variant="fill" size="small" color={over7 <= 10 ? 'green' : 'red'}>7일+ 초과 {over7}건</TossBadge>
          </div>
          {backlogUsers.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    {['담당자', 'Open', '7일+ 초과', '평균 경과일'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '2px solid #E5E8EB' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {backlogUsers.map((u: any, idx: number) => (
                    <tr key={u.name || idx} style={{ borderBottom: '1px solid #F2F4F6' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: '#191F28' }}>{u.name}</td>
                      <td style={{ padding: '8px 12px' }}>{u.open ?? 0}건</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontWeight: 700, color: (u.over7 ?? 0) > 0 ? '#c62828' : '#2e7d32' }}>{u.over7 ?? 0}건</span>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#4E5968' }}>{u.avgDaysOpen ?? 0}일</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* 7일+ 초과 Raw 데이터 — 담당자별 그룹핑 */}
        {rawOpps.length > 0 && (() => {
          const grouped: Record<string, any[]> = {};
          rawOpps.forEach((o: any) => {
            const key = o.boUser || '(미배정)';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(o);
          });
          const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#191F28' }}>7일+ 초과 영업기회 상세</span>
                <TossBadge variant="fill" size="small" color="red">{rawOpps.length}건</TossBadge>
              </div>
              {sortedGroups.map(([boName, opps]) => (
                <div key={boName} style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#191F28' }}>{boName}</span>
                    <TossBadge variant="weak" size="xsmall" color="red">{opps.length}건</TossBadge>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#F9FAFB' }}>
                          {[
                            { label: '영업기회', align: 'left' },
                            { label: '파트너/FC', align: 'left' },
                            { label: '단계', align: 'center' },
                            { label: '계약', align: 'center' },
                            { label: '매장', align: 'center' },
                            { label: '경과일', align: 'center' },
                            { label: 'Open 과업', align: 'left' },
                            { label: '완료 과업', align: 'left' },
                          ].map(h => (
                            <th key={h.label} style={{ ...thS, textAlign: h.align as any }}>{h.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {opps.map((o: any, idx: number) => (
                          <tr key={o.oppId || idx} style={{ background: '#FFF5F5' }}>
                            <td style={{ ...tdS, minWidth: '200px' }}>
                              {sfOppLink(
                                (o.name || o.oppId || '').length > 30 ? (o.name || o.oppId || '').substring(0, 30) + '…' : (o.name || o.oppId),
                                o
                              )}
                            </td>
                            <td style={{ ...tdS, maxWidth: '100px' }}>{channelSourceRender(null, o)}</td>
                            <td style={{ ...tdS, textAlign: 'center' }}>
                              <TossBadge variant="weak" size="xsmall" color="blue">{o.stageName || '-'}</TossBadge>
                            </td>
                            <td style={{ ...tdS, textAlign: 'center' }}>{contractBadge(o.hasContract)}</td>
                            <td style={{ ...tdS, textAlign: 'center' }}>{companyStatusBadge(o.companyStatus)}</td>
                            <td style={{ ...tdS, textAlign: 'center' }}>
                              <span style={{ fontWeight: 700, color: '#c62828' }}>{o.ageInDays ?? 0}일</span>
                            </td>
                            <td style={{ ...tdS, minWidth: '120px' }}>{nextTaskRender(null, o)}</td>
                            <td style={{ ...tdS, minWidth: '120px' }}>
                              {(() => {
                                const allTasks = o.tasks || [];
                                const completedTasks = allTasks.filter((t: any) => t.status === 'Completed');
                                if (completedTasks.length === 0) return <span style={{ color: '#B0B8C1', fontSize: '12px' }}>-</span>;
                                const last = completedTasks[completedTasks.length - 1];
                                return (
                                  <div
                                    onClick={() => setTaskModal({ oppName: o.name || o.oppId, tasks: allTasks })}
                                    style={{ cursor: 'pointer', lineHeight: 1.4 }}
                                  >
                                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#333D4B', whiteSpace: 'nowrap' }}>
                                      {last.subject !== '-' ? last.subject : '완료'}
                                    </div>
                                    {last.createdDate && (
                                      <div style={{ fontSize: '11px', color: '#8B95A1' }}>{last.createdDate}</div>
                                    )}
                                    {completedTasks.length > 1 && (
                                      <div style={{ fontSize: '11px', color: '#3182F6', marginTop: '1px' }}>📋 완료 {completedTasks.length}건</div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    );
  }

  const csBoDetailRenderers = [renderCSBoLeadTimeDetail, renderCsBoDailyCloseDetail, renderCSBoBacklogDetail, renderCSBoCwDetail];

  // BO 담당자별 종합 KPI 상세
  function renderBOOwnerSummary() {
    if (boUsers.length === 0) return null;
    // 합산 행
    const totalContracts = boUsers.reduce((s: number, u: any) => s + (u.contracts ?? 0), 0);
    const totalContractsNew = boUsers.reduce((s: number, u: any) => s + (u.contractsNew ?? 0), 0);
    const totalContractsAddInstall = boUsers.reduce((s: number, u: any) => s + (u.contractsAddInstall ?? 0), 0);
    const totalContractTablets = boUsers.reduce((s: number, u: any) => s + (u.contractTablets ?? 0), 0);
    const totalOver7 = boUsers.reduce((s: number, u: any) => s + (u.over7 ?? 0), 0);
    const totalCarryoverCW = boUsers.reduce((s: number, u: any) => s + (u.carryoverCW ?? 0), 0);
    const totalCarryoverCL = boUsers.reduce((s: number, u: any) => s + (u.carryoverCL ?? 0), 0);
    const totalOpen = boUsers.reduce((s: number, u: any) => s + (u.open ?? 0), 0);
    const avgAll = boUsers.length > 0 ? +(boUsers.reduce((s: number, u: any) => s + (u.avgDailyClose ?? 0), 0) / boUsers.length).toFixed(1) : 0;

    const summaryRow = {
      _isSummary: true, name: '합산',
      total: boTotalSQL, thisMonthCW: boTotalCW,
      thisMonthCL: boUsers.reduce((s: number, u: any) => s + (u.thisMonthCL ?? 0), 0),
      open: totalOpen,
      thisMonthCWRate: boOverallCWRate,
      combinedCWRate: boTotalSQL > 0 ? +(((boTotalCW + totalCarryoverCW) / boTotalSQL) * 100).toFixed(1) : 0,
      carryoverCW: totalCarryoverCW, carryoverCL: totalCarryoverCL,
      avgDailyClose: avgAll, over7: totalOver7,
      contracts: totalContracts, contractsNew: totalContractsNew,
      contractsAddInstall: totalContractsAddInstall, contractTablets: totalContractTablets,
    };

    const rows = [...boUsers, summaryRow];

    return (
      <div style={{
        marginTop: '16px', background: '#fff', borderRadius: '16px', padding: '28px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: '3px solid #3182F6',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#191F28' }}>담당자별 종합 KPI</span>
          <TossBadge variant="weak" size="small" color="blue">이번달 Lead 기준</TossBadge>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', minWidth: '900px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={thStyle} rowSpan={2}>담당자</th>
                <th style={{ ...thStyle, textAlign: 'center', borderBottom: 'none' }} colSpan={5}>이번달 Lead</th>
                <th style={{ ...thStyle, textAlign: 'center', borderBottom: 'none' }} colSpan={2}>이월</th>
                <th style={{ ...thStyle, textAlign: 'center' }} rowSpan={2}>합산<br/>전환율</th>
                <th style={{ ...thStyle, textAlign: 'center', borderBottom: 'none' }} colSpan={2}>과정 지표</th>
                <th style={{ ...thStyle, textAlign: 'center', borderBottom: 'none' }} colSpan={3}>계약</th>
              </tr>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>SQL</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>CW</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>CL</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>진행중</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>전환율</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>CW</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>CL</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>일평균마감</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>7일+잔량</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>전체</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>신규</th>
                <th style={{ ...thStyle, textAlign: 'right', fontSize: '13.5px' }}>추가설치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u: any, idx: number) => {
                const isSummary = u._isSummary;
                const rowStyle: React.CSSProperties = {
                  borderBottom: '1px solid #F2F4F6',
                  ...(isSummary ? { background: '#F5F9FF', fontWeight: 700 } : {}),
                };
                const avg = u.avgDailyClose ?? 0;
                const o7 = u.over7 ?? 0;
                return (
                  <tr key={u.name || idx} style={rowStyle}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700, color: isSummary ? '#3182F6' : '#191F28' }}>{u.name}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.total ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.thisMonthCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{clBadge(u.thisMonthCL ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span style={{ color: (u.open ?? 0) > 30 ? '#E65100' : '#8B95A1' }}>{u.open ?? 0}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.thisMonthCWRate ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwBadge(u.carryoverCW ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{clBadge(u.carryoverCL ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cwRateBadge(u.combinedCWRate ?? 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <TossBadge variant={avg >= 5 ? 'weak' : 'fill'} size="xsmall" color={avg >= 5 ? 'green' : avg >= 3 ? 'yellow' : 'red'}>
                        {typeof avg === 'number' ? avg.toFixed(1) : avg}
                      </TossBadge>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {o7 > 0
                        ? <TossBadge variant="fill" size="xsmall" color="red">{o7}건</TossBadge>
                        : <span style={{ color: '#B0B8C1' }}>0</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span style={{ fontWeight: 600 }}>{u.contracts ?? 0}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {(u.contractsNew ?? 0) > 0
                        ? <span>{u.contractsNew}</span>
                        : <span style={{ color: '#B0B8C1' }}>0</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {(u.contractsAddInstall ?? 0) > 0
                        ? <span>{u.contractsAddInstall}</span>
                        : <span style={{ color: '#B0B8C1' }}>0</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ============ 공통 섹션 렌더러 ============

  function renderFlowSection(
    title: string,
    subtitle: string,
    steps: FlowStep[],
    activeIdx: number,
    setActive: (i: number) => void,
    detailFns: (() => React.ReactNode)[],
    sectionColor: string,
    extraContent?: React.ReactNode,
  ) {
    if (steps.length === 0) return null;
    const current = steps[activeIdx];
    const colors = tossColorMap[current?.color] || tossColorMap.blue;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '0', position: 'relative' }}>
          {steps.map((step, i) => {
            const isActive = activeIdx === i;
            const c = tossColorMap[step.color] || tossColorMap.blue;
            return (
              <React.Fragment key={step.key}>
                <div onClick={() => setActive(i)} style={{
                  flex: 1, background: isActive ? c.lightBg : '#fff',
                  border: isActive ? `2px solid ${c.accent}` : '1px solid #E5E8EB',
                  borderRadius: '16px', padding: '20px 16px', textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.2s ease',
                  boxShadow: isActive ? `0 4px 12px ${c.accent}20` : '0 1px 3px rgba(0,0,0,0.06)',
                  position: 'relative',
                }}>
                  <div style={{ fontSize: '20px', marginBottom: '4px' }}>{step.icon}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#6B7684', marginBottom: '8px' }}>{step.label}</div>
                  <div style={{ fontSize: '2.6em', fontWeight: 700, color: isActive ? c.accent : '#191F28', lineHeight: 1.1, marginBottom: '6px' }}>{step.value}</div>
                  <div style={{ fontSize: '14px', color: '#8B95A1', marginBottom: '8px' }}>{step.detail}</div>
                  <TossBadge variant={step.met ? 'weak' : 'fill'} size="xsmall" color={step.met ? 'green' : 'red'}>
                    {step.met ? '✓ ' : '✗ '}{step.target}
                  </TossBadge>
                  {step.rawCount > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <TossBadge variant="fill" size="xsmall" color="red">관리대상 {step.rawCount}건</TossBadge>
                    </div>
                  )}
                  {isActive && (
                    <div style={{
                      position: 'absolute', bottom: '-12px', left: '50%', transform: 'translateX(-50%)',
                      width: 0, height: 0, borderLeft: '12px solid transparent', borderRight: '12px solid transparent',
                      borderTop: `12px solid ${c.accent}`, zIndex: 10,
                    }} />
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B0B8C1', fontSize: '1.4em' }}>→</div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        {extraContent}
        <div style={{
          background: '#fff', borderRadius: '16px', padding: '28px', marginTop: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          borderTop: `3px solid ${colors.accent}`,
        }}>
          {detailFns[activeIdx]?.()}
        </div>
      </div>
    );
  }

  // ============ 메인 렌더 ============

  const detailRenderers = [renderFRTDetail, renderTaskDetail, renderVisitDetail, renderSQLDetail];
  const currentStep = flowSteps[activeStep];

  // Toss 컬러 맵
  const tossColorMap: Record<string, { accent: string; bg: string; lightBg: string }> = {
    blue: { accent: '#3182F6', bg: '#E8F3FF', lightBg: '#F5F9FF' },
    teal: { accent: '#00B8D9', bg: '#E3FAFC', lightBg: '#F5FDFE' },
    green: { accent: '#20C997', bg: '#EBFBEE', lightBg: '#F5FFF7' },
    red: { accent: '#F04452', bg: '#FFF0F0', lightBg: '#FFF8F8' },
  };

  // ============ 스코어 탭 렌더링 ============

  function renderScoreTab() {
    const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
    const totalColor = (total: number) => total >= 80 ? '#20C997' : total >= 50 ? '#FF8C00' : '#F04452';

    // ===== 공통: 스코어 테이블 렌더러 =====
    function renderScoreSection(
      title: string,
      members: { name: string; scores: { label: string; weight: number; value: number; detail: string; color: string; pct?: number }[]; total: number }[],
      criteria: { label: string; weight: string; target: string }[],
    ) {
      const sorted = [...members].sort((a, b) => b.total - a.total);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* 배점 기준 (최상단, 가로 일렬) */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {criteria.map((c) => (
              <div key={c.label} style={{
                flex: '1 1 0', minWidth: '160px',
                background: '#fff', borderRadius: '16px', padding: '18px 20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #E5E8EB',
                display: 'flex', flexDirection: 'column', gap: '10px',
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  alignSelf: 'flex-start',
                  padding: '4px 14px', borderRadius: '8px',
                  background: '#3182F6', color: '#fff', fontSize: '15px', fontWeight: 800,
                }}>{c.weight}</span>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#191F28', lineHeight: 1.4 }}>{c.label}</div>
                <div style={{ fontSize: '14px', color: '#8B95A1' }}>{c.target}</div>
              </div>
            ))}
          </div>

          {/* 상위 3명 포디움 */}
          {sorted.length > 0 && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {sorted.slice(0, Math.min(3, sorted.length)).map((m, i) => (
                <div key={m.name} style={{
                  flex: '1 1 220px', padding: '28px', borderRadius: '16px', textAlign: 'center',
                  background: i === 0 ? 'linear-gradient(135deg, #FFF8E1 0%, #FFE082 100%)' : '#F9FAFB',
                  border: `2px solid ${rankColors[i]}40`,
                }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>{['🥇','🥈','🥉'][i]}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#191F28' }}>{m.name}</div>
                  <div style={{ fontSize: '34px', fontWeight: 900, color: totalColor(m.total), marginTop: '10px' }}>
                    {m.total}<span style={{ fontSize: '18px', fontWeight: 600, color: '#8B95A1' }}>점</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 전원 상세 카드 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {sorted.map((m, i) => {
              return (
                <div key={m.name} style={{
                  background: '#fff', borderRadius: '16px', padding: '28px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  border: i < 3 ? `2px solid ${rankColors[i]}30` : '1px solid #F2F4F6',
                }}>
                  {/* 헤더: 순위 + 이름 + 총점 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <span style={{ fontWeight: 800, fontSize: '26px', color: i < 3 ? rankColors[i] : '#6B7684' }}>{i + 1}</span>
                      <span style={{ fontWeight: 800, fontSize: '22px', color: '#191F28' }}>{m.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontSize: '34px', fontWeight: 900, color: totalColor(m.total) }}>{m.total}</span>
                      <span style={{ fontSize: '18px', fontWeight: 600, color: '#8B95A1' }}>점</span>
                    </div>
                  </div>
                  {/* 지표 그리드 */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    {m.scores.map(s => {
                      const barPct = s.pct !== undefined ? Math.min(s.pct, 100) : (s.weight > 0 ? Math.min((s.value / s.weight) * 100, 100) : 0);
                      const passed = s.value > 0;
                      return (
                        <div key={s.label} style={{ background: '#F9FAFB', borderRadius: '14px', padding: '18px 20px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontSize: '16px', color: '#6B7684', fontWeight: 600 }}>{s.label}</span>
                            <span style={{ fontSize: '16px', fontWeight: 700, color: passed ? '#20C997' : '#F04452' }}>{s.value}/{s.weight}</span>
                          </div>
                          <div style={{ height: '12px', background: '#E5E8EB', borderRadius: '6px', overflow: 'hidden', marginBottom: '10px' }}>
                            <div style={{ width: `${barPct}%`, height: '100%', background: passed ? s.color : '#E5E8EB', borderRadius: '6px', transition: 'width 0.5s',
                              backgroundImage: !passed && barPct > 0 ? `repeating-linear-gradient(45deg, ${s.color}60, ${s.color}60 4px, ${s.color}30 4px, ${s.color}30 8px)` : 'none',
                              backgroundColor: passed ? s.color : undefined,
                            }} />
                          </div>
                          <div style={{ fontSize: '22px', fontWeight: 800, color: passed ? s.color : '#F04452', textAlign: 'center' }}>{s.detail}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ===== IS 인사이드세일즈 =====
    function renderISScore() {
      if (!is) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음</div>;
      const fullOwners = getAllMembersWithData(is?.byOwner, is?.members);
      const allTaskData = is?.dailyTask?.byOwner || [];
      const taskMap = new Map(allTaskData.map((t: any) => [t.name, t]));
      const members = fullOwners.filter((o: any) => o.team && o.team !== '-').map((m: any) => {
        const frtTotal = (m.frtOk ?? 0) + (m.frtOver20 ?? 0);
        const frtRate = frtTotal > 0 ? (m.frtOk / frtTotal) * 100 : 0;
        const task = taskMap.get(m.name);
        const taskAvg = task?.avgDaily ?? 0;
        const sqlRate = m.sqlConversionRate ?? 0;
        const visitConverted = m.visitConverted ?? 0;
        return {
          name: m.name,
          scores: [
            { label: 'SQL전환율', weight: 50, value: sqlRate >= 90 ? 50 : 0, detail: `${sqlRate}%`, color: '#8B5CF6', pct: (sqlRate / 90) * 100 },
            { label: 'FRT', weight: 20, value: frtRate >= 80 ? 20 : 0, detail: `${+frtRate.toFixed(1)}%`, color: '#20C997', pct: (frtRate / 80) * 100 },
            { label: 'Task', weight: 10, value: taskAvg >= 30 ? 10 : 0, detail: `${+taskAvg.toFixed(1)}건/일`, color: '#3182F6', pct: (taskAvg / 30) * 100 },
            { label: '방문', weight: 20, value: visitConverted >= 75 ? 20 : 0, detail: `${visitConverted}건`, color: '#FF8C00', pct: (visitConverted / 75) * 100 },
          ],
          total: 0,
        };
      });
      members.forEach(m => { m.total = m.scores.reduce((s, sc) => s + sc.value, 0); });
      return renderScoreSection('인사이드세일즈 스코어', members, [
        { label: 'SQL 전환율', weight: '50점', target: '목표: 90% 이상' },
        { label: 'FRT 준수율 (20분 초과 0건)', weight: '20점', target: '목표: 80% 이상' },
        { label: 'Task 생성수 (인당 30건)', weight: '10점', target: '목표: 일 30건 이상' },
        { label: '방문완료 건수 (인당 75건)', weight: '20점', target: '목표: 월 75건 이상' },
      ]);
    }

    // ===== FS 필드세일즈 — 1등 집중 포상 =====
    function renderFSScore() {
      const fsMemberNames = new Set((fs?.members || []).map((m: any) => m.name));
      const users = (fs?.cwConversionRate?.byUser || []).filter((u: any) => fsMemberNames.has(u.name));
      if (users.length === 0) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음</div>;
      const sorted = [...users].sort((a: any, b: any) => (b.thisMonthCW ?? 0) - (a.thisMonthCW ?? 0));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ background: 'linear-gradient(135deg, #FFF8E1 0%, #FFE082 100%)', borderRadius: '16px', padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>🏆</div>
            <div style={{ fontSize: '14px', color: '#8B95A1', marginBottom: '4px' }}>CW 1위</div>
            <div style={{ fontSize: '28px', fontWeight: 900, color: '#191F28' }}>{sorted[0]?.name ?? '-'}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#FF8C00', marginTop: '8px' }}>CW {sorted[0]?.thisMonthCW ?? 0}건 / 전환율 {sorted[0]?.cwRate ?? 0}%</div>
          </div>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#191F28', marginBottom: '16px' }}>전체 순위 (CW 건수 기준)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#F9FAFB' }}>
                  <th style={{ ...thStyle, textAlign: 'center', width: '50px' }}>순위</th>
                  <th style={thStyle}>이름</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CW</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>진행중</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u: any, i: number) => (
                  <tr key={u.name} style={{ borderBottom: '1px solid #F2F4F6', background: i === 0 ? '#FFFDF5' : '#fff' }}>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 800, color: i < 3 ? rankColors[i] : '#6B7684', fontSize: '16px' }}>{i + 1}</td>
                    <td style={tdStyle}><span style={{ fontWeight: 700 }}>{u.name}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.total ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#20C997' }}>{u.thisMonthCW ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#F04452' }}>{u.thisMonthCL ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{u.open ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, color: (u.cwRate ?? 0) >= 60 ? '#20C997' : '#F04452' }}>{u.cwRate ?? 0}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ background: '#F9FAFB', borderRadius: '12px', padding: '16px 20px', fontSize: '13px', color: '#6B7684' }}>
            <div style={{ fontWeight: 700, marginBottom: '4px', color: '#191F28' }}>📌 평가 기준</div>
            <div>기존 3/2/1억 클럽 폐지 → <span style={{ fontWeight: 700 }}>1등 집중 포상</span> (CW 건수 기준)</div>
          </div>
        </div>
      );
    }

    // ===== BO 인바운드 백오피스 =====
    function renderBOScore() {
      const boMemberNames = new Set((ibo?.members || []).map((m: any) => m.name));
      const allUsers = ibo?.cwConversionRate?.byUser || [];
      const dcUsers = ibo?.dailyClose?.byUser || [];
      const dcMap = new Map(dcUsers.map((u: any) => [u.name, u]));
      const blUsers = ibo?.sqlBacklog?.byUser || [];
      const blMap = new Map(blUsers.map((u: any) => [u.name, u]));
      // 계약 태블릿 댓수 (byBO)
      const contractByBO = new Map((ibo?.contractSummary?.byBO || []).map((b: any) => [b.name, b]));
      // members 기준 필터 + 데이터 없는 멤버도 포함
      const userMap = new Map(allUsers.map((u: any) => [u.name, u]));
      const filteredNames = Array.from(boMemberNames);
      if (filteredNames.length === 0) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음</div>;
      // 마감률: 3월 목표 2600대, 인당 = 2600 / BO멤버수
      const monthlyTarget = 2600;
      const perPersonTarget = Math.round(monthlyTarget / filteredNames.length);
      const members = filteredNames.map((name: string) => {
        const u = userMap.get(name) || { name, cwRate: 0, over7: 0, total: 0, thisMonthCW: 0, carryoverCW: 0, thisMonthCL: 0, carryoverCL: 0, cw: 0, cl: 0 };
        const dc = dcMap.get(name);
        const bl = blMap.get(name);
        const thisMonthCW = u.thisMonthCW ?? 0;
        const carryoverCW = u.carryoverCW ?? 0;
        const allCW = thisMonthCW + carryoverCW;
        const totalSQL = u.total ?? 0;
        // 당월 CW 기준 전환율 (스코어 판정용)
        const cwRate = totalSQL > 0 ? +((thisMonthCW / totalSQL) * 100).toFixed(1) : 0;
        const cwRateAll = totalSQL > 0 ? +((allCW / totalSQL) * 100).toFixed(1) : 0;
        // 일마감: KPI 탭과 동일하게 avgDailyCloseThisMonth (당월 기준) 사용
        const avgDaily = dc?.avgDailyCloseThisMonth ?? dc?.avgDailyClose ?? 0;
        const over7 = bl?.over7 ?? (u.over7 ?? 0);
        // 마감률: 계약 태블릿 댓수 (이월 포함) / 인당 목표 대수
        const contract = contractByBO.get(name);
        const tablets = contract?.tablets ?? 0;
        const closeRate = perPersonTarget > 0 ? +((tablets / perPersonTarget) * 100).toFixed(1) : 0;
        return {
          name: u.name ?? name,
          scores: [
            { label: 'CW전환율', weight: 50, value: cwRate >= 60 ? 50 : 0, detail: `당월 ${cwRate}% (이월 ${carryoverCW}건 / 합산 ${cwRateAll}%)`, color: '#8B5CF6', pct: (cwRate / 60) * 100 },
            { label: '일마감', weight: 10, value: avgDaily >= 5 ? 10 : 0, detail: `${(+avgDaily).toFixed(1)}건/일`, color: '#3182F6', pct: (avgDaily / 5) * 100 },
            { label: 'SQL잔량', weight: 10, value: over7 <= 10 ? 10 : 0, detail: `${over7}건`, color: '#FF8C00', pct: over7 <= 10 ? 100 : Math.max((1 - (over7 - 10) / 20) * 100, 5) },
            { label: '마감률', weight: 30, value: closeRate >= 100 ? 30 : 0, detail: `${tablets}/${perPersonTarget}대 (${closeRate}%)`, color: '#20C997', pct: Math.min(closeRate, 100) },
          ],
          total: 0,
        };
      });
      members.forEach(m => { m.total = m.scores.reduce((s, sc) => s + sc.value, 0); });
      return renderScoreSection('인바운드 백오피스 스코어', members, [
        { label: 'SQL→CW 전환율', weight: '50점', target: '목표: 60% 이상 (이월 포함)' },
        { label: '일일 마감 건수', weight: '10점', target: '목표: 일 5건 이상' },
        { label: '7일 초과 SQL 잔량', weight: '10점', target: '목표: 10건 이내' },
        { label: '마감률 (태블릿 댓수)', weight: '30점', target: `목표: 인당 ${perPersonTarget}대 (월 ${monthlyTarget}대/${filteredNames.length}명)` },
      ]);
    }

    // ===== 채널 TM =====
    function renderCsTmScore() {
      const tmMemberNames = new Set((csTm?.members || []).map((m: any) => m.name));
      const tmOwners = (csTm?.byOwner || []).filter((o: any) => tmMemberNames.has(o.name));
      if (tmOwners.length === 0) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음</div>;
      const members = tmOwners.map((o: any) => {
        const avgDailyConv = o.avgDailyConversion ?? 0;
        const frtOver20 = o.frtOver20 ?? 0;
        const unconverted = o.unconvertedMQL ?? 0;
        const sqlRate = (o.mql ?? 0) > 0 ? +((o.sql / o.mql) * 100).toFixed(1) : 0;
        return {
          name: o.name,
          scores: [
            { label: '전환건수', weight: 50, value: avgDailyConv >= 5 ? 50 : 0, detail: `${avgDailyConv}건/일`, color: '#8B5CF6', pct: (avgDailyConv / 5) * 100 },
            { label: 'FRT', weight: 10, value: frtOver20 === 0 ? 10 : 0, detail: `초과 ${frtOver20}건`, color: '#20C997', pct: frtOver20 === 0 ? 100 : Math.max((1 - frtOver20 / 10) * 100, 5) },
            { label: '미전환', weight: 20, value: unconverted === 0 ? 20 : 0, detail: `${unconverted}건`, color: '#FF8C00', pct: unconverted === 0 ? 100 : Math.max((1 - unconverted / 20) * 100, 5) },
            { label: 'SQL잔량', weight: 20, value: 20, detail: '-', color: '#3182F6' }, // TODO: per-user over7
          ],
          total: 0,
        };
      });
      members.forEach(m => { m.total = m.scores.reduce((s, sc) => s + sc.value, 0); });
      return renderScoreSection('TM 스코어', members, [
        { label: '영업기회 전환 건수 (일 5건 x 영업일수)', weight: '50점', target: '목표: 일 5건 이상' },
        { label: 'FRT (20분 초과 0건)', weight: '10점', target: '목표: 초과 0건' },
        { label: '미전환 건수', weight: '20점', target: '목표: 0건' },
        { label: '7일 초과 SQL 잔량', weight: '20점', target: '목표: 10건 이내' },
      ]);
    }

    // ===== 채널 BO =====
    function renderCsBoScore() {
      const csBoMemberNames = new Set((csBo?.members || []).map((m: any) => m.name));
      const allUsers = csBo?.cwConversionRate?.byUser || [];
      const ltUsers = csBo?.leadTime?.byUser || [];
      const blUsers = csBo?.sqlBacklog?.byUser || [];
      const dcUsers = csBo?.dailyClose?.byUser || [];
      const ltMap = new Map(ltUsers.map((u: any) => [u.name, u]));
      const blMap = new Map(blUsers.map((u: any) => [u.name, u]));
      const dcMap = new Map(dcUsers.map((u: any) => [u.name, u]));
      const userMap = new Map(allUsers.map((u: any) => [u.name, u]));
      const filteredNames = Array.from(csBoMemberNames);
      if (filteredNames.length === 0) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음</div>;
      const members = filteredNames.map((name: string) => {
        const u = userMap.get(name) || { name, cwRate: 0, total: 0, thisMonthCW: 0, carryoverCW: 0 };
        const thisMonthCW = u.thisMonthCW ?? 0;
        const carryoverCW = u.carryoverCW ?? 0;
        const allCW = thisMonthCW + carryoverCW;
        const totalSQL = u.total ?? 0;
        // 당월 CW 기준 전환율 (스코어 판정용)
        const cwRate = totalSQL > 0 ? +((thisMonthCW / totalSQL) * 100).toFixed(1) : 0;
        const cwRateAll = totalSQL > 0 ? +((allCW / totalSQL) * 100).toFixed(1) : 0;
        const dc = dcMap.get(name);
        const avgDaily = dc?.avgDailyCloseThisMonth ?? dc?.avgDailyClose ?? 0;
        const lt = ltMap.get(u.name);
        const overdue = lt?.overdue ?? 0;
        const bl = blMap.get(u.name);
        const over7 = bl?.over7 ?? 0;
        return {
          name: u.name,
          scores: [
            { label: 'CW전환율', weight: 50, value: cwRate >= 60 ? 50 : 0, detail: `당월 ${cwRate}% (이월 ${carryoverCW}건 / 합산 ${cwRateAll}%)`, color: '#8B5CF6', pct: (cwRate / 60) * 100 },
            { label: '일마감', weight: 20, value: avgDaily >= 3 ? 20 : 0, detail: `${(+avgDaily).toFixed(1)}건`, color: '#3182F6', pct: (avgDaily / 3) * 100 },
            { label: '리드타임', weight: 10, value: overdue === 0 ? 10 : 0, detail: `초과 ${overdue}건`, color: '#20C997', pct: overdue === 0 ? 100 : Math.max((1 - overdue / 10) * 100, 5) },
            { label: 'SQL잔량', weight: 20, value: over7 <= 10 ? 20 : 0, detail: `${over7}건`, color: '#FF8C00', pct: over7 <= 10 ? 100 : Math.max((1 - (over7 - 10) / 20) * 100, 5) },
          ],
          total: 0,
        };
      });
      members.forEach(m => { m.total = m.scores.reduce((s, sc) => s + sc.value, 0); });
      return renderScoreSection('채널 백오피스 스코어', members, [
        { label: 'SQL→CW 전환율', weight: '50점', target: '목표: 60% 이상' },
        { label: '일일 마감 건수', weight: '20점', target: '목표: 일 3건 이상' },
        { label: 'BO 배정 후 리드타임 (당일 완료)', weight: '10점', target: '목표: 초과 0건' },
        { label: '7일 초과 SQL 잔량', weight: '20점', target: '목표: 10건 이내' },
      ]);
    }

    // ===== 채널 AE (csData 기반) =====
    function renderAEScore() {
      const bd = csKpi?.bd;
      if (!bd) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음 (채널 데이터 로딩 필요)</div>;

      // MOU 체결 owner별 집계 (csMouStats.partner/franchiseHQ.thisMonthList)
      const mouPartners = csMouStats?.partner?.thisMonthList || [];
      const mouHQs = csMouStats?.franchiseHQ?.thisMonthList || [];
      const ownerMouCount: Record<string, number> = {};
      [...mouPartners, ...mouHQs].forEach((m: any) => {
        const owner = m.owner || m.Owner?.Name;
        if (owner) ownerMouCount[owner] = (ownerMouCount[owner] || 0) + 1;
      });

      // 네고진입 owner별 집계 (negoAccountsEnriched에서 파생)
      const negoTarget = bd.negoEntryThisMonth?.target ?? 10;
      const negoByOwner: Record<string, number> = {};
      negoAccountsEnriched.forEach((a: any) => {
        if (a.owner && a.owner !== '-') negoByOwner[a.owner] = (negoByOwner[a.owner] || 0) + 1;
      });

      // 미서명 owner별 (data.channel.ae에서 가져오되 csData 우선)
      const aeKpi = data?.channel?.ae;
      const unsignedMap = new Map((aeKpi?.unsignedContracts?.byOwner || []).map((o: any) => [o.name, o]));

      // 미팅 byOwner (csKpi.meetingsByOwner — mouIncomplete = 네고/MOU전 미팅)
      const meetingsByOwner = csKpi?.meetingsByOwner || [];
      const meetingMap = new Map(meetingsByOwner.map((o: any) => [o.name, o.total ?? 0]));

      // 영업일수 (csKpi.thisMonthDays = 현재 경과일, 영업일 근사값으로 0.7 곱)
      const workdays = aeKpi?.workdays ?? aeKpi?.totalWeekdays ?? (Math.round((csKpi?.thisMonthDays ?? 12) * 0.7) || 12);
      const meetingTarget = 2 * workdays;

      // 멤버 목록: meetingsByOwner + MOU owner + 네고 owner 합집합
      const memberSet = new Set<string>();
      meetingsByOwner.forEach((o: any) => { if (o.name) memberSet.add(o.name); });
      Object.keys(ownerMouCount).forEach(n => memberSet.add(n));
      Object.keys(negoByOwner).forEach(n => memberSet.add(n));
      // data.channel.ae.members가 있으면 그것으로 필터
      if (aeKpi?.members?.length > 0) {
        const aeNames = new Set(aeKpi.members.map((m: any) => m.name));
        memberSet.forEach(n => { if (!aeNames.has(n)) memberSet.delete(n); });
      }

      const members = Array.from(memberSet).map((name: string) => {
        const mouCnt = ownerMouCount[name] ?? 0;
        const negoCnt = negoByOwner[name] ?? 0;
        const unsigned = unsignedMap.get(name);
        const overdueCount = unsigned?.overdue ?? 0;
        const meetCnt = meetingMap.get(name) ?? 0;
        return {
          name,
          scores: [
            { label: 'MOU체결', weight: 50, value: mouCnt >= 4 ? 50 : 0, detail: `${mouCnt}건`, color: '#8B5CF6', pct: (mouCnt / 4) * 100 },
            { label: '네고진입', weight: 10, value: negoCnt >= negoTarget ? 10 : 0, detail: `${negoCnt}건`, color: '#FF8C00', pct: (negoCnt / negoTarget) * 100 },
            { label: '미서명', weight: 20, value: overdueCount === 0 ? 20 : 0, detail: overdueCount === 0 ? '없음' : `${overdueCount}건 초과`, color: '#20C997', pct: overdueCount === 0 ? 100 : Math.max((1 - overdueCount / 5) * 100, 5) },
            { label: '미팅', weight: 20, value: meetCnt >= meetingTarget ? 20 : 0, detail: `${meetCnt}건`, color: '#3182F6', pct: (meetCnt / meetingTarget) * 100 },
          ],
          total: 0,
        };
      });
      members.forEach(m => { m.total = m.scores.reduce((s, sc) => s + sc.value, 0); });
      return renderScoreSection('AE 스코어', members, [
        { label: '신규 MOU 체결 수', weight: '50점', target: '목표: 월 4건 이상' },
        { label: 'MOU 네고 단계 진입 건수', weight: '10점', target: `목표: 월 ${negoTarget}건 이상` },
        { label: '계약서 발송 후 미서명 경과 일수', weight: '20점', target: '목표: 7일 초과 0건' },
        { label: '미완료 파트너 캘린더 확정 미팅 수', weight: '20점', target: `목표: 일 2건 x 영업일수 (${meetingTarget}건)` },
      ]);
    }

    // ===== 채널 AM (csData 기반) =====
    function renderAMScore() {
      const amKpi = csKpi?.am;
      if (!amKpi) return <div style={{ color: '#8B95A1', padding: '40px', textAlign: 'center' }}>데이터 없음 (채널 데이터 로딩 필요)</div>;

      // 개인별 리드 (amHeatmap.data — Account Owner 기준, Lead→파트너Account→Owner 매핑)
      const amHeatmap = csSummary?.channelLeadsByOwner?.amHeatmap;
      const leadsByOwner = amHeatmap?.data || [];
      const leadMap = new Map(leadsByOwner.map((o: any) => [o.owner, { total: o.total ?? 0 }]));

      // 미팅 byOwner (csKpi.meetingsByOwner — mouComplete = MOU완료 곳 미팅)
      const meetingsByOwner = csKpi?.meetingsByOwner || [];
      const meetingMap = new Map(meetingsByOwner.map((o: any) => [o.name, o.mouComplete ?? 0]));

      // 영업일수
      const amData = data?.channel?.am;
      const workdays = amData?.workdays ?? amData?.totalWeekdays ?? (Math.round((csKpi?.thisMonthDays ?? 12) * 0.7) || 12);
      const meetingTarget = 2 * workdays;

      // 안착률 byOwner (csMouStats.onboarding.partner.list + franchiseHQ.list → owner별 집계)
      const partnerList = csMouStats?.onboarding?.partner?.list || [];
      const hqList = csMouStats?.onboarding?.franchiseHQ?.list || [];
      const onboardByOwner: Record<string, { settled: number; total: number }> = {};
      [...partnerList, ...hqList].forEach((p: any) => {
        const owner = p.owner || '-';
        if (!onboardByOwner[owner]) onboardByOwner[owner] = { settled: 0, total: 0 };
        onboardByOwner[owner].total++;
        if (p.isSettled || p.settled) onboardByOwner[owner].settled++;
      });

      // 활성파트너 byOwner (csPartnerStats + csFranchiseHQList — 최근 90일 리드 발생 기준)
      const activeByOwner: Record<string, number> = {};
      (csPartnerStats || []).forEach((p: any) => {
        if ((p.last3MonthLeadCount ?? 0) > 0) {
          const owner = p.owner || '-';
          activeByOwner[owner] = (activeByOwner[owner] || 0) + 1;
        }
      });
      (csFranchiseHQList || []).forEach((h: any) => {
        if ((h.last3MonthLeadCount ?? 0) > 0) {
          const owner = h.owner || '-';
          activeByOwner[owner] = (activeByOwner[owner] || 0) + 1;
        }
      });

      const leadTarget = 5; // 일 5건 목표

      // 멤버 목록: channelLeadsByOwner + meetingsByOwner + onboarding 합집합
      const memberSet = new Set<string>();
      leadsByOwner.forEach((o: any) => { if (o.owner) memberSet.add(o.owner); });
      meetingsByOwner.forEach((o: any) => { if (o.name) memberSet.add(o.name); });
      Object.keys(onboardByOwner).filter(n => n !== '-').forEach(n => memberSet.add(n));
      // data.channel.am.members가 있으면 그것으로 필터
      if (amData?.members?.length > 0) {
        const amNames = new Set(amData.members.map((m: any) => m.name));
        memberSet.forEach(n => { if (!amNames.has(n)) memberSet.delete(n); });
      }

      const members = Array.from(memberSet).map((name: string) => {
        const leadOwner = leadMap.get(name);
        const leadTotal = (leadOwner?.total ?? 0);
        const leadAvgDaily = workdays > 0 ? +(leadTotal / workdays).toFixed(1) : 0;
        const meetCnt = meetingMap.get(name) ?? 0;
        const onboard = onboardByOwner[name];
        const onboardRate = onboard && onboard.total > 0
          ? +((onboard.settled / onboard.total) * 100).toFixed(1) : 0;
        const activeCount = activeByOwner[name] ?? 0;
        return {
          name,
          scores: [
            { label: '리드확보', weight: 50, value: leadAvgDaily >= leadTarget ? 50 : 0, detail: `${leadAvgDaily}건/일`, color: '#8B5CF6', pct: (leadAvgDaily / leadTarget) * 100 },
            { label: '미팅', weight: 10, value: meetCnt >= meetingTarget ? 10 : 0, detail: `${meetCnt}건`, color: '#3182F6', pct: (meetCnt / meetingTarget) * 100 },
            { label: '안착률', weight: 20, value: onboardRate >= 80 ? 20 : 0, detail: `${onboardRate}%`, color: '#20C997', pct: (onboardRate / 80) * 100 },
            { label: '활성유지', weight: 20, value: activeCount >= 70 ? 20 : 0, detail: `${activeCount}개`, color: '#FF8C00', pct: (activeCount / 70) * 100 },
          ],
          total: 0,
        };
      });
      members.forEach(m => { m.total = m.scores.reduce((s, sc) => s + sc.value, 0); });
      return renderScoreSection('AM 스코어', members, [
        { label: '채널 리드 확보 수 (일 5건 x 영업일수)', weight: '50점', target: '목표: 일 5건 이상' },
        { label: 'MOU 완료 파트너 확정 미팅 수 (일 2건)', weight: '10점', target: `목표: ${meetingTarget}건 이상` },
        { label: '신규 파트너 초기 안착률', weight: '20점', target: '목표: 80% 이상' },
        { label: '기존 파트너 활성 유지', weight: '20점', target: '목표: 70개 이상' },
      ]);
    }

    const scoreGroups = [
      {
        label: '인바운드세일즈',
        tabs: [
          { key: 'is' as const, label: '인사이드세일즈', color: '#F04452' },
          { key: 'fs' as const, label: '필드세일즈', color: '#00B8D9' },
          { key: 'bo' as const, label: '백오피스', color: '#3182F6' },
        ],
      },
      {
        label: '채널세일즈',
        tabs: [
          { key: 'ae' as const, label: 'AE', color: '#20C997' },
          { key: 'am' as const, label: 'AM', color: '#00B8D9' },
          { key: 'tm' as const, label: 'TM', color: '#F04452' },
          { key: 'csbo' as const, label: '백오피스', color: '#3182F6' },
        ],
      },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* 파트 탭 */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', background: '#fff', borderRadius: '14px', padding: '10px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E5E8EB' }}>
          {scoreGroups.map((group, gi) => (
            <React.Fragment key={group.label}>
              {gi > 0 && <div style={{ width: '1px', background: '#E5E8EB', margin: '0 2px' }} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#8B95A1', letterSpacing: '0.5px', paddingLeft: '4px' }}>{group.label}</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {group.tabs.map((tab) => {
                    const isActive = scoreTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setScoreTab(tab.key)}
                        style={{
                          padding: '10px 18px', border: 'none', cursor: 'pointer', borderRadius: '10px',
                          fontSize: '15px', fontWeight: 700, transition: 'all 0.2s ease',
                          background: isActive ? tab.color : 'transparent',
                          color: isActive ? '#fff' : '#6B7684',
                          boxShadow: isActive ? `0 2px 8px ${tab.color}30` : 'none',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>

        {scoreTab === 'is' && renderISScore()}
        {scoreTab === 'fs' && renderFSScore()}
        {scoreTab === 'bo' && renderBOScore()}
        {scoreTab === 'ae' && renderAEScore()}
        {scoreTab === 'am' && renderAMScore()}
        {scoreTab === 'tm' && renderCsTmScore()}
        {scoreTab === 'csbo' && renderCsBoScore()}
      </div>
    );
  }

  const teamGroups = [
    { key: 'inbound' as const, label: '인바운드 세일즈팀', color: '#3182F6' },
    { key: 'channel' as const, label: '채널 세일즈팀', color: '#20C997' },
  ];

  const inboundTabs = [
    { key: 'is' as const, label: '인사이드세일즈', desc: '과정 지표가 결과(SQL 전환율)를 만듭니다', color: '#F04452' },
    { key: 'fs' as const, label: '필드세일즈', desc: '과정 지표(Golden Time·방문관리)가 결과(CW 전환율)를 만듭니다', color: '#00B8D9' },
    { key: 'bo' as const, label: '백오피스', desc: '과정 지표(일평균 마감·SQL 잔량)가 결과(CW 전환율)를 만듭니다', color: '#3182F6' },
  ];

  const channelTabs = [
    { key: 'ae' as const, label: 'AE', desc: '미팅 → 네고 체류 관리 → MOU 체결', color: '#20C997' },
    { key: 'am' as const, label: 'AM', desc: 'MOU 미팅 → Lead 창출 → 비활성 파트너 → 활성 파트너 관리', color: '#00B8D9' },
    { key: 'tm' as const, label: 'TM', desc: 'Lead 전환(방문+견적) → FRT → MQL 전환 → SQL 잔량 관리', color: '#F04452' },
    { key: 'bo' as const, label: '백오피스', desc: 'SQL→CW 전환율, 계약 체결, 일평균 마감, SQL 잔량 관리', color: '#3182F6' },
  ];

  const activeGroupInfo = teamGroups.find(g => g.key === activeGroup)!;
  const activeDesc = activeGroup === 'inbound'
    ? (inboundTabs.find(t => t.key === activeTab)?.desc ?? '')
    : activeGroup === 'channel'
    ? (channelTabs.find(t => t.key === csActiveTab)?.desc ?? '')
    : '직무별 담당자 스코어링 — 시상 기준 점수표';

  return (
    <div style={{ padding: '30px 40px', background: '#F9FAFB', minHeight: '100vh' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '1.8em', fontWeight: 700, color: '#191F28', letterSpacing: '-0.5px' }}>
              {activeGroup === 'score' ? '🏆 스코어' : 'KPI Dashboard'}
            </h1>
            {activeGroup !== 'score' && <TossBadge variant="weak" size="small" color="blue">v2</TossBadge>}
          </div>
          <p style={{ color: '#8B95A1', marginTop: '6px', fontSize: '15px' }}>
            {activeDesc}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 데이터 기준 시간 */}
          {(() => {
            const ts = [data?.extractedAt, csData?.generatedAt]
              .filter(Boolean)
              .sort()
              .pop();
            if (!ts) return null;
            const d = new Date(ts);
            const kst = new Date(d.getTime() + 9 * 3600000);
            const label = `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')} 기준`;
            return (
              <span style={{ fontSize: '13px', color: '#8B95A1', fontWeight: 400 }}>
                데이터 갱신 {label}
              </span>
            );
          })()}
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            style={{
              padding: '8px 16px', borderRadius: '10px', border: '1px solid #E5E8EB',
              fontSize: '14px', fontWeight: 600, color: '#191F28', background: '#fff', cursor: 'pointer',
            }}
          >
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* 팀 그룹 네비게이션 */}
      {activeGroup !== 'score' && <div style={{
        display: 'flex', gap: '6px', marginBottom: '12px',
      }}>
        {teamGroups.map(group => {
          const isActive = activeGroup === group.key;
          return (
            <button
              key={group.key}
              onClick={() => setActiveGroup(group.key)}
              style={{
                padding: '10px 24px', cursor: 'pointer',
                borderRadius: '10px', fontSize: '15px', fontWeight: 700,
                transition: 'all 0.2s ease',
                background: isActive ? group.color : '#fff',
                color: isActive ? '#fff' : '#8B95A1',
                boxShadow: isActive ? `0 2px 8px ${group.color}30` : '0 1px 3px rgba(0,0,0,0.06)',
                border: isActive ? 'none' : '1px solid #E5E8EB',
              }}
            >
              {group.label}
            </button>
          );
        })}
      </div>}

      {/* 하위 탭 네비게이션 (인바운드) */}
      {activeGroup === 'inbound' && (
        <div style={{
          display: 'flex', gap: '0', marginBottom: '28px',
          background: '#fff', borderRadius: '12px', padding: '4px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E5E8EB',
        }}>
          {inboundTabs.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: '12px 20px', border: 'none', cursor: 'pointer',
                  borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                  transition: 'all 0.2s ease',
                  background: isActive ? tab.color : 'transparent',
                  color: isActive ? '#fff' : '#6B7684',
                  boxShadow: isActive ? `0 2px 8px ${tab.color}30` : 'none',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 하위 탭 네비게이션 (채널) */}
      {activeGroup === 'channel' && (
        <div style={{
          display: 'flex', gap: '0', marginBottom: '28px',
          background: '#fff', borderRadius: '12px', padding: '4px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E5E8EB',
        }}>
          {channelTabs.map(tab => {
            const isActive = csActiveTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setCsActiveTab(tab.key)}
                style={{
                  flex: 1, padding: '12px 20px', border: 'none', cursor: 'pointer',
                  borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                  transition: 'all 0.2s ease',
                  background: isActive ? tab.color : 'transparent',
                  color: isActive ? '#fff' : '#6B7684',
                  boxShadow: isActive ? `0 2px 8px ${tab.color}30` : 'none',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{
          background: '#FFF0F0', borderRadius: '12px', padding: '16px 20px',
          marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <TossBadge variant="fill" size="small" color="red">오류</TossBadge>
          <span style={{ color: '#F04452', fontSize: '14px' }}>{error}</span>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '28px' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="metro-loading" style={{ flex: 1, height: '160px', borderRadius: '16px' }} />
          ))}
        </div>
      )}

      {/* 인사이드세일즈 탭 */}
      {activeGroup === 'inbound' && activeTab === 'is' && !loading && is && renderFlowSection(
        '인사이드세일즈',
        '',
        flowSteps, activeStep, setActiveStep, detailRenderers, 'red',
      )}

      {/* 필드세일즈 탭 */}
      {activeGroup === 'inbound' && activeTab === 'fs' && !loading && fs && renderFlowSection(
        '필드세일즈',
        '',
        fsFlowSteps, fsActiveStep, setFsActiveStep, fsDetailRenderers, 'teal',
      )}

      {/* 인바운드 백오피스 탭 */}
      {activeGroup === 'inbound' && activeTab === 'bo' && !loading && ibo && renderFlowSection(
        '백오피스',
        '',
        boFlowSteps, boActiveStep, setBoActiveStep, boDetailRenderers, 'blue',
        renderBOOwnerSummary(),
      )}

      {/* 스코어 탭 (상단) */}
      {activeGroup === 'score' && !loading && is && renderScoreTab()}

      {/* Channel Sales - AE 탭 */}
      {activeGroup === 'channel' && csActiveTab === 'ae' && !csLoading && csData && renderFlowSection(
        'AE',
        '',
        csAeFlowSteps, csAeActiveStep, setCsAeActiveStep, csAeDetailRenderers, 'green',
      )}

      {/* Channel Sales - AM 탭 */}
      {activeGroup === 'channel' && csActiveTab === 'am' && !csLoading && csData && renderFlowSection(
        'AM',
        '',
        csAmFlowSteps, csAmActiveStep, setCsAmActiveStep, csAmDetailRenderers, 'green',
      )}

      {/* Channel Sales - TM 탭 */}
      {activeGroup === 'channel' && csActiveTab === 'tm' && !loading && data?.channel?.tm && renderFlowSection(
        'TM',
        '',
        csTmFlowSteps, csTmActiveStep, setCsTmActiveStep, csTmDetailRenderers, 'red',
      )}

      {/* Channel Sales - 백오피스 탭 */}
      {activeGroup === 'channel' && csActiveTab === 'bo' && !loading && data?.channel?.backOffice && renderFlowSection(
        '백오피스',
        '',
        csBoFlowSteps, csBoActiveStep, setCsBoActiveStep, csBoDetailRenderers, 'blue',
      )}

      {/* Channel Sales - AE/AM 로딩 */}
      {activeGroup === 'channel' && (csActiveTab === 'ae' || csActiveTab === 'am') && csLoading && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '28px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="metro-loading" style={{ flex: 1, height: '160px', borderRadius: '16px' }} />
          ))}
        </div>
      )}

      {/* Channel Sales - TM/BO 로딩 */}
      {activeGroup === 'channel' && (csActiveTab === 'tm' || csActiveTab === 'bo') && loading && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '28px' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="metro-loading" style={{ flex: 1, height: '160px', borderRadius: '16px' }} />
          ))}
        </div>
      )}

      {/* Task 모달 팝업 */}
      {taskModal && (
        <div
          onClick={() => setTaskModal(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setTaskModal(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', width: '960px', maxWidth: '95vw',
              maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* 모달 헤더 */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', borderBottom: '2px solid #e3f2fd',
              background: 'linear-gradient(135deg, #e3f2fd, #f5f5f5)',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#1565c0', marginBottom: '2px' }}>
                  📋 과업 목록
                </h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>
                  {taskModal.oppName} · {taskModal.tasks.length}건
                </p>
              </div>
              <button
                onClick={() => setTaskModal(null)}
                style={{
                  background: 'none', border: 'none', fontSize: '1.5em', color: '#999',
                  cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
              >
                ✕
              </button>
            </div>
            {/* 모달 본문 */}
            <div style={{ overflow: 'auto', padding: '12px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>생성일</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#666' }}>제목</th>
                    <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>상태</th>
                    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>예정일</th>
                  </tr>
                </thead>
                <tbody>
                  {taskModal.tasks.map((t: any, i: number) => (
                    <React.Fragment key={t.id || i}>
                      <tr style={{ borderBottom: t.description ? 'none' : '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: '#555', verticalAlign: 'top' }}>{t.createdDate || '-'}</td>
                        <td style={{ padding: '10px 16px', fontWeight: 500, color: '#333', maxWidth: '300px' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.subject}>{t.subject}</div>
                        </td>
                        <td style={{ padding: '10px 16px', textAlign: 'center', verticalAlign: 'top' }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 600,
                            background: t.status === 'Completed' ? '#e8f5e9' : t.status === 'Not Started' ? '#fff3e0' : '#e3f2fd',
                            color: t.status === 'Completed' ? '#2e7d32' : t.status === 'Not Started' ? '#e65100' : '#1565c0',
                            border: `1px solid ${t.status === 'Completed' ? '#a5d6a7' : t.status === 'Not Started' ? '#ffcc80' : '#90caf9'}`,
                          }}>
                            {t.status === 'Completed' ? '완료' : t.status === 'Not Started' ? '미시작' : t.status === 'In Progress' ? '진행중' : t.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: '#555', verticalAlign: 'top' }}>{t.activityDate || '-'}</td>
                      </tr>
                      {t.description && (
                        <tr style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td colSpan={4} style={{ padding: '0 16px 10px 16px' }}>
                            <div style={{
                              fontSize: '0.9em', color: '#555', background: '#f8f9fa', borderRadius: '6px',
                              padding: '10px 14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              borderLeft: '3px solid #90caf9',
                            }}>
                              {t.description}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {taskModal.tasks.length === 0 && (
                <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>과업 데이터가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 리드 과업 상세 모달 */}
      {leadTaskModal && (
        <div
          onClick={() => setLeadTaskModal(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLeadTaskModal(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', width: '720px', maxWidth: '95vw',
              maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* 모달 헤더 */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', borderBottom: '2px solid #E8F5E9',
              background: 'linear-gradient(135deg, #E8F5E9, #F5F5F5)',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#2E7D32', marginBottom: '2px' }}>
                  📋 과업 상세
                </h3>
                <p style={{ fontSize: '0.9em', color: '#666' }}>
                  {leadTaskModal.leadName} · {leadTaskModal.tasks.length}건
                </p>
              </div>
              <button
                onClick={() => setLeadTaskModal(null)}
                style={{
                  background: 'none', border: 'none', fontSize: '1.5em', color: '#999',
                  cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
              >
                ✕
              </button>
            </div>
            {/* 모달 본문 */}
            <div style={{ overflow: 'auto', padding: '12px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>제목</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>담당자</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>상태</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>예정일</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>SF</th>
                  </tr>
                </thead>
                <tbody>
                  {leadTaskModal.tasks.map((t: any, i: number) => (
                    <React.Fragment key={i}>
                      <tr style={{ borderBottom: (t.description && t.description !== '-') ? 'none' : '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500, color: '#333', maxWidth: '280px' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.subject}>{t.subject || '-'}</div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', color: '#555', whiteSpace: 'nowrap' }}>{t.owner || '-'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 600,
                            background: t.status === 'Completed' ? '#e8f5e9' : t.status === 'Not Started' ? '#fff3e0' : '#e3f2fd',
                            color: t.status === 'Completed' ? '#2e7d32' : t.status === 'Not Started' ? '#e65100' : '#1565c0',
                            border: `1px solid ${t.status === 'Completed' ? '#a5d6a7' : t.status === 'Not Started' ? '#ffcc80' : '#90caf9'}`,
                          }}>
                            {t.status === 'Completed' ? '완료' : t.status === 'Not Started' ? '미시작' : t.status === 'In Progress' ? '진행중' : t.status === 'Open' ? '진행중' : t.status === 'Deferred' ? '보류' : t.status === 'Waiting on someone else' ? '대기' : (t.status || '-')}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap', color: '#555' }}>{t.date || '-'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {t.taskId ? (
                            <a
                              href={`https://torder.lightning.force.com/lightning/r/Task/${t.taskId}/view`}
                              target="_blank" rel="noopener noreferrer"
                              style={{ color: '#3182F6', fontSize: '13px', textDecoration: 'none' }}
                              title="Salesforce에서 보기"
                            >🔗</a>
                          ) : <span style={{ color: '#ccc' }}>-</span>}
                        </td>
                      </tr>
                      {t.description && t.description !== '-' && (
                        <tr style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td colSpan={5} style={{ padding: '0 12px 10px 12px' }}>
                            <div style={{
                              fontSize: '0.9em', color: '#555', background: '#f8f9fa', borderRadius: '6px',
                              padding: '10px 14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              borderLeft: '3px solid #66BB6A',
                            }}>
                              {t.description}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {leadTaskModal.tasks.length === 0 && (
                <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>과업 데이터가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 미팅 Raw 데이터 모달 — Account별 */}
      {meetingModal && (() => {
        const matchIds = new Set(meetingModal.accountIds || [meetingModal.accountId]);
        const acctEvents = (csData?.rawData?.channelEvents || [])
          .filter((e: any) => matchIds.has(e.WhatId))
          .sort((a: any, b: any) => new Date(b.ActivityDate || b.CreatedDate).getTime() - new Date(a.ActivityDate || a.CreatedDate).getTime());
        return (
          <div
            onClick={() => setMeetingModal(null)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#fff', borderRadius: '12px', width: '960px', maxWidth: '95vw',
                maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {/* 헤더 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '18px 24px', borderBottom: '2px solid #E3FAF0',
                background: 'linear-gradient(135deg, #E3FAF0, #F5F5F5)',
              }}>
                <div>
                  <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#20C997', marginBottom: '2px' }}>
                    📅 미팅 이력
                  </h3>
                  <p style={{ fontSize: '0.9em', color: '#666' }}>
                    {meetingModal.accountName} · 전체 {acctEvents.length}건
                  </p>
                </div>
                <button
                  onClick={() => setMeetingModal(null)}
                  style={{
                    background: 'none', border: 'none', fontSize: '1.5em', color: '#999',
                    cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                >
                  ✕
                </button>
              </div>
              {/* 본문 */}
              <div style={{ overflow: 'auto', padding: '12px 16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>미팅일</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>제목</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>담당자</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>유형</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acctEvents.map((e: any, i: number) => (
                      <React.Fragment key={e.Id || i}>
                        <tr style={{ borderBottom: e.Description ? 'none' : '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#333', fontWeight: 500 }}>
                            {e.ActivityDate || e.CreatedDate?.split('T')[0] || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 500, color: '#191F28' }}>
                            {e.Subject || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#555' }}>
                            {e.Owner?.Name || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 600,
                              background: '#E3FAF0', color: '#20C997', border: '1px solid #96E8C8',
                            }}>
                              {e.Type || '미팅'}
                            </span>
                          </td>
                        </tr>
                        {e.Description && (
                          <tr style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td colSpan={4} style={{ padding: '0 12px 10px 12px' }}>
                              <div style={{
                                fontSize: '0.9em', color: '#555', background: '#F8F9FA', borderRadius: '6px',
                                padding: '10px 14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                borderLeft: '3px solid #20C997',
                              }}>
                                {e.Description}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {acctEvents.length === 0 && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>미팅 데이터가 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* CS Task 모달 — Account별 */}
      {csTaskModal && (() => {
        const matchIds = new Set(csTaskModal.accountIds || [csTaskModal.accountId]);
        const acctTasks = (csData?.rawData?.channelTasks || [])
          .filter((t: any) => matchIds.has(t.WhatId))
          .sort((a: any, b: any) => new Date(b.ActivityDate || b.CreatedDate).getTime() - new Date(a.ActivityDate || a.CreatedDate).getTime());
        return (
          <div
            onClick={() => setCsTaskModal(null)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#fff', borderRadius: '12px', width: '960px', maxWidth: '95vw',
                maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {/* 헤더 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '18px 24px', borderBottom: '2px solid #EDE9FE',
                background: 'linear-gradient(135deg, #EDE9FE, #F5F5F5)',
              }}>
                <div>
                  <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#7C3AED', marginBottom: '2px' }}>
                    📋 Task 이력
                  </h3>
                  <p style={{ fontSize: '0.9em', color: '#666' }}>
                    {csTaskModal.accountName} · 전체 {acctTasks.length}건
                  </p>
                </div>
                <button
                  onClick={() => setCsTaskModal(null)}
                  style={{
                    background: 'none', border: 'none', fontSize: '1.5em', color: '#999',
                    cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                >
                  ✕
                </button>
              </div>
              {/* 본문 */}
              <div style={{ overflow: 'auto', padding: '12px 16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95em' }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>예정일</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666' }}>제목</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>담당자</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>상태</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }}>유형</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acctTasks.map((t: any, i: number) => (
                      <React.Fragment key={`cstask-${i}`}>
                        <tr style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#333', fontWeight: 500 }}>
                            {t.ActivityDate || t.CreatedDate?.split('T')[0] || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 500, color: '#191F28' }}>
                            {t.Subject || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: '#555' }}>
                            {t.Owner?.Name || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 600,
                              background: t.Status === 'Completed' ? '#e8f5e9' : t.Status === 'Not Started' ? '#fff3e0' : '#EDE9FE',
                              color: t.Status === 'Completed' ? '#2e7d32' : t.Status === 'Not Started' ? '#e65100' : '#7C3AED',
                              border: `1px solid ${t.Status === 'Completed' ? '#a5d6a7' : t.Status === 'Not Started' ? '#ffcc80' : '#C4B5FD'}`,
                            }}>
                              {t.Status === 'Completed' ? '완료' : t.Status === 'Not Started' ? '미시작' : t.Status === 'In Progress' ? '진행중' : (t.Status || '-')}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 600,
                              background: '#EDE9FE', color: '#7C3AED', border: '1px solid #C4B5FD',
                            }}>
                              {t.Type || 'Task'}
                            </span>
                          </td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {acctTasks.length === 0 && (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>Task 데이터가 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 온보딩 상세 모달 */}
      {onboardModal && (() => {
        const p = onboardModal.partner;
        const leads = p.leadDetails || [];
        const stores = p.storeDetails || [];
        return (
          <div onClick={() => setOnboardModal(null)} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: '#fff', borderRadius: '12px', width: '960px', maxWidth: '95vw',
              maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex', flexDirection: 'column',
            }}>
              {/* 헤더 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '18px 24px', borderBottom: '2px solid #EBFBEE',
                background: 'linear-gradient(135deg, #EBFBEE, #F5F5F5)',
              }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 700, color: '#20C997' }}>
                    🌱 온보딩 상세
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.9em', color: '#666' }}>
                    {p.name} · {(p.isSettled || p.settled) ? '안착' : '미안착'} · MOU {p.mouStart}
                  </p>
                </div>
                <button onClick={() => setOnboardModal(null)} style={{
                  background: 'none', border: 'none', fontSize: '1.5em', cursor: 'pointer', color: '#999',
                }}>✕</button>
              </div>

              {/* 바디 */}
              <div style={{ overflow: 'auto', padding: '16px 20px' }}>
                {/* 요약 */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[
                    { label: '안착여부', value: (p.isSettled || p.settled) ? '안착' : '미안착', color: (p.isSettled || p.settled) ? '#20C997' : '#F04452', bg: (p.isSettled || p.settled) ? '#E3FAF0' : '#FFF0F0' },
                    { label: '리드(window)', value: `${p.leadCountWithinWindow ?? 0}건`, color: '#3182F6', bg: '#E8F3FF' },
                    { label: '전체 리드', value: `${p.totalLeadCount ?? 0}건`, color: '#6B7684', bg: '#F2F4F6' },
                    { label: '추천매장', value: `${p.referredStoreCount ?? 0}개`, color: '#00B8D9', bg: '#E3FAFC' },
                  ].map(item => (
                    <div key={item.label} style={{ flex: '1 1 80px', padding: '10px 8px', borderRadius: '10px', background: item.bg, textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#6B7684', fontWeight: 600, marginBottom: '2px' }}>{item.label}</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* 리드 상세 */}
                {leads.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '8px' }}>
                      리드 내역 <TossBadge variant="weak" size="xsmall" color="blue">{leads.length}건</TossBadge>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#F9FAFB' }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '1px solid #E5E8EB' }}>매장명</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '1px solid #E5E8EB' }}>상태</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '1px solid #E5E8EB' }}>생성일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((l: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid #F2F4F6' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 500 }}>{l.storeName || l.Company || '-'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <TossBadge variant="weak" size="xsmall" color={l.Status === 'Closed - Converted' ? 'green' : 'blue'}>
                                {l.Status || '-'}
                              </TossBadge>
                            </td>
                            <td style={{ padding: '8px 10px', color: '#6B7684' }}>{l.CreatedDate?.split('T')[0] || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 추천매장 상세 */}
                {stores.length > 0 && (
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#191F28', marginBottom: '8px' }}>
                      추천매장 <TossBadge variant="weak" size="xsmall" color="teal">{stores.length}개</TossBadge>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#F9FAFB' }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '1px solid #E5E8EB' }}>매장명</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#6B7684', borderBottom: '1px solid #E5E8EB' }}>상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stores.map((s: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid #F2F4F6' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 500 }}>{s.Name || s.storeName || '-'}</td>
                            <td style={{ padding: '8px 10px', color: '#6B7684' }}>{s.Status || s.status || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {leads.length === 0 && stores.length === 0 && (
                  <div style={{ padding: '30px', textAlign: 'center', color: '#8B95A1' }}>
                    상세 데이터가 없습니다
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ============ 스타일 상수 ============

const thStyle: React.CSSProperties = {
  padding: '11px 14px',
  fontSize: '18px',
  fontWeight: 600,
  color: '#8B95A1',
  textAlign: 'left',
  borderBottom: '1px solid #E5E8EB',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '11px 14px',
  fontSize: '18px',
  color: '#333D4B',
  whiteSpace: 'nowrap',
};

export default function KPIV2Page() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: '#8B95A1' }}>로딩중...</div>}>
      <KPIV2PageInner />
    </Suspense>
  );
}
