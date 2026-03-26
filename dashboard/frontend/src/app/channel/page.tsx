'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useReportData } from '@/lib/useReportData';
import { fetchChannelAM } from '@/lib/api';
import TossBadge from '@/components/TossBadge';
import {
  KPICard,
  TrendChart,
  OwnerBarChart,
  FunnelChart,
  AgingPieChart,
  HorizontalBarChart,
} from '@/components/ReportCharts';
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

// ============ Design Tokens ============

const C = {
  text: '#191F28',
  secondary: '#6B7684',
  muted: '#8B95A1',
  border: '#E5E8EB',
  bg: '#FFFFFF',
  bgSub: '#F9FAFB',
  green: '#00C950',
  red: '#F04452',
  blue: '#3182F6',
  orange: '#F59E0B',
  teal: '#0EA5E9',
  purple: '#8B5CF6',
  gray: '#8B95A1',
};

type Tab = 'ae' | 'am' | 'tm' | 'bo';

// ============ Shared sub-components ============

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 15,
        fontWeight: 600,
        color: C.text,
        marginBottom: 12,
        marginTop: 28,
      }}
    >
      {children}
    </h3>
  );
}

function CardRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      {children}
    </div>
  );
}

function Panel({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
      {title && (
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 14 }}>{title}</div>
      )}
      {children}
    </div>
  );
}

function ProgressGauge({ label, value, max, rate, target }: { label: string; value: number; max: number; rate: number; target?: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: C.text }}>{rate.toFixed(1)}</span>
        <span style={{ fontSize: 14, color: C.secondary }}>%</span>
        <span style={{ fontSize: 13, color: C.muted, marginLeft: 8 }}>({value} / {max})</span>
      </div>
      <div style={{ background: C.bgSub, borderRadius: 6, height: 12, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: rate >= (target || 0) ? C.green : C.orange,
            borderRadius: 6,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      {target !== undefined && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Target: {target}%</div>
      )}
    </div>
  );
}

// ============ Main Page ============

export default function ChannelPage() {
  const { data, prevData, loading, error, months, selectedMonth, setSelectedMonth } = useReportData();
  const [activeTab, setActiveTab] = useState<Tab>('ae');

  const ch = data?.channel;
  const prevCh = prevData?.channel;
  const trends = data?.dailyTrends || [];

  // 채널 AM 데이터에서 onboarding.partner.list 가져오기
  const [channelAMData, setChannelAMData] = useState<any>(null);
  useEffect(() => {
    if (!selectedMonth) return;
    fetchChannelAM(selectedMonth)
      .then((res) => setChannelAMData(res))
      .catch(() => setChannelAMData(null));
  }, [selectedMonth]);

  // 안착 타임라인 데이터 계산
  const settlementTimeline = useMemo(() => {
    // API 모드: 백엔드가 이미 계산한 것 직접 사용
    if (channelAMData?.settlementTimeline?.length > 0) return channelAMData.settlementTimeline;
    // S3 모드 폴백: raw 데이터에서 계산
    const list = channelAMData?.onboarding?.partner?.list
      || channelAMData?.mou?.onboarding?.partner?.list || [];
    if (list.length === 0) return [];
    return list.map((item: any) => {
      const mouDate = item.mouContractDate || item.mouStart;
      const leadDate = item.absoluteFirstLeadDate;
      let leadToMouDays: number | null = null;
      if (mouDate && leadDate && mouDate !== '-') {
        const diff = new Date(mouDate).getTime() - new Date(leadDate).getTime();
        leadToMouDays = Math.round(diff / (1000 * 60 * 60 * 24));
      }
      return {
        partnerName: item.name ?? null,
        absoluteFirstLeadDate: leadDate ?? null,
        mouStart: item.mouStart ?? item.mouContractDate ?? null,
        mouContractDate: mouDate !== '-' ? mouDate : null,
        preMouLeadCount: item.preMouLeadCount ?? 0,
        leadToMouDays,
        leadsAfterMou3Months: item.leadCountWithinWindow ?? item.leadCount ?? null,
        isSettled: item.isSettled ?? null,
      };
    });
  }, [channelAMData]);

  // ---- Tab button style ----
  const tabStyle = (active: boolean) => ({
    padding: '10px 24px',
    border: 'none',
    cursor: 'pointer' as const,
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    background: active ? C.blue : C.bg,
    color: active ? '#fff' : C.secondary,
    borderRadius: 10,
    transition: 'all 0.15s',
  });

  // ---- Loading / Error ----
  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, color: C.secondary }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, color: C.red }}>{error}</div>
      </div>
    );
  }

  const ae = ch?.ae;
  const am = ch?.am;
  const tm = ch?.tm;
  const bo = ch?.backOffice;
  const prevAe = prevCh?.ae;
  const prevAm = prevCh?.am;
  const prevTm = prevCh?.tm;
  const prevBo = prevCh?.backOffice;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
      {/* ---- Header ---- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0 }}>
            채널 세일즈
          </h1>
          {data?.extractedAt && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              데이터 추출: {data.extractedAt}
            </div>
          )}
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            fontSize: 14,
            color: C.text,
            background: C.bg,
            cursor: 'pointer',
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* ---- Tabs ---- */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, background: C.bgSub, padding: 4, borderRadius: 12, width: 'fit-content' }}>
        {[
          { key: 'ae' as Tab, label: 'AE' },
          { key: 'am' as Tab, label: 'AM' },
          { key: 'tm' as Tab, label: 'TM' },
          { key: 'bo' as Tab, label: 'BO' },
        ].map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={tabStyle(activeTab === t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ======== AE Tab ======== */}
      {activeTab === 'ae' && ae && (
        <div>
          <CardRow>
            <KPICard
              label="MOU 총건수"
              value={ae.mouCount?.total ?? 0}
              unit="건"
              prevValue={prevAe?.mouCount?.total}
              target={ae.mouCount?.target ?? 4}
              targetLabel="Target"
              color={C.blue}
            />
            <KPICard
              label="미팅수"
              value={ae.meetingCount?.total ?? 0}
              unit="건"
              prevValue={prevAe?.meetingCount?.total}
              target={`일평균 ${ae.meetingCount?.avgDaily ?? 0}`}
              targetLabel="실적"
              color={C.teal}
            />
            <KPICard
              label="네고 파이프라인"
              value={ae.mouNegoProgress?.total ?? Object.values(ae.mouNegoProgress?.byProgress || {}).reduce((s: number, v: any) => s + (typeof v === 'number' ? v : 0), 0)}
              unit="건"
              prevValue={prevAe?.mouNegoProgress?.total}
              color={C.purple}
            />
          </CardRow>

          <SectionTitle>MOU 상세</SectionTitle>
          <CardRow>
            <KPICard label="파트너사" value={ae.mouCount?.partners ?? 0} unit="건" color={C.blue} />
            <KPICard label="프랜차이즈 본사" value={ae.mouCount?.franchiseHQ ?? 0} unit="건" color={C.orange} />
            <KPICard label="프랜차이즈 브랜드" value={ae.mouCount?.franchiseBrands ?? 0} unit="건" color={C.teal} />
          </CardRow>

          <SectionTitle>파이프라인 분포</SectionTitle>
          {ae.mouNegoProgress?.byProgress && (
            <AgingPieChart data={ae.mouNegoProgress.byProgress} />
          )}

          <SectionTitle>담당자별 미팅</SectionTitle>
          {ae.meetingCount?.byOwner && ae.meetingCount.byOwner.length > 0 && (
            <OwnerBarChart
              data={ae.meetingCount.byOwner}
              bars={[{ key: 'count', color: C.blue, name: '미팅수' }]}
              height={280}
            />
          )}
        </div>
      )}

      {/* ======== AM Tab ======== */}
      {activeTab === 'am' && am && (
        <div>
          <CardRow>
            <KPICard
              label="일평균 리드"
              value={am.dailyLeadCount?.avgDaily ?? 0}
              unit="건"
              prevValue={prevAm?.dailyLeadCount?.avgDaily}
              target="20-25"
              targetLabel="Target"
              color={C.blue}
            />
            <KPICard
              label="파트너 리드"
              value={am.dailyLeadCount?.partner ?? 0}
              unit="건"
              prevValue={prevAm?.dailyLeadCount?.partner}
              color={C.teal}
            />
            <KPICard
              label="프랜차이즈 리드"
              value={am.dailyLeadCount?.franchise ?? 0}
              unit="건"
              prevValue={prevAm?.dailyLeadCount?.franchise}
              color={C.orange}
            />
            <KPICard
              label="활성 파트너"
              value={am.activePartnerCount?.total ?? 0}
              unit="개"
              prevValue={prevAm?.activePartnerCount?.total}
              target={am.activePartnerCount?.target ?? 70}
              targetLabel="Target"
              color={C.green}
            />
          </CardRow>

          <SectionTitle>담당자별 리드</SectionTitle>
          {am.dailyLeadCount?.byOwner && am.dailyLeadCount.byOwner.length > 0 && (
            <OwnerBarChart
              data={am.dailyLeadCount.byOwner}
              bars={[
                { key: 'partner', color: C.blue, name: '파트너' },
                { key: 'franchise', color: C.orange, name: '프랜차이즈' },
              ]}
              stacked
              height={300}
            />
          )}

          <SectionTitle>온보딩 전환율</SectionTitle>
          {am.onboardingRate && (
            <ProgressGauge
              label="정착 전환율"
              value={am.onboardingRate.settled ?? 0}
              max={am.onboardingRate.total ?? 0}
              rate={am.onboardingRate.rate ?? 0}
              target={am.onboardingRate.target}
            />
          )}

          {/* 파트너 안착 타임라인 */}
          {settlementTimeline.length > 0 && (
            <>
              <SectionTitle>파트너 안착 타임라인</SectionTitle>
              <Panel>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['파트너사', '최초 Lead 인입', 'MOU 시작일', 'MOU 채결일', 'MOU 전 Lead', 'Lead→MOU 간격', 'MOU 후 Lead', '안착'].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: '10px 12px',
                              textAlign: 'left',
                              fontWeight: 600,
                              color: C.secondary,
                              borderBottom: `2px solid ${C.border}`,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settlementTimeline.map((row: any, idx: number) => {
                        const gap = row.leadToMouDays;
                        const hasLeadBeforeMou = gap != null && gap > 0;
                        const formatGap = (g: number | null) => {
                          if (g == null) return '-';
                          if (g < 0) return `MOU 후 ${Math.abs(g)}일`;
                          return `${g}일`;
                        };
                        return (
                          <tr
                            key={row.partnerName ?? idx}
                            style={{
                              background: hasLeadBeforeMou ? '#FFF8E1' : (idx % 2 === 0 ? C.bg : C.bgSub),
                              transition: 'background 0.15s',
                            }}
                          >
                            <td style={{ padding: '10px 12px', color: C.text, fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>
                              {row.partnerName ?? '-'}
                            </td>
                            <td style={{ padding: '10px 12px', color: C.text, borderBottom: `1px solid ${C.border}` }}>
                              {row.absoluteFirstLeadDate ?? '-'}
                            </td>
                            <td style={{ padding: '10px 12px', color: C.text, borderBottom: `1px solid ${C.border}` }}>
                              {row.mouStart ?? '-'}
                            </td>
                            <td style={{ padding: '10px 12px', color: C.text, borderBottom: `1px solid ${C.border}` }}>
                              {row.mouContractDate ?? '-'}
                            </td>
                            <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                              {row.preMouLeadCount > 0 ? (
                                <TossBadge color="blue" variant="weak" size="xsmall">{row.preMouLeadCount}건</TossBadge>
                              ) : '-'}
                            </td>
                            <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, color: gap != null ? (gap < 0 ? C.red : C.text) : C.muted }}>
                              {formatGap(gap)}
                            </td>
                            <td style={{ padding: '10px 12px', color: C.text, borderBottom: `1px solid ${C.border}` }}>
                              {row.leadsAfterMou3Months != null ? `${row.leadsAfterMou3Months}건` : '-'}
                            </td>
                            <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                              {row.isSettled != null ? (
                                <TossBadge
                                  color={row.isSettled ? 'green' : 'red'}
                                  variant="weak"
                                  size="xsmall"
                                >
                                  {row.isSettled ? '안착' : '미안착'}
                                </TossBadge>
                              ) : (
                                <TossBadge color="elephant" variant="weak" size="xsmall">-</TossBadge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          <SectionTitle>활성 파트너 현황</SectionTitle>
          <CardRow>
            <KPICard label="파트너사" value={am.activePartnerCount?.partners ?? 0} unit="개" color={C.blue} />
            <KPICard label="브랜드" value={am.activePartnerCount?.brands ?? 0} unit="개" color={C.orange} />
            <KPICard
              label="전체"
              value={am.activePartnerCount?.total ?? 0}
              unit="개"
              target={am.activePartnerCount?.target ?? 70}
              targetLabel="Target"
              color={C.green}
            />
          </CardRow>
        </div>
      )}

      {/* ======== TM Tab ======== */}
      {activeTab === 'tm' && tm && (
        <div>
          <CardRow>
            <KPICard
              label="인당 전환"
              value={tm.dailyConversion?.avgDailyPerPerson ?? 0}
              unit="건/일"
              prevValue={prevTm?.dailyConversion?.avgDailyPerPerson}
              target={tm.dailyConversion?.target_daily ?? 5}
              targetLabel="Target"
              color={C.blue}
            />
            <KPICard
              label="방문배정"
              value={tm.dailyConversion?.visitAssigned ?? 0}
              unit="건"
              prevValue={prevTm?.dailyConversion?.visitAssigned}
              color={C.teal}
            />
            <KPICard
              label="견적발송"
              value={tm.quoteSent?.total ?? tm.dailyConversion?.quoteSent ?? 0}
              unit="건"
              prevValue={prevTm?.quoteSent?.total ?? prevTm?.dailyConversion?.quoteSent}
              color={C.purple}
            />
            <KPICard
              label="FRT 준수율"
              value={tm.frt?.totalWithTask ? ((tm.frt.frtOk / tm.frt.totalWithTask) * 100).toFixed(1) : 0}
              unit="%"
              color={C.green}
            />
            <KPICard
              label="잔량 (7일+)"
              value={tm.sqlBacklog?.over7 ?? 0}
              unit="건"
              prevValue={prevTm?.sqlBacklog?.over7}
              target={tm.sqlBacklog?.target}
              targetLabel="Target"
              color={C.red}
            />
          </CardRow>

          <SectionTitle>채널 퍼널 (Lead - MQL - SQL)</SectionTitle>
          {tm.unconvertedMQL?.funnel && (
            <FunnelChart
              steps={[
                { label: 'Lead', value: tm.unconvertedMQL.funnel.lead ?? 0, color: C.blue },
                { label: 'MQL', value: tm.unconvertedMQL.funnel.mql ?? 0, color: C.teal },
                { label: 'SQL', value: tm.unconvertedMQL.funnel.sql ?? 0, color: C.green },
              ]}
            />
          )}

          <SectionTitle>일별 전환 추이</SectionTitle>
          {trends.length > 0 && (
            <TrendChart
              data={trends.map((d: any) => ({
                date: d.date,
                dailyConversion: d.channelTM?.dailyConversion ?? 0,
                lead: d.channelTM?.lead ?? 0,
              }))}
              bars={[{ key: 'dailyConversion', color: C.gray, name: '일별 전환' }]}
              lines={[{ key: 'lead', color: C.blue, name: 'Lead' }]}
              height={300}
            />
          )}

          <SectionTitle>FRT 분석</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {tm.frt?.buckets && (
              <Panel title="응답 시간 분포">
                <AgingPieChart data={tm.frt.buckets} />
              </Panel>
            )}
            {tm.frt?.byTimeSlot && tm.frt.byTimeSlot.length > 0 && (
              <Panel title="시간대별 FRT">
                <OwnerBarChart
                  data={tm.frt.byTimeSlot}
                  bars={[
                    { key: 'frtOk', color: C.green, name: '준수' },
                    { key: 'frtOver20', color: C.red, name: '초과' },
                  ]}
                  stacked
                  nameKey="timeSlot"
                  height={240}
                />
              </Panel>
            )}
          </div>

          <SectionTitle>담당자별 견적 발송</SectionTitle>
          {tm.quoteSent?.byOwner && tm.quoteSent.byOwner.length > 0 && (
            <OwnerBarChart
              data={tm.quoteSent.byOwner}
              bars={[
                { key: 'total', color: C.blue, name: '전체' },
                { key: 'final', color: C.green, name: '최종' },
              ]}
              height={280}
            />
          )}

          <SectionTitle>담당자별 잔량</SectionTitle>
          {tm.sqlBacklog?.byOwner && tm.sqlBacklog.byOwner.length > 0 && (
            <OwnerBarChart
              data={tm.sqlBacklog.byOwner}
              bars={[
                { key: 'total', color: C.blue, name: '전체' },
                { key: 'over7', color: C.red, name: '7일 초과' },
              ]}
              stacked
              height={280}
            />
          )}
        </div>
      )}

      {/* ======== BO Tab ======== */}
      {activeTab === 'bo' && bo && (
        <div>
          <CardRow>
            <KPICard
              label="CW 건수"
              value={bo.cwConversionRate?.byUser?.reduce((s: number, u: any) => s + (u.cw ?? 0), 0) ?? 0}
              unit="건"
              color={C.green}
              target={bo.cwConversionRate?.target}
              targetLabel="Target"
            />
            <KPICard
              label="리드타임 초과"
              value={bo.leadTime?.overdueCount ?? 0}
              unit="건"
              prevValue={prevBo?.leadTime?.overdueCount}
              color={C.red}
            />
            <KPICard
              label="잔량 (7일+)"
              value={bo.sqlBacklog?.totalOver7 ?? 0}
              unit="건"
              prevValue={prevBo?.sqlBacklog?.totalOver7}
              target={bo.sqlBacklog?.target}
              targetLabel="Target"
              color={C.orange}
            />
            <KPICard
              label="일평균 마감"
              value={bo.dailyClose?.avgDaily ?? 0}
              unit="건"
              prevValue={prevBo?.dailyClose?.avgDaily}
              target={bo.dailyClose?.target}
              targetLabel="Target"
              color={C.blue}
            />
          </CardRow>

          <SectionTitle>담당자별 CW (이월 포함)</SectionTitle>
          {bo.cwWithCarryover?.byUser && bo.cwWithCarryover.byUser.length > 0 && (
            <OwnerBarChart
              data={bo.cwWithCarryover.byUser}
              bars={[
                { key: 'thisMonthCW', color: C.green, name: '당월 CW' },
                { key: 'carryoverCW', color: C.orange, name: '이월 CW' },
              ]}
              stacked
              height={300}
            />
          )}

          <SectionTitle>일별 마감 추이</SectionTitle>
          {trends.length > 0 && (
            <TrendChart
              data={trends.map((d: any) => ({
                date: d.date,
                cw: d.channelBO?.cw ?? 0,
                cl: d.channelBO?.cl ?? 0,
                sqlBacklogOpen: d.channelBO?.sqlBacklogOpen ?? 0,
              }))}
              bars={[
                { key: 'cw', color: C.green, name: 'CW' },
                { key: 'cl', color: C.red, name: 'CL' },
              ]}
              lines={[{ key: 'sqlBacklogOpen', color: C.gray, name: '잔량' }]}
              height={300}
            />
          )}

          <SectionTitle>담당자별 리드타임</SectionTitle>
          {bo.leadTime?.byUser && bo.leadTime.byUser.length > 0 && (
            <OwnerBarChart
              data={bo.leadTime.byUser}
              bars={[
                { key: 'open', color: C.blue, name: '오픈' },
                { key: 'overdue', color: C.red, name: '초과' },
              ]}
              height={280}
            />
          )}

          <SectionTitle>잔량 추이</SectionTitle>
          {trends.length > 0 && (
            <Panel>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart
                  data={trends.map((d: any) => ({
                    date: d.date,
                    sqlBacklogOpen: d.channelBO?.sqlBacklogOpen ?? 0,
                    sqlBacklogOver7: d.channelBO?.sqlBacklogOver7 ?? 0,
                  }))}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: C.secondary }}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                    tickFormatter={(v: string) => {
                      if (!v) return '';
                      const p = v.split('-');
                      return p.length >= 3 ? `${parseInt(p[1])}/${parseInt(p[2])}` : v;
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: C.secondary }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      fontSize: 13,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: C.secondary, paddingTop: 8 }} />
                  <Area
                    type="monotone"
                    dataKey="sqlBacklogOpen"
                    name="잔량"
                    fill={`${C.blue}20`}
                    stroke={C.blue}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="sqlBacklogOver7"
                    name="7일 초과"
                    stroke={C.red}
                    strokeWidth={2}
                    dot={{ r: 3, fill: C.red }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          )}

          <SectionTitle>담당자별 일평균 마감</SectionTitle>
          {bo.dailyClose?.byUser && bo.dailyClose.byUser.length > 0 && (
            <Panel>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={bo.dailyClose.byUser}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: C.secondary }}
                    tickLine={false}
                    axisLine={{ stroke: C.border }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: C.secondary }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      fontSize: 13,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                  />
                  <Bar
                    dataKey="avgDailyClose"
                    name="일평균 마감"
                    fill={C.blue}
                    radius={[4, 4, 0, 0]}
                    barSize={28}
                  />
                  {bo.dailyClose.target && (
                    <ReferenceLine
                      y={bo.dailyClose.target}
                      stroke={C.red}
                      strokeDasharray="6 4"
                      label={{
                        value: `Target: ${bo.dailyClose.target}`,
                        position: 'insideTopRight',
                        fontSize: 11,
                        fill: C.red,
                      }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
