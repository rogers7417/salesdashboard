'use client';

import React, { useState, useEffect } from 'react';
import { fetchKPIReport, fetchKPIMonths, fetchKPIDates, fetchKPIWeeks, fetchChannelSales, Week } from '@/lib/api';
import StatsCard from '@/components/StatsCard';
import DataTable from '@/components/DataTable';
import MeetingCalendar from '@/components/MeetingCalendar';
import LeadHeatmap from '@/components/LeadHeatmap';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, AreaChart, Area } from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4003';

type TabType = 'insideSales' | 'fieldSales' | 'inboundBO' | 'channelAE' | 'channelAM' | 'channelTM' | 'channelBO';

const tabs: { key: TabType; label: string; group: string }[] = [
  { key: 'insideSales', label: 'Inside Sales', group: '인바운드' },
  { key: 'fieldSales', label: 'Field Sales', group: '인바운드' },
  { key: 'inboundBO', label: 'Back Office', group: '인바운드' },
  { key: 'channelAE', label: 'AE', group: '채널' },
  { key: 'channelAM', label: 'AM', group: '채널' },
  { key: 'channelTM', label: 'TM', group: '채널' },
  { key: 'channelBO', label: 'Back Office', group: '채널' },
];

function fmtFrt(minutes: number): string {
  if (!minutes && minutes !== 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function kpiColor(value: number, target: number, lowerIsBetter = false): 'green' | 'orange' | 'red' {
  if (lowerIsBetter) {
    if (value <= target) return 'green';
    if (value <= target * 2) return 'orange';
    return 'red';
  }
  if (value >= target) return 'green';
  if (value >= target * 0.8) return 'orange';
  return 'red';
}

export default function KPIPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('insideSales');
  const [month, setMonth] = useState<string>('');
  const [months, setMonths] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null);
  const [taskModal, setTaskModal] = useState<{ oppName: string; tasks: any[] } | null>(null);
  const [extractStatus, setExtractStatus] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 채널 세일즈 데이터 (channel-sales-report 실시간 API)
  const [channelData, setChannelData] = useState<any>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  // 추출 상태 주기적 확인 (60초)
  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${API_BASE}/api/kpi/extract-status`)
        .then(r => r.json())
        .then(setExtractStatus)
        .catch(() => {});
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 60000);
    return () => clearInterval(timer);
  }, []);

  // 월 변경 시 채널 데이터 초기화
  useEffect(() => {
    setChannelData(null);
    setChannelError(null);
  }, [month]);

  // 채널 AE/AM 탭 활성 시 channel-sales-report API 호출
  useEffect(() => {
    if (activeTab !== 'channelAE' && activeTab !== 'channelAM') return;
    if (channelData && !channelError) return; // 이미 데이터가 있으면 재요청 안 함
    setChannelLoading(true);
    setChannelError(null);
    fetchChannelSales(month || undefined)
      .then(setChannelData)
      .catch((err) => {
        console.error('채널 세일즈 데이터 로딩 실패:', err);
        setChannelError('채널 세일즈 데이터를 불러오는데 실패했습니다. Salesforce 연동을 확인하세요.');
      })
      .finally(() => setChannelLoading(false));
  }, [activeTab, month, channelData, channelError]);

  // 수동 새로고침
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/kpi/refresh?month=${month}`, { method: 'POST' });
      const result = await res.json();
      setExtractStatus(result.status || result);
      if (res.ok) {
        // 데이터 다시 로드
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchKPIMonths()
      .then(res => {
        setMonths(res.months);
        if (res.months.length > 0 && !month) {
          setMonth(res.months[0]);
        }
      })
      .catch(console.error);
  }, []);

  // 월 변경 시 일별 파일 목록 + 주 목록 조회
  useEffect(() => {
    if (!month) return;
    fetchKPIDates(month)
      .then(res => setAvailableDates(res.dates || []))
      .catch(() => setAvailableDates([]));
    fetchKPIWeeks(month)
      .then(res => {
        setWeeks(res.weeks || []);
      })
      .catch(() => setWeeks([]));
  }, [month]);

  // 데이터 로딩 (월간 / 주별 / 일별)
  useEffect(() => {
    if (!month) return;
    if (viewMode === 'daily' && !selectedDate) return;
    if (viewMode === 'weekly' && !selectedWeek) return;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        let result;
        if (viewMode === 'weekly' && selectedWeek) {
          result = await fetchKPIReport(undefined, undefined, selectedWeek.start, selectedWeek.end);
        } else if (viewMode === 'daily' && selectedDate) {
          result = await fetchKPIReport(undefined, selectedDate);
        } else {
          result = await fetchKPIReport(month);
        }
        setData(result);
      } catch (err) {
        setError('KPI 데이터를 불러오는데 실패했습니다.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [month, viewMode, selectedDate, selectedWeek]);

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  // 모달 열기/닫기: ESC 키 + 배경 스크롤 방지
  useEffect(() => {
    if (!taskModal) return;
    // 배경 스크롤 방지
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

  // 키보드 ← → 로 일별/주별 이동
  useEffect(() => {
    if (viewMode === 'monthly') return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (viewMode === 'daily' && availableDates.length > 0) {
        const idx = availableDates.indexOf(selectedDate);
        if (e.key === 'ArrowLeft' && idx > 0) {
          e.preventDefault();
          setSelectedDate(availableDates[idx - 1]);
        } else if (e.key === 'ArrowRight' && idx < availableDates.length - 1) {
          e.preventDefault();
          setSelectedDate(availableDates[idx + 1]);
        }
      } else if (viewMode === 'weekly' && weeks.length > 0 && selectedWeek) {
        const idx = weeks.findIndex(w => w.weekNum === selectedWeek.weekNum);
        if (e.key === 'ArrowLeft' && idx > 0) {
          e.preventDefault();
          setSelectedWeek(weeks[idx - 1]);
        } else if (e.key === 'ArrowRight' && idx < weeks.length - 1) {
          e.preventDefault();
          setSelectedWeek(weeks[idx + 1]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode, selectedDate, availableDates, selectedWeek, weeks]);

  const tabStyle = (isActive: boolean) => ({
    padding: '10px 20px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.95em',
    fontWeight: 500 as const,
    background: isActive ? '#0078d4' : '#fff',
    color: isActive ? '#fff' : '#333',
    borderBottom: isActive ? '3px solid #0078d4' : '3px solid transparent',
    transition: 'all 0.2s',
  });

  // === Inside Sales 컬럼 ===
  const insideSalesColumns = [
    { key: 'name', header: '담당자' },
    { key: 'lead', header: 'Lead', align: 'right' as const },
    { key: 'mql', header: 'MQL', align: 'right' as const },
    { key: 'sql', header: 'SQL', align: 'right' as const },
    { key: 'sqlConversionRate', header: 'SQL전환율', align: 'right' as const, render: (v: number) => `${v}%` },
    { key: 'avgFrt', header: 'FRT평균', align: 'right' as const, render: (v: number) => fmtFrt(v) },
    { key: 'frtOver20', header: 'FRT>20분', align: 'right' as const },
    { key: 'visitConverted', header: '방문완료', align: 'right' as const },
    { key: 'visitRate', header: '방문율', align: 'right' as const, render: (v: number) => `${v}%` },
  ];

  // === Inside Sales Daily Task 컬럼 ===
  const dailyTaskColumns = [
    { key: 'name', header: '담당자' },
    { key: 'totalTasks', header: '총 Task', align: 'right' as const },
    { key: 'avgDaily', header: '일평균', align: 'right' as const },
    { key: 'daysOver30', header: '30건 이상 일수', align: 'right' as const },
    { key: 'totalWeekdays', header: '근무일수', align: 'right' as const },
  ];

  // === Field Sales 컬럼 ===
  // === 이월 포함 CW 컬럼 (Field/BO 공통) ===
  const cwRateBadge = (v: number) => {
    const bg = v >= 60 ? '#e8f5e9' : v >= 48 ? '#fff3e0' : '#ffebee';
    const color = v >= 60 ? '#2e7d32' : v >= 48 ? '#e65100' : '#c62828';
    return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{v}%</span>;
  };
  const combinedRateBadge = (v: number) => {
    const bg = v >= 60 ? '#e8f5e9' : v >= 40 ? '#e3f2fd' : '#f5f5f5';
    const color = v >= 60 ? '#2e7d32' : v >= 40 ? '#1565c0' : '#666';
    return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{v}%</span>;
  };
  const cwBadge = (v: number) => (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: '#e8f5e9', color: '#2e7d32' }}>{v}</span>
  );
  const clBadge = (v: number) => (
    v > 0 ? <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: '#ffebee', color: '#c62828' }}>{v}</span> : <span style={{ color: '#ccc' }}>0</span>
  );
  const fieldSalesColumns = [
    { key: 'name', header: '담당자' },
    { key: 'total', header: 'SQL', align: 'right' as const, group: '이번달 Lead' },
    { key: 'thisMonthCW', header: 'CW', align: 'right' as const, render: cwBadge, group: '이번달 Lead' },
    { key: 'thisMonthCL', header: 'CL', align: 'right' as const, render: clBadge, group: '이번달 Lead' },
    { key: 'open', header: '진행중', align: 'right' as const, group: '이번달 Lead', render: (v: number) => (
      <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: v > 30 ? '#fff3e0' : '#f5f5f5', color: v > 30 ? '#e65100' : '#333' }}>{v}</span>
    )},
    { key: 'thisMonthCWRate', header: '전환율', align: 'right' as const, render: cwRateBadge, group: '이번달 Lead' },
    { key: 'carryoverCW', header: 'CW', align: 'right' as const, render: cwBadge, group: '이월' },
    { key: 'carryoverCL', header: 'CL', align: 'right' as const, render: clBadge, group: '이월' },
    { key: 'combinedCWRate', header: '합산 전환율', align: 'right' as const, render: combinedRateBadge },
  ];

  const carryoverCWColumns = [
    { key: 'name', header: '담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'cw', header: '전체 CW', align: 'right' as const, render: cwBadge },
    { key: 'thisMonthCW', header: '이번달 CW', align: 'right' as const },
    { key: 'carryoverCW', header: '이월 CW', align: 'right' as const, render: (v: number) => (
      v > 0 ? <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>{v}</span> : <span style={{ color: '#ccc' }}>0</span>
    )},
    { key: 'cl', header: 'CL', align: 'right' as const, render: clBadge },
    { key: 'totalClosed', header: '마감건', align: 'right' as const },
    { key: 'cwRate', header: 'CW율', align: 'right' as const, render: cwRateBadge },
  ];

  // === Inbound BO 컬럼 ===
  const inboundBOColumns = [
    { key: 'name', header: '담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'total', header: 'SQL', align: 'right' as const, group: '이번달 Lead' },
    { key: 'thisMonthCW', header: 'CW', align: 'right' as const, render: cwBadge, group: '이번달 Lead' },
    { key: 'thisMonthCL', header: 'CL', align: 'right' as const, render: clBadge, group: '이번달 Lead' },
    { key: 'open', header: '진행중', align: 'right' as const, group: '이번달 Lead', render: (v: number) => (
      <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: v > 30 ? '#fff3e0' : '#f5f5f5', color: v > 30 ? '#e65100' : '#333' }}>{v}</span>
    )},
    { key: 'thisMonthCWRate', header: '전환율', align: 'right' as const, render: cwRateBadge, group: '이번달 Lead' },
    { key: 'carryoverCW', header: 'CW', align: 'right' as const, render: cwBadge, group: '이월' },
    { key: 'carryoverCL', header: 'CL', align: 'right' as const, render: clBadge, group: '이월' },
    { key: 'combinedCWRate', header: '합산 전환율', align: 'right' as const, render: combinedRateBadge },
    { key: 'avgDailyClose', header: '일평균마감', align: 'right' as const, group: '과정 지표', render: (_: number, row: any) => {
      const v = row.avgDailyClose ?? 0;
      const bg = v >= 5 ? '#e8f5e9' : v >= 3 ? '#fff3e0' : '#ffebee';
      const color = v >= 5 ? '#2e7d32' : v >= 3 ? '#e65100' : '#c62828';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{v}</span>;
    }},
    { key: 'over7', header: '7일+잔량', align: 'right' as const, group: '과정 지표', render: (_: any, row: any) => {
      const v = row.openByAge?.over7 ?? 0;
      const bg = v === 0 ? '#e8f5e9' : v <= 5 ? '#fff3e0' : '#ffebee';
      const color = v === 0 ? '#2e7d32' : v <= 5 ? '#e65100' : '#c62828';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{v}</span>;
    }},
    { key: 'contracts', header: '전체', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (v: number) => (
      <span style={{ fontWeight: 700, color: v > 0 ? '#2e7d32' : '#ccc' }}>{v}</span>
    )},
    { key: 'contractsNew', header: '신규(이월)', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (_: any, row: any) => {
      const v = row.contractsNew ?? 0;
      const carry = row.contractsNewCarryover ?? 0;
      return (
        <span>
          <span style={{ fontWeight: 700, color: v > 0 ? '#1565c0' : '#ccc' }}>{v}</span>
          {carry > 0 && <span style={{ fontSize: '0.72em', color: '#e65100', marginLeft: '3px' }}>({carry})</span>}
        </span>
      );
    }},
    { key: 'contractsAddInstall', header: '추가설치', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (v: number) => (
      <span style={{ fontWeight: 700, color: v > 0 ? '#e65100' : '#ccc' }}>{v}</span>
    )},
    { key: 'contractTablets', header: '태블릿', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (v: number) => (
      <span style={{ fontWeight: 600, color: v > 0 ? '#555' : '#ccc' }}>{v}대</span>
    )},
    { key: 'tabletRatio', header: '건당 태블릿', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (_: any, row: any) => {
      const contracts = row.contracts ?? 0;
      const tablets = row.contractTablets ?? 0;
      if (contracts === 0) return <span style={{ color: '#ccc' }}>-</span>;
      const ratio = (tablets / contracts).toFixed(1);
      return <span style={{ fontWeight: 600, color: '#555' }}>{ratio}대</span>;
    }},
    { key: 'tabletAchievement', header: '달성률', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (_: any, row: any) => {
      const tablets = row.contractTablets ?? 0;
      const target = 650; // IBS 2,600대 / 4명
      if (row.name === '(미배정)') return <span style={{ color: '#ccc' }}>-</span>;
      const pct = ((tablets / target) * 100).toFixed(1);
      const numPct = parseFloat(pct);
      const bg = numPct >= 100 ? '#e8f5e9' : numPct >= 50 ? '#fff3e0' : '#ffebee';
      const color = numPct >= 100 ? '#2e7d32' : numPct >= 50 ? '#e65100' : '#c62828';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{pct}%</span>;
    }},
  ];

  // === Channel TM 컬럼 ===
  const channelTMColumns = [
    { key: 'name', header: '담당자' },
    { key: 'lead', header: 'Lead', align: 'right' as const },
    { key: 'mql', header: 'MQL', align: 'right' as const },
    { key: 'sql', header: 'SQL', align: 'right' as const },
    { key: 'converted', header: '방문배정', align: 'right' as const },
    { key: 'quoteTransitions', header: '견적발송', align: 'right' as const },
    { key: 'totalActions', header: '합산', align: 'right' as const, render: (v: number) => (
      <span style={{ fontWeight: 700, color: '#1565c0' }}>{v ?? 0}</span>
    )},
    { key: 'avgDailyActions', header: '인당일평균', align: 'right' as const, render: (v: number) => {
      const val = v ?? 0;
      const bg = val >= 5 ? '#e8f5e9' : val >= 3 ? '#fff3e0' : '#ffebee';
      const color = val >= 5 ? '#2e7d32' : val >= 3 ? '#e65100' : '#c62828';
      return <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: bg, color }}>{val}건</span>;
    }},
    { key: 'avgFrt', header: 'FRT평균', align: 'right' as const, render: (v: number) => fmtFrt(v) },
    { key: 'frtOver20', header: 'FRT>20분', align: 'right' as const },
    { key: 'unconvertedMQL', header: '미전환MQL', align: 'right' as const },
  ];

  // === Channel AM 리드 컬럼 ===
  const channelAMColumns = [
    { key: 'name', header: '담당자' },
    { key: 'partner', header: '파트너 리드', align: 'right' as const },
    { key: 'franchise', header: '프랜차이즈 리드', align: 'right' as const },
    { key: 'total', header: '전체', align: 'right' as const },
  ];

  // === Channel AE 미팅 컬럼 ===
  const meetingColumns = [
    { key: 'name', header: '담당자' },
    { key: 'count', header: '미팅 수', align: 'right' as const },
  ];

  // === Channel BO 컬럼 ===
  const channelBOColumns = [
    { key: 'name', header: '담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'total', header: 'SQL', align: 'right' as const, group: '이번달 Lead' },
    { key: 'thisMonthCW', header: 'CW', align: 'right' as const, render: cwBadge, group: '이번달 Lead' },
    { key: 'thisMonthCL', header: 'CL', align: 'right' as const, render: clBadge, group: '이번달 Lead' },
    { key: 'thisMonthCWRate', header: '전환율', align: 'right' as const, render: cwRateBadge, group: '이번달 Lead' },
    { key: 'open', header: '진행중', align: 'right' as const, group: '이번달 Lead', render: (v: number) => {
      const bg = v > 30 ? '#fff3e0' : 'transparent';
      const color = v > 30 ? '#e65100' : v > 0 ? '#333' : '#ccc';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 600, background: bg, color }}>{v}</span>;
    }},
    { key: 'carryoverCW', header: 'CW', align: 'right' as const, render: cwBadge, group: '이월' },
    { key: 'carryoverCL', header: 'CL', align: 'right' as const, render: clBadge, group: '이월' },
    { key: 'combinedCWRate', header: '합산 전환율', align: 'right' as const, render: combinedRateBadge },
    { key: 'avgDailyClose', header: '일평균마감', align: 'right' as const, group: '과정 지표', render: (_: number, row: any) => {
      const v = row.avgDailyClose ?? 0;
      const bg = v >= 3 ? '#e8f5e9' : v >= 2 ? '#fff3e0' : '#ffebee';
      const color = v >= 3 ? '#2e7d32' : v >= 2 ? '#e65100' : '#c62828';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{v}</span>;
    }},
    { key: 'over7', header: '7일+잔량', align: 'right' as const, group: '과정 지표', render: (v: number) => {
      const bg = v > 10 ? '#ffebee' : v > 5 ? '#fff3e0' : v > 0 ? '#e8f5e9' : 'transparent';
      const color = v > 10 ? '#c62828' : v > 5 ? '#e65100' : v > 0 ? '#2e7d32' : '#ccc';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: bg, color }}>{v}</span>;
    }},
    { key: 'contracts', header: '전체', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (v: number) => (
      <span style={{ fontWeight: 700, color: v > 0 ? '#2e7d32' : '#ccc' }}>{v}</span>
    )},
    { key: 'contractsNew', header: '신규(이월)', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (_: any, row: any) => {
      const v = row.contractsNew ?? 0;
      const carry = row.contractsNewCarryover ?? 0;
      return (
        <span>
          <span style={{ fontWeight: 700, color: v > 0 ? '#1565c0' : '#ccc' }}>{v}</span>
          {carry > 0 && <span style={{ fontSize: '0.72em', color: '#e65100', marginLeft: '3px' }}>({carry})</span>}
        </span>
      );
    }},
    { key: 'contractsAddInstall', header: '추가설치', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (v: number) => (
      <span style={{ fontWeight: 700, color: v > 0 ? '#e65100' : '#ccc' }}>{v}</span>
    )},
    { key: 'contractTablets', header: '태블릿', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (v: number) => (
      <span style={{ fontWeight: 600, color: v > 0 ? '#555' : '#ccc' }}>{v}대</span>
    )},
    { key: 'tabletRatio', header: '건당 태블릿', align: 'right' as const, group: '계약 (ContractDateStart 기준)', render: (_: any, row: any) => {
      const contracts = row.contracts ?? 0;
      const tablets = row.contractTablets ?? 0;
      if (contracts === 0) return <span style={{ color: '#ccc' }}>-</span>;
      const ratio = (tablets / contracts).toFixed(1);
      return <span style={{ fontWeight: 600, color: '#555' }}>{ratio}대</span>;
    }},
  ];

  const is = data?.inbound?.insideSales;
  const fs = data?.inbound?.fieldSales;
  const ibo = data?.inbound?.backOffice;
  const ae = data?.channel?.ae;
  const am = data?.channel?.am;
  const tm = data?.channel?.tm;
  const cbo = data?.channel?.backOffice;
  const dailyTrends: any[] = (data?.dailyTrends as any[]) || [];

  // 일별 Raw 데이터로 이동하는 헬퍼
  const goToDaily = (date: string) => {
    setViewMode('daily');
    setSelectedDate(date);
    setSelectedWeek(null);
  };

  // 일별 추이 섹션: 왼쪽 차트 + 오른쪽 날짜 리스트
  function DailyTrendPanel({ title, subtitle, color, trendData, valueKey, targetValue, unit, problemFilter, problemLabel, problemColor }: {
    title: string;
    subtitle: string;
    color: string;
    trendData: { date: string; dayName: string; value: number | null; rawCount?: number }[];
    valueKey: string;
    targetValue: number;
    unit: string;
    problemFilter: (d: any) => boolean;
    problemLabel: string;
    problemColor: string;
  }) {
    // 주말 제외한 영업일만
    const weekdayData = trendData.filter(d => {
      const dow = new Date(d.date + 'T00:00:00').getDay();
      return dow !== 0 && dow !== 6;
    });
    const validData = weekdayData.filter(d => d.value !== null && d.value !== undefined);
    const problemDays = validData.filter(problemFilter);

    if (validData.length === 0) return null;

    const problemRate = validData.length > 0 ? Math.round((problemDays.length / validData.length) * 100) : 0;
    const isHealthy = problemDays.length === 0;
    const isCritical = problemRate >= 70;

    return (
      <div style={{
        background: '#fff',
        borderRadius: '10px',
        border: `1px solid ${isHealthy ? '#c8e6c9' : isCritical ? `${problemColor}30` : '#e8e8e8'}`,
        padding: '20px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 좌측 색상 바 */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: '4px',
          background: isHealthy ? '#4caf50' : isCritical ? problemColor : color,
        }} />

        {/* 헤더: 제목 + 요약 뱃지 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingLeft: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div>
              <span style={{ fontSize: '1em', fontWeight: 700, color: '#333' }}>{title}</span>
              <span style={{ fontSize: '0.8em', color: '#999', marginLeft: '8px' }}>{subtitle}</span>
            </div>
          </div>
          {isHealthy ? (
            <div style={{
              padding: '4px 12px', borderRadius: '12px', fontSize: '0.78em', fontWeight: 600,
              background: '#e8f5e9', color: '#2e7d32',
            }}>
              ALL CLEAR
            </div>
          ) : (
            <div style={{
              padding: '4px 12px', borderRadius: '12px', fontSize: '0.78em', fontWeight: 600,
              background: isCritical ? '#ffebee' : '#fff3e0',
              color: isCritical ? '#c62828' : '#e65100',
            }}>
              {problemDays.length}/{validData.length}일 미달 ({problemRate}%)
            </div>
          )}
        </div>

        {/* 2열 레이아웃: 왼쪽 차트 + 오른쪽 날짜 */}
        <div style={{ display: 'flex', gap: '20px', paddingLeft: '8px' }}>
          {/* 왼쪽: 차트 (60%) */}
          <div style={{ flex: '6', minWidth: 0 }}>
            <div style={{ height: '200px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={validData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id={`grad-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date" tick={{ fontSize: 12, fill: '#666', fontWeight: 500 }}
                    tickFormatter={(v: string) => `${parseInt(v.substring(8))}일`}
                    axisLine={{ stroke: '#ddd' }} tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#888', fontWeight: 500 }}
                    axisLine={false} tickLine={false}
                    width={40}
                    tickFormatter={(v: number) => `${v}${unit}`}
                  />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      const isProblem = problemFilter(d);
                      return (
                        <div style={{
                          background: '#fff', borderRadius: '8px', padding: '10px 14px',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                          border: `1.5px solid ${isProblem ? problemColor : color}`,
                          fontSize: '0.82em', minWidth: '140px',
                        }}>
                          <div style={{ fontWeight: 700, marginBottom: '6px', color: '#333' }}>
                            {d.date.substring(5)} ({d.dayName})
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                            <span style={{ color: '#888' }}>{title}</span>
                            <b style={{ color: isProblem ? problemColor : color }}>{d.value}{unit}</b>
                          </div>
                          {d.rawCount !== undefined && d.rawCount > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '3px' }}>
                              <span style={{ color: '#888' }}>{problemLabel}</span>
                              <b style={{ color: problemColor }}>{d.rawCount}건</b>
                            </div>
                          )}
                          {isProblem && (
                            <div style={{
                              marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #f0f0f0',
                              color: problemColor, fontSize: '0.9em', fontWeight: 600, textAlign: 'center',
                            }}>
                              클릭하여 Raw 데이터 확인 →
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={targetValue} stroke={problemColor} strokeDasharray="4 4" strokeOpacity={0.5} label={{
                    value: `목표 ${targetValue}${unit}`, position: 'insideTopRight',
                    style: { fontSize: '12px', fill: problemColor, opacity: 0.7, fontWeight: 500 },
                  }} />
                  <Area
                    type="monotone" dataKey="value" stroke={color} fill={`url(#grad-${valueKey})`}
                    strokeWidth={2.5}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      const isProblem = problemFilter(payload);
                      if (isProblem) {
                        return (
                          <g key={payload.date}>
                            <circle cx={cx} cy={cy} r={7} fill={problemColor} fillOpacity={0.12} />
                            <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={problemColor} strokeWidth={2.5} style={{ cursor: 'pointer' }} />
                          </g>
                        );
                      }
                      return <circle key={payload.date} cx={cx} cy={cy} r={2.5} fill={color} stroke="#fff" strokeWidth={1} />;
                    }}
                    activeDot={{ r: 6, stroke: color, strokeWidth: 2, fill: '#fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 오른쪽: 캘린더 (40%) */}
          <div style={{
            flex: '4',
            minWidth: 0,
            borderLeft: '1px solid #f0f0f0',
            paddingLeft: '20px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {(() => {
              // 캘린더 데이터 생성
              const dataMap = new Map<string, any>();
              trendData.forEach(d => dataMap.set(d.date, d));
              const problemSet = new Set(problemDays.map(d => d.date));

              // 월의 첫째 날과 마지막 날
              const firstDate = trendData[0]?.date;
              if (!firstDate) return null;
              const yearMonth = firstDate.substring(0, 7);
              const firstDay = new Date(yearMonth + '-01T00:00:00');
              const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
              const startDow = firstDay.getDay(); // 0=일, 1=월...
              const totalDays = lastDay.getDate();

              const calDays = ['일', '월', '화', '수', '목', '금', '토'];
              const cells: { day: number; date: string; dow: number }[] = [];
              for (let d = 1; d <= totalDays; d++) {
                const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
                const dow = (startDow + d - 1) % 7;
                cells.push({ day: d, date: dateStr, dow });
              }

              return (
                <>
                  <div style={{ fontSize: '0.72em', color: '#888', marginBottom: '8px', fontWeight: 600, letterSpacing: '0.3px', textAlign: 'center' }}>
                    문제 일자 클릭 → Raw 데이터
                  </div>
                  {/* 요일 헤더 */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '2px', marginBottom: '4px',
                  }}>
                    {calDays.map((d, i) => (
                      <div key={d} style={{
                        textAlign: 'center', fontSize: '0.78em', fontWeight: 600,
                        color: i === 0 ? '#e53935' : i === 6 ? '#1565c0' : '#888',
                        padding: '4px 0',
                      }}>{d}</div>
                    ))}
                  </div>
                  {/* 날짜 그리드 */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '2px',
                  }}>
                    {/* 첫 주 빈 칸 */}
                    {Array.from({ length: startDow }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {cells.map(cell => {
                      const entry = dataMap.get(cell.date);
                      const isWeekend = cell.dow === 0 || cell.dow === 6;
                      const isProblem = problemSet.has(cell.date);
                      const hasData = entry && entry.value !== null && entry.value !== undefined;
                      const isOk = hasData && !isProblem;

                      return (
                        <button
                          key={cell.date}
                          onClick={() => isProblem ? goToDaily(cell.date) : undefined}
                          disabled={!isProblem}
                          title={hasData ? `${cell.date} — ${title}: ${entry.value}${unit}` : `${cell.date}`}
                          style={{
                            aspectRatio: '1',
                            border: 'none',
                            borderRadius: '6px',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.92em',
                            fontWeight: isProblem ? 700 : 500,
                            cursor: isProblem ? 'pointer' : 'default',
                            transition: 'all 0.15s',
                            background: isProblem ? `${problemColor}15` : isOk ? '#e8f5e910' : 'transparent',
                            color: isWeekend && !hasData ? '#ccc'
                              : isProblem ? problemColor
                              : isOk ? '#2e7d32'
                              : '#bbb',
                            position: 'relative',
                          }}
                          onMouseOver={(e) => { if (isProblem) e.currentTarget.style.background = `${problemColor}30`; }}
                          onMouseOut={(e) => { if (isProblem) e.currentTarget.style.background = `${problemColor}15`; }}
                        >
                          <span>{cell.day}</span>
                          {hasData && (
                            <span style={{
                              fontSize: '0.75em', lineHeight: 1, marginTop: '1px',
                              color: isProblem ? problemColor : '#888',
                              fontWeight: isProblem ? 700 : 500,
                            }}>
                              {entry.value}{unit}
                            </span>
                          )}
                          {isProblem && (
                            <div style={{
                              position: 'absolute', top: '2px', right: '2px',
                              width: '5px', height: '5px', borderRadius: '50%',
                              background: problemColor,
                            }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {/* 범례 */}
                  <div style={{
                    display: 'flex', gap: '12px', justifyContent: 'center',
                    marginTop: '8px', fontSize: '0.68em', color: '#999',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: problemColor, display: 'inline-block' }} />
                      미달
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4caf50', display: 'inline-block' }} />
                      달성
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e0e0e0', display: 'inline-block' }} />
                      데이터 없음
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  }

  // BO 전용 렌더러 (컴포넌트 레벨 — renderInboundBO, renderChannelBO 공유)
  const sfOppLink = (name: string, row: any) => row.oppId ? (
    <a href={`https://torder.lightning.force.com/lightning/r/Opportunity/${row.oppId}/view`} target="_blank" rel="noopener noreferrer"
      style={{ color: '#1565c0', textDecoration: 'none', borderBottom: '1px dashed #90caf9' }}
      onMouseOver={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = '#0d47a1')}
      onMouseOut={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.color = '#1565c0')}
    >{name}</a>
  ) : <span>{name}</span>;

  const ageBadge = (v: number) => {
    if (v === null || v === undefined) return <span>-</span>;
    const bg = v > 30 ? '#b71c1c' : v > 14 ? '#e53935' : v > 7 ? '#ff7043' : v > 3 ? '#ffa726' : '#66bb6a';
    return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.88em', fontWeight: 700, background: bg, color: '#fff', whiteSpace: 'nowrap' as const }}>{v}일</span>;
  };

  const boStageBadge = (v: string, row?: any) => {
    if (!v) return <span>-</span>;
    const colors: Record<string, { bg: string; color: string }> = {
      '미팅확정': { bg: '#e3f2fd', color: '#1565c0' },
      '제안': { bg: '#fff3e0', color: '#e65100' },
      '견적': { bg: '#ede7f6', color: '#4a148c' },
      '계약': { bg: '#e8f5e9', color: '#2e7d32' },
      '출고진행': { bg: '#e0f7fa', color: '#00695c' },
      '방문배정': { bg: '#f3e5f5', color: '#7b1fa2' },
      'Closed Won': { bg: '#e8f5e9', color: '#1b5e20' },
      'Closed Lost': { bg: '#ffebee', color: '#b71c1c' },
    };
    const style = colors[v] || { bg: '#f5f5f5', color: '#555' };
    const badge = <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: style.bg, color: style.color, whiteSpace: 'nowrap' as const }}>{v}</span>;

    // 이후에 Close된 건이면 현재 상태 뱃지 추가
    if (row?.currentStage && row.currentStage !== v) {
      const isCW = row.currentStage === 'Closed Won';
      const closedLabel = isCW ? 'CW' : 'CL';
      const closedDate = row.closedDate ? ` ${row.closedDate.substring(5).replace('-', '/')}` : '';
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ textDecoration: 'line-through', opacity: 0.5, padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: style.bg, color: style.color, whiteSpace: 'nowrap' as const }}>{v}</span>
          <span style={{
            padding: '2px 6px', borderRadius: '4px', fontSize: '0.75em', fontWeight: 700,
            background: isCW ? '#e8f5e9' : '#ffebee',
            color: isCW ? '#1b5e20' : '#b71c1c',
            whiteSpace: 'nowrap' as const,
          }}>→{closedLabel}{closedDate}</span>
        </span>
      );
    }
    return badge;
  };

  const resultBadge = (v: string) => {
    if (v === 'Closed Won') return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: '#e8f5e9', color: '#1b5e20', fontSize: '0.85em' }}>CW</span>;
    if (v === 'Closed Lost') return <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: '#ffebee', color: '#b71c1c', fontSize: '0.85em' }}>CL</span>;
    return <span>{v}</span>;
  };

  const quoteBadge = (v: boolean) => v
    ? <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#e8f5e9', color: '#2e7d32', fontWeight: 600, fontSize: '0.85em' }}>있음</span>
    : <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#ffebee', color: '#c62828', fontWeight: 600, fontSize: '0.85em' }}>없음</span>;

  const lastActivityRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#ccc' }}>-</span>;
    const color = v > 7 ? '#c62828' : v > 3 ? '#e65100' : '#333';
    return <span style={{ fontWeight: 600, color }}>{v}일 전</span>;
  };

  const boReasonBadge = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#ccc' }}>-</span>;
    return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: '#fce4ec', color: '#c62828', whiteSpace: 'nowrap' as const }}>{v}</span>;
  };

  // 방문일 렌더러 — 날짜 중심, 완료일/예정일 구분
  const visitDateRender = (_: any, row: any) => {
    const completeDate = row.visitCompleteDate;
    const scheduleDate = row.visitScheduleDate;
    if (completeDate) {
      return (
        <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 700, background: '#e8f5e9', color: '#1b5e20', fontSize: '0.88em', whiteSpace: 'nowrap' as const }}>
          {completeDate}
        </span>
      );
    }
    if (scheduleDate) {
      return (
        <span style={{ padding: '3px 10px', borderRadius: '4px', fontWeight: 600, background: '#e3f2fd', color: '#1565c0', fontSize: '0.85em', whiteSpace: 'nowrap' as const }}>
          {scheduleDate} <span style={{ fontSize: '0.8em' }}>예정</span>
        </span>
      );
    }
    return <span style={{ color: '#ccc', fontSize: '0.85em' }}>-</span>;
  };

  // 매장상태 렌더러
  const companyStatusBadge = (v: string) => {
    if (!v || v === '-') return <span style={{ color: '#ccc' }}>-</span>;
    const colors: Record<string, { bg: string; color: string }> = {
      '운영중': { bg: '#e8f5e9', color: '#2e7d32' },
      '오픈전': { bg: '#fff3e0', color: '#e65100' },
      '폐업': { bg: '#ffebee', color: '#b71c1c' },
      '휴업': { bg: '#fce4ec', color: '#c62828' },
    };
    const style = colors[v] || { bg: '#f5f5f5', color: '#555' };
    return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.82em', fontWeight: 600, background: style.bg, color: style.color, whiteSpace: 'nowrap' as const }}>{v}</span>;
  };

  // 경과일 공통 렌더러 (방문후/생성→방문 등)
  const daysElapsedRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#ccc', fontSize: '0.85em' }}>-</span>;
    const bg = v > 14 ? '#b71c1c' : v > 7 ? '#e53935' : v > 3 ? '#ff7043' : v <= 1 ? '#66bb6a' : '#ffa726';
    return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.88em', fontWeight: 700, background: bg, color: '#fff', whiteSpace: 'nowrap' as const }}>{v}일</span>;
  };

  // 생성→방문 소요일 렌더러 (짧을수록 좋음)
  const daysToVisitRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#ccc', fontSize: '0.85em' }}>-</span>;
    const bg = v <= 1 ? '#66bb6a' : v <= 3 ? '#ffa726' : v <= 7 ? '#ff7043' : '#e53935';
    return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.88em', fontWeight: 700, background: bg, color: '#fff', whiteSpace: 'nowrap' as const }}>{v}일</span>;
  };

  // 과업 셀 클릭 핸들러
  const openTaskModal = (row: any) => {
    if (row.tasks && row.tasks.length > 0) {
      setTaskModal({ oppName: row.name, tasks: row.tasks });
    }
  };

  // 다음 과업 날짜 렌더러
  const nextTaskDateRender = (_: any, row: any) => {
    const date = row.nextTaskDate;
    const subject = row.nextTaskSubject;
    const hasTasks = row.tasks && row.tasks.length > 0;
    if (!date || date === '-') {
      if (hasTasks) return (
        <span onClick={() => openTaskModal(row)} style={{ color: '#999', fontSize: '0.82em', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' as const }}>
          {row.taskCount}건
        </span>
      );
      return <span style={{ color: '#ccc', fontSize: '0.85em' }}>-</span>;
    }
    return (
      <div onClick={() => openTaskModal(row)} style={{ lineHeight: 1.4, cursor: hasTasks ? 'pointer' : 'default' }}>
        <div style={{ fontSize: '0.88em', fontWeight: 700, color: '#1565c0', whiteSpace: 'nowrap' as const }}>{date}</div>
        {subject && subject !== '-' && (
          <div style={{ fontSize: '0.75em', color: '#888', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={subject}>{subject}</div>
        )}
        {hasTasks && <div style={{ fontSize: '0.7em', color: '#1565c0', marginTop: '1px' }}>📋 {row.taskCount}건</div>}
      </div>
    );
  };

  // 최근 과업 날짜 렌더러
  const lastTaskDateRender = (_: any, row: any) => {
    const date = row.lastTaskDate;
    const subject = row.lastTaskSubject;
    const hasTasks = row.tasks && row.tasks.length > 0;
    if (!date || date === '-') {
      if (hasTasks) return (
        <span onClick={() => openTaskModal(row)} style={{ color: '#999', fontSize: '0.82em', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' as const }}>
          {row.taskCount}건
        </span>
      );
      return <span style={{ color: '#ccc', fontSize: '0.85em' }}>-</span>;
    }
    return (
      <div onClick={() => openTaskModal(row)} style={{ lineHeight: 1.4, cursor: hasTasks ? 'pointer' : 'default' }}>
        <div style={{ fontSize: '0.88em', fontWeight: 600, color: '#333', whiteSpace: 'nowrap' as const }}>{date}</div>
        {subject && subject !== '-' && (
          <div style={{ fontSize: '0.75em', color: '#888', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={subject}>{subject}</div>
        )}
        {hasTasks && <div style={{ fontSize: '0.7em', color: '#1565c0', marginTop: '1px' }}>📋 {row.taskCount}건</div>}
      </div>
    );
  };

  // 과업 정보 렌더러
  const taskInfoRender = (_: any, row: any) => {
    if (!row.lastTaskSubject || row.lastTaskSubject === '-') return <span style={{ color: '#ccc', fontSize: '0.85em' }}>과업 없음</span>;
    return (
      <div style={{ lineHeight: 1.4 }}>
        <div style={{ fontSize: '0.85em', fontWeight: 600, color: '#333', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={row.lastTaskSubject}>
          {row.lastTaskSubject}
        </div>
        <div style={{ fontSize: '0.75em', color: '#888' }}>
          {row.lastTaskDate !== '-' ? row.lastTaskDate : ''} · {row.taskCount || 0}건
        </div>
      </div>
    );
  };

  const nextTaskRender = (_: any, row: any) => {
    if (!row.hasOpenTask) {
      return <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#ffebee', color: '#c62828', fontWeight: 600, fontSize: '0.8em' }}>없음</span>;
    }
    return (
      <div style={{ lineHeight: 1.4 }}>
        <span style={{ padding: '2px 8px', borderRadius: '4px', background: '#e8f5e9', color: '#2e7d32', fontWeight: 600, fontSize: '0.8em' }}>
          {row.openTaskCount}건
        </span>
        <div style={{ fontSize: '0.78em', color: '#555', marginTop: '2px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={row.nextTaskSubject}>
          {row.nextTaskSubject !== '-' ? row.nextTaskSubject : ''}
        </div>
        {row.nextTaskDate && row.nextTaskDate !== '-' && (
          <div style={{ fontSize: '0.72em', color: '#888' }}>{row.nextTaskDate}</div>
        )}
      </div>
    );
  };

  // Stage 파이프라인 순서 및 색상
  const stageOrder: Record<string, { order: number; color: string; bg: string }> = {
    '방문배정': { order: 1, color: '#7b1fa2', bg: '#f3e5f5' },
    '견적': { order: 2, color: '#1565c0', bg: '#e3f2fd' },
    '재견적': { order: 3, color: '#4527a0', bg: '#ede7f6' },
    '선납금': { order: 4, color: '#e65100', bg: '#fff3e0' },
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

  // BO Raw Data 컬럼
  // 타임라인: Opp → 단계 → 생성일 → (N일후)방문 → (N일경과) → 최근과업 → 다음과업
  const contractBadge = (v: boolean) => v
    ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '0.78em', fontWeight: 700, background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9' }}>있음</span>
    : <span style={{ color: '#ccc', fontSize: '0.82em' }}>-</span>;

  const rawOpenOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'boUser', header: 'BO담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'stageName', header: '단계', render: (v: string, row: any) => boStageBadge(v, row) },
    { key: 'companyStatus', header: '매장상태', render: companyStatusBadge },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'createdDate', header: '생성일' },
    { key: 'daysToVisit', header: '생성→방문', align: 'right' as const, render: daysToVisitRender },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'daysSinceVisit', header: '방문후(역일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'bizDaysSinceVisit', header: '방문후(영업일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'lastTaskDate', header: '최근 과업', render: lastTaskDateRender },
    { key: 'nextTaskDate', header: '다음 과업', render: nextTaskDateRender },
  ];

  const rawClosedOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'boUser', header: 'BO담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'fieldUser', header: 'Field담당자' },
    { key: 'stageName', header: '결과', render: resultBadge },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'lossReason', header: '종료사유', render: boReasonBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'ageInDays', header: '경과일', align: 'right' as const },
    { key: 'closeDate', header: '마감일' },
  ];

  // 채널 BO Raw Data 컬럼
  // 채널 BO 타임라인: Opp → 단계 → 생성일 → (N일후)방문 → (N일경과) → 최근과업 → 다음과업
  const chRawOpenOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'boUser', header: 'BO담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'stageName', header: '단계', render: (v: string, row: any) => boStageBadge(v, row) },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'createdDate', header: '생성일' },
    { key: 'daysToVisit', header: '생성→방문', align: 'right' as const, render: daysToVisitRender },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'daysSinceVisit', header: '방문후(역일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'bizDaysSinceVisit', header: '방문후(영업일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'lastTaskDate', header: '최근 과업', render: lastTaskDateRender },
    { key: 'nextTaskDate', header: '다음 과업', render: nextTaskDateRender },
    // Stage 체류시간 분석 컬럼
    { key: 'currentStageDays', header: '현단계(일)', align: 'right' as const,
      render: (v: number) => {
        const days = v ?? 0;
        const bg = days >= 7 ? '#ffebee' : days >= 3 ? '#fff3e0' : '#f5f5f5';
        const color = days >= 7 ? '#c62828' : days >= 3 ? '#e65100' : '#666';
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontWeight: 600, background: bg, color }}>{days}일</span>;
      }
    },
    { key: 'bottleneckStage', header: '병목단계',
      render: (_: any, row: any) => {
        if (!row.bottleneckStage) return <span style={{ color: '#999' }}>-</span>;
        const stages = row.stageHistory || [];
        const maxDwell = stages.length > 0 ? Math.max(...stages.map((x: any) => x.dwellDays)) : 0;
        return (
          <details style={{ cursor: 'pointer' }}>
            <summary style={{ listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600,
                background: '#ffebee', color: '#c62828' }}>
                🔴 {row.bottleneckStage} ({row.bottleneckDays}일)
              </span>
              <span style={{ fontSize: '0.7em', color: '#999' }}>▼</span>
            </summary>
            {stages.length > 0 && (
              <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', marginTop: '6px' }}>
                {stages.map((s: any, i: number) => {
                  const isCurrent = s.exitDate === null;
                  const isBottleneck = s.dwellDays === maxDwell && stages.length > 1;
                  return (
                    <span key={i} title={`${s.stage}: ${s.enteredDate} ~ ${s.exitDate || '현재'}`}
                      style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '0.75em', fontWeight: 600,
                        background: isBottleneck ? '#ffebee' : isCurrent ? '#e3f2fd' : '#f5f5f5',
                        color: isBottleneck ? '#c62828' : isCurrent ? '#1565c0' : '#666',
                        border: isCurrent ? '1px solid #90caf9' : 'none',
                      }}>
                      {s.stage} {s.dwellDays}일
                    </span>
                  );
                })}
              </div>
            )}
          </details>
        );
      }
    },
  ];

  // 채널 TM Raw Data 컬럼 (방문배정/견적/재견적 단계)
  const chRawOpenOppColumns_TM = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'ownerName', header: '소유자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v || '(미배정)'}</span> },
    { key: 'stageName', header: '단계', render: (v: string, row: any) => boStageBadge(v, row) },
    { key: 'createdDate', header: '생성일' },
    { key: 'daysToVisit', header: '생성→방문', align: 'right' as const, render: daysToVisitRender },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'daysSinceVisit', header: '방문후(역일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'lastTaskDate', header: '최근 과업', render: lastTaskDateRender },
    { key: 'nextTaskDate', header: '다음 과업', render: nextTaskDateRender },
    { key: 'currentStageDays', header: '현단계(일)', align: 'right' as const,
      render: (v: number) => {
        const days = v ?? 0;
        const bg = days >= 7 ? '#ffebee' : days >= 3 ? '#fff3e0' : '#f5f5f5';
        const color = days >= 7 ? '#c62828' : days >= 3 ? '#e65100' : '#666';
        return <span style={{ padding: '3px 8px', borderRadius: '4px', fontWeight: 600, background: bg, color }}>{days}일</span>;
      }
    },
    { key: 'bottleneckStage', header: '병목단계',
      render: (_: any, row: any) => {
        if (!row.bottleneckStage) return <span style={{ color: '#999' }}>-</span>;
        const stages = row.stageHistory || [];
        const maxDwell = stages.length > 0 ? Math.max(...stages.map((x: any) => x.dwellDays)) : 0;
        return (
          <details style={{ cursor: 'pointer' }}>
            <summary style={{ listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600,
                background: '#ffebee', color: '#c62828' }}>
                🔴 {row.bottleneckStage} ({row.bottleneckDays}일)
              </span>
              <span style={{ fontSize: '0.7em', color: '#999' }}>▼</span>
            </summary>
            {stages.length > 0 && (
              <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', marginTop: '6px' }}>
                {stages.map((s: any, i: number) => {
                  const isCurrent = s.exitDate === null;
                  const isBottleneck = s.dwellDays === maxDwell && stages.length > 1;
                  return (
                    <span key={i} title={`${s.stage}: ${s.enteredDate} ~ ${s.exitDate || '현재'}`}
                      style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '0.75em', fontWeight: 600,
                        background: isBottleneck ? '#ffebee' : isCurrent ? '#e3f2fd' : '#f5f5f5',
                        color: isBottleneck ? '#c62828' : isCurrent ? '#1565c0' : '#666',
                        border: isCurrent ? '1px solid #90caf9' : 'none',
                      }}>
                      {s.stage} {s.dwellDays}일
                    </span>
                  );
                })}
              </div>
            )}
          </details>
        );
      }
    },
  ];

  const chRawClosedOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'boUser', header: 'BO담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'stageName', header: '결과', render: resultBadge },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'lossReason', header: '종료사유', render: boReasonBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'closeDate', header: '마감일' },
  ];

  // Field Sales 전용 컬럼
  const fsRawOpenOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'stageName', header: '단계', render: (v: string, row: any) => boStageBadge(v, row) },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'createdDate', header: '생성일' },
    { key: 'daysToVisit', header: '생성→방문', align: 'right' as const, render: daysToVisitRender },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'daysSinceVisit', header: '방문후(역일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'bizDaysSinceVisit', header: '방문후(영업일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'lastTaskDate', header: '최근 과업', render: lastTaskDateRender },
    { key: 'nextTaskDate', header: '다음 과업', render: nextTaskDateRender },
  ];

  const fsRawClosedOppColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'boUser', header: 'BO담당자' },
    { key: 'stageName', header: '결과', render: resultBadge },
    { key: 'hasContract', header: '계약서', render: contractBadge },
    { key: 'lossReason', header: '종료사유', render: boReasonBadge },
    { key: 'installHopeDate', header: '설치희망일' },
    { key: 'ageInDays', header: '경과일', align: 'right' as const },
    { key: 'closeDate', header: '마감일' },
  ];

  const visitDurationRender = (v: number | null) => {
    if (v === null || v === undefined) return <span style={{ color: '#ccc' }}>-</span>;
    const h = Math.floor(v / 60);
    const m = v % 60;
    const text = h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
    const bg = v >= 60 ? '#e8f5e9' : v >= 30 ? '#fff3e0' : '#ffebee';
    const color = v >= 60 ? '#2e7d32' : v >= 30 ? '#e65100' : '#c62828';
    return <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 600, background: bg, color }}>{text}</span>;
  };

  const goldenTimeViolationColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'stageName', header: '단계', render: (v: string, row: any) => boStageBadge(v, row) },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'visitDurationMin', header: '방문소요', align: 'right' as const, render: visitDurationRender },
    { key: 'daysSinceLastTask', header: '미터치일수', align: 'right' as const, render: (v: number) => (
      <span style={{
        display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.85em', fontWeight: 700,
        background: v >= 14 ? '#ffcdd2' : '#fff3e0', color: v >= 14 ? '#c62828' : '#e65100',
      }}>
        {v}일
      </span>
    ) },
    { key: 'ageInDays', header: '경과일', align: 'right' as const, render: ageBadge },
    { key: 'lastTaskDate', header: '최근 과업', render: lastTaskDateRender },
    { key: 'nextTaskDate', header: '다음 과업', render: nextTaskDateRender },
  ];

  // 방문후 7일+ 미관리 컬럼
  const staleVisitColumns = [
    { key: 'name', header: 'Opp명', render: sfOppLink },
    { key: 'fieldUser', header: 'Field담당자', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'stageName', header: '단계', render: (v: string, row: any) => boStageBadge(v, row) },
    { key: 'visitCompleteDate', header: '방문일', render: visitDateRender },
    { key: 'visitDurationMin', header: '방문소요', align: 'right' as const, render: visitDurationRender },
    { key: 'daysSinceVisit', header: '방문후(역일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'bizDaysSinceVisit', header: '방문후(영업일)', align: 'right' as const, render: daysElapsedRender },
    { key: 'lastTaskDate', header: '최근 과업', render: lastTaskDateRender },
    { key: 'nextTaskDate', header: '다음 과업', render: nextTaskDateRender },
    { key: 'ageInDays', header: 'Opp경과', align: 'right' as const, render: ageBadge },
  ];

  function renderInsideSales() {
    const totalFrtOver20 = is?.frt?.frtOver20 ?? 0;
    const frtOk = is?.frt?.frtOk ?? 0;
    const frtTotal = is?.frt?.totalWithTask ?? 0;
    const frtRate = frtTotal > 0 ? +((frtOk / frtTotal) * 100).toFixed(1) : 0;

    // IS 담당자 이름 Set (퍼널 테이블 기준)
    const isOwnerNames = new Set((is?.byOwner || []).map((o: any) => o.name));
    // Daily Task: IS 담당자만 필터
    const filteredDailyTask = (is?.dailyTask?.byOwner || []).filter((o: any) => isOwnerNames.has(o.name));
    const avgDailyTask = filteredDailyTask.length > 0
      ? (filteredDailyTask.reduce((s: number, o: any) => s + o.avgDaily, 0) / filteredDailyTask.length).toFixed(1)
      : '-';

    // 프로세스 플로우 데이터
    const flowSteps = [
      {
        label: 'FRT 준수',
        value: `${frtRate}%`,
        detail: `${frtOk} / ${frtTotal}건`,
        target: '20분 이내',
        met: frtRate >= 80,
        color: '#0078d4',
      },
      {
        label: 'Task 생성',
        value: `${avgDailyTask}건`,
        detail: '인당 일평균',
        target: '30건/일',
        met: parseFloat(avgDailyTask as string) >= 30,
        color: '#00897b',
      },
      {
        label: '방문 완료',
        value: `${is?.visitCount ?? '-'}건`,
        detail: `완료율 ${is?.visitRate ?? '-'}%`,
        target: '75건/월',
        met: (is?.visitCount ?? 0) >= 75,
        color: '#2e7d32',
      },
    ];

    const resultStep = {
      label: 'SQL 전환율',
      value: `${is?.sqlConversionRate ?? '-'}%`,
      detail: `MQL ${is?.mql ?? 0} → SQL ${is?.sql ?? 0}`,
      target: '90%',
      met: (is?.sqlConversionRate ?? 0) >= 90,
    };

    // Raw 데이터 (일별 모드)
    const rawData = is?.rawData;
    const isDaily = data?.periodType === 'daily';
    const isWeekly = data?.periodType === 'weekly';

    // Salesforce Lead 링크 렌더러
    const sfLink = (name: string, row: any) => row.leadId ? (
      <a href={`https://torder.lightning.force.com/lightning/r/Lead/${row.leadId}/view`} target="_blank" rel="noopener noreferrer"
        style={{ color: '#1565c0', textDecoration: 'none', borderBottom: '1px dashed #90caf9' }}
        onMouseOver={(e) => (e.currentTarget.style.color = '#0d47a1')}
        onMouseOut={(e) => (e.currentTarget.style.color = '#1565c0')}
      >{name}</a>
    ) : name;

    // Raw 데이터 렌더러 헬퍼
    const statusBadge = (v: string) => {
      if (!v || v === '-') return '-';
      const colors: Record<string, { bg: string; color: string }> = {
        'MQL': { bg: '#e3f2fd', color: '#1565c0' },
        'SQL': { bg: '#e8f5e9', color: '#2e7d32' },
        'Qualified': { bg: '#e8f5e9', color: '#2e7d32' },
        'Recycled': { bg: '#fff3e0', color: '#e65100' },
        'Unqualified': { bg: '#fce4ec', color: '#c62828' },
        '종료': { bg: '#eceff1', color: '#546e7a' },
      };
      const style = colors[v] || { bg: '#f5f5f5', color: '#666' };
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: style.bg, color: style.color, whiteSpace: 'nowrap' as const }}>{v}</span>;
    };

    const frtBadge = (v: number) => {
      if (!v && v !== 0) return '-';
      const bg = v >= 60 ? '#b71c1c' : v >= 30 ? '#e53935' : '#ff7043';
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.88em', fontWeight: 700, background: bg, color: '#fff', whiteSpace: 'nowrap' as const }}>{fmtFrt(v)}</span>;
    };

    const taskCountBadge = (v: number) => {
      const count = v ?? 0;
      const isZero = count === 0;
      return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: isZero ? '#ffebee' : '#f5f5f5', color: isZero ? '#c62828' : '#333' }}>{count}건</span>;
    };

    const ownerBold = (v: string) => <span style={{ fontWeight: 600, color: '#222' }}>{v || '-'}</span>;

    const bucketBadge = (v: string) => {
      if (!v) return '-';
      return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.82em', fontWeight: 500, background: '#fff8e1', color: '#f57f17', whiteSpace: 'nowrap' as const }}>{v}</span>;
    };

    const stageBadge = (v: string) => {
      if (!v) return '-';
      const colors: Record<string, { bg: string; color: string }> = {
        '미팅확정': { bg: '#e8f5e9', color: '#2e7d32' },
        '제안': { bg: '#e3f2fd', color: '#1565c0' },
        '계약': { bg: '#ede7f6', color: '#4a148c' },
        'Closed Won': { bg: '#e8f5e9', color: '#1b5e20' },
        'Closed Lost': { bg: '#ffebee', color: '#b71c1c' },
      };
      const style = colors[v] || { bg: '#f5f5f5', color: '#555' };
      return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: style.bg, color: style.color, whiteSpace: 'nowrap' as const }}>{v}</span>;
    };

    // 종료 사유 강조 뱃지
    const reasonBadge = (v: string) => {
      if (!v || v === '-') return <span style={{ color: '#ccc' }}>-</span>;
      return (
        <span style={{
          padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600,
          background: '#fce4ec', color: '#c62828', whiteSpace: 'nowrap' as const,
        }}>{v}</span>
      );
    };

    // 다음 과업 렌더러
    const nextTaskRender = (_: any, row: any) => {
      if (row.group === 'closed' || row.group === 'qualified') return <span style={{ color: '#ccc' }}>-</span>;
      if (!row.hasOpenTask) {
        return (
          <span style={{
            padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 700,
            background: '#ffebee', color: '#c62828', whiteSpace: 'nowrap' as const,
          }}>과업 없음</span>
        );
      }
      return (
        <span style={{
          padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600,
          background: '#e8f5e9', color: '#2e7d32', whiteSpace: 'nowrap' as const,
        }}>{row.nextTaskSubject !== '-' ? row.nextTaskSubject : '있음'}{row.nextTaskDate && row.nextTaskDate !== '-' ? ` (${row.nextTaskDate})` : ''}</span>
      );
    };

    // 그룹 라벨 렌더러 (행 내에서 그룹 표시)
    const groupLabel = (_: any, row: any) => {
      if (row.group === 'qualified') {
        return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8em', fontWeight: 600, background: '#e8f5e9', color: '#2e7d32' }}>전환</span>;
      }
      if (row.group === 'closed') {
        return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8em', fontWeight: 600, background: '#eceff1', color: '#546e7a' }}>종료</span>;
      }
      return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8em', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>계류</span>;
    };

    // Raw 데이터 테이블 컬럼 정의
    const frtOver20Columns = [
      { key: 'group', header: '구분', render: groupLabel },
      { key: 'name', header: '이름', render: sfLink },
      { key: 'company', header: '회사명' },
      { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
      { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
      { key: 'frtMinutes', header: 'FRT', align: 'right' as const, render: (v: number) => frtBadge(v) },
      { key: 'lossReason', header: '종료사유', render: (v: string) => reasonBadge(v) },
      { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
      { key: 'lastTaskDate', header: '최근터치' },
      { key: 'taskCount', header: 'Task', align: 'right' as const, render: (v: number) => taskCountBadge(v) },
    ];
    const unconvertedMQLColumns = [
      { key: 'group', header: '구분', render: groupLabel },
      { key: 'name', header: '이름', render: sfLink },
      { key: 'company', header: '회사명' },
      { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
      { key: 'status', header: '상태', render: (v: string) => statusBadge(v) },
      { key: 'lossReason', header: '종료사유', render: (v: string) => reasonBadge(v) },
      { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
      { key: 'lastTaskDate', header: '최근터치' },
      { key: 'taskCount', header: 'Task', align: 'right' as const, render: (v: number) => taskCountBadge(v) },
    ];
    const noVisitSQLColumns = [
      { key: 'group', header: '구분', render: groupLabel },
      { key: 'name', header: '이름', render: sfLink },
      { key: 'company', header: '회사명' },
      { key: 'owner', header: '담당자', render: (v: string) => ownerBold(v) },
      { key: 'oppStage', header: 'Opp단계', render: (v: string) => stageBadge(v) },
      { key: 'lossReason', header: '종료사유', render: (v: string) => reasonBadge(v) },
      { key: 'nextTask', header: '다음 과업', render: nextTaskRender },
      { key: 'lastTaskDate', header: '최근터치' },
      { key: 'taskCount', header: 'Task', align: 'right' as const, render: (v: number) => taskCountBadge(v) },
    ];

    return (
      <>
        {/* 프로세스 플로우: 과정 지표 → 결과 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '8px' }}>MQL → SQL 전환 프로세스</h2>
          <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '24px' }}>과정 지표가 결과(SQL 전환율)를 만듭니다</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', padding: '0 10px' }}>
            {/* 과정 지표 (Leading Indicators) */}
            {flowSteps.map((step, i) => (
              <React.Fragment key={step.label}>
                <div style={{
                  flex: 1,
                  background: step.met ? `${step.color}12` : '#fff5f5',
                  border: `2px solid ${step.met ? step.color : '#e53935'}`,
                  borderRadius: '12px',
                  padding: '20px 16px',
                  textAlign: 'center',
                  position: 'relative',
                }}>
                  <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    과정 {i + 1}
                  </div>
                  <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: '1.8em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                    {step.value}
                  </div>
                  <div style={{ fontSize: '0.8em', color: '#666', marginTop: '6px' }}>{step.detail}</div>
                  <div style={{
                    marginTop: '10px',
                    fontSize: '0.72em',
                    padding: '3px 10px',
                    borderRadius: '10px',
                    display: 'inline-block',
                    background: step.met ? '#e8f5e9' : '#ffebee',
                    color: step.met ? '#2e7d32' : '#c62828',
                  }}>
                    목표: {step.target}
                  </div>
                </div>
                {/* 화살표 */}
                <div style={{
                  width: '40px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#bbb', fontSize: '1.4em',
                }}>
                  →
                </div>
              </React.Fragment>
            ))}
            {/* 결과 (SQL 전환율) */}
            <div style={{
              flex: 1.2,
              background: resultStep.met ? 'linear-gradient(135deg, #1565c0, #0d47a1)' : 'linear-gradient(135deg, #c62828, #b71c1c)',
              borderRadius: '12px',
              padding: '20px 16px',
              textAlign: 'center',
              color: '#fff',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            }}>
              <div style={{ fontSize: '0.75em', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.85 }}>
                결과
              </div>
              <div style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '8px' }}>
                {resultStep.label}
              </div>
              <div style={{ fontSize: '2.2em', fontWeight: 700, lineHeight: 1.1 }}>
                {resultStep.value}
              </div>
              <div style={{ fontSize: '0.8em', marginTop: '6px', opacity: 0.85 }}>{resultStep.detail}</div>
              <div style={{
                marginTop: '10px',
                fontSize: '0.72em',
                padding: '3px 10px',
                borderRadius: '10px',
                display: 'inline-block',
                background: 'rgba(255,255,255,0.2)',
              }}>
                목표: {resultStep.target}
              </div>
            </div>
          </div>
        </div>

        {/* KPI 카드 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>Inside Sales KPI 요약</h2>
          <div className="metro-grid metro-grid-5">
            <StatsCard
              title="SQL 전환율"
              value={`${is?.sqlConversionRate ?? '-'}%`}
              target="90%"
              subtitle="MQL → SQL"
              color={is ? kpiColor(is.sqlConversionRate, 90) : 'blue'}
              loading={loading}
            />
            <StatsCard
              title="FRT 20분 초과"
              value={totalFrtOver20}
              target="0건"
              subtitle={`평균 ${is?.frt?.avgFrtMinutes ? fmtFrt(is.frt.avgFrtMinutes) : '-'}`}
              color={is ? kpiColor(totalFrtOver20, 0, true) : 'orange'}
              loading={loading}
            />
            <StatsCard
              title="Daily Task 평균"
              value={avgDailyTask}
              target="30건"
              subtitle="인당 일평균"
              color="teal"
              loading={loading}
            />
            <StatsCard
              title="방문 완료"
              value={is?.visitCount ?? '-'}
              target="75건"
              subtitle="월 기준"
              color={is ? kpiColor(is.visitCount, 75) : 'green'}
              loading={loading}
            />
            <StatsCard
              title="방문 완료율"
              value={`${is?.visitRate ?? '-'}%`}
              target="90%"
              subtitle="SQL → 방문"
              color={is ? kpiColor(is.visitRate, 90) : 'purple'}
              loading={loading}
            />
          </div>
        </div>

        {/* 일별 모드: 담당자별 KPI 요약 카드 */}
        {isDaily && is?.byOwner && (() => {
          // 인바운드 IS 팀원만 필터: userId가 이름에 들어간 건 제외, lead 최소 5건 이상
          const owners = (is.byOwner as any[]).filter((o: any) =>
            o.lead >= 5 && o.name && !/^[0-9a-zA-Z]/.test(o.name)
          );
          const taskMap = new Map((filteredDailyTask || []).map((t: any) => [t.name, t]));
          if (owners.length === 0) return null;
          return (
            <div className="metro-card" style={{ padding: '24px' }}>
              <h2 style={{ marginBottom: '8px' }}>담당자별 KPI 요약</h2>
              <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '20px' }}>
                각 담당자의 핵심 지표를 한눈에 확인합니다
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {owners.map((owner: any) => {
                  const task = taskMap.get(owner.name);
                  const taskAvg = task?.avgDaily ?? 0;
                  const metrics = [
                    { label: 'Lead', value: owner.lead, unit: '건', color: '#1565c0', bg: '#e3f2fd' },
                    { label: 'MQL', value: owner.mql, unit: '건', color: '#6a1b9a', bg: '#f3e5f5' },
                    { label: 'SQL', value: owner.sql, unit: '건', color: '#00695c', bg: '#e0f2f1' },
                    {
                      label: 'SQL 전환율',
                      value: `${owner.sqlConversionRate ?? 0}%`,
                      color: (owner.sqlConversionRate ?? 0) >= 90 ? '#2e7d32' : (owner.sqlConversionRate ?? 0) >= 70 ? '#e65100' : '#c62828',
                      bg: (owner.sqlConversionRate ?? 0) >= 90 ? '#e8f5e9' : (owner.sqlConversionRate ?? 0) >= 70 ? '#fff3e0' : '#ffebee',
                      target: '90%',
                    },
                    {
                      label: 'FRT 초과',
                      value: owner.frtOver20 ?? 0,
                      unit: '건',
                      color: (owner.frtOver20 ?? 0) === 0 ? '#2e7d32' : '#c62828',
                      bg: (owner.frtOver20 ?? 0) === 0 ? '#e8f5e9' : '#ffebee',
                      target: '0건',
                    },
                    {
                      label: 'FRT 평균',
                      value: fmtFrt(owner.avgFrt ?? 0),
                      color: (owner.avgFrt ?? 0) <= 20 ? '#2e7d32' : '#e65100',
                      bg: (owner.avgFrt ?? 0) <= 20 ? '#e8f5e9' : '#fff3e0',
                    },
                    {
                      label: '방문완료',
                      value: owner.visitConverted ?? 0,
                      unit: '건',
                      color: '#2e7d32',
                      bg: '#e8f5e9',
                    },
                    {
                      label: 'Task',
                      value: task ? task.totalTasks : 0,
                      unit: '건',
                      color: taskAvg >= 30 ? '#2e7d32' : taskAvg >= 20 ? '#e65100' : '#c62828',
                      bg: taskAvg >= 30 ? '#e8f5e9' : taskAvg >= 20 ? '#fff3e0' : '#ffebee',
                      sub: `일평균 ${taskAvg.toFixed ? taskAvg.toFixed(1) : taskAvg}`,
                    },
                  ];
                  return (
                    <div key={owner.userId} style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: '#fff',
                    }}>
                      {/* 담당자 헤더 */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 20px',
                        background: 'linear-gradient(135deg, #37474f, #455a64)',
                        color: '#fff',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '50%',
                            background: 'rgba(255,255,255,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.95em', fontWeight: 700,
                          }}>
                            {owner.name?.charAt(0) || '?'}
                          </div>
                          <span style={{ fontSize: '1.05em', fontWeight: 700 }}>{owner.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            padding: '4px 12px', borderRadius: '20px', fontSize: '0.82em', fontWeight: 600,
                            background: (owner.sqlConversionRate ?? 0) >= 90 ? 'rgba(76,175,80,0.3)' : (owner.sqlConversionRate ?? 0) >= 70 ? 'rgba(255,152,0,0.3)' : 'rgba(244,67,54,0.3)',
                            color: '#fff',
                          }}>
                            전환율 {owner.sqlConversionRate ?? 0}%
                          </span>
                        </div>
                      </div>
                      {/* 메트릭 그리드 */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(8, 1fr)',
                        gap: '1px',
                        background: '#f0f0f0',
                      }}>
                        {metrics.map((m, i) => (
                          <div key={i} style={{
                            padding: '14px 12px',
                            background: '#fff',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '6px', fontWeight: 500 }}>
                              {m.label}
                            </div>
                            <div style={{
                              fontSize: '1.25em', fontWeight: 700, color: m.color,
                              marginBottom: '2px',
                            }}>
                              {typeof m.value === 'number' ? `${m.value}${m.unit || ''}` : m.value}
                            </div>
                            {m.target && (
                              <div style={{ fontSize: '0.7em', color: '#aaa' }}>목표 {m.target}</div>
                            )}
                            {m.sub && (
                              <div style={{ fontSize: '0.7em', color: '#aaa' }}>{m.sub}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {!isDaily && (() => {
          const owners = (is?.byOwner as any[] || []).filter((o: any) =>
            o.lead >= 10 && o.name && !/^[0-9a-zA-Z]/.test(o.name)
          );
          const taskMap = new Map((filteredDailyTask || []).map((t: any) => [t.name, t]));
          if (owners.length === 0) return null;
          return (
            <div className="metro-card" style={{ padding: '24px' }}>
              <h2 style={{ marginBottom: '8px' }}>담당자별 KPI 요약{isWeekly ? ' (주간 합산)' : ''}</h2>
              <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '20px' }}>
                각 담당자의 핵심 지표를 한눈에 확인합니다
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {owners.map((owner: any) => {
                  const task = taskMap.get(owner.name);
                  const taskAvg = task?.avgDaily ?? 0;
                  const metrics = [
                    { label: 'Lead', value: owner.lead, unit: '건', color: '#1565c0', bg: '#e3f2fd' },
                    { label: 'MQL', value: owner.mql, unit: '건', color: '#6a1b9a', bg: '#f3e5f5' },
                    { label: 'SQL', value: owner.sql, unit: '건', color: '#00695c', bg: '#e0f2f1' },
                    {
                      label: 'SQL 전환율',
                      value: `${owner.sqlConversionRate ?? 0}%`,
                      color: (owner.sqlConversionRate ?? 0) >= 90 ? '#2e7d32' : (owner.sqlConversionRate ?? 0) >= 70 ? '#e65100' : '#c62828',
                      bg: (owner.sqlConversionRate ?? 0) >= 90 ? '#e8f5e9' : (owner.sqlConversionRate ?? 0) >= 70 ? '#fff3e0' : '#ffebee',
                      target: '90%',
                    },
                    {
                      label: 'FRT 초과',
                      value: owner.frtOver20 ?? 0,
                      unit: '건',
                      color: (owner.frtOver20 ?? 0) === 0 ? '#2e7d32' : '#c62828',
                      bg: (owner.frtOver20 ?? 0) === 0 ? '#e8f5e9' : '#ffebee',
                      target: '0건',
                    },
                    {
                      label: 'FRT 평균',
                      value: fmtFrt(owner.avgFrt ?? 0),
                      color: (owner.avgFrt ?? 0) <= 20 ? '#2e7d32' : '#e65100',
                      bg: (owner.avgFrt ?? 0) <= 20 ? '#e8f5e9' : '#fff3e0',
                    },
                    {
                      label: '방문완료',
                      value: owner.visitConverted ?? 0,
                      unit: '건',
                      color: '#2e7d32',
                      bg: '#e8f5e9',
                    },
                    {
                      label: '방문율',
                      value: `${owner.visitRate ?? 0}%`,
                      color: (owner.visitRate ?? 0) >= 90 ? '#2e7d32' : (owner.visitRate ?? 0) >= 70 ? '#e65100' : '#c62828',
                      bg: (owner.visitRate ?? 0) >= 90 ? '#e8f5e9' : (owner.visitRate ?? 0) >= 70 ? '#fff3e0' : '#ffebee',
                      target: '90%',
                    },
                    {
                      label: 'Task',
                      value: task ? task.totalTasks : 0,
                      unit: '건',
                      color: taskAvg >= 30 ? '#2e7d32' : taskAvg >= 20 ? '#e65100' : '#c62828',
                      bg: taskAvg >= 30 ? '#e8f5e9' : taskAvg >= 20 ? '#fff3e0' : '#ffebee',
                      sub: `일평균 ${taskAvg.toFixed ? taskAvg.toFixed(1) : taskAvg}`,
                    },
                  ];
                  return (
                    <div key={owner.userId} style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: '#fff',
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 20px',
                        background: 'linear-gradient(135deg, #37474f, #455a64)',
                        color: '#fff',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '50%',
                            background: 'rgba(255,255,255,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.95em', fontWeight: 700,
                          }}>
                            {owner.name?.charAt(0) || '?'}
                          </div>
                          <span style={{ fontSize: '1.05em', fontWeight: 700 }}>{owner.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            padding: '4px 12px', borderRadius: '20px', fontSize: '0.82em', fontWeight: 600,
                            background: (owner.sqlConversionRate ?? 0) >= 90 ? 'rgba(76,175,80,0.3)' : (owner.sqlConversionRate ?? 0) >= 70 ? 'rgba(255,152,0,0.3)' : 'rgba(244,67,54,0.3)',
                            color: '#fff',
                          }}>
                            전환율 {owner.sqlConversionRate ?? 0}%
                          </span>
                        </div>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(9, 1fr)',
                        gap: '1px',
                        background: '#f0f0f0',
                      }}>
                        {metrics.map((m, i) => (
                          <div key={i} style={{
                            padding: '14px 12px',
                            background: '#fff',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '6px', fontWeight: 500 }}>
                              {m.label}
                            </div>
                            <div style={{
                              fontSize: '1.25em', fontWeight: 700, color: m.color,
                              marginBottom: '2px',
                            }}>
                              {typeof m.value === 'number' ? `${m.value}${m.unit || ''}` : m.value}
                            </div>
                            {m.target && (
                              <div style={{ fontSize: '0.7em', color: '#aaa' }}>목표 {m.target}</div>
                            )}
                            {m.sub && (
                              <div style={{ fontSize: '0.7em', color: '#aaa' }}>{m.sub}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 주차별 모드: 일별 IS 상세 데이터 */}
        {isWeekly && is?.dailyDetails?.length > 0 && (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <h2 style={{ marginBottom: '4px' }}>일별 Inside Sales 상세</h2>
            <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '16px' }}>
              주간 내 각 일자별 담당자 실적 및 Raw 데이터 · {(is.dailyDetails as any[]).length}일
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(is.dailyDetails as any[]).map((day: any, idx: number) => {
                const owners = (day.byOwner || []).filter((o: any) => o.lead > 0 && o.name && !/^[0-9a-zA-Z]/.test(o.name));
                const rd = day.rawData || {};
                const frtCount = rd.frtOver20?.length || 0;
                const mqlCount = rd.unconvertedMQL?.length || 0;
                const noVisitCount = rd.noVisitSQL?.length || 0;
                const totalRaw = frtCount + mqlCount + noVisitCount;
                return (
                  <div key={idx} style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                    {/* 일자 헤더 */}
                    <div style={{
                      padding: '10px 16px',
                      background: day.dayOfWeek === 0 || day.dayOfWeek === 6 ? '#fff3e0' : '#e8f5e9',
                      borderBottom: '1px solid #e0e0e0',
                      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' as const,
                    }}>
                      <span style={{ fontWeight: 700, fontSize: '1em' }}>
                        {day.date} ({day.dayName})
                      </span>
                      <span style={{ fontSize: '0.85em', color: '#333', fontWeight: 600 }}>
                        Lead {day.lead} → MQL {day.mql} → SQL {day.sql}
                      </span>
                      {day.sqlConversionRate !== null && (
                        <span style={{
                          padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                          background: day.sqlConversionRate >= 30 ? '#e8f5e9' : '#fce4ec',
                          color: day.sqlConversionRate >= 30 ? '#2e7d32' : '#c62828',
                        }}>
                          전환율 {day.sqlConversionRate}%
                        </span>
                      )}
                      {day.frt && (
                        <span style={{
                          padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                          background: (day.frt.frtOver20 || 0) === 0 ? '#e8f5e9' : '#fce4ec',
                          color: (day.frt.frtOver20 || 0) === 0 ? '#2e7d32' : '#c62828',
                        }}>
                          FRT초과 {day.frt.frtOver20 || 0}건
                        </span>
                      )}
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: day.visitCount > 0 ? '#e8f5e9' : '#f5f5f5',
                        color: day.visitCount > 0 ? '#2e7d32' : '#999',
                      }}>
                        방문 {day.visitCount}건
                      </span>
                    </div>
                    {/* byOwner 테이블 */}
                    {owners.length > 0 && (
                      <div style={{ padding: '0' }}>
                        <DataTable columns={insideSalesColumns} data={owners} loading={false} />
                      </div>
                    )}
                    {/* Raw 데이터 요약 (문제건) */}
                    {totalRaw > 0 && (
                      <div style={{ padding: '8px 16px', borderTop: '1px solid #e0e0e0', background: '#fff8f0' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '8px' }}>
                          {frtCount > 0 && (
                            <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#fce4ec', color: '#c62828' }}>
                              FRT초과 {frtCount}건
                            </span>
                          )}
                          {mqlCount > 0 && (
                            <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>
                              미전환 {mqlCount}건
                            </span>
                          )}
                          {noVisitCount > 0 && (
                            <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#f3e5f5', color: '#7b1fa2' }}>
                              미방문 {noVisitCount}건
                            </span>
                          )}
                        </div>
                        {frtCount > 0 && (
                          <DataTable columns={frtOver20Columns} data={rd.frtOver20} loading={false} className="daily-raw daily-raw-red" />
                        )}
                        {mqlCount > 0 && (
                          <div style={{ marginTop: frtCount > 0 ? '8px' : '0' }}>
                            <DataTable columns={unconvertedMQLColumns} data={rd.unconvertedMQL} loading={false} className="daily-raw daily-raw-orange" />
                          </div>
                        )}
                        {noVisitCount > 0 && (
                          <div style={{ marginTop: (frtCount + mqlCount) > 0 ? '8px' : '0' }}>
                            <DataTable columns={noVisitSQLColumns} data={rd.noVisitSQL} loading={false} className="daily-raw daily-raw-purple" />
                          </div>
                        )}
                      </div>
                    )}
                    {owners.length === 0 && totalRaw === 0 && (
                      <div style={{ padding: '12px 16px', color: '#999', fontSize: '0.88em' }}>
                        해당일 데이터 없음
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 일별 모드: Raw 데이터 테이블 */}
        {isDaily && rawData && (
          <>
            {/* 일별 Raw 데이터 요약 헤더 */}
            {(() => {
              const allRaw = [...(rawData.frtOver20 || []), ...(rawData.unconvertedMQL || []), ...(rawData.noVisitSQL || [])];
              const openCount = allRaw.filter((r: any) => r.group === 'open').length;
              const closedCount = allRaw.filter((r: any) => r.group === 'closed').length;
              const qualifiedCount = allRaw.filter((r: any) => r.group === 'qualified').length;
              const noTaskCount = allRaw.filter((r: any) => r.group === 'open' && !r.hasOpenTask).length;
              return (
                <div style={{
                  background: 'linear-gradient(135deg, #263238, #37474f)',
                  borderRadius: '8px',
                  padding: '20px 28px',
                  marginBottom: '20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div>
                      <h2 style={{ color: '#fff', fontSize: '1.2em', fontWeight: 600, marginBottom: '4px', borderBottom: 'none', paddingBottom: 0 }}>
                        일별 상세 데이터
                      </h2>
                      <p style={{ color: '#90a4ae', fontSize: '0.85em' }}>
                        종료건은 사유를, 계류건은 다음 과업 유무를 확인하세요
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      {rawData.frtOver20?.length > 0 && (
                        <div style={{ padding: '6px 14px', borderRadius: '6px', background: 'rgba(229,57,53,0.2)', color: '#ef9a9a', fontSize: '0.85em', fontWeight: 600 }}>
                          FRT초과 {rawData.frtOver20.length}
                        </div>
                      )}
                      {rawData.unconvertedMQL?.length > 0 && (
                        <div style={{ padding: '6px 14px', borderRadius: '6px', background: 'rgba(255,152,0,0.2)', color: '#ffcc80', fontSize: '0.85em', fontWeight: 600 }}>
                          미전환 {rawData.unconvertedMQL.length}
                        </div>
                      )}
                      {rawData.noVisitSQL?.length > 0 && (
                        <div style={{ padding: '6px 14px', borderRadius: '6px', background: 'rgba(123,31,162,0.2)', color: '#ce93d8', fontSize: '0.85em', fontWeight: 600 }}>
                          미방문 {rawData.noVisitSQL.length}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 종료/계류 요약 바 */}
                  <div style={{ display: 'flex', gap: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '4px', background: '#ff7043', color: '#fff', fontSize: '0.82em', fontWeight: 700 }}>계류 {openCount}건</span>
                      {noTaskCount > 0 && (
                        <span style={{ padding: '3px 10px', borderRadius: '4px', background: 'rgba(255,82,82,0.3)', color: '#ff8a80', fontSize: '0.78em', fontWeight: 600 }}>
                          과업없음 {noTaskCount}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '4px', background: '#78909c', color: '#fff', fontSize: '0.82em', fontWeight: 700 }}>종료 {closedCount}건</span>
                    </div>
                    {qualifiedCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '4px', background: '#66bb6a', color: '#fff', fontSize: '0.82em', fontWeight: 700 }}>전환 {qualifiedCount}건</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* FRT 20분 초과 목록 */}
            {rawData.frtOver20?.length > 0 && (() => {
              const items = rawData.frtOver20 as any[];
              const openItems = items.filter((r: any) => r.group === 'open');
              const closedItems = items.filter((r: any) => r.group === 'closed');
              const qualifiedItems = items.filter((r: any) => r.group === 'qualified');
              return (
                <div style={{
                  background: '#fff',
                  borderRadius: '8px',
                  border: '1px solid #ffcdd2',
                  borderLeft: '5px solid #e53935',
                  marginBottom: '20px',
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(229,57,53,0.08)',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '18px 24px',
                    background: 'linear-gradient(135deg, #ffebee, #fff5f5)',
                    borderBottom: '1px solid #ffcdd2',
                  }}>
                    <div>
                      <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#b71c1c', marginBottom: '2px' }}>
                        FRT 20분 초과 Lead
                      </h3>
                      <p style={{ color: '#999', fontSize: '0.82em' }}>
                        계류 {openItems.length} · 종료 {closedItems.length}{qualifiedItems.length > 0 ? ` · 전환 ${qualifiedItems.length}` : ''}
                      </p>
                    </div>
                    <div style={{
                      padding: '8px 18px', borderRadius: '8px',
                      background: '#e53935', color: '#fff',
                      fontSize: '1em', fontWeight: 700,
                      boxShadow: '0 2px 6px rgba(229,57,53,0.3)',
                    }}>
                      {rawData.frtOver20.length}건
                    </div>
                  </div>
                  <div style={{ padding: '0' }}>
                    <DataTable columns={frtOver20Columns} data={rawData.frtOver20} loading={loading} className="daily-raw daily-raw-red" />
                  </div>
                </div>
              );
            })()}

            {/* 미전환 MQL 목록 */}
            {rawData.unconvertedMQL?.length > 0 && (() => {
              const items = rawData.unconvertedMQL as any[];
              const openItems = items.filter((r: any) => r.group === 'open');
              const closedItems = items.filter((r: any) => r.group === 'closed');
              return (
                <div style={{
                  background: '#fff',
                  borderRadius: '8px',
                  border: '1px solid #ffe0b2',
                  borderLeft: '5px solid #ff9800',
                  marginBottom: '20px',
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(255,152,0,0.08)',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '18px 24px',
                    background: 'linear-gradient(135deg, #fff3e0, #fffbf5)',
                    borderBottom: '1px solid #ffe0b2',
                  }}>
                    <div>
                      <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#e65100', marginBottom: '2px' }}>
                        미전환 MQL
                      </h3>
                      <p style={{ color: '#999', fontSize: '0.82em' }}>
                        계류 {openItems.length} · 종료 {closedItems.length}
                      </p>
                    </div>
                    <div style={{
                      padding: '8px 18px', borderRadius: '8px',
                      background: '#ff9800', color: '#fff',
                      fontSize: '1em', fontWeight: 700,
                      boxShadow: '0 2px 6px rgba(255,152,0,0.3)',
                    }}>
                      {rawData.unconvertedMQL.length}건
                    </div>
                  </div>
                  <div style={{ padding: '0' }}>
                    <DataTable columns={unconvertedMQLColumns} data={rawData.unconvertedMQL} loading={loading} className="daily-raw daily-raw-orange" />
                  </div>
                </div>
              );
            })()}

            {/* 방문 미완료 SQL */}
            {rawData.noVisitSQL?.length > 0 && (() => {
              const items = rawData.noVisitSQL as any[];
              const openItems = items.filter((r: any) => r.group === 'open');
              const closedItems = items.filter((r: any) => r.group === 'closed');
              return (
                <div style={{
                  background: '#fff',
                  borderRadius: '8px',
                  border: '1px solid #e1bee7',
                  borderLeft: '5px solid #7b1fa2',
                  marginBottom: '20px',
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(123,31,162,0.08)',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '18px 24px',
                    background: 'linear-gradient(135deg, #f3e5f5, #faf5fd)',
                    borderBottom: '1px solid #e1bee7',
                  }}>
                    <div>
                      <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#6a1b9a', marginBottom: '2px' }}>
                        방문 미완료 SQL
                      </h3>
                      <p style={{ color: '#999', fontSize: '0.82em' }}>
                        계류 {openItems.length} · 종료 {closedItems.length}
                      </p>
                    </div>
                    <div style={{
                      padding: '8px 18px', borderRadius: '8px',
                      background: '#7b1fa2', color: '#fff',
                      fontSize: '1em', fontWeight: 700,
                      boxShadow: '0 2px 6px rgba(123,31,162,0.3)',
                    }}>
                      {rawData.noVisitSQL.length}건
                    </div>
                  </div>
                  <div style={{ padding: '0' }}>
                    <DataTable columns={noVisitSQLColumns} data={rawData.noVisitSQL} loading={loading} className="daily-raw daily-raw-purple" />
                  </div>
                </div>
              );
            })()}

            {/* Raw 데이터 없는 경우 */}
            {(!rawData.frtOver20?.length && !rawData.unconvertedMQL?.length && !rawData.noVisitSQL?.length) && (
              <div style={{
                textAlign: 'center', padding: '50px 20px',
                background: 'linear-gradient(135deg, #e8f5e9, #f1f8e9)',
                borderRadius: '8px',
                border: '1px solid #c8e6c9',
              }}>
                <div style={{ fontSize: '2.5em', marginBottom: '12px', color: '#2e7d32' }}>✓</div>
                <h3 style={{ color: '#2e7d32', marginBottom: '8px', fontSize: '1.2em', fontWeight: 700 }}>모든 지표 달성</h3>
                <p style={{ color: '#66bb6a', fontSize: '0.95em' }}>이 날짜에는 미달성 항목이 없습니다.</p>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  function renderFieldSales() {
    const isDaily = data?.periodType === 'daily';
    const isWeekly = data?.periodType === 'weekly';
    const rawUsers = fs?.cwConversionRate?.byUser || [];
    const allUsers = rawUsers.map((u: any) => {
      const tmCW = u.thisMonthCW ?? 0;
      const tmCL = u.thisMonthCL ?? 0;
      const coCW = u.carryoverCW ?? 0;
      const coCL = u.carryoverCL ?? 0;
      const allCW = tmCW + coCW;
      return {
        ...u,
        thisMonthCWRate: u.cwRate ?? 0,
        combinedCWRate: u.total > 0 ? +((allCW / u.total) * 100).toFixed(1) : 0,  // (이번달+이월) CW / 이번달SQL
      };
    });
    const totalSQL = allUsers.reduce((s: number, u: any) => s + u.total, 0);
    const totalCW = allUsers.reduce((s: number, u: any) => s + (u.thisMonthCW ?? 0), 0);
    const totalCL = allUsers.reduce((s: number, u: any) => s + (u.thisMonthCL ?? 0), 0);
    const totalOpen = allUsers.reduce((s: number, u: any) => s + (u.open ?? 0), 0);
    const totalCarryoverCW = allUsers.reduce((s: number, u: any) => s + (u.carryoverCW ?? 0), 0);
    const totalCarryoverCL = allUsers.reduce((s: number, u: any) => s + (u.carryoverCL ?? 0), 0);
    const overallCWRate = totalSQL > 0 ? ((totalCW / totalSQL) * 100).toFixed(1) : '-';
    // 합산 행 추가
    const allUsersWithSummary = [...allUsers, {
      _isSummary: true,
      name: '합산',
      total: totalSQL,
      thisMonthCW: totalCW,
      thisMonthCL: totalCL,
      open: totalOpen,
      thisMonthCWRate: overallCWRate !== '-' ? parseFloat(overallCWRate as string) : 0,
      combinedCWRate: totalSQL > 0 ? +(((totalCW + totalCarryoverCW) / totalSQL) * 100).toFixed(1) : 0,
      carryoverCW: totalCarryoverCW,
      carryoverCL: totalCarryoverCL,
    }];
    const cw = fs?.cwWithCarryover;
    const goldenTimeStale = fs?.goldenTime?.staleCount ?? fs?.goldenTime?.stale8plus ?? 0;
    const goldenTimeTotal = fs?.goldenTime?.total ?? 0;
    const obsTotal = fs?.obsLeadCount?.total ?? fs?.obsLeadCount ?? 0;
    const staleVisitTotal = fs?.staleVisit?.total ?? 0;
    const staleVisitOver14 = fs?.staleVisit?.over14 ?? 0;
    const staleVisitOpps = fs?.staleVisit?.opps || [];
    const visitCalendarData = fs?.visitCalendar || [];

    return (
      <>
        {/* 영업 전환 지표 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '4px' }}>영업 전환 지표</h2>
          <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '20px' }}>과정 지표(리터치 준수)가 결과(CW 전환율)를 만듭니다</p>

          <div style={{ display: 'flex', alignItems: 'stretch', gap: '0', padding: '0 4px' }}>
            {[
              {
                label: 'Golden Time 준수',
                badge: '과정 지표',
                value: `${goldenTimeStale}건`,
                sub: `8일+ 미터치 / 전체 ${goldenTimeTotal}건`,
                target: '목표: 0건',
                color: '#e65100',
                met: goldenTimeStale === 0,
              },
              {
                label: '방문후 미관리',
                badge: '과정 지표',
                value: `${staleVisitTotal}건`,
                sub: `7일+ 경과 / 14일+ ${staleVisitOver14}건`,
                target: '목표: 0건',
                color: '#c62828',
                met: staleVisitTotal === 0,
              },
            ].map((step, i) => (
              <React.Fragment key={step.label}>
                <div style={{
                  flex: 1,
                  minWidth: 0,
                  background: step.met ? `${step.color}12` : '#fff5f5',
                  border: `2px solid ${step.met ? step.color : '#e53935'}`,
                  borderRadius: '10px',
                  padding: '12px 6px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.6em', color: '#888', marginBottom: '2px', fontWeight: 600 }}>
                    {step.badge}
                  </div>
                  <div style={{ fontSize: '0.78em', fontWeight: 600, color: '#333', marginBottom: '4px' }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: '1.3em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                    {typeof step.value === 'number' ? step.value.toLocaleString() : step.value}
                  </div>
                  <div style={{ fontSize: '0.65em', color: '#888', marginTop: '3px' }}>
                    {step.sub}
                  </div>
                  <div style={{
                    marginTop: '4px', fontSize: '0.6em', fontWeight: 600,
                    color: step.met ? step.color : '#e53935',
                    background: step.met ? `${step.color}18` : '#ffebee',
                    padding: '2px 6px', borderRadius: '10px', display: 'inline-block',
                  }}>
                    {step.target}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px', color: '#bbb', fontSize: '1em' }}>→</div>
              </React.Fragment>
            ))}

            {/* 결과 지표 */}
            <div style={{
              flex: 1.2,
              minWidth: 0,
              background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#e8f5e9' : '#ffebee',
              border: `2px solid ${(overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935'}`,
              borderRadius: '10px',
              padding: '12px 6px',
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: '0.6em', fontWeight: 700, letterSpacing: '0.3px',
                color: '#fff', background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
                padding: '2px 8px', borderRadius: '10px', display: 'inline-block', marginBottom: '3px',
              }}>
                핵심 KPI
              </div>
              <div style={{ fontSize: '0.78em', fontWeight: 600, color: '#333', marginBottom: '4px' }}>
                SQL→CW 전환율
              </div>
              <div style={{
                fontSize: '1.4em', fontWeight: 700, lineHeight: 1.1,
                color: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
              }}>
                {overallCWRate}%
              </div>
              <div style={{ fontSize: '0.65em', color: '#888', marginTop: '3px' }}>
                이번달 Lead ({totalSQL}→{totalCW})
              </div>
              <div style={{
                marginTop: '4px', fontSize: '0.6em', fontWeight: 600,
                color: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
                background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#c8e6c918' : '#ffebee',
                padding: '2px 6px', borderRadius: '10px', display: 'inline-block',
              }}>
                목표: 60%
              </div>
            </div>
          </div>
        </div>

        {/* 보조 지표: Lead 생산 & 이월 비중 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '4px' }}>보조 지표</h2>
          <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '20px' }}>영업 전환과 별개로 관리하는 활동·구성 지표</p>

          <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', padding: '0 4px' }}>
            {[
              {
                label: 'OBS Lead 생산',
                value: typeof obsTotal === 'number' ? obsTotal : '-',
                sub: 'Field Sales 생성',
                target: '목표: 200건',
                color: '#00897b',
                met: typeof obsTotal === 'number' && obsTotal >= 200,
              },
              {
                label: '이월 비중',
                value: cw?.totalCW > 0 ? `${((cw.totalCarryoverCW / cw.totalCW) * 100).toFixed(0)}%` : '-',
                sub: `이월 ${cw?.totalCarryoverCW ?? 0} / 전체 ${cw?.totalCW ?? 0}`,
                target: '낮을수록 좋음',
                color: '#5e35b1',
                met: cw?.totalCW > 0 ? (cw.totalCarryoverCW / cw.totalCW) < 0.5 : true,
              },
            ].map((step) => (
              <div key={step.label} style={{
                flex: 1,
                minWidth: 0,
                background: step.met ? `${step.color}12` : '#fff5f5',
                border: `2px solid ${step.met ? step.color : '#e53935'}`,
                borderRadius: '10px',
                padding: '12px 6px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '0.6em', color: '#888', marginBottom: '2px', fontWeight: 600 }}>
                  보조 KPI
                </div>
                <div style={{ fontSize: '0.78em', fontWeight: 600, color: '#333', marginBottom: '4px' }}>
                  {step.label}
                </div>
                <div style={{ fontSize: '1.3em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                  {typeof step.value === 'number' ? step.value.toLocaleString() : step.value}
                </div>
                <div style={{ fontSize: '0.65em', color: '#888', marginTop: '3px' }}>
                  {step.sub}
                </div>
                <div style={{
                  marginTop: '4px', fontSize: '0.6em', fontWeight: 600,
                  color: step.met ? step.color : '#e53935',
                  background: step.met ? `${step.color}18` : '#ffebee',
                  padding: '2px 6px', borderRadius: '10px', display: 'inline-block',
                }}>
                  {step.target}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* KPI 요약 카드 — 영업 전환 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>Field Sales KPI 요약</h2>
          <div className="metro-grid metro-grid-4">
            <StatsCard
              title="이번달 SQL→CW"
              value={`${overallCWRate}%`}
              target="60%"
              subtitle={`이번달 Lead 기준 (${totalCW}건)`}
              color={overallCWRate !== '-' ? kpiColor(parseFloat(overallCWRate as string), 60) : 'blue'}
              loading={loading}
            />
            <StatsCard
              title="이월포함 CW"
              value={cw?.totalCW ?? '-'}
              subtitle={`이번달 ${cw?.totalThisMonthCW ?? 0} + 이월 ${cw?.totalCarryoverCW ?? 0}`}
              color="green"
              loading={loading}
            />
            <StatsCard
              title="Golden Time"
              value={`${goldenTimeStale}건`}
              subtitle={`8일+ 미터치 / 전체 ${goldenTimeTotal}건`}
              color="orange"
              loading={loading}
            />
            <StatsCard
              title="방문후 미관리"
              value={`${staleVisitTotal}건`}
              subtitle={`14일+ ${staleVisitOver14}건 / 7일+ 전체`}
              color={staleVisitTotal > 0 ? 'red' : 'green'}
              loading={loading}
            />
          </div>
          <div style={{ borderTop: '1px dashed #e0e0e0', margin: '16px 0', paddingTop: '16px' }}>
            <div style={{ fontSize: '0.82em', color: '#999', fontWeight: 600, marginBottom: '12px' }}>보조 지표</div>
            <div className="metro-grid metro-grid-4">
              <StatsCard
                title="OBS Lead 생산"
                value={obsTotal}
                target="200건"
                subtitle="Field Sales 생성"
                color={fs ? kpiColor(typeof obsTotal === 'number' ? obsTotal : 0, 200) : 'teal'}
                loading={loading}
              />
              <StatsCard
                title="이월 비중"
                value={cw?.totalCW > 0 ? `${((cw.totalCarryoverCW / cw.totalCW) * 100).toFixed(0)}%` : '-'}
                subtitle="전체 CW 중 이월분"
                color="dark"
                loading={loading}
              />
            </div>
          </div>
        </div>

        {/* 담당자별 상세 (이번달 Lead 기준) */}
        {allUsers.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>담당자별 상세 (이번달 Lead 기준)</h2>
            <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '16px' }}>
              SQL 배정 → CW/CL 전환 현황 · 이번달 생성 Lead + 이월 구분
            </p>
            <DataTable columns={fieldSalesColumns} data={allUsersWithSummary} loading={loading} />
          </div>
        )}

        {/* 방문 캘린더 매트릭스 */}
        {visitCalendarData.length > 0 && (() => {
          // 현재 월의 일자 배열 (1~31)
          const periodStr = data?.period || data?.dateRange?.start || '';
          const yearMonth = periodStr.substring(0, 7); // '2026-03'
          const year = parseInt(yearMonth.split('-')[0]) || new Date().getFullYear();
          const month = parseInt(yearMonth.split('-')[1]) || (new Date().getMonth() + 1);
          const daysInMonth = new Date(year, month, 0).getDate();
          const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
          const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

          return (
            <div className="metro-card" style={{ background: '#fff' }}>
              <div style={{ marginBottom: '16px' }}>
                <h2 style={{ marginBottom: '4px' }}>방문 일정 캘린더</h2>
                <p style={{ color: '#888', fontSize: '0.85em' }}>
                  담당자별 월간 방문 현황 · {year}년 {month}월
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${daysInMonth * 38 + 120}px`, fontSize: '0.82em' }}>
                  <thead>
                    <tr>
                      <th style={{
                        position: 'sticky', left: 0, zIndex: 2, background: '#f5f5f5',
                        padding: '6px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid #e0e0e0',
                        whiteSpace: 'nowrap',
                      }}>담당자</th>
                      {days.map(d => {
                        const dateObj = new Date(year, month - 1, d);
                        const dow = dateObj.getDay();
                        const isWeekend = dow === 0 || dow === 6;
                        return (
                          <th key={d} style={{
                            padding: '4px 2px', textAlign: 'center', fontWeight: 600,
                            borderBottom: '2px solid #e0e0e0', minWidth: '34px',
                            background: isWeekend ? '#fff3e0' : '#f5f5f5',
                            color: dow === 0 ? '#e53935' : dow === 6 ? '#1565c0' : '#555',
                            fontSize: '0.9em',
                          }}>
                            <div>{d}</div>
                            <div style={{ fontSize: '0.75em', fontWeight: 400 }}>{dayNames[dow]}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visitCalendarData.map((user: any) => (
                      <tr key={user.name}>
                        <td style={{
                          position: 'sticky', left: 0, zIndex: 1, background: '#fff',
                          padding: '6px 12px', fontWeight: 600, borderBottom: '1px solid #f0f0f0',
                          whiteSpace: 'nowrap', fontSize: '0.92em',
                        }}>{user.name}</td>
                        {days.map(d => {
                          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                          const events = user.dates?.[dateStr] || [];
                          const dateObj = new Date(year, month - 1, d);
                          const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                          const completed = events.filter((e: any) => e.status === '방문완료');
                          const scheduled = events.filter((e: any) => e.status === '방문예정');
                          const cancelled = events.filter((e: any) => e.status === '방문취소');
                          const tooltip = events.map((e: any) => `${e.oppName} (${e.status})`).join('\n');
                          return (
                            <td key={d} style={{
                              padding: '4px 2px', textAlign: 'center',
                              borderBottom: '1px solid #f0f0f0',
                              background: isWeekend ? '#fffde7' : '#fff',
                            }} title={tooltip || undefined}>
                              {completed.length > 0 && (
                                <span style={{
                                  display: 'inline-block', width: '18px', height: '18px', lineHeight: '18px',
                                  borderRadius: '50%', background: '#2e7d32', color: '#fff',
                                  fontSize: '0.7em', fontWeight: 700,
                                }}>{completed.length > 1 ? completed.length : '●'}</span>
                              )}
                              {scheduled.length > 0 && (
                                <span style={{
                                  display: 'inline-block', width: '18px', height: '18px', lineHeight: '18px',
                                  borderRadius: '50%', border: '2px solid #1565c0', color: '#1565c0',
                                  fontSize: '0.65em', fontWeight: 700, background: '#fff',
                                  marginLeft: completed.length > 0 ? '1px' : '0',
                                }}>{scheduled.length > 1 ? scheduled.length : '○'}</span>
                              )}
                              {cancelled.length > 0 && (
                                <span style={{
                                  display: 'inline-block', width: '18px', height: '18px', lineHeight: '18px',
                                  borderRadius: '50%', background: '#ffcdd2', color: '#c62828',
                                  fontSize: '0.65em', fontWeight: 700,
                                  marginLeft: (completed.length > 0 || scheduled.length > 0) ? '1px' : '0',
                                }}>✕</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 범례 */}
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px', padding: '8px 12px', background: '#fafafa', borderRadius: '6px', fontSize: '0.82em' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', background: '#2e7d32' }} /> 방문완료
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #1565c0', background: '#fff' }} /> 방문예정
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', background: '#ffcdd2', color: '#c62828', textAlign: 'center', lineHeight: '14px', fontSize: '0.7em', fontWeight: 700 }}>✕</span> 방문취소
                </span>
              </div>
            </div>
          );
        })()}

        {/* 월별 모드: 일별 추이 차트 (숨김) */}
        {false && !isDaily && !isWeekly && dailyTrends && dailyTrends.length > 0 && (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ marginBottom: '4px' }}>Field Sales 일별 추이</h2>
              <p style={{ color: '#888', fontSize: '0.85em' }}>
                CW 전환율·Golden Time·방문후 미관리의 일별 변화 · 문제 일자를 클릭하면 해당일 Raw 데이터로 이동합니다
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <DailyTrendPanel
                title="CW 전환율"
                subtitle="목표: 60% 이상"
                color="#2e7d32"
                valueKey="fsCwRate"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.fieldSales?.cwRate ?? null,
                  rawCount: (d.fieldSales?.cw ?? 0) + (d.fieldSales?.cl ?? 0),
                }))}
                targetValue={60}
                unit="%"
                problemFilter={(d: any) => d.value !== null && d.value < 60}
                problemLabel="마감"
                problemColor="#e53935"
              />
              <DailyTrendPanel
                title="Golden Time 위반"
                subtitle="목표: 0건"
                color="#e65100"
                valueKey="fsGoldenTime"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.fieldSales?.goldenTimeStale ?? null,
                }))}
                targetValue={0}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value > 0}
                problemLabel="위반"
                problemColor="#c62828"
              />
              <DailyTrendPanel
                title="방문후 미관리"
                subtitle="목표: 0건"
                color="#c62828"
                valueKey="fsStaleVisit"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.fieldSales?.staleVisitCount ?? null,
                }))}
                targetValue={0}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value > 0}
                problemLabel="미관리"
                problemColor="#b71c1c"
              />
            </div>
          </div>
        )}

        {/* Golden Time 위반 Raw 데이터 */}
        {fs?.goldenTime?.violations?.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: '8px', border: '1px solid #ffe0b2',
            borderLeft: '5px solid #e65100', marginBottom: '20px', overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(230,81,0,0.08)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', background: 'linear-gradient(135deg, #fff3e0, #fff8e1)',
              borderBottom: '1px solid #ffe0b2',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#e65100', marginBottom: '2px' }}>
                  Golden Time 위반 Opportunity
                </h3>
                <p style={{ color: '#999', fontSize: '0.82em' }}>
                  견적 단계에서 8일 이상 과업 미터치
                </p>
              </div>
              <div style={{
                padding: '8px 18px', borderRadius: '8px', background: '#e65100', color: '#fff',
                fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(230,81,0,0.3)',
              }}>
                {fs.goldenTime.violations.length}건
              </div>
            </div>
            <DataTable columns={goldenTimeViolationColumns} data={fs.goldenTime.violations} loading={loading} className="daily-raw daily-raw-orange" />
          </div>
        )}

        {/* 방문후 7일+ 미관리 Raw 데이터 */}
        {staleVisitOpps.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: '8px', border: '1px solid #ffcdd2',
            borderLeft: '5px solid #c62828', marginBottom: '20px', overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(198,40,40,0.08)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', background: 'linear-gradient(135deg, #ffebee, #fce4ec)',
              borderBottom: '1px solid #ffcdd2',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#c62828', marginBottom: '2px' }}>
                  방문후 미관리 Opportunity
                </h3>
                <p style={{ color: '#999', fontSize: '0.82em' }}>
                  방문 완료 후 7일 이상 경과 · 14일+ {staleVisitOver14}건
                </p>
              </div>
              <div style={{
                padding: '8px 18px', borderRadius: '8px', background: '#c62828', color: '#fff',
                fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(198,40,40,0.3)',
              }}>
                {staleVisitOpps.length}건
              </div>
            </div>
            <DataTable columns={staleVisitColumns} data={staleVisitOpps} loading={loading} className="daily-raw daily-raw-red" />
          </div>
        )}

        {/* 주별 모드: 일별 FS 상세 */}
        {isWeekly && fs?.dailyDetails?.length > 0 && (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <h2 style={{ marginBottom: '4px' }}>일별 Field Sales 상세</h2>
            <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '16px' }}>
              주간 내 각 일자별 Golden Time 위반 및 Raw 데이터 · {(fs.dailyDetails as any[]).length}일
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(fs.dailyDetails as any[]).map((day: any, idx: number) => {
                const violations = day.rawData?.goldenTimeViolations || [];
                const dayStaleVisit = day.staleVisit?.opps || [];
                const dayStaleTotal = day.staleVisit?.total ?? 0;
                const cwRateUsers = day.cwConversionRate?.byUser || [];
                const dayCW = cwRateUsers.reduce((s: number, u: any) => s + (u.cw || 0), 0);
                const dayCL = cwRateUsers.reduce((s: number, u: any) => s + (u.cl || 0), 0);
                const dayTotal = cwRateUsers.reduce((s: number, u: any) => s + (u.total || 0), 0);
                const dayRate = dayTotal > 0 ? ((dayCW / dayTotal) * 100).toFixed(1) : '-';
                const gtStale = day.goldenTime?.staleCount ?? day.goldenTime?.stale8plus ?? 0;
                return (
                  <div key={idx} style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                    <div style={{
                      padding: '10px 16px',
                      background: day.dayOfWeek === 0 || day.dayOfWeek === 6 ? '#fff3e0' : '#e0f2f1',
                      borderBottom: '1px solid #e0e0e0',
                      display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' as const,
                    }}>
                      <span style={{ fontWeight: 700, fontSize: '1em' }}>
                        {day.date} ({day.dayName})
                      </span>
                      <span style={{ fontSize: '0.85em', color: '#333', fontWeight: 600 }}>
                        SQL {dayTotal} → CW {dayCW} / CL {dayCL}
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: dayRate !== '-' && parseFloat(dayRate) >= 60 ? '#e8f5e9' : '#fce4ec',
                        color: dayRate !== '-' && parseFloat(dayRate) >= 60 ? '#2e7d32' : '#c62828',
                      }}>
                        전환율 {dayRate}%
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: gtStale === 0 ? '#e8f5e9' : '#fff3e0',
                        color: gtStale === 0 ? '#2e7d32' : '#e65100',
                      }}>
                        Golden Time 위반 {gtStale}건
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: '#f5f5f5', color: '#555',
                      }}>
                        OBS Lead {typeof day.obsLeadCount === 'object' ? (day.obsLeadCount?.total ?? 0) : (day.obsLeadCount || 0)}
                      </span>
                      {dayStaleTotal > 0 && (
                        <span style={{
                          padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                          background: '#ffebee', color: '#c62828',
                        }}>
                          방문후 미관리 {dayStaleTotal}건
                        </span>
                      )}
                    </div>
                    {/* Golden Time 위반 목록 */}
                    {violations.length > 0 && (
                      <div style={{ padding: '8px 16px', borderTop: '1px solid #e0e0e0', background: '#fff8f0' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>
                            Golden Time 위반 {violations.length}건
                          </span>
                        </div>
                        <DataTable columns={goldenTimeViolationColumns} data={violations} loading={false} className="daily-raw daily-raw-orange" />
                      </div>
                    )}
                    {/* 방문후 미관리 목록 */}
                    {dayStaleVisit.length > 0 && (
                      <div style={{ padding: '8px 16px', borderTop: '1px solid #e0e0e0', background: '#fff5f5' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#ffebee', color: '#c62828' }}>
                            방문후 미관리 {dayStaleVisit.length}건
                          </span>
                        </div>
                        <DataTable columns={staleVisitColumns} data={dayStaleVisit} loading={false} className="daily-raw daily-raw-red" />
                      </div>
                    )}
                    {violations.length === 0 && dayStaleVisit.length === 0 && (
                      <div style={{ padding: '12px 16px', color: '#999', fontSize: '0.88em' }}>
                        위반 항목 없음
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Raw Data: 최근 마감 내역 — 임시 숨김 */}
        {false && fs?.rawData?.rawClosedOpps?.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: '8px', border: '1px solid #c8e6c9',
            borderLeft: '5px solid #2e7d32', marginBottom: '20px', overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(46,125,50,0.08)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', background: 'linear-gradient(135deg, #e8f5e9, #f1f8e9)',
              borderBottom: '1px solid #c8e6c9',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#1b5e20', marginBottom: '2px' }}>
                  최근 마감 내역
                </h3>
                <p style={{ color: '#999', fontSize: '0.82em' }}>
                  CW {fs.rawData.rawClosedOpps.filter((o: any) => o.stageName === 'Closed Won').length}건 · CL {fs.rawData.rawClosedOpps.filter((o: any) => o.stageName === 'Closed Lost').length}건
                </p>
              </div>
              <div style={{
                padding: '8px 18px', borderRadius: '8px', background: '#2e7d32', color: '#fff',
                fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(46,125,50,0.3)',
              }}>
                {fs.rawData.rawClosedOpps.length}건
              </div>
            </div>
            <DataTable columns={fsRawClosedOppColumns} data={fs.rawData.rawClosedOpps} loading={loading} className="daily-raw daily-raw-green" />
          </div>
        )}
      </>
    );
  }

  function renderInboundBO() {
    const isDaily = data?.periodType === 'daily';
    const isWeekly = data?.periodType === 'weekly';
    const rawUsers = ibo?.cwConversionRate?.byUser || [];
    // 계약 데이터를 담당자별 테이블에 머지
    const contractByBO: Record<string, any> = {};
    (ibo?.contractSummary?.byBO || []).forEach((b: any) => { contractByBO[b.name] = b; });
    const cwByBO: Record<string, any> = {};
    (ibo?.cwWithCarryover?.byUser || []).forEach((u: any) => { cwByBO[u.name] = u; });
    const dcByBO: Record<string, any> = {};
    (ibo?.dailyClose?.byUser || []).forEach((u: any) => { dcByBO[u.name] = u; });
    const allUsers = rawUsers.map((u: any) => {
      const ct = contractByBO[u.name] || {};
      const cwu = cwByBO[u.name] || {};
      const dc = dcByBO[u.name] || {};
      const tmCW = u.thisMonthCW ?? 0;
      const tmCL = u.thisMonthCL ?? 0;
      const coCW = u.carryoverCW ?? 0;
      const coCL = u.carryoverCL ?? 0;
      const allCW = tmCW + coCW;
      return {
        ...u,
        thisMonthCWRate: u.cwRate ?? 0,
        combinedCWRate: u.total > 0 ? +((allCW / u.total) * 100).toFixed(1) : 0,
        carryoverCWRate: (coCW + coCL) > 0 ? +((coCW / (coCW + coCL)) * 100).toFixed(1) : 0,
        contracts: ct.total ?? 0,
        contractsNew: ct.new ?? 0,
        contractsNewCarryover: ct.newCarryover ?? 0,
        contractsAddInstall: ct.addInstall ?? 0,
        contractTablets: ct.tablets ?? 0,
        avgDailyCloseThisMonth: dc.avgDailyCloseThisMonth ?? 0,
        avgDailyCloseCarryover: dc.avgDailyCloseCarryover ?? 0,
      };
    });
    const totalSQL = allUsers.reduce((s: number, u: any) => s + u.total, 0);
    const totalCW = allUsers.reduce((s: number, u: any) => s + (u.thisMonthCW ?? 0), 0);
    const totalCL = allUsers.reduce((s: number, u: any) => s + (u.thisMonthCL ?? 0), 0);
    const totalOpen = allUsers.reduce((s: number, u: any) => s + (u.open ?? 0), 0);
    const totalCarryoverCW = allUsers.reduce((s: number, u: any) => s + (u.carryoverCW ?? 0), 0);
    const totalCarryoverCL = allUsers.reduce((s: number, u: any) => s + (u.carryoverCL ?? 0), 0);
    const totalContracts = allUsers.reduce((s: number, u: any) => s + (u.contracts ?? 0), 0);
    const totalContractsNew = allUsers.reduce((s: number, u: any) => s + (u.contractsNew ?? 0), 0);
    const totalContractsNewCarryover = allUsers.reduce((s: number, u: any) => s + (u.contractsNewCarryover ?? 0), 0);
    const totalContractsAddInstall = allUsers.reduce((s: number, u: any) => s + (u.contractsAddInstall ?? 0), 0);
    const totalContractTablets = allUsers.reduce((s: number, u: any) => s + (u.contractTablets ?? 0), 0);
    const overallCWRate = totalSQL > 0 ? ((totalCW / totalSQL) * 100).toFixed(1) : '-';
    const overallAvgDailyClose = allUsers.length > 0
      ? +(allUsers.reduce((s: number, u: any) => s + (u.avgDailyClose ?? 0), 0) / allUsers.length).toFixed(1) : 0;
    // 합산 행 추가
    const allUsersWithSummary = [...allUsers, {
      _isSummary: true,
      name: '합산',
      total: totalSQL,
      thisMonthCW: totalCW,
      thisMonthCL: totalCL,
      open: totalOpen,
      thisMonthCWRate: overallCWRate !== '-' ? parseFloat(overallCWRate as string) : 0,
      combinedCWRate: totalSQL > 0 ? +(((totalCW + totalCarryoverCW) / totalSQL) * 100).toFixed(1) : 0,
      carryoverCW: totalCarryoverCW,
      carryoverCL: totalCarryoverCL,
      avgDailyClose: overallAvgDailyClose,
      openByAge: { over7: allUsers.reduce((s: number, u: any) => s + (u.openByAge?.over7 ?? 0), 0) },
      contracts: totalContracts,
      contractsNew: totalContractsNew,
      contractsNewCarryover: totalContractsNewCarryover,
      contractsAddInstall: totalContractsAddInstall,
      contractTablets: totalContractTablets,
      contractAvgTablets: totalContracts > 0 ? +(totalContractTablets / totalContracts).toFixed(1) : 0,
      achievementRate: '-',
    }];
    const avgDailyClose = ibo?.dailyClose?.byUser
      ? (ibo.dailyClose.byUser.reduce((s: number, u: any) => s + u.avgDailyClose, 0) / ibo.dailyClose.byUser.length).toFixed(1)
      : '-';
    const avgDailyCloseThisMonth = ibo?.dailyClose?.byUser
      ? (ibo.dailyClose.byUser.reduce((s: number, u: any) => s + (u.avgDailyCloseThisMonth ?? 0), 0) / ibo.dailyClose.byUser.length).toFixed(1)
      : '-';
    const avgDailyCloseCarryover = ibo?.dailyClose?.byUser
      ? (ibo.dailyClose.byUser.reduce((s: number, u: any) => s + (u.avgDailyCloseCarryover ?? 0), 0) / ibo.dailyClose.byUser.length).toFixed(1)
      : '-';
    const cw = ibo?.cwWithCarryover;

    return (
      <>
        <div className="metro-card">
          <h2 style={{ marginBottom: '8px' }}>인바운드 Back Office KPI</h2>
          <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '24px' }}>과정 지표(일평균 마감·SQL 잔량)가 결과(CW 전환율)를 만듭니다</p>

          <div style={{ display: 'flex', alignItems: 'stretch', gap: '0', padding: '0 10px' }}>
            {[
              {
                label: '일평균 마감',
                value: avgDailyClose,
                sub: `이번달 ${avgDailyCloseThisMonth} + 이월 ${avgDailyCloseCarryover}`,
                target: '목표: 5건',
                color: '#00897b',
                met: avgDailyClose !== '-' && parseFloat(avgDailyClose as string) >= 5,
              },
              {
                label: 'SQL 잔량 (7일+)',
                value: ibo?.sqlBacklog?.totalOver7 ?? '-',
                sub: `전체 진행중 ${ibo?.sqlBacklog?.totalOpen ?? 0}건`,
                target: '목표: ≤10건',
                color: '#e65100',
                met: (ibo?.sqlBacklog?.totalOver7 ?? 999) <= 10,
              },
              {
                label: '이월 비중',
                value: cw?.totalCW > 0 ? `${((cw.totalCarryoverCW / cw.totalCW) * 100).toFixed(0)}%` : '-',
                sub: `이월 ${cw?.totalCarryoverCW ?? 0} / 전체 ${cw?.totalCW ?? 0}`,
                target: '낮을수록 좋음',
                color: '#5e35b1',
                met: cw?.totalCW > 0 ? (cw.totalCarryoverCW / cw.totalCW) < 0.5 : true,
              },
            ].map((step, i) => (
              <React.Fragment key={step.label}>
                <div style={{
                  flex: 1,
                  background: step.met ? `${step.color}12` : '#fff5f5',
                  border: `2px solid ${step.met ? step.color : '#e53935'}`,
                  borderRadius: '12px',
                  padding: '20px 16px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    과정 {i + 1}
                  </div>
                  <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: '1.8em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                    {typeof step.value === 'number' ? step.value.toLocaleString() : step.value}
                  </div>
                  <div style={{ fontSize: '0.78em', color: '#888', marginTop: '6px' }}>
                    {step.sub}
                  </div>
                  <div style={{
                    marginTop: '8px', fontSize: '0.72em', fontWeight: 600,
                    color: step.met ? step.color : '#e53935',
                    background: step.met ? `${step.color}18` : '#ffebee',
                    padding: '3px 10px', borderRadius: '10px', display: 'inline-block',
                  }}>
                    {step.target}
                  </div>
                </div>
                {i < 2 && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#bbb', fontSize: '1.5em' }}>→</div>
                )}
              </React.Fragment>
            ))}

            {/* 화살표 → 결과 */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#bbb', fontSize: '1.5em' }}>→</div>

            {/* 결과 지표 (핵심 KPI) */}
            <div style={{
              flex: 1.3,
              background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#e8f5e9' : '#ffebee',
              border: `2px solid ${(overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935'}`,
              borderRadius: '12px',
              padding: '20px 16px',
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: '0.75em', fontWeight: 700, letterSpacing: '0.5px',
                color: '#fff', background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
                padding: '3px 12px', borderRadius: '10px', display: 'inline-block', marginBottom: '6px',
              }}>
                결과
              </div>
              <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                SQL→CW 전환율
              </div>
              <div style={{
                fontSize: '2em', fontWeight: 700, lineHeight: 1.1,
                color: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
              }}>
                {overallCWRate}%
              </div>
              <div style={{ fontSize: '0.78em', color: '#888', marginTop: '6px' }}>
                이번달 Lead 기준 ({totalSQL}건 중 {totalCW}건)
              </div>
              <div style={{
                marginTop: '8px', fontSize: '0.72em', fontWeight: 600,
                color: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
                background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#c8e6c918' : '#ffebee',
                padding: '3px 10px', borderRadius: '10px', display: 'inline-block',
              }}>
                목표: 60%
              </div>
            </div>
          </div>

          {/* 하단 보조 지표: 계약 기반 */}
          {(() => { const cs = ibo?.contractSummary; return (
          <div style={{ display: 'flex', gap: '12px', marginTop: '16px', padding: '0 10px' }}>
            <div style={{
              flex: 1, background: '#f5f5f5', borderRadius: '8px', padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.85em', color: '#666' }}>계약 건수</span>
              <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#2e7d32' }}>
                {cs?.total ?? '-'}건
              </span>
            </div>
            <div style={{
              flex: 1.4, background: '#f5f5f5', borderRadius: '8px', padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <span style={{ fontSize: '0.85em', color: '#666' }}>신규</span>
                {(cs?.newFromCarryover ?? 0) > 0 && (
                  <span style={{ fontSize: '0.72em', color: '#e65100', marginLeft: '6px', background: '#fff3e0', padding: '1px 6px', borderRadius: '4px' }}>
                    이월 {cs.newFromCarryover}건
                  </span>
                )}
              </div>
              <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#1565c0' }}>
                {cs?.new ?? '-'}건
              </span>
            </div>
            <div style={{
              flex: 1, background: '#f5f5f5', borderRadius: '8px', padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.85em', color: '#666' }}>추가설치</span>
              <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#e65100' }}>
                {cs?.addInstall ?? '-'}건
              </span>
            </div>
          </div>
          ); })()}
        </div>

        {/* 월별/주별 모드: BO 일별 추이 차트 — 임시 숨김 */}
        {false && !isDaily && !isWeekly && dailyTrends && dailyTrends.length > 0 && (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ marginBottom: '4px' }}>인바운드 BO 일별 추이</h2>
              <p style={{ color: '#888', fontSize: '0.85em' }}>
                SQL 생산·마감·잔량의 일별 변화 · 문제 일자를 클릭하면 해당일 Raw 데이터로 이동합니다
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <DailyTrendPanel
                title="SQL 생산"
                subtitle="일별 SQL(Opp) 배정 건수"
                color="#1565c0"
                valueKey="iboSqlTotal"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.inboundBO?.sqlTotal ?? null,
                  rawCount: d.inboundBO?.totalClosed ?? 0,
                }))}
                targetValue={10}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value < 5}
                problemLabel="마감 처리"
                problemColor="#e65100"
              />
              <DailyTrendPanel
                title="일별 마감"
                subtitle="CW + CL 처리 건수"
                color="#00897b"
                valueKey="iboDailyClosed"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.inboundBO?.totalClosed ?? null,
                  rawCount: d.inboundBO?.cw ?? 0,
                }))}
                targetValue={5}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value < 3}
                problemLabel="CW"
                problemColor="#e53935"
              />
              <DailyTrendPanel
                title="SQL 잔량 (7일+)"
                subtitle="목표: 10건 이하"
                color="#e65100"
                valueKey="iboBacklog7"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.inboundBO?.sqlBacklogOver7 ?? null,
                  rawCount: d.inboundBO?.sqlBacklogOpen ?? 0,
                }))}
                targetValue={10}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value > 10}
                problemLabel="전체 잔량"
                problemColor="#c62828"
              />
            </div>
          </div>
        )}

        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>담당자별 상세 (이번달 Lead 기준)</h2>
          <DataTable columns={inboundBOColumns} data={allUsersWithSummary} loading={loading} />
        </div>

        {false && cw?.byUser?.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '20px' }}>담당자별 CW (이월 포함, CloseDate 기준)</h2>
            <DataTable columns={carryoverCWColumns} data={cw.byUser} loading={loading} />
          </div>
        )}

        {/* Raw Data: 진행중 Opportunity 상세 (Stage별 그룹) */}
        {ibo?.rawData?.rawOpenOpps?.length > 0 && (() => {
          const stageGroups = groupOppsByStage(ibo.rawData.rawOpenOpps);
          return (
            <div style={{
              background: '#fff', borderRadius: '8px', border: '1px solid #b2dfdb',
              borderLeft: '5px solid #00897b', marginBottom: '20px', overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,137,123,0.08)',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '18px 24px', background: 'linear-gradient(135deg, #e0f2f1, #f0fdfa)',
                borderBottom: '1px solid #b2dfdb',
              }}>
                <div>
                  <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#00695c', marginBottom: '4px' }}>
                    진행중 Opportunity 상세
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
                    {stageGroups.map(g => (
                      <span key={g.stage} style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.78em', fontWeight: 600,
                        background: g.bg, color: g.color, border: `1px solid ${g.color}30`,
                      }}>
                        {g.stage} {g.items.length}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{
                  padding: '8px 18px', borderRadius: '8px', background: '#00897b', color: '#fff',
                  fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(0,137,123,0.3)',
                }}>
                  {ibo.rawData.rawOpenOpps.length}건
                </div>
              </div>
              {stageGroups.map(g => (
                <div key={g.stage}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 24px', background: g.bg, borderBottom: `2px solid ${g.color}40`,
                  }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%', background: g.color, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '0.92em', fontWeight: 700, color: g.color }}>{g.stage}</span>
                    <span style={{ fontSize: '0.82em', color: '#888' }}>{g.items.length}건</span>
                  </div>
                  <DataTable columns={rawOpenOppColumns} data={g.items} loading={loading} className="daily-raw daily-raw-teal" />
                </div>
              ))}
            </div>
          );
        })()}

        {/* Raw Data: 최근 마감 내역 — 임시 숨김 */}
        {false && ibo?.rawData?.rawClosedOpps?.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: '8px', border: '1px solid #c8e6c9',
            borderLeft: '5px solid #2e7d32', marginBottom: '20px', overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(46,125,50,0.08)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', background: 'linear-gradient(135deg, #e8f5e9, #f1f8e9)',
              borderBottom: '1px solid #c8e6c9',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#1b5e20', marginBottom: '2px' }}>
                  최근 마감 내역
                </h3>
                <p style={{ color: '#999', fontSize: '0.82em' }}>
                  CW {ibo.rawData.rawClosedOpps.filter((o: any) => o.stageName === 'Closed Won').length}건 · CL {ibo.rawData.rawClosedOpps.filter((o: any) => o.stageName === 'Closed Lost').length}건
                </p>
              </div>
              <div style={{
                padding: '8px 18px', borderRadius: '8px', background: '#2e7d32', color: '#fff',
                fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(46,125,50,0.3)',
              }}>
                {ibo.rawData.rawClosedOpps.length}건
              </div>
            </div>
            <DataTable columns={rawClosedOppColumns} data={ibo.rawData.rawClosedOpps} loading={loading} className="daily-raw daily-raw-green" />
          </div>
        )}
      </>
    );
  }

  function renderChannelAE() {
    const kpiData = channelData?.kpi;
    const bd = kpiData?.bd;
    const mouData = channelData?.mouStats;
    const isChannelLoaded = !!channelData && !channelLoading;

    // 채널 데이터 로딩 중
    if (channelLoading) {
      return (
        <div className="metro-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '2em', marginBottom: '16px' }}>⏳</div>
          <h3 style={{ color: '#666', fontWeight: 400 }}>Salesforce에서 채널 세일즈 데이터를 불러오는 중...</h3>
          <p style={{ color: '#999', fontSize: '0.85em', marginTop: '8px' }}>첫 로딩 시 15~30초 소요될 수 있습니다</p>
        </div>
      );
    }

    if (channelError) {
      return (
        <div className="metro-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: '#e53935' }}>{channelError}</p>
          <button
            onClick={() => { setChannelError(null); setChannelData(null); }}
            style={{ marginTop: '12px', padding: '8px 20px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            다시 시도
          </button>
        </div>
      );
    }

    // AE 프로세스 플로우 데이터
    const aeFlowSteps = [
      {
        label: 'MOU 미완료 곳 미팅',
        value: `${bd?.meetingsIncompleteAvg?.value ?? '-'}건/일`,
        detail: `이번달 ${bd?.meetingsIncompleteThisMonth?.value ?? 0}건`,
        target: '2건/일',
        met: (parseFloat(bd?.meetingsIncompleteAvg?.value) || 0) >= 2,
        color: '#e65100',
      },
      {
        label: '네고 단계 진입',
        value: `${bd?.negoEntryThisMonth?.value ?? '-'}건`,
        detail: `전체 ${bd?.negoEntryThisMonth?.total ?? 0}건 중`,
        target: '10건',
        met: (bd?.negoEntryThisMonth?.value ?? 0) >= 10,
        color: '#00897b',
      },
    ];

    const aeResultStep = {
      label: '신규 MOU 체결',
      value: `${bd?.mouNewThisMonth?.value ?? '-'}건`,
      detail: `목표 대비 ${Math.round(((bd?.mouNewThisMonth?.value ?? 0) / 4) * 100)}%`,
      target: '4건',
      met: (bd?.mouNewThisMonth?.value ?? 0) >= 4,
    };

    return (
      <>
        {/* 프로세스 플로우: MOU 체결 프로세스 */}
        {isChannelLoaded && bd && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '8px' }}>MOU 체결 프로세스</h2>
            <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '24px' }}>과정 지표가 결과(MOU 체결)를 만듭니다</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0', padding: '0 10px' }}>
              {aeFlowSteps.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div style={{
                    flex: 1,
                    background: step.met ? `${step.color}12` : '#fff5f5',
                    border: `2px solid ${step.met ? step.color : '#e53935'}`,
                    borderRadius: '12px',
                    padding: '20px 16px',
                    textAlign: 'center',
                    position: 'relative',
                  }}>
                    <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      과정 {i + 1}
                    </div>
                    <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                      {step.label}
                    </div>
                    <div style={{ fontSize: '1.8em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                      {step.value}
                    </div>
                    <div style={{ fontSize: '0.8em', color: '#666', marginTop: '6px' }}>{step.detail}</div>
                    <div style={{
                      marginTop: '10px',
                      fontSize: '0.72em',
                      padding: '3px 10px',
                      borderRadius: '10px',
                      display: 'inline-block',
                      background: step.met ? '#e8f5e9' : '#ffebee',
                      color: step.met ? '#2e7d32' : '#c62828',
                    }}>
                      목표: {step.target}
                    </div>
                  </div>
                  <div style={{
                    width: '40px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#bbb', fontSize: '1.4em',
                  }}>
                    →
                  </div>
                </React.Fragment>
              ))}
              {/* 결과 */}
              <div style={{
                flex: 1.2,
                background: aeResultStep.met ? 'linear-gradient(135deg, #1565c0, #0d47a1)' : 'linear-gradient(135deg, #c62828, #b71c1c)',
                borderRadius: '12px',
                padding: '20px 16px',
                textAlign: 'center',
                color: '#fff',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              }}>
                <div style={{ fontSize: '0.75em', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.85 }}>
                  결과
                </div>
                <div style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '8px' }}>
                  {aeResultStep.label}
                </div>
                <div style={{ fontSize: '2.2em', fontWeight: 700, lineHeight: 1.1 }}>
                  {aeResultStep.value}
                </div>
                <div style={{ fontSize: '0.8em', marginTop: '6px', opacity: 0.85 }}>{aeResultStep.detail}</div>
                <div style={{
                  marginTop: '10px',
                  fontSize: '0.72em',
                  padding: '3px 10px',
                  borderRadius: '10px',
                  display: 'inline-block',
                  background: 'rgba(255,255,255,0.2)',
                }}>
                  목표: {aeResultStep.target}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 핵심 지표 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>핵심 지표</h2>
          <div className="metro-grid metro-grid-3">
            <StatsCard
              title="신규 MOU 체결"
              value={bd?.mouNewThisMonth?.value ?? ae?.mouCount?.total ?? '-'}
              target="4건"
              subtitle={isChannelLoaded ? `목표 ${bd?.mouNewThisMonth?.target ?? 4}건` : `파트너 ${ae?.mouCount?.partners ?? 0} / 프랜차이즈 ${ae?.mouCount?.franchiseHQ ?? 0}`}
              color={kpiColor(bd?.mouNewThisMonth?.value ?? ae?.mouCount?.total ?? 0, 4)}
              loading={!isChannelLoaded && loading}
            />
            <StatsCard
              title="네고 단계 진입"
              value={bd?.negoEntryThisMonth?.value ?? ae?.mouNegoProgress?.byProgress?.Negotiation ?? '-'}
              target="10건"
              subtitle={isChannelLoaded ? `전체 네고 ${bd?.negoEntryThisMonth?.total ?? 0}건` : 'Negotiation 진행중'}
              color={kpiColor(bd?.negoEntryThisMonth?.value ?? 0, 10)}
              loading={!isChannelLoaded && loading}
            />
            <StatsCard
              title="MOU 미완료 곳 미팅"
              value={isChannelLoaded ? `${bd?.meetingsIncompleteAvg?.value ?? '-'}` : (ae?.meetingCount?.avgDaily ?? '-')}
              target="2건/일"
              subtitle={isChannelLoaded
                ? `오늘 ${bd?.meetingsIncompleteToday?.value ?? 0}건 · 이번달 ${bd?.meetingsIncompleteThisMonth?.value ?? 0}건`
                : `총 ${ae?.meetingCount?.total ?? 0}건`}
              color={kpiColor(parseFloat(bd?.meetingsIncompleteAvg?.value ?? ae?.meetingCount?.avgDaily ?? 0), 2)}
              loading={!isChannelLoaded && loading}
            />
          </div>
        </div>

        {/* 미팅 캘린더 */}
        {isChannelLoaded && kpiData?.meetingCalendar && kpiData?.calendarMeta && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>미팅 캘린더</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '16px' }}>
              MOU 완료/미완료 거래처 미팅 현황 · 날짜 클릭 시 상세 보기
            </p>
            <MeetingCalendar
              calendarMeta={kpiData.calendarMeta}
              meetingCalendar={kpiData.meetingCalendar}
              todayStr={kpiData.date || ''}
            />
          </div>
        )}

        {/* 담당자별 미팅 — Raw 데이터 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '4px' }}>담당자별 미팅</h2>
          <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '16px' }}>
            이번달 채널 거래처 미팅 상세 현황
          </p>
          {isChannelLoaded && kpiData?.meetingCalendar ? (
            <DataTable
              columns={[
                { key: 'date', header: '날짜' },
                { key: 'owner', header: '담당자' },
                { key: 'accountName', header: '거래처' },
                { key: 'subject', header: '유형' },
                { key: 'isMouComplete', header: 'MOU', align: 'center' as const, render: (v: boolean) => (
                  <span style={{
                    padding: '2px 8px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                    background: v ? '#e8f5e9' : '#fce4ec',
                    color: v ? '#2e7d32' : '#c62828',
                  }}>
                    {v ? '완료' : '미완료'}
                  </span>
                )},
                { key: 'isCompleted', header: '상태', align: 'center' as const, render: (v: boolean, row: any) => (
                  <span style={{ fontSize: '0.82em', color: v ? '#999' : '#1565c0', fontWeight: v ? 400 : 600 }}>
                    {v ? '완료' : '예정'}
                  </span>
                )},
              ]}
              data={
                Object.entries(kpiData.meetingCalendar as Record<string, any[]>)
                  .flatMap(([date, events]: [string, any[]]) =>
                    events.map((e: any) => ({ ...e, date: date.substring(5).replace('-', '/') }))
                  )
                  .sort((a: any, b: any) => b.date.localeCompare(a.date) || a.owner.localeCompare(b.owner))
              }
              loading={false}
            />
          ) : (
            <DataTable columns={meetingColumns} data={ae?.meetingCount?.byOwner || []} loading={loading} />
          )}
        </div>

        {/* MOU 체결 현황 */}
        {isChannelLoaded && mouData && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>MOU 체결 현황</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '16px' }}>
              이번달 & 최근 3개월 MOU 체결 및 초기 안착률
            </p>

            {/* MOU 요약 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: '#f3e5f5', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#7b1fa2', marginBottom: '4px' }}>이번달 파트너 MOU</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#4a148c' }}>{mouData.partner?.thisMonth ?? 0}</div>
              </div>
              <div style={{ background: '#e8eaf6', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#283593', marginBottom: '4px' }}>이번달 본사 MOU</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#1a237e' }}>{mouData.franchiseHQ?.thisMonth ?? 0}</div>
              </div>
              <div style={{ background: '#e0f2f1', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#00695c', marginBottom: '4px' }}>파트너 안착률</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: parseFloat(mouData.onboarding?.partner?.rate || 0) >= 80 ? '#2e7d32' : '#e65100' }}>
                  {mouData.onboarding?.partner?.rate ?? 0}%
                </div>
                <div style={{ fontSize: '0.7em', color: '#888' }}>{mouData.onboarding?.partner?.settled ?? 0}/{mouData.onboarding?.partner?.total ?? 0}</div>
              </div>
              <div style={{ background: '#fce4ec', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#880e4f', marginBottom: '4px' }}>브랜드 안착률</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: parseFloat(mouData.onboarding?.franchiseBrand?.rate || 0) >= 80 ? '#2e7d32' : '#e65100' }}>
                  {mouData.onboarding?.franchiseBrand?.rate ?? 0}%
                </div>
                <div style={{ fontSize: '0.7em', color: '#888' }}>{mouData.onboarding?.franchiseBrand?.settled ?? 0}/{mouData.onboarding?.franchiseBrand?.total ?? 0}</div>
              </div>
            </div>

            {/* 이번달 MOU 체결 목록 */}
            {(mouData.partner?.thisMonthList?.length > 0 || mouData.franchiseHQ?.thisMonthList?.length > 0) && (
              <>
                <h3 style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '10px', color: '#555' }}>이번달 MOU 체결 목록</h3>
                <DataTable
                  columns={[
                    { key: 'name', header: '업체명' },
                    { key: 'type', header: '유형' },
                    { key: 'mouStart', header: 'MOU 시작일' },
                    { key: 'owner', header: '담당자' },
                  ]}
                  data={[
                    ...(mouData.partner?.thisMonthList || []).map((p: any) => ({ ...p, type: '파트너사' })),
                    ...(mouData.franchiseHQ?.thisMonthList || []).map((h: any) => ({ name: h.hqName || h.name, type: '프랜차이즈 본사', mouStart: h.mouStart, owner: h.owner })),
                  ]}
                  loading={false}
                />
              </>
            )}

            {/* 미안착 목록 — 리드 + Case 상세 */}
            {mouData.onboarding?.partner?.list && mouData.onboarding.partner.list.filter((p: any) => !p.isSettled).length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <h3 style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '4px', color: '#c62828' }}>미안착 파트너사</h3>
                <p style={{ color: '#888', fontSize: '0.78em', marginBottom: '12px' }}>
                  MOU 후 3개월 내 Lead 0건 · 소개 매장의 Case(장애) 현황 포함
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {mouData.onboarding.partner.list
                    .filter((p: any) => !p.isSettled)
                    .sort((a: any, b: any) => (b.totalLeadCount || 0) - (a.totalLeadCount || 0))
                    .map((p: any) => (
                      <div key={p.id || p.name} style={{
                        background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', padding: '12px',
                      }}>
                        {/* 파트너 헤더 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: '0.88em' }}>{p.name}</span>
                            <span style={{ fontSize: '0.75em', color: '#888', marginLeft: '8px' }}>{p.owner}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', fontSize: '0.72em' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#f3e5f5', color: '#7b1fa2', fontWeight: 600 }}>
                              MOU {p.mouStart?.substring(5) || '-'}
                            </span>
                            <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#fff8e1', color: '#e65100', fontWeight: 600 }}>
                              전체 Lead {p.totalLeadCount ?? 0}건
                            </span>
                            {(p.preMouLeadCount ?? 0) > 0 && (
                              <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#fce4ec', color: '#c62828', fontWeight: 600 }}>
                                MOU 전 {p.preMouLeadCount}건
                              </span>
                            )}
                            {(p.referredStoreCount ?? 0) > 0 && (
                              <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#e3f2fd', color: '#1565c0', fontWeight: 600 }}>
                                🏪 소개매장 {p.referredStoreCount}곳
                              </span>
                            )}
                            {(p.totalCaseCount ?? 0) > 0 && (
                              <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#ffebee', color: '#b71c1c', fontWeight: 600 }}>
                                ⚠ Case {p.totalCaseCount}건
                              </span>
                            )}
                          </div>
                        </div>
                        {/* 안착 기한 */}
                        <div style={{ fontSize: '0.72em', color: '#999', marginBottom: '8px' }}>
                          안착 기한: {p.mouStart} ~ {p.mouEndWindow}
                        </div>
                        {/* 리드(PartnerName__c) 기반 상세 */}
                        {p.leadDetails && p.leadDetails.length > 0 && (
                          <div style={{ fontSize: '0.78em', marginBottom: '8px' }}>
                            <div style={{ fontSize: '0.85em', fontWeight: 600, color: '#666', marginBottom: '4px' }}>📋 Lead 기반 소개</div>
                            {p.leadDetails.map((lead: any, idx: number) => (
                              <div key={lead.id || idx} style={{
                                padding: '6px 10px', borderRadius: '6px', marginBottom: '4px',
                                background: lead.isPreMou ? '#fff3e0' : '#f5f5f5',
                                border: lead.caseCount > 0 ? '1px solid #ffcdd2' : '1px solid #eee',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{lead.company}</span>
                                    <span style={{ color: '#888', marginLeft: '8px' }}>{lead.createdDate}</span>
                                    {lead.isPreMou && (
                                      <span style={{ marginLeft: '6px', fontSize: '0.85em', color: '#e65100', fontWeight: 600 }}>MOU 전</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <span style={{
                                      padding: '1px 6px', borderRadius: '8px', fontSize: '0.85em',
                                      background: lead.isConverted ? '#e8f5e9' : '#f5f5f5',
                                      color: lead.isConverted ? '#2e7d32' : '#999',
                                    }}>
                                      {lead.status}
                                    </span>
                                    {lead.caseCount > 0 && (
                                      <span style={{ padding: '1px 6px', borderRadius: '8px', fontSize: '0.85em', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>
                                        Case {lead.caseCount}건
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* Case 상세 */}
                                {lead.caseSummary && lead.caseSummary.length > 0 && (
                                  <div style={{ marginTop: '4px', paddingLeft: '12px', borderLeft: '2px solid #ffcdd2' }}>
                                    {lead.caseSummary.map((c: any, ci: number) => (
                                      <div key={ci} style={{ fontSize: '0.9em', color: '#666', marginBottom: '2px' }}>
                                        <span style={{ color: '#c62828', fontWeight: 500 }}>{c.type}</span>
                                        {c.type2 !== '-' && <span> › {c.type2}</span>}
                                        {c.type3 !== '-' && <span> › {c.type3}</span>}
                                        <span style={{ color: '#999', marginLeft: '6px' }}>{c.createdDate}</span>
                                        <span style={{ marginLeft: '6px', color: c.status === 'Closed' ? '#999' : '#e65100' }}>{c.status}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* AccountPartner__c 기반 소개 매장 */}
                        {p.storeDetails && p.storeDetails.length > 0 && (
                          <div style={{ fontSize: '0.78em' }}>
                            <div style={{ fontSize: '0.85em', fontWeight: 600, color: '#1565c0', marginBottom: '4px' }}>🏪 소개 매장 (AccountPartner__c)</div>
                            {p.storeDetails.map((store: any, idx: number) => (
                              <div key={store.storeId || idx} style={{
                                padding: '6px 10px', borderRadius: '6px', marginBottom: '4px',
                                background: '#e3f2fd',
                                border: store.caseCount > 0 ? '1px solid #ffcdd2' : '1px solid #bbdefb',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{store.storeName}</span>
                                    <span style={{ color: '#888', marginLeft: '8px' }}>{store.createdDate}</span>
                                  </div>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    {store.caseCount > 0 && (
                                      <span style={{ padding: '1px 6px', borderRadius: '8px', fontSize: '0.85em', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>
                                        Case {store.caseCount}건
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* 매장 Case 상세 */}
                                {store.caseSummary && store.caseSummary.length > 0 && (
                                  <div style={{ marginTop: '4px', paddingLeft: '12px', borderLeft: '2px solid #ffcdd2' }}>
                                    {store.caseSummary.map((c: any, ci: number) => (
                                      <div key={ci} style={{ fontSize: '0.9em', color: '#666', marginBottom: '2px' }}>
                                        <span style={{ color: '#c62828', fontWeight: 500 }}>{c.type}</span>
                                        {c.type2 !== '-' && <span> › {c.type2}</span>}
                                        {c.type3 !== '-' && <span> › {c.type3}</span>}
                                        <span style={{ color: '#999', marginLeft: '6px' }}>{c.createdDate}</span>
                                        <span style={{ marginLeft: '6px', color: c.status === 'Closed' ? '#999' : '#e65100' }}>{c.status}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 소개 이력 없음 */}
                        {(!p.leadDetails || p.leadDetails.length === 0) && (!p.storeDetails || p.storeDetails.length === 0) && (
                          <div style={{ color: '#bbb', fontSize: '0.78em' }}>소개 이력 없음</div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 기존 데이터 fallback: MOU 체결 목록 (channel data 없을 때) */}
        {!isChannelLoaded && ae?.mouCount?.details && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '20px' }}>이번 달 MOU 체결 목록</h2>
            <DataTable
              columns={[
                { key: 'name', header: '업체명' },
                { key: 'mouStart', header: 'MOU 시작일' },
                { key: 'owner', header: '담당자' },
              ]}
              data={[...(ae.mouCount.details.partners || []), ...(ae.mouCount.details.franchiseHQ || [])]}
              loading={loading}
            />
          </div>
        )}
      </>
    );
  }

  function renderChannelAM() {
    const kpiData = channelData?.kpi;
    const amKpi = kpiData?.am;
    const clbo = channelData?.summary?.channelLeadsByOwner;
    const amHeatmap = clbo?.amHeatmap;
    const mouData = channelData?.mouStats;
    const pipelineData = channelData?.pipeline;
    const isChannelLoaded = !!channelData && !channelLoading;

    // 채널 데이터 로딩 중
    if (channelLoading) {
      return (
        <div className="metro-card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '2em', marginBottom: '16px' }}>⏳</div>
          <h3 style={{ color: '#666', fontWeight: 400 }}>Salesforce에서 채널 세일즈 데이터를 불러오는 중...</h3>
          <p style={{ color: '#999', fontSize: '0.85em', marginTop: '8px' }}>첫 로딩 시 15~30초 소요될 수 있습니다</p>
        </div>
      );
    }

    if (channelError) {
      return (
        <div className="metro-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: '#e53935' }}>{channelError}</p>
          <button
            onClick={() => { setChannelError(null); setChannelData(null); }}
            style={{ marginTop: '12px', padding: '8px 20px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            다시 시도
          </button>
        </div>
      );
    }

    // AM 프로세스 플로우 데이터
    const amFlowSteps = [
      {
        label: '채널 리드 확보',
        value: `${amKpi?.leadsDailyAvg?.value ?? '-'}건/일`,
        detail: `이번달 ${amKpi?.leadsThisMonth?.value ?? 0}건`,
        target: '20~25건/일',
        met: (parseFloat(amKpi?.leadsDailyAvg?.value) || 0) >= 20,
        color: '#0078d4',
      },
      {
        label: 'MOU 완료 곳 미팅',
        value: `${amKpi?.meetingsCompleteAvg?.value ?? '-'}건/일`,
        detail: `이번달 ${amKpi?.meetingsCompleteThisMonth?.value ?? 0}건`,
        target: '2건/일',
        met: (parseFloat(amKpi?.meetingsCompleteAvg?.value) || 0) >= 2,
        color: '#00897b',
      },
      {
        label: '신규 파트너 안착률',
        value: `${amKpi?.onboardingRate?.value ?? '-'}%`,
        detail: `${amKpi?.onboardingRate?.settled ?? 0} / ${amKpi?.onboardingRate?.total ?? 0}곳`,
        target: '80%',
        met: (parseFloat(amKpi?.onboardingRate?.value) || 0) >= 80,
        color: '#2e7d32',
      },
    ];

    const amResultStep = {
      label: '활성 파트너 (90일)',
      value: `${amKpi?.activeChannels90d?.value ?? '-'}개`,
      detail: `파트너 ${amKpi?.activeChannels90d?.partners ?? 0} + 본사 ${amKpi?.activeChannels90d?.hq ?? 0}`,
      target: '70개',
      met: (amKpi?.activeChannels90d?.value ?? 0) >= 70,
    };

    return (
      <>
        {/* 프로세스 플로우: 파트너 활성화 프로세스 */}
        {isChannelLoaded && amKpi && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '8px' }}>파트너 활성화 프로세스</h2>
            <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '24px' }}>과정 지표가 결과(활성 파트너 확보)를 만듭니다</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0', padding: '0 10px' }}>
              {amFlowSteps.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div style={{
                    flex: 1,
                    background: step.met ? `${step.color}12` : '#fff5f5',
                    border: `2px solid ${step.met ? step.color : '#e53935'}`,
                    borderRadius: '12px',
                    padding: '20px 16px',
                    textAlign: 'center',
                    position: 'relative',
                  }}>
                    <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      과정 {i + 1}
                    </div>
                    <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                      {step.label}
                    </div>
                    <div style={{ fontSize: '1.8em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                      {step.value}
                    </div>
                    <div style={{ fontSize: '0.8em', color: '#666', marginTop: '6px' }}>{step.detail}</div>
                    <div style={{
                      marginTop: '10px',
                      fontSize: '0.72em',
                      padding: '3px 10px',
                      borderRadius: '10px',
                      display: 'inline-block',
                      background: step.met ? '#e8f5e9' : '#ffebee',
                      color: step.met ? '#2e7d32' : '#c62828',
                    }}>
                      목표: {step.target}
                    </div>
                  </div>
                  <div style={{
                    width: '40px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#bbb', fontSize: '1.4em',
                  }}>
                    →
                  </div>
                </React.Fragment>
              ))}
              {/* 결과 */}
              <div style={{
                flex: 1.2,
                background: amResultStep.met ? 'linear-gradient(135deg, #1565c0, #0d47a1)' : 'linear-gradient(135deg, #c62828, #b71c1c)',
                borderRadius: '12px',
                padding: '20px 16px',
                textAlign: 'center',
                color: '#fff',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              }}>
                <div style={{ fontSize: '0.75em', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.85 }}>
                  결과
                </div>
                <div style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '8px' }}>
                  {amResultStep.label}
                </div>
                <div style={{ fontSize: '2.2em', fontWeight: 700, lineHeight: 1.1 }}>
                  {amResultStep.value}
                </div>
                <div style={{ fontSize: '0.8em', marginTop: '6px', opacity: 0.85 }}>{amResultStep.detail}</div>
                <div style={{
                  marginTop: '10px',
                  fontSize: '0.72em',
                  padding: '3px 10px',
                  borderRadius: '10px',
                  display: 'inline-block',
                  background: 'rgba(255,255,255,0.2)',
                }}>
                  목표: {amResultStep.target}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 핵심 지표 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>핵심 지표</h2>
          <div className="metro-grid metro-grid-4">
            <StatsCard
              title="채널 리드 확보"
              value={isChannelLoaded ? (amKpi?.leadsDailyAvg?.value ?? '-') : (am?.dailyLeadCount?.avgDaily ?? '-')}
              target="20~25건/일"
              subtitle={isChannelLoaded
                ? `오늘 ${amKpi?.leadsToday?.value ?? 0}건 · 이번달 ${amKpi?.leadsThisMonth?.value ?? 0}건`
                : `총 ${am?.dailyLeadCount?.total ?? 0}건`}
              color={kpiColor(parseFloat(amKpi?.leadsDailyAvg?.value ?? am?.dailyLeadCount?.avgDaily ?? 0), 20)}
              loading={!isChannelLoaded && loading}
            />
            <StatsCard
              title="MOU 완료 곳 미팅"
              value={isChannelLoaded ? (amKpi?.meetingsCompleteAvg?.value ?? '-') : (am?.meetingCount?.avgDaily ?? '-')}
              target="2건/일"
              subtitle={isChannelLoaded
                ? `오늘 ${amKpi?.meetingsCompleteToday?.value ?? 0}건 · 이번달 ${amKpi?.meetingsCompleteThisMonth?.value ?? 0}건`
                : `총 ${am?.meetingCount?.total ?? 0}건`}
              color={kpiColor(parseFloat(amKpi?.meetingsCompleteAvg?.value ?? am?.meetingCount?.avgDaily ?? 0), 2)}
              loading={!isChannelLoaded && loading}
            />
            <StatsCard
              title="신규 파트너 안착률"
              value={isChannelLoaded ? `${amKpi?.onboardingRate?.value ?? '-'}%` : `${am?.onboardingRate?.rate ?? '-'}%`}
              target="80%"
              subtitle={isChannelLoaded
                ? `${amKpi?.onboardingRate?.settled ?? 0} / ${amKpi?.onboardingRate?.total ?? 0}`
                : `${am?.onboardingRate?.settled ?? 0} / ${am?.onboardingRate?.total ?? 0}`}
              color={kpiColor(amKpi?.onboardingRate?.value ?? am?.onboardingRate?.rate ?? 0, 80)}
              loading={!isChannelLoaded && loading}
            />
            <StatsCard
              title="활성 파트너 (90일)"
              value={isChannelLoaded ? (amKpi?.activeChannels90d?.value ?? '-') : (am?.activePartnerCount?.total ?? '-')}
              target="70개"
              subtitle={isChannelLoaded
                ? `파트너 ${amKpi?.activeChannels90d?.partners ?? 0} / 본사 ${amKpi?.activeChannels90d?.hq ?? 0}`
                : `파트너 ${am?.activePartnerCount?.partners ?? 0} / 브랜드 ${am?.activePartnerCount?.brands ?? 0}`}
              color={kpiColor(amKpi?.activeChannels90d?.value ?? am?.activePartnerCount?.total ?? 0, 70)}
              loading={!isChannelLoaded && loading}
            />
          </div>
        </div>

        {/* Lead 히트맵 캘린더 */}
        {isChannelLoaded && amHeatmap?.data && amHeatmap.data.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>AM별 Lead 히트맵</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '16px' }}>
              Account Owner 기준 일별 채널 리드 현황 · 색상 강도 = Lead 수
            </p>
            <LeadHeatmap
              data={amHeatmap.data}
              calendarMeta={amHeatmap.calendar}
              maxValue={amHeatmap.maxValue}
            />
          </div>
        )}

        {/* 담당자별 Lead 현황 */}
        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>담당자별 리드 현황</h2>
          {isChannelLoaded && clbo?.data ? (
            <DataTable
              columns={[
                { key: 'owner', header: '담당자' },
                { key: 'partner', header: '파트너 리드', align: 'right' as const },
                { key: 'franchise', header: '프랜차이즈 리드', align: 'right' as const },
                { key: 'total', header: '전체', align: 'right' as const, render: (v: number) => <span style={{ fontWeight: 700 }}>{v}</span> },
                { key: 'mql', header: 'MQL', align: 'right' as const },
                { key: 'sql', header: 'SQL', align: 'right' as const },
                { key: 'conversionRate', header: '전환율', align: 'right' as const, render: (v: string) => {
                  const num = parseFloat(v);
                  const bg = num >= 50 ? '#e8f5e9' : num >= 30 ? '#fff3e0' : '#ffebee';
                  const color = num >= 50 ? '#2e7d32' : num >= 30 ? '#e65100' : '#c62828';
                  return <span style={{ padding: '2px 8px', borderRadius: '4px', fontWeight: 600, background: bg, color }}>{v}%</span>;
                }},
              ]}
              data={clbo.data}
              loading={false}
            />
          ) : (
            <DataTable columns={channelAMColumns} data={am?.dailyLeadCount?.byOwner || []} loading={loading} />
          )}
        </div>

        {/* MOU 체결/안착률 (AE와 동일) */}
        {isChannelLoaded && mouData && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>MOU 체결 & 안착률</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '16px' }}>
              최근 3개월 MOU 체결 파트너/본사의 초기 안착 현황
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ background: '#f3e5f5', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#7b1fa2', marginBottom: '4px' }}>이번달 파트너 MOU</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#4a148c' }}>{mouData.partner?.thisMonth ?? 0}</div>
              </div>
              <div style={{ background: '#e8eaf6', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#283593', marginBottom: '4px' }}>이번달 본사 MOU</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: '#1a237e' }}>{mouData.franchiseHQ?.thisMonth ?? 0}</div>
              </div>
              <div style={{ background: '#e0f2f1', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#00695c', marginBottom: '4px' }}>파트너 안착률</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: parseFloat(mouData.onboarding?.partner?.rate || 0) >= 80 ? '#2e7d32' : '#e65100' }}>
                  {mouData.onboarding?.partner?.rate ?? 0}%
                </div>
                <div style={{ fontSize: '0.7em', color: '#888' }}>{mouData.onboarding?.partner?.settled ?? 0}/{mouData.onboarding?.partner?.total ?? 0}</div>
              </div>
              <div style={{ background: '#fce4ec', borderRadius: '8px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75em', color: '#880e4f', marginBottom: '4px' }}>브랜드 안착률</div>
                <div style={{ fontSize: '1.5em', fontWeight: 700, color: parseFloat(mouData.onboarding?.franchiseBrand?.rate || 0) >= 80 ? '#2e7d32' : '#e65100' }}>
                  {mouData.onboarding?.franchiseBrand?.rate ?? 0}%
                </div>
                <div style={{ fontSize: '0.7em', color: '#888' }}>{mouData.onboarding?.franchiseBrand?.settled ?? 0}/{mouData.onboarding?.franchiseBrand?.total ?? 0}</div>
              </div>
            </div>

            {/* 미안착 목록 — 리드 + Case + 소개매장 상세 */}
            {mouData.onboarding?.partner?.list && mouData.onboarding.partner.list.filter((p: any) => !p.isSettled).length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <h3 style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '4px', color: '#c62828' }}>미안착 파트너사</h3>
                <p style={{ color: '#888', fontSize: '0.78em', marginBottom: '12px' }}>
                  MOU 후 3개월 내 Lead 0건 · 소개 매장의 Case(장애) 현황 포함
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {mouData.onboarding.partner.list
                    .filter((p: any) => !p.isSettled)
                    .sort((a: any, b: any) => (b.totalCaseCount || 0) - (a.totalCaseCount || 0))
                    .map((p: any) => (
                      <div key={p.id || p.name} style={{
                        background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', padding: '12px',
                      }}>
                        {/* 파트너 헤더 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: '0.88em' }}>{p.name}</span>
                            <span style={{ fontSize: '0.75em', color: '#888', marginLeft: '8px' }}>{p.owner}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', fontSize: '0.72em', flexWrap: 'wrap' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#f3e5f5', color: '#7b1fa2', fontWeight: 600 }}>
                              MOU {p.mouStart?.substring(5) || '-'}
                            </span>
                            {(p.totalLeadCount ?? 0) > 0 && (
                              <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#fff8e1', color: '#e65100', fontWeight: 600 }}>
                                Lead {p.totalLeadCount}건
                              </span>
                            )}
                            {(p.referredStoreCount ?? 0) > 0 && (
                              <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#e3f2fd', color: '#1565c0', fontWeight: 600 }}>
                                🏪 소개매장 {p.referredStoreCount}곳
                              </span>
                            )}
                            {(p.totalCaseCount ?? 0) > 0 && (
                              <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#ffebee', color: '#b71c1c', fontWeight: 600 }}>
                                ⚠ Case {p.totalCaseCount}건
                              </span>
                            )}
                          </div>
                        </div>
                        {/* 안착 기한 */}
                        <div style={{ fontSize: '0.72em', color: '#999', marginBottom: '8px' }}>
                          안착 기한: {p.mouStart} ~ {p.mouEndWindow}
                        </div>
                        {/* 리드(PartnerName__c) 기반 상세 */}
                        {p.leadDetails && p.leadDetails.length > 0 && (
                          <div style={{ fontSize: '0.78em', marginBottom: '8px' }}>
                            <div style={{ fontSize: '0.85em', fontWeight: 600, color: '#666', marginBottom: '4px' }}>📋 Lead 기반 소개</div>
                            {p.leadDetails.map((lead: any, idx: number) => (
                              <div key={lead.id || idx} style={{
                                padding: '6px 10px', borderRadius: '6px', marginBottom: '4px',
                                background: lead.isPreMou ? '#fff3e0' : '#f5f5f5',
                                border: lead.caseCount > 0 ? '1px solid #ffcdd2' : '1px solid #eee',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{lead.company}</span>
                                    <span style={{ color: '#888', marginLeft: '8px' }}>{lead.createdDate}</span>
                                    {lead.isPreMou && (
                                      <span style={{ marginLeft: '6px', fontSize: '0.85em', color: '#e65100', fontWeight: 600 }}>MOU 전</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <span style={{
                                      padding: '1px 6px', borderRadius: '8px', fontSize: '0.85em',
                                      background: lead.isConverted ? '#e8f5e9' : '#f5f5f5',
                                      color: lead.isConverted ? '#2e7d32' : '#999',
                                    }}>
                                      {lead.status}
                                    </span>
                                    {lead.caseCount > 0 && (
                                      <span style={{ padding: '1px 6px', borderRadius: '8px', fontSize: '0.85em', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>
                                        Case {lead.caseCount}건
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {lead.caseSummary && lead.caseSummary.length > 0 && (
                                  <div style={{ marginTop: '4px', paddingLeft: '12px', borderLeft: '2px solid #ffcdd2' }}>
                                    {lead.caseSummary.map((c: any, ci: number) => (
                                      <div key={ci} style={{ fontSize: '0.9em', color: '#666', marginBottom: '2px' }}>
                                        <span style={{ color: '#c62828', fontWeight: 500 }}>{c.type}</span>
                                        {c.type2 !== '-' && <span> › {c.type2}</span>}
                                        {c.type3 !== '-' && <span> › {c.type3}</span>}
                                        <span style={{ color: '#999', marginLeft: '6px' }}>{c.createdDate}</span>
                                        <span style={{ marginLeft: '6px', color: c.status === 'Closed' ? '#999' : '#e65100' }}>{c.status}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* AccountPartner__c 기반 소개 매장 */}
                        {p.storeDetails && p.storeDetails.length > 0 && (
                          <div style={{ fontSize: '0.78em' }}>
                            <div style={{ fontSize: '0.85em', fontWeight: 600, color: '#1565c0', marginBottom: '4px' }}>🏪 소개 매장</div>
                            {p.storeDetails.map((store: any, idx: number) => (
                              <div key={store.storeId || idx} style={{
                                padding: '6px 10px', borderRadius: '6px', marginBottom: '4px',
                                background: '#e3f2fd',
                                border: store.caseCount > 0 ? '1px solid #ffcdd2' : '1px solid #bbdefb',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{store.storeName}</span>
                                    <span style={{ color: '#888', marginLeft: '8px' }}>{store.createdDate}</span>
                                  </div>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    {store.caseCount > 0 && (
                                      <span style={{ padding: '1px 6px', borderRadius: '8px', fontSize: '0.85em', background: '#ffebee', color: '#c62828', fontWeight: 600 }}>
                                        Case {store.caseCount}건
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {store.caseSummary && store.caseSummary.length > 0 && (
                                  <div style={{ marginTop: '4px', paddingLeft: '12px', borderLeft: '2px solid #ffcdd2' }}>
                                    {store.caseSummary.map((c: any, ci: number) => (
                                      <div key={ci} style={{ fontSize: '0.9em', color: '#666', marginBottom: '2px' }}>
                                        <span style={{ color: '#c62828', fontWeight: 500 }}>{c.type}</span>
                                        {c.type2 !== '-' && <span> › {c.type2}</span>}
                                        {c.type3 !== '-' && <span> › {c.type3}</span>}
                                        <span style={{ color: '#999', marginLeft: '6px' }}>{c.createdDate}</span>
                                        <span style={{ marginLeft: '6px', color: c.status === 'Closed' ? '#999' : '#e65100' }}>{c.status}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* 소개 이력 없음 */}
                        {(!p.leadDetails || p.leadDetails.length === 0) && (!p.storeDetails || p.storeDetails.length === 0) && (
                          <div style={{ color: '#bbb', fontSize: '0.78em' }}>소개 이력 없음</div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 활동 파트너사 — 일별 Lead + 미팅 */}
        {isChannelLoaded && channelData?.activePartnerThisMonth && channelData.activePartnerThisMonth.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>이번달 활동 파트너사</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '12px' }}>
              이번달 Lead가 발생한 파트너사 ({channelData.activePartnerThisMonth.length}개) · 일별 Lead & 미팅 현황
            </p>
            {/* 범례 */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', fontSize: '0.75em', color: '#666' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#ffb300' }} />
                Lead
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#1976d2' }} />
                미팅
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#f0f0f0' }} />
                없음
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#fafafa', border: '1px dashed #ddd' }} />
                주말
              </div>
            </div>
            {/* 파트너 카드 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {channelData.activePartnerThisMonth
                .sort((a: any, b: any) => (b.thisMonthLeadCount || 0) - (a.thisMonthLeadCount || 0))
                .map((partner: any) => {
                  const activity = partner.dailyActivity || [];
                  const maxLead = Math.max(...activity.map((d: any) => d.leads), 1);
                  return (
                    <div key={partner.id || partner.name} style={{
                      background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0',
                      padding: '12px', overflow: 'hidden',
                    }}>
                      {/* 헤더 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.88em', color: '#333' }}>{partner.name}</span>
                          <span style={{ fontSize: '0.75em', color: '#888', marginLeft: '8px' }}>{partner.owner}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', fontSize: '0.72em' }}>
                          <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#fff8e1', color: '#e65100', fontWeight: 600 }}>
                            Lead {partner.thisMonthLeadCount ?? 0}
                          </span>
                          {(partner.meetingCount ?? 0) > 0 && (
                            <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#e3f2fd', color: '#1565c0', fontWeight: 600 }}>
                              미팅 {partner.meetingCount}
                            </span>
                          )}
                          <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#f5f5f5', color: '#666' }}>
                            3개월 {partner.last3MonthLeadCount ?? 0}
                          </span>
                        </div>
                      </div>
                      {/* 일별 타임라인 */}
                      {activity.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ display: 'flex', gap: '2px', minWidth: 'fit-content' }}>
                            {activity.map((d: any) => {
                              const dayOfWeek = new Date(new Date().getFullYear(), new Date().getMonth(), d.day).getDay();
                              const dayLabel = ['일','월','화','수','목','금','토'][dayOfWeek];
                              const isSun = dayOfWeek === 0;
                              const isSat = dayOfWeek === 6;
                              // Lead 색상
                              let leadBg = d.isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.leads > 0) {
                                const intensity = d.leads / maxLead;
                                leadBg = intensity <= 0.3 ? '#fff8e1' : intensity <= 0.6 ? '#ffe082' : '#ffb300';
                              }
                              // 미팅 색상
                              let meetBg = d.isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.meetings > 0) {
                                meetBg = d.meetings >= 2 ? '#1565c0' : '#42a5f5';
                              }
                              return (
                                <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: '28px' }}>
                                  {/* 날짜 */}
                                  <div style={{
                                    fontSize: '0.6em', fontWeight: 500, color: isSun ? '#e53935' : isSat ? '#1565c0' : '#999',
                                    lineHeight: 1.2,
                                  }}>
                                    {d.day}
                                  </div>
                                  {/* 요일 */}
                                  <div style={{
                                    fontSize: '0.5em', color: isSun ? '#e53935' : isSat ? '#1565c0' : '#bbb',
                                    lineHeight: 1, marginBottom: '2px',
                                  }}>
                                    {dayLabel}
                                  </div>
                                  {/* Lead 셀 */}
                                  <div title={`${d.day}일: Lead ${d.leads}건`} style={{
                                    width: '26px', height: '20px', borderRadius: '3px',
                                    background: leadBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.65em', fontWeight: d.leads > 0 ? 700 : 400,
                                    color: d.leads > 0 ? (leadBg === '#ffb300' ? '#fff' : '#e65100') : (d.isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.leads > 0 ? d.leads : (d.isWeekend ? '' : '·')}
                                  </div>
                                  {/* 미팅 셀 */}
                                  <div title={`${d.day}일: 미팅 ${d.meetings}건`} style={{
                                    width: '26px', height: '20px', borderRadius: '3px',
                                    background: meetBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.65em', fontWeight: d.meetings > 0 ? 700 : 400,
                                    color: d.meetings > 0 ? '#fff' : (d.isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.meetings > 0 ? d.meetings : (d.isWeekend ? '' : '·')}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* 행 라벨 */}
                          <div style={{ display: 'flex', gap: '2px', marginTop: '2px' }}>
                            <div style={{ fontSize: '0.55em', color: '#e65100', fontWeight: 600, width: '28px', textAlign: 'center' }}>Lead</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#ccc', fontSize: '0.8em', textAlign: 'center', padding: '8px' }}>데이터 없음</div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* 활동 프랜차이즈 본사 — 일별 Lead + 미팅 */}
        {isChannelLoaded && channelData?.activeHQThisMonth && channelData.activeHQThisMonth.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>이번달 활동 프랜차이즈 본사</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '12px' }}>
              이번달 Lead가 발생한 프랜차이즈 본사 ({channelData.activeHQThisMonth.length}개) · 일별 Lead & 미팅 현황
            </p>
            {/* 범례 */}
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', fontSize: '0.75em', color: '#666' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#ffb300' }} />
                Lead
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#1976d2' }} />
                미팅
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#f0f0f0' }} />
                없음
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#fafafa', border: '1px dashed #ddd' }} />
                주말
              </div>
            </div>
            {/* 본사 카드 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {channelData.activeHQThisMonth
                .sort((a: any, b: any) => (b.thisMonthLeadCount || 0) - (a.thisMonthLeadCount || 0))
                .map((hq: any) => {
                  const activity = hq.dailyActivity || [];
                  const maxLead = Math.max(...activity.map((d: any) => d.leads), 1);
                  return (
                    <div key={hq.hqId || hq.hqName} style={{
                      background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0',
                      padding: '12px', overflow: 'hidden',
                    }}>
                      {/* 헤더 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.88em', color: '#333' }}>{hq.hqName}</span>
                          <span style={{ fontSize: '0.75em', color: '#888', marginLeft: '8px' }}>{hq.owner}</span>
                          <span style={{ fontSize: '0.68em', color: '#aaa', marginLeft: '6px' }}>({hq.brands?.length ?? 0}개 브랜드)</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', fontSize: '0.72em' }}>
                          <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#fff8e1', color: '#e65100', fontWeight: 600 }}>
                            Lead {hq.thisMonthLeadCount ?? 0}
                          </span>
                          {(hq.meetingCount ?? 0) > 0 && (
                            <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#e3f2fd', color: '#1565c0', fontWeight: 600 }}>
                              미팅 {hq.meetingCount}
                            </span>
                          )}
                          <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#f5f5f5', color: '#666' }}>
                            3개월 {hq.last3MonthLeadCount ?? 0}
                          </span>
                        </div>
                      </div>
                      {/* 일별 타임라인 */}
                      {activity.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                          <div style={{ display: 'flex', gap: '2px', minWidth: 'fit-content' }}>
                            {activity.map((d: any) => {
                              const dayOfWeek = new Date(new Date().getFullYear(), new Date().getMonth(), d.day).getDay();
                              const dayLabel = ['일','월','화','수','목','금','토'][dayOfWeek];
                              const isSun = dayOfWeek === 0;
                              const isSat = dayOfWeek === 6;
                              // Lead 색상
                              let leadBg = d.isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.leads > 0) {
                                const intensity = d.leads / maxLead;
                                leadBg = intensity <= 0.3 ? '#fff8e1' : intensity <= 0.6 ? '#ffe082' : '#ffb300';
                              }
                              // 미팅 색상
                              let meetBg = d.isWeekend ? '#fafafa' : '#f0f0f0';
                              if (d.meetings > 0) {
                                meetBg = d.meetings >= 2 ? '#1565c0' : '#42a5f5';
                              }
                              return (
                                <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: '28px' }}>
                                  {/* 날짜 */}
                                  <div style={{
                                    fontSize: '0.6em', fontWeight: 500, color: isSun ? '#e53935' : isSat ? '#1565c0' : '#999',
                                    lineHeight: 1.2,
                                  }}>
                                    {d.day}
                                  </div>
                                  {/* 요일 */}
                                  <div style={{
                                    fontSize: '0.5em', color: isSun ? '#e53935' : isSat ? '#1565c0' : '#bbb',
                                    lineHeight: 1, marginBottom: '2px',
                                  }}>
                                    {dayLabel}
                                  </div>
                                  {/* Lead 셀 */}
                                  <div title={`${d.day}일: Lead ${d.leads}건`} style={{
                                    width: '26px', height: '20px', borderRadius: '3px',
                                    background: leadBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.65em', fontWeight: d.leads > 0 ? 700 : 400,
                                    color: d.leads > 0 ? (leadBg === '#ffb300' ? '#fff' : '#e65100') : (d.isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.leads > 0 ? d.leads : (d.isWeekend ? '' : '·')}
                                  </div>
                                  {/* 미팅 셀 */}
                                  <div title={`${d.day}일: 미팅 ${d.meetings}건`} style={{
                                    width: '26px', height: '20px', borderRadius: '3px',
                                    background: meetBg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.65em', fontWeight: d.meetings > 0 ? 700 : 400,
                                    color: d.meetings > 0 ? '#fff' : (d.isWeekend ? 'transparent' : '#ddd'),
                                  }}>
                                    {d.meetings > 0 ? d.meetings : (d.isWeekend ? '' : '·')}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* 행 라벨 */}
                          <div style={{ display: 'flex', gap: '2px', marginTop: '2px' }}>
                            <div style={{ fontSize: '0.55em', color: '#e65100', fontWeight: 600, width: '28px', textAlign: 'center' }}>Lead</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#ccc', fontSize: '0.8em', textAlign: 'center', padding: '8px' }}>데이터 없음</div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* 파이프라인 — 숨김 처리 */}
        {false && isChannelLoaded && pipelineData?.ownerPipelineStats && pipelineData.ownerPipelineStats.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '4px' }}>파이프라인 현황</h2>
            <p style={{ color: '#888', fontSize: '0.82em', marginBottom: '16px' }}>
              담당자별 Lead → 전환 → Opp → CW/CL
            </p>
            <DataTable
              columns={[
                { key: 'name', header: '담당자' },
                { key: 'leadsThisMonth', header: 'Lead', align: 'right' as const },
                { key: 'leadsConverted', header: '전환', align: 'right' as const },
                { key: 'openOpps', header: 'Open Opp', align: 'right' as const },
                { key: 'cwThisMonth', header: 'CW', align: 'right' as const, render: (v: number) => (
                  <span style={{ fontWeight: 700, color: v > 0 ? '#2e7d32' : '#ccc' }}>{v}</span>
                )},
                { key: 'clThisMonth', header: 'CL', align: 'right' as const, render: (v: number) => (
                  <span style={{ color: v > 0 ? '#c62828' : '#ccc' }}>{v}</span>
                )},
                { key: 'winRate', header: 'Win Rate', align: 'right' as const, render: (_: any, row: any) => {
                  const total = (row.cwThisMonth || 0) + (row.clThisMonth || 0);
                  if (total === 0) return <span style={{ color: '#ccc' }}>-</span>;
                  const rate = ((row.cwThisMonth / total) * 100).toFixed(0);
                  return <span style={{ fontWeight: 600 }}>{rate}%</span>;
                }},
              ]}
              data={pipelineData.ownerPipelineStats}
              loading={false}
            />
          </div>
        )}
      </>
    );
  }

  function renderChannelTM() {
    const isDaily = data?.periodType === 'daily';
    const isWeekly = data?.periodType === 'weekly';
    return (
      <>
        {/* 월별/주별 모드: 채널 TM 일별 추이 — 숨김 처리 */}
        {false && !isDaily && !isWeekly && dailyTrends && dailyTrends.length > 0 && (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ marginBottom: '4px' }}>일별 프로세스 추이</h2>
              <p style={{ color: '#888', fontSize: '0.85em' }}>
                채널 TM 지표의 일별 변화 · 문제 일자를 클릭하면 해당일 Raw 데이터로 이동합니다
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <DailyTrendPanel
                title="FRT 20분 초과"
                subtitle="목표: 0건"
                color="#ff9800"
                valueKey="tmFrtOver20"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.channelTM.frtOver20,
                }))}
                targetValue={0}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value > 0}
                problemLabel="FRT 초과"
                problemColor="#e53935"
              />
              <DailyTrendPanel
                title="영업기회 전환"
                subtitle="목표: 5건 이상"
                color="#1565c0"
                valueKey="tmConversion"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.channelTM.dailyConversion,
                }))}
                targetValue={5}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value < 5}
                problemLabel="미달"
                problemColor="#e65100"
              />
              <DailyTrendPanel
                title="MQL 미전환"
                subtitle="목표: 0건"
                color="#c62828"
                valueKey="tmUnconvertedMQL"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.channelTM.unconvertedMQL,
                }))}
                targetValue={0}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value > 0}
                problemLabel="미전환"
                problemColor="#c62828"
              />
            </div>
          </div>
        )}

        {/* 프로세스 플로우: 과정 지표 → 결과 */}
        {(() => {
          const frtOver20 = tm?.frt?.frtOver20 ?? 0;
          const frtOk = tm?.frt?.frtOk ?? 0;
          const frtTotal = tm?.frt?.totalWithTask ?? 0;
          // 핵심 KPI: 방문배정 + 견적 합산 인당 일평균
          const dc = tm?.dailyConversion || {};
          const avgDailyPerPerson = dc.avgDailyPerPerson ?? 0;
          const totalActions = dc.total ?? 0;
          const visitAssigned = dc.visitAssigned ?? 0;
          const quoteTransitions = dc.quoteTransitions ?? 0;
          const tmMemberCount = dc.tmMemberCount ?? 1;
          // 미전환
          const unconvertedCount = tm?.unconvertedMQL?.count ?? 0;
          // TM 구간 WIP
          const over7 = tm?.sqlBacklog?.over7 ?? 0;
          const openTotal = tm?.sqlBacklog?.openTotal ?? 0;

          const chTmFlowSteps = [
            {
              label: '인당 전환',
              value: `${avgDailyPerPerson}건/일`,
              detail: `방문${visitAssigned} + 견적${quoteTransitions} = ${totalActions}건 (${tmMemberCount}명)`,
              target: '인당 5건/일',
              met: avgDailyPerPerson >= 5,
              color: '#00897b',
            },
            {
              label: 'FRT 20분 초과',
              value: `${frtOver20}건`,
              detail: `${frtOk} / ${frtTotal}건`,
              target: '0건',
              met: frtOver20 === 0,
              color: '#0078d4',
            },
            {
              label: 'MQL 미전환',
              value: `${unconvertedCount}건`,
              detail: `MQL ${tm?.unconvertedMQL?.funnel?.mql ?? 0} → SQL ${tm?.unconvertedMQL?.funnel?.sql ?? 0}`,
              target: '0건',
              met: unconvertedCount === 0,
              color: '#e65100',
            },
          ];

          const chTmResultStep = {
            label: 'SQL 잔량 (7일+)',
            value: `${over7}건`,
            detail: `TM 구간(방문~견적) ${openTotal}건 중`,
            target: '≤10건',
            met: over7 <= 10,
          };

          return (
            <div className="metro-card">
              <h2 style={{ marginBottom: '8px' }}>Lead → SQL 전환 프로세스</h2>
              <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '24px' }}>과정 지표가 결과(SQL 잔량 관리)를 만듭니다</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0', padding: '0 10px' }}>
                {chTmFlowSteps.map((step, i) => (
                  <React.Fragment key={step.label}>
                    <div style={{
                      flex: 1,
                      background: step.met ? `${step.color}12` : '#fff5f5',
                      border: `2px solid ${step.met ? step.color : '#e53935'}`,
                      borderRadius: '12px',
                      padding: '20px 16px',
                      textAlign: 'center',
                      position: 'relative',
                    }}>
                      <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        과정 {i + 1}
                      </div>
                      <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                        {step.label}
                      </div>
                      <div style={{ fontSize: '1.8em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                        {step.value}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#666', marginTop: '6px' }}>{step.detail}</div>
                      <div style={{
                        marginTop: '10px',
                        fontSize: '0.72em',
                        padding: '3px 10px',
                        borderRadius: '10px',
                        display: 'inline-block',
                        background: step.met ? '#e8f5e9' : '#ffebee',
                        color: step.met ? '#2e7d32' : '#c62828',
                      }}>
                        목표: {step.target}
                      </div>
                    </div>
                    <div style={{
                      width: '40px', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#bbb', fontSize: '1.4em',
                    }}>
                      →
                    </div>
                  </React.Fragment>
                ))}
                <div style={{
                  flex: 1.2,
                  background: chTmResultStep.met ? 'linear-gradient(135deg, #1565c0, #0d47a1)' : 'linear-gradient(135deg, #c62828, #b71c1c)',
                  borderRadius: '12px',
                  padding: '20px 16px',
                  textAlign: 'center',
                  color: '#fff',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                }}>
                  <div style={{ fontSize: '0.75em', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.85 }}>
                    결과
                  </div>
                  <div style={{ fontSize: '0.95em', fontWeight: 600, marginBottom: '8px' }}>
                    {chTmResultStep.label}
                  </div>
                  <div style={{ fontSize: '2.2em', fontWeight: 700, lineHeight: 1.1 }}>
                    {chTmResultStep.value}
                  </div>
                  <div style={{ fontSize: '0.8em', marginTop: '6px', opacity: 0.85 }}>{chTmResultStep.detail}</div>
                  <div style={{
                    marginTop: '10px',
                    fontSize: '0.72em',
                    padding: '3px 10px',
                    borderRadius: '10px',
                    display: 'inline-block',
                    background: 'rgba(255,255,255,0.2)',
                  }}>
                    목표: {chTmResultStep.target}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 담당자별 KPI 카드 */}
        {tm?.byOwner && (() => {
          const owners = (tm.byOwner as any[]).filter((o: any) => isDaily ? o.lead >= 1 : o.lead >= 5);
          if (owners.length === 0) return null;
          return (
            <div className="metro-card" style={{ padding: '24px' }}>
              <h2 style={{ marginBottom: '8px' }}>담당자별 KPI 요약{isWeekly ? ' (주간 합산)' : ''}</h2>
              <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '20px' }}>
                각 담당자의 핵심 지표를 한눈에 확인합니다
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {owners.map((owner: any) => {
                  const avgActions = owner.avgDailyActions ?? 0;
                  const metrics = [
                    { label: 'Lead', value: owner.lead ?? 0, unit: '건', color: '#1565c0', bg: '#e3f2fd' },
                    { label: 'MQL', value: owner.mql ?? 0, unit: '건', color: '#6a1b9a', bg: '#f3e5f5' },
                    { label: 'SQL', value: owner.sql ?? 0, unit: '건', color: '#00695c', bg: '#e0f2f1' },
                    { label: '방문배정', value: owner.converted ?? 0, unit: '건', color: '#2e7d32', bg: '#e8f5e9' },
                    { label: '견적발송', value: owner.quoteTransitions ?? 0, unit: '건', color: '#00838f', bg: '#e0f7fa' },
                    {
                      label: '인당일평균',
                      value: avgActions,
                      unit: '건/일',
                      color: avgActions >= 5 ? '#2e7d32' : avgActions >= 3 ? '#e65100' : '#c62828',
                      bg: avgActions >= 5 ? '#e8f5e9' : avgActions >= 3 ? '#fff3e0' : '#ffebee',
                      target: '5건/일',
                    },
                    {
                      label: 'FRT 초과',
                      value: owner.frtOver20 ?? 0,
                      unit: '건',
                      color: (owner.frtOver20 ?? 0) === 0 ? '#2e7d32' : '#c62828',
                      bg: (owner.frtOver20 ?? 0) === 0 ? '#e8f5e9' : '#ffebee',
                      target: '0건',
                    },
                    {
                      label: '미전환MQL',
                      value: owner.unconvertedMQL ?? 0,
                      unit: '건',
                      color: (owner.unconvertedMQL ?? 0) === 0 ? '#2e7d32' : '#e65100',
                      bg: (owner.unconvertedMQL ?? 0) === 0 ? '#e8f5e9' : '#fff3e0',
                      target: '0건',
                    },
                  ];
                  return (
                    <div key={owner.userId || owner.name} style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: '#fff',
                    }}>
                      {/* 담당자 헤더 */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 20px',
                        background: 'linear-gradient(135deg, #37474f, #455a64)',
                        color: '#fff',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '50%',
                            background: 'rgba(255,255,255,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.95em', fontWeight: 700,
                          }}>
                            {owner.name?.charAt(0) || '?'}
                          </div>
                          <span style={{ fontSize: '1.05em', fontWeight: 700 }}>{owner.name}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            padding: '4px 12px', borderRadius: '20px', fontSize: '0.82em', fontWeight: 600,
                            background: (owner.converted ?? 0) >= 5 ? 'rgba(76,175,80,0.3)' : (owner.converted ?? 0) >= 3 ? 'rgba(255,152,0,0.3)' : 'rgba(244,67,54,0.3)',
                            color: '#fff',
                          }}>
                            전환 {owner.converted ?? 0}건
                          </span>
                        </div>
                      </div>
                      {/* 메트릭 그리드 — 8개 항목 1줄 */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${metrics.length}, 1fr)`,
                        gap: '1px',
                        background: '#f0f0f0',
                      }}>
                        {metrics.map((m, i) => (
                          <div key={i} style={{
                            padding: '10px 6px',
                            background: '#fff',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: '0.7em', color: '#888', marginBottom: '4px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                              {m.label}
                            </div>
                            <div style={{
                              fontSize: '1.1em', fontWeight: 700, color: m.color,
                              marginBottom: '2px', whiteSpace: 'nowrap',
                            }}>
                              {typeof m.value === 'number' ? `${m.value}${m.unit || ''}` : m.value}
                            </div>
                            {m.target && (
                              <div style={{ fontSize: '0.65em', color: '#aaa', whiteSpace: 'nowrap' }}>목표 {m.target}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 담당자별 상세 - 월간에서만 표시 (주간은 일별 TM 상세로 대체) */}
        {!isWeekly && (
        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>담당자별 상세</h2>
          <DataTable columns={channelTMColumns} data={tm?.byOwner?.filter((o: any) => isDaily ? o.lead >= 1 : o.lead >= 5) || []} loading={loading} />
        </div>
        )}

        {/* 주차별 모드: 일별 TM 상세 데이터 */}
        {isWeekly && tm?.dailyDetails?.length > 0 && (() => {
          // 채널 TM Raw 데이터 컬럼 정의 (Inside Sales 패턴)
          const chTmSfLink = (name: string, row: any) => row.leadId ? (
            <a href={`https://torder.lightning.force.com/lightning/r/Lead/${row.leadId}/view`} target="_blank" rel="noopener noreferrer"
              style={{ color: '#1565c0', textDecoration: 'none', borderBottom: '1px dashed #90caf9' }}
            >{name}</a>
          ) : name;
          const chTmStatusBadge = (v: string) => {
            if (!v || v === '-') return '-';
            const colors: Record<string, { bg: string; color: string }> = {
              'MQL': { bg: '#e3f2fd', color: '#1565c0' }, 'SQL': { bg: '#e8f5e9', color: '#2e7d32' },
              'Qualified': { bg: '#e8f5e9', color: '#2e7d32' }, 'Recycled': { bg: '#fff3e0', color: '#e65100' },
              'Unqualified': { bg: '#fce4ec', color: '#c62828' }, '종료': { bg: '#eceff1', color: '#546e7a' },
            };
            const style = colors[v] || { bg: '#f5f5f5', color: '#666' };
            return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: style.bg, color: style.color, whiteSpace: 'nowrap' as const }}>{v}</span>;
          };
          const chTmFrtBadge = (v: number) => {
            if (!v && v !== 0) return '-';
            const bg = v >= 60 ? '#b71c1c' : v >= 30 ? '#e53935' : '#ff7043';
            return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.88em', fontWeight: 700, background: bg, color: '#fff', whiteSpace: 'nowrap' as const }}>{fmtFrt(v)}</span>;
          };
          const chTmGroupLabel = (_: any, row: any) => {
            if (row.group === 'qualified') return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8em', fontWeight: 600, background: '#e8f5e9', color: '#2e7d32' }}>전환</span>;
            if (row.group === 'closed') return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8em', fontWeight: 600, background: '#eceff1', color: '#546e7a' }}>종료</span>;
            return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.8em', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>계류</span>;
          };
          const chTmReasonBadge = (v: string) => {
            if (!v || v === '-') return <span style={{ color: '#ccc' }}>-</span>;
            return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: '#fce4ec', color: '#c62828', whiteSpace: 'nowrap' as const }}>{v}</span>;
          };
          const chTmNextTaskRender = (_: any, row: any) => {
            if (row.group === 'closed' || row.group === 'qualified') return <span style={{ color: '#ccc' }}>-</span>;
            if (!row.hasOpenTask) return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 700, background: '#ffebee', color: '#c62828', whiteSpace: 'nowrap' as const }}>과업 없음</span>;
            return <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: '#e8f5e9', color: '#2e7d32', whiteSpace: 'nowrap' as const }}>{row.nextTaskSubject !== '-' ? row.nextTaskSubject : '있음'}{row.nextTaskDate && row.nextTaskDate !== '-' ? ` (${row.nextTaskDate})` : ''}</span>;
          };
          const chTmTaskCountBadge = (v: number) => {
            const count = v ?? 0;
            return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 600, background: count === 0 ? '#ffebee' : '#f5f5f5', color: count === 0 ? '#c62828' : '#333' }}>{count}건</span>;
          };

          const chTmFrtColumns = [
            { key: 'group', header: '구분', render: chTmGroupLabel },
            { key: 'name', header: '이름', render: chTmSfLink },
            { key: 'company', header: '회사명' },
            { key: 'owner', header: '담당자', render: (v: string) => <span style={{ fontWeight: 600, color: '#222' }}>{v || '-'}</span> },
            { key: 'status', header: '상태', render: (v: string) => chTmStatusBadge(v) },
            { key: 'frtMinutes', header: 'FRT', align: 'right' as const, render: (v: number) => chTmFrtBadge(v) },
            { key: 'lossReason', header: '종료사유', render: (v: string) => chTmReasonBadge(v) },
            { key: 'nextTask', header: '다음 과업', render: chTmNextTaskRender },
            { key: 'lastTaskDate', header: '최근터치' },
            { key: 'taskCount', header: 'Task', align: 'right' as const, render: (v: number) => chTmTaskCountBadge(v) },
          ];
          const chTmMqlColumns = [
            { key: 'group', header: '구분', render: chTmGroupLabel },
            { key: 'name', header: '이름', render: chTmSfLink },
            { key: 'company', header: '회사명' },
            { key: 'owner', header: '담당자', render: (v: string) => <span style={{ fontWeight: 600, color: '#222' }}>{v || '-'}</span> },
            { key: 'status', header: '상태', render: (v: string) => chTmStatusBadge(v) },
            { key: 'lossReason', header: '종료사유', render: (v: string) => chTmReasonBadge(v) },
            { key: 'nextTask', header: '다음 과업', render: chTmNextTaskRender },
            { key: 'lastTaskDate', header: '최근터치' },
            { key: 'taskCount', header: 'Task', align: 'right' as const, render: (v: number) => chTmTaskCountBadge(v) },
          ];

          return (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <h2 style={{ marginBottom: '4px' }}>일별 TM 상세</h2>
            <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '16px' }}>
              주간 내 각 일자별 담당자 실적 및 Raw 데이터 · {tm.dailyDetails.length}일
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {(tm.dailyDetails as any[]).map((day: any, idx: number) => {
                const dc = day.dailyConversion;
                const frt = day.frt;
                const mql = day.unconvertedMQL;
                const owners = (day.byOwner || []).filter((o: any) => o.lead > 0);
                const rd = day.rawData || {};
                const frtCount = rd.frtOver20?.length || 0;
                const mqlCount = rd.unconvertedMQL?.length || 0;
                const totalRaw = frtCount + mqlCount;
                return (
                  <div key={idx} style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                    {/* 일자 헤더 + 핵심 요약 */}
                    <div style={{
                      padding: '10px 16px',
                      background: day.dayOfWeek === 0 || day.dayOfWeek === 6 ? '#fff3e0' : '#e3f2fd',
                      borderBottom: '1px solid #e0e0e0',
                      display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' as const,
                    }}>
                      <span style={{ fontWeight: 700, fontSize: '1em' }}>
                        {day.date} ({day.dayName})
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: (dc?.total || 0) >= 5 ? '#e8f5e9' : '#fce4ec',
                        color: (dc?.total || 0) >= 5 ? '#2e7d32' : '#c62828',
                      }}>
                        전환 {dc?.total ?? 0}건
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: (frt?.frtOver20 || 0) === 0 ? '#e8f5e9' : '#fce4ec',
                        color: (frt?.frtOver20 || 0) === 0 ? '#2e7d32' : '#c62828',
                      }}>
                        FRT초과 {frt?.frtOver20 ?? 0}건
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
                        background: (mql?.count || 0) === 0 ? '#e8f5e9' : '#fff3e0',
                        color: (mql?.count || 0) === 0 ? '#2e7d32' : '#e65100',
                      }}>
                        미전환 {mql?.count ?? 0}건
                      </span>
                      <span style={{ fontSize: '0.82em', color: '#666' }}>
                        Lead {dc?.lead ?? 0} → MQL {dc?.mql ?? 0} → SQL {dc?.sql ?? 0}
                      </span>
                    </div>
                    {/* byOwner 테이블 */}
                    {owners.length > 0 && (
                      <div style={{ padding: '0' }}>
                        <DataTable
                          columns={channelTMColumns}
                          data={owners}
                          loading={false}
                        />
                      </div>
                    )}
                    {/* Raw 데이터 (문제건 상세) */}
                    {totalRaw > 0 && (
                      <div style={{ padding: '8px 16px', borderTop: '1px solid #e0e0e0', background: '#fff8f0' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '8px' }}>
                          {frtCount > 0 && (
                            <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#fce4ec', color: '#c62828' }}>
                              FRT초과 {frtCount}건
                            </span>
                          )}
                          {mqlCount > 0 && (
                            <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600, background: '#fff3e0', color: '#e65100' }}>
                              미전환 {mqlCount}건
                            </span>
                          )}
                        </div>
                        {frtCount > 0 && (
                          <DataTable columns={chTmFrtColumns} data={rd.frtOver20} loading={false} className="daily-raw daily-raw-red" />
                        )}
                        {mqlCount > 0 && (
                          <div style={{ marginTop: frtCount > 0 ? '8px' : '0' }}>
                            <DataTable columns={chTmMqlColumns} data={rd.unconvertedMQL} loading={false} className="daily-raw daily-raw-orange" />
                          </div>
                        )}
                      </div>
                    )}
                    {owners.length === 0 && totalRaw === 0 && (
                      <div style={{ padding: '12px 16px', color: '#999', fontSize: '0.88em' }}>
                        해당일 데이터 없음
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          );
        })()}

        {/* Raw Data: 채널 TM 진행중 Opportunity (방문배정/견적/재견적) */}
        {tm?.rawData?.rawOpenOpps?.length > 0 && (() => {
          const stageGroups = groupOppsByStage(tm.rawData.rawOpenOpps);
          return (
            <div className="metro-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ marginBottom: '4px' }}>진행중 Opportunity 상세 (TM 단계)</h2>
                  <p style={{ color: '#888', fontSize: '0.85em', margin: 0 }}>
                    방문배정 ~ 견적 단계 · 견적 전송까지 TM 책임
                  </p>
                </div>
                <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#1565c0' }}>
                  {tm.rawData.rawOpenOpps.length}건
                </span>
              </div>
              {stageGroups.map((g: any) => (
                <div key={g.stage} style={{ marginBottom: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: g.color }} />
                    <span style={{ fontWeight: 700, color: g.color }}>{g.stage}</span>
                    <span style={{ fontSize: '0.85em', color: '#999' }}>{g.items.length}건</span>
                  </div>
                  <DataTable columns={chRawOpenOppColumns_TM} data={g.items} loading={loading} className="daily-raw daily-raw-teal" />
                </div>
              ))}
            </div>
          );
        })()}
      </>
    );
  }

  function renderChannelBO() {
    const isDaily = data?.periodType === 'daily';
    const isWeekly = data?.periodType === 'weekly';
    const rawCboUsers = cbo?.cwConversionRate?.byUser || [];
    const cboContractByBO: Record<string, any> = {};
    (cbo?.contractSummary?.byBO || []).forEach((b: any) => { cboContractByBO[b.name] = b; });
    const cboCwByBO: Record<string, any> = {};
    (cbo?.cwWithCarryover?.byUser || []).forEach((u: any) => { cboCwByBO[u.name] = u; });
    const cboDcByBO: Record<string, any> = {};
    (cbo?.dailyClose?.byUser || []).forEach((u: any) => { cboDcByBO[u.name] = u; });
    const cboBacklogByUser: Record<string, any> = {};
    (cbo?.sqlBacklog?.byUser || []).forEach((b: any) => { cboBacklogByUser[b.name] = b; });
    const allUsers = rawCboUsers.map((u: any) => {
      const ct = cboContractByBO[u.name] || {};
      const cwu = cboCwByBO[u.name] || {};
      const dc = cboDcByBO[u.name] || {};
      const tmCW = u.thisMonthCW ?? 0;
      const tmCL = u.thisMonthCL ?? 0;
      const coCW = u.carryoverCW ?? 0;
      const coCL = u.carryoverCL ?? 0;
      const allCW = tmCW + coCW;
      return {
        ...u,
        thisMonthCWRate: u.cwRate ?? 0,
        combinedCWRate: u.total > 0 ? +((allCW / u.total) * 100).toFixed(1) : 0,
        carryoverCWRate: (coCW + coCL) > 0 ? +((coCW / (coCW + coCL)) * 100).toFixed(1) : 0,
        contracts: ct.total ?? 0,
        contractsNew: ct.new ?? 0,
        contractsNewCarryover: ct.newCarryover ?? 0,
        contractsAddInstall: ct.addInstall ?? 0,
        contractTablets: ct.tablets ?? 0,
        avgDailyCloseThisMonth: dc.avgDailyCloseThisMonth ?? 0,
        avgDailyCloseCarryover: dc.avgDailyCloseCarryover ?? 0,
        over7: (cboBacklogByUser[u.name] || {}).over7 ?? 0,
      };
    });
    const totalSQL = allUsers.reduce((s: number, u: any) => s + u.total, 0);
    const totalCW = allUsers.reduce((s: number, u: any) => s + (u.thisMonthCW ?? 0), 0);
    const totalCL = allUsers.reduce((s: number, u: any) => s + (u.thisMonthCL ?? 0), 0);
    const totalOpen = allUsers.reduce((s: number, u: any) => s + (u.open ?? 0), 0);
    const totalOver7 = allUsers.reduce((s: number, u: any) => s + (u.over7 ?? 0), 0);
    const totalCarryoverCW = allUsers.reduce((s: number, u: any) => s + (u.carryoverCW ?? 0), 0);
    const totalCarryoverCL = allUsers.reduce((s: number, u: any) => s + (u.carryoverCL ?? 0), 0);
    const totalContracts = allUsers.reduce((s: number, u: any) => s + (u.contracts ?? 0), 0);
    const totalContractsNew = allUsers.reduce((s: number, u: any) => s + (u.contractsNew ?? 0), 0);
    const totalContractsNewCarryover = allUsers.reduce((s: number, u: any) => s + (u.contractsNewCarryover ?? 0), 0);
    const totalContractsAddInstall = allUsers.reduce((s: number, u: any) => s + (u.contractsAddInstall ?? 0), 0);
    const totalContractTablets = allUsers.reduce((s: number, u: any) => s + (u.contractTablets ?? 0), 0);
    const overallCWRate = totalSQL > 0 ? ((totalCW / totalSQL) * 100).toFixed(1) : '-';
    const overallAvgDailyClose = allUsers.length > 0
      ? +(allUsers.reduce((s: number, u: any) => s + (u.avgDailyClose ?? 0), 0) / allUsers.length).toFixed(1) : 0;
    // 합산 행 추가
    const allUsersWithSummary = [...allUsers, {
      _isSummary: true,
      name: '합산',
      total: totalSQL,
      thisMonthCW: totalCW,
      thisMonthCL: totalCL,
      open: totalOpen,
      thisMonthCWRate: overallCWRate !== '-' ? parseFloat(overallCWRate as string) : 0,
      combinedCWRate: totalSQL > 0 ? +(((totalCW + totalCarryoverCW) / totalSQL) * 100).toFixed(1) : 0,
      carryoverCW: totalCarryoverCW,
      carryoverCL: totalCarryoverCL,
      avgDailyClose: overallAvgDailyClose,
      over7: totalOver7,
      contracts: totalContracts,
      contractsNew: totalContractsNew,
      contractsNewCarryover: totalContractsNewCarryover,
      contractsAddInstall: totalContractsAddInstall,
      contractTablets: totalContractTablets,
      contractAvgTablets: totalContracts > 0 ? +(totalContractTablets / totalContracts).toFixed(1) : 0,
      achievementRate: '-',
    }];
    const avgDailyClose = cbo?.dailyClose?.byUser
      ? (cbo.dailyClose.byUser.reduce((s: number, u: any) => s + u.avgDailyClose, 0) / cbo.dailyClose.byUser.length).toFixed(1)
      : '-';
    const avgDailyCloseThisMonth = cbo?.dailyClose?.byUser
      ? (cbo.dailyClose.byUser.reduce((s: number, u: any) => s + (u.avgDailyCloseThisMonth ?? 0), 0) / cbo.dailyClose.byUser.length).toFixed(1)
      : '-';
    const avgDailyCloseCarryover = cbo?.dailyClose?.byUser
      ? (cbo.dailyClose.byUser.reduce((s: number, u: any) => s + (u.avgDailyCloseCarryover ?? 0), 0) / cbo.dailyClose.byUser.length).toFixed(1)
      : '-';
    const cw = cbo?.cwWithCarryover;

    return (
      <>
        <div className="metro-card">
          <h2 style={{ marginBottom: '8px' }}>채널 Back Office KPI</h2>
          <p style={{ color: '#888', fontSize: '0.85em', marginBottom: '24px' }}>과정 지표(일평균 마감·SQL 잔량)가 결과(CW 전환율)를 만듭니다</p>

          <div style={{ display: 'flex', alignItems: 'stretch', gap: '0', padding: '0 10px' }}>
            {/* 과정 지표 */}
            {[
              {
                label: '일평균 마감',
                value: avgDailyClose,
                sub: `이번달 ${avgDailyCloseThisMonth} + 이월 ${avgDailyCloseCarryover}`,
                target: '목표: 3건',
                color: '#00897b',
                met: avgDailyClose !== '-' && parseFloat(avgDailyClose as string) >= 3,
              },
              {
                label: 'SQL 잔량 (7일+)',
                value: cbo?.sqlBacklog?.totalOver7 ?? '-',
                sub: `전체 진행중 ${cbo?.sqlBacklog?.totalOpen ?? 0}건`,
                target: '목표: ≤10건',
                color: '#e65100',
                met: (cbo?.sqlBacklog?.totalOver7 ?? 999) <= 10,
              },
              {
                label: '이월 비중',
                value: cw?.totalCW > 0 ? `${((cw.totalCarryoverCW / cw.totalCW) * 100).toFixed(0)}%` : '-',
                sub: `이월 ${cw?.totalCarryoverCW ?? 0} / 전체 ${cw?.totalCW ?? 0}`,
                target: '낮을수록 좋음',
                color: '#5e35b1',
                met: cw?.totalCW > 0 ? (cw.totalCarryoverCW / cw.totalCW) < 0.5 : true,
              },
            ].map((step, i) => (
              <React.Fragment key={step.label}>
                <div style={{
                  flex: 1,
                  background: step.met ? `${step.color}12` : '#fff5f5',
                  border: `2px solid ${step.met ? step.color : '#e53935'}`,
                  borderRadius: '12px',
                  padding: '20px 16px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '0.75em', color: '#888', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    과정 {i + 1}
                  </div>
                  <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: '1.8em', fontWeight: 700, color: step.met ? step.color : '#e53935', lineHeight: 1.1 }}>
                    {typeof step.value === 'number' ? step.value.toLocaleString() : step.value}
                  </div>
                  <div style={{ fontSize: '0.78em', color: '#888', marginTop: '6px' }}>
                    {step.sub}
                  </div>
                  <div style={{
                    marginTop: '8px', fontSize: '0.72em', fontWeight: 600,
                    color: step.met ? step.color : '#e53935',
                    background: step.met ? `${step.color}18` : '#ffebee',
                    padding: '3px 10px', borderRadius: '10px', display: 'inline-block',
                  }}>
                    {step.target}
                  </div>
                </div>
                {i < 2 && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#bbb', fontSize: '1.5em' }}>→</div>
                )}
              </React.Fragment>
            ))}

            {/* 화살표 → 결과 */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#bbb', fontSize: '1.5em' }}>→</div>

            {/* 결과 지표 (핵심 KPI) */}
            <div style={{
              flex: 1.3,
              background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#e8f5e9' : '#ffebee',
              border: `2px solid ${(overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935'}`,
              borderRadius: '12px',
              padding: '20px 16px',
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: '0.75em', fontWeight: 700, letterSpacing: '0.5px',
                color: '#fff', background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
                padding: '3px 12px', borderRadius: '10px', display: 'inline-block', marginBottom: '6px',
              }}>
                결과
              </div>
              <div style={{ fontSize: '0.95em', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                SQL→CW 전환율
              </div>
              <div style={{
                fontSize: '2em', fontWeight: 700, lineHeight: 1.1,
                color: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
              }}>
                {overallCWRate}%
              </div>
              <div style={{ fontSize: '0.78em', color: '#888', marginTop: '6px' }}>
                이번달 Lead 기준 ({totalSQL}건 중 {totalCW}건)
              </div>
              <div style={{
                marginTop: '8px', fontSize: '0.72em', fontWeight: 600,
                color: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#2e7d32' : '#e53935',
                background: (overallCWRate !== '-' && parseFloat(overallCWRate as string) >= 60) ? '#c8e6c918' : '#ffebee',
                padding: '3px 10px', borderRadius: '10px', display: 'inline-block',
              }}>
                목표: 60%
              </div>
            </div>
          </div>

          {/* 하단 보조 지표: 계약 기반 */}
          {(() => { const cs = cbo?.contractSummary; return (
          <div style={{ display: 'flex', gap: '12px', marginTop: '16px', padding: '0 10px' }}>
            <div style={{
              flex: 1, background: '#f5f5f5', borderRadius: '8px', padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.85em', color: '#666' }}>계약 건수</span>
              <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#2e7d32' }}>
                {cs?.total ?? '-'}건
              </span>
            </div>
            <div style={{
              flex: 1.4, background: '#f5f5f5', borderRadius: '8px', padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <span style={{ fontSize: '0.85em', color: '#666' }}>신규</span>
                {(cs?.newFromCarryover ?? 0) > 0 && (
                  <span style={{ fontSize: '0.72em', color: '#e65100', marginLeft: '6px', background: '#fff3e0', padding: '1px 6px', borderRadius: '4px' }}>
                    이월 {cs.newFromCarryover}건
                  </span>
                )}
              </div>
              <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#1565c0' }}>
                {cs?.new ?? '-'}건
              </span>
            </div>
            <div style={{
              flex: 1, background: '#f5f5f5', borderRadius: '8px', padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '0.85em', color: '#666' }}>추가설치</span>
              <span style={{ fontSize: '1.2em', fontWeight: 700, color: '#e65100' }}>
                {cs?.addInstall ?? '-'}건
              </span>
            </div>
          </div>
          ); })()}
        </div>

        {/* 월별/주별 모드: 채널 BO 일별 추이 차트 — 임시 숨김 */}
        {false && !isDaily && !isWeekly && dailyTrends && dailyTrends.length > 0 && (
          <div className="metro-card" style={{ background: '#f8f9fa' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ marginBottom: '4px' }}>채널 BO 일별 추이</h2>
              <p style={{ color: '#888', fontSize: '0.85em' }}>
                SQL 생산·마감·잔량의 일별 변화 · 문제 일자를 클릭하면 해당일 Raw 데이터로 이동합니다
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <DailyTrendPanel
                title="SQL 생산"
                subtitle="일별 SQL(Opp) 배정 건수"
                color="#1565c0"
                valueKey="cboSqlTotal"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.channelBO?.sqlTotal ?? null,
                  rawCount: d.channelBO?.totalClosed ?? 0,
                }))}
                targetValue={5}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value < 3}
                problemLabel="마감 처리"
                problemColor="#e65100"
              />
              <DailyTrendPanel
                title="일별 마감"
                subtitle="CW + CL 처리 건수"
                color="#00897b"
                valueKey="cboDailyClosed"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.channelBO?.totalClosed ?? null,
                  rawCount: d.channelBO?.cw ?? 0,
                }))}
                targetValue={3}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value < 2}
                problemLabel="CW"
                problemColor="#e53935"
              />
              <DailyTrendPanel
                title="SQL 잔량 (7일+)"
                subtitle="목표: 10건 이하"
                color="#e65100"
                valueKey="cboBacklog7"
                trendData={dailyTrends.map((d: any) => ({
                  date: d.date,
                  dayName: d.dayName,
                  value: d.channelBO?.sqlBacklogOver7 ?? null,
                  rawCount: d.channelBO?.sqlBacklogOpen ?? 0,
                }))}
                targetValue={10}
                unit="건"
                problemFilter={(d: any) => d.value !== null && d.value > 10}
                problemLabel="전체 잔량"
                problemColor="#c62828"
              />
            </div>
          </div>
        )}

        <div className="metro-card">
          <h2 style={{ marginBottom: '20px' }}>담당자별 상세 (이번달 Lead 기준)</h2>
          <DataTable columns={channelBOColumns} data={allUsersWithSummary} loading={loading} />
        </div>

        {false && cw?.byUser?.length > 0 && (
          <div className="metro-card">
            <h2 style={{ marginBottom: '20px' }}>담당자별 CW (이월 포함, CloseDate 기준)</h2>
            <DataTable columns={carryoverCWColumns} data={cw.byUser} loading={loading} />
          </div>
        )}

        {/* Raw Data: 채널 진행중 Opportunity 상세 (Stage별 그룹) */}
        {cbo?.rawData?.rawOpenOpps?.length > 0 && (() => {
          const stageGroups = groupOppsByStage(cbo.rawData.rawOpenOpps);
          return (
            <div style={{
              background: '#fff', borderRadius: '8px', border: '1px solid #b2dfdb',
              borderLeft: '5px solid #00897b', marginBottom: '20px', overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,137,123,0.08)',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '18px 24px', background: 'linear-gradient(135deg, #e0f2f1, #f0fdfa)',
                borderBottom: '1px solid #b2dfdb',
              }}>
                <div>
                  <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#00695c', marginBottom: '4px' }}>
                    진행중 Opportunity 상세
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
                    {stageGroups.map(g => (
                      <span key={g.stage} style={{
                        padding: '2px 10px', borderRadius: '10px', fontSize: '0.78em', fontWeight: 600,
                        background: g.bg, color: g.color, border: `1px solid ${g.color}30`,
                      }}>
                        {g.stage} {g.items.length}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{
                  padding: '8px 18px', borderRadius: '8px', background: '#00897b', color: '#fff',
                  fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(0,137,123,0.3)',
                }}>
                  {cbo.rawData.rawOpenOpps.length}건
                </div>
              </div>
              {stageGroups.map(g => (
                <div key={g.stage}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 24px', background: g.bg, borderBottom: `2px solid ${g.color}40`,
                  }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%', background: g.color, flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '0.92em', fontWeight: 700, color: g.color }}>{g.stage}</span>
                    <span style={{ fontSize: '0.82em', color: '#888' }}>{g.items.length}건</span>
                  </div>
                  <DataTable columns={chRawOpenOppColumns} data={g.items} loading={loading} className="daily-raw daily-raw-teal" />
                </div>
              ))}
            </div>
          );
        })()}

        {/* Raw Data: 채널 최근 마감 내역 — 임시 숨김 */}
        {false && cbo?.rawData?.rawClosedOpps?.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: '8px', border: '1px solid #c8e6c9',
            borderLeft: '5px solid #2e7d32', marginBottom: '20px', overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(46,125,50,0.08)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', background: 'linear-gradient(135deg, #e8f5e9, #f1f8e9)',
              borderBottom: '1px solid #c8e6c9',
            }}>
              <div>
                <h3 style={{ fontSize: '1.1em', fontWeight: 700, color: '#1b5e20', marginBottom: '2px' }}>
                  최근 마감 내역
                </h3>
                <p style={{ color: '#999', fontSize: '0.82em' }}>
                  CW {cbo.rawData.rawClosedOpps.filter((o: any) => o.stageName === 'Closed Won').length}건 · CL {cbo.rawData.rawClosedOpps.filter((o: any) => o.stageName === 'Closed Lost').length}건
                </p>
              </div>
              <div style={{
                padding: '8px 18px', borderRadius: '8px', background: '#2e7d32', color: '#fff',
                fontSize: '1em', fontWeight: 700, boxShadow: '0 2px 6px rgba(46,125,50,0.3)',
              }}>
                {cbo.rawData.rawClosedOpps.length}건
              </div>
            </div>
            <DataTable columns={chRawClosedOppColumns} data={cbo.rawData.rawClosedOpps} loading={loading} className="daily-raw daily-raw-green" />
          </div>
        )}
      </>
    );
  }

  const renderTab: Record<TabType, () => React.ReactNode> = {
    insideSales: renderInsideSales,
    fieldSales: renderFieldSales,
    inboundBO: renderInboundBO,
    channelAE: renderChannelAE,
    channelAM: renderChannelAM,
    channelTM: renderChannelTM,
    channelBO: renderChannelBO,
  };

  return (
    <div style={{ padding: '30px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px' }}>
        <div>
          <h1 style={{ fontSize: '2em', fontWeight: 300 }}>KPI 현황</h1>
          <p style={{ color: '#666', marginTop: '10px' }}>
            {data?.periodLabel || '기간 선택'}
            {data?.periodType === 'daily' && (
              <span style={{ marginLeft: '8px', padding: '2px 8px', background: '#e3f2fd', color: '#0078d4', fontSize: '0.85em', borderRadius: '4px' }}>
                일별 보기
              </span>
            )}
            {data?.periodType === 'weekly' && (
              <span style={{ marginLeft: '8px', padding: '2px 8px', background: '#f3e5f5', color: '#7b1fa2', fontSize: '0.85em', borderRadius: '4px' }}>
                주별 보기
              </span>
            )}
          </p>
          {extractStatus?.lastRun && (
            <p style={{ color: '#999', fontSize: '0.75em', marginTop: '4px' }}>
              마지막 동기화: {new Date(extractStatus.lastRun).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {extractStatus.lastResult === 'success' ? ' ✅' : ' ❌'}
              {extractStatus.isRunning && ' (동기화 중...)'}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* 새로고침 버튼 */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || extractStatus?.isRunning}
            title="Salesforce에서 최신 데이터 가져오기"
            style={{
              padding: '8px 14px', fontSize: '0.9em', border: '1px solid #ccc',
              background: refreshing ? '#f5f5f5' : '#fff', cursor: refreshing ? 'not-allowed' : 'pointer',
              borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <span style={{ display: 'inline-block', animation: refreshing || extractStatus?.isRunning ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            {refreshing ? '동기화 중...' : '새로고침'}
          </button>
          {/* 월 선택 */}
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); setViewMode('monthly'); setSelectedDate(''); setSelectedWeek(null); }}
            disabled={loading}
            style={{ padding: '8px 16px', fontSize: '1em', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', borderRadius: '6px' }}
          >
            {months.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* 월간/주별/일별 토글 */}
          {(['monthly', 'weekly', 'daily'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode);
                if (mode === 'daily' && availableDates.length > 0 && !selectedDate) {
                  setSelectedDate(availableDates[availableDates.length - 1]);
                }
                if (mode === 'weekly' && weeks.length > 0 && !selectedWeek) {
                  setSelectedWeek(weeks[weeks.length - 1]);
                }
              }}
              disabled={loading}
              style={{
                padding: '8px 16px', fontSize: '0.95em', border: '1px solid #ccc',
                background: viewMode === mode ? '#0078d4' : '#fff',
                color: viewMode === mode ? '#fff' : '#333',
                cursor: 'pointer', borderRadius: '6px', fontWeight: viewMode === mode ? 600 : 400,
              }}
            >
              {mode === 'monthly' ? '월간' : mode === 'weekly' ? '주별' : '일별'}
            </button>
          ))}

          {/* 일별 네비게이터 */}
          {viewMode === 'daily' && availableDates.length > 0 && (() => {
            const idx = availableDates.indexOf(selectedDate);
            const hasPrev = idx > 0;
            const hasNext = idx < availableDates.length - 1;
            const dow = selectedDate ? new Date(selectedDate).getDay() : 0;
            const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][dow];
            return (
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
                <button
                  onClick={() => hasPrev && setSelectedDate(availableDates[idx - 1])}
                  disabled={!hasPrev || loading}
                  style={{
                    padding: '8px 10px', border: 'none', cursor: hasPrev ? 'pointer' : 'not-allowed',
                    background: hasPrev ? '#f5f5f5' : '#fafafa', color: hasPrev ? '#333' : '#ccc',
                    fontSize: '1em', lineHeight: 1, borderRight: '1px solid #eee',
                  }}
                >
                  ◀
                </button>
                <span style={{ padding: '8px 14px', fontWeight: 600, fontSize: '0.95em', minWidth: '140px', textAlign: 'center' }}>
                  {selectedDate} ({dayLabel})
                </span>
                <button
                  onClick={() => hasNext && setSelectedDate(availableDates[idx + 1])}
                  disabled={!hasNext || loading}
                  style={{
                    padding: '8px 10px', border: 'none', cursor: hasNext ? 'pointer' : 'not-allowed',
                    background: hasNext ? '#f5f5f5' : '#fafafa', color: hasNext ? '#333' : '#ccc',
                    fontSize: '1em', lineHeight: 1, borderLeft: '1px solid #eee',
                  }}
                >
                  ▶
                </button>
              </div>
            );
          })()}

          {/* 주별 네비게이터 */}
          {viewMode === 'weekly' && weeks.length > 0 && selectedWeek && (() => {
            const idx = weeks.findIndex(w => w.weekNum === selectedWeek.weekNum);
            const hasPrev = idx > 0;
            const hasNext = idx < weeks.length - 1;
            return (
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
                <button
                  onClick={() => hasPrev && setSelectedWeek(weeks[idx - 1])}
                  disabled={!hasPrev || loading}
                  style={{
                    padding: '8px 10px', border: 'none', cursor: hasPrev ? 'pointer' : 'not-allowed',
                    background: hasPrev ? '#f5f5f5' : '#fafafa', color: hasPrev ? '#333' : '#ccc',
                    fontSize: '1em', lineHeight: 1, borderRight: '1px solid #eee',
                  }}
                >
                  ◀
                </button>
                <span style={{ padding: '8px 14px', fontWeight: 600, fontSize: '0.95em', minWidth: '200px', textAlign: 'center' }}>
                  {selectedWeek.label} ({selectedWeek.start} ~ {selectedWeek.end})
                </span>
                <button
                  onClick={() => hasNext && setSelectedWeek(weeks[idx + 1])}
                  disabled={!hasNext || loading}
                  style={{
                    padding: '8px 10px', border: 'none', cursor: hasNext ? 'pointer' : 'not-allowed',
                    background: hasNext ? '#f5f5f5' : '#fafafa', color: hasNext ? '#333' : '#ccc',
                    fontSize: '1em', lineHeight: 1, borderLeft: '1px solid #eee',
                  }}
                >
                  ▶
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="metro-card red" style={{ marginBottom: '20px' }}>
          <p style={{ color: '#e81123' }}>{error}</p>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '0', background: '#fff', borderBottom: '1px solid #e0e0e0', flexWrap: 'wrap' }}>
        {['인바운드', '채널'].map(group => (
          <React.Fragment key={group}>
            <div style={{ padding: '10px 12px', fontSize: '0.85em', color: '#999', fontWeight: 600, alignSelf: 'center' }}>
              {group}
            </div>
            {tabs.filter(t => t.group === group).map(tab => (
              <button
                key={tab.key}
                style={tabStyle(activeTab === tab.key)}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
            {group === '인바운드' && (
              <div style={{ width: '1px', background: '#e0e0e0', margin: '8px 4px' }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ marginTop: '25px' }}>
        {renderTab[activeTab]()}
      </div>

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
                <h3 style={{ fontSize: '1.05em', fontWeight: 700, color: '#1565c0', marginBottom: '2px' }}>
                  📋 과업 목록
                </h3>
                <p style={{ fontSize: '0.85em', color: '#666' }}>
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
            <div style={{ overflow: 'auto', padding: '0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92em' }}>
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
                            display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '0.82em', fontWeight: 600,
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
                              fontSize: '0.88em', color: '#555', background: '#f8f9fa', borderRadius: '6px',
                              padding: '10px 14px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              borderLeft: '3px solid #90caf9', maxHeight: '200px', overflow: 'auto',
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
    </div>
  );
}
