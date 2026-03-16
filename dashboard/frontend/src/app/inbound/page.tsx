'use client';

import React, { useState, useMemo } from 'react';
import { useReportData } from '@/lib/useReportData';
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
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

// ============ Helpers ============

function safe(v: any, fallback: any = 0) {
  return v !== undefined && v !== null ? v : fallback;
}

function pct(v: any) {
  const n = Number(v);
  return isNaN(n) ? '0.0' : n.toFixed(1);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '32px 0 12px' }}>
      {children}
    </h3>
  );
}

function CardWrap({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ============ Main Page ============

export default function InboundReportPage() {
  const { data, prevData, loading, error, months, selectedMonth, setSelectedMonth } =
    useReportData();
  const [activeTab, setActiveTab] = useState<'is' | 'fs' | 'bo'>('is');

  // Derived data
  const is = data?.inbound?.insideSales;
  const fs = data?.inbound?.fieldSales;
  const bo = data?.inbound?.backOffice;
  const trends = data?.dailyTrends || [];
  const prevIs = prevData?.inbound?.insideSales;
  const prevFs = prevData?.inbound?.fieldSales;
  const prevBo = prevData?.inbound?.backOffice;

  // IS funnel CW total
  const isCwTotal = useMemo(() => {
    if (!is?.byOwner) return 0;
    return is.byOwner.reduce((sum: number, o: any) => sum + safe(o.cw), 0);
  }, [is]);

  // FS totals
  const fsTotals = useMemo(() => {
    if (!fs?.cwConversionRate?.byUser) return { sql: 0, cw: 0, cl: 0 };
    const users = fs.cwConversionRate.byUser;
    return {
      sql: users.reduce((s: number, u: any) => s + safe(u.sql), 0),
      cw: users.reduce((s: number, u: any) => s + safe(u.cw), 0),
      cl: users.reduce((s: number, u: any) => s + safe(u.cl), 0),
    };
  }, [fs]);

  const fsCwRate = useMemo(() => {
    if (fsTotals.sql === 0) return 0;
    return (fsTotals.cw / fsTotals.sql) * 100;
  }, [fsTotals]);

  const prevFsTotals = useMemo(() => {
    if (!prevFs?.cwConversionRate?.byUser) return { sql: 0, cw: 0, cwRate: 0 };
    const users = prevFs.cwConversionRate.byUser;
    const sql = users.reduce((s: number, u: any) => s + safe(u.sql), 0);
    const cw = users.reduce((s: number, u: any) => s + safe(u.cw), 0);
    return { sql, cw, cwRate: sql > 0 ? (cw / sql) * 100 : 0 };
  }, [prevFs]);

  // Trend data for charts
  const isTrendData = useMemo(
    () => trends.map((t: any) => ({ date: t.date, dayName: t.dayName, ...t.insideSales })),
    [trends]
  );
  const fsTrendData = useMemo(
    () => trends.map((t: any) => ({ date: t.date, dayName: t.dayName, ...t.fieldSales })),
    [trends]
  );
  const boTrendData = useMemo(
    () => trends.map((t: any) => ({ date: t.date, dayName: t.dayName, ...t.inboundBO })),
    [trends]
  );

  // FRT bucket data
  const frtBucketData = useMemo(() => {
    if (!is?.frt?.buckets) return [];
    return Object.entries(is.frt.buckets).map(([name, value]) => ({
      name,
      value: value as number,
    }));
  }, [is]);

  // FRT time slot data
  const frtTimeSlotData = useMemo(() => {
    if (!is?.frt?.byTimeSlot) return [];
    const slots = is.frt.byTimeSlot;
    const labels: Record<string, string> = { biz: '영업시간', offHour: '영업외', weekend: '주말' };
    return Object.entries(slots).map(([key, val]: [string, any]) => ({
      name: labels[key] || key,
      rate: safe(val?.rate),
      ok: safe(val?.ok),
      total: safe(val?.total),
    }));
  }, [is]);

  // Loss reason data
  const lossReasonData = useMemo(() => {
    if (!fs?.lossReasonSummary) return [];
    return Object.entries(fs.lossReasonSummary).map(([name, value]) => ({
      name,
      value: value as number,
    }));
  }, [fs]);

  // BO contract by BO user
  const boContractData = useMemo(() => {
    if (!bo?.contractSummary?.byBO) return [];
    return Object.entries(bo.contractSummary.byBO).map(([name, vals]: [string, any]) => ({
      name,
      new: safe(vals.new),
      addInstall: safe(vals.addInstall),
    }));
  }, [bo]);

  // ============ Tab Button Style ============
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px',
    fontSize: 14,
    fontWeight: active ? 700 : 500,
    color: active ? C.blue : C.secondary,
    background: active ? `${C.blue}0F` : 'transparent',
    border: active ? `1.5px solid ${C.blue}` : `1px solid ${C.border}`,
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  });

  // ============ Loading / Error ============

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{ fontSize: 16, color: C.secondary }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{ fontSize: 16, color: C.red }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  // ============ Render ============

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 64px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0 }}>
          인바운드 세일즈
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {data?.extractedAt && (
            <span style={{ fontSize: 12, color: C.muted }}>
              추출: {data.extractedAt}
            </span>
          )}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: 14,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.text,
              background: C.bg,
              cursor: 'pointer',
            }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        {(['is', 'fs', 'bo'] as const).map((tab) => {
          const labels = { is: 'IS (Inside Sales)', fs: 'FS (Field Sales)', bo: 'BO (Back Office)' };
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={tabStyle(activeTab === tab)}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* IS Tab */}
      {activeTab === 'is' && is && (
        <div>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <KPICard
              label="Lead"
              value={safe(is.lead)}
              unit="건"
              prevValue={prevIs?.lead}
            />
            <KPICard
              label="MQL"
              value={safe(is.mql)}
              unit="건"
              prevValue={prevIs?.mql}
            />
            <KPICard
              label="SQL전환율"
              value={pct(is.sqlConversionRate)}
              unit="%"
              prevValue={prevIs?.sqlConversionRate}
              color={C.blue}
            />
            <KPICard
              label="방문전환율"
              value={pct(is.visitRate)}
              unit="%"
              prevValue={prevIs?.visitRate}
              color={C.teal}
            />
          </div>

          {/* Funnel */}
          <SectionTitle>세일즈 퍼널</SectionTitle>
          <FunnelChart
            steps={[
              { label: 'Lead', value: safe(is.lead), color: C.gray },
              { label: 'MQL', value: safe(is.mql), color: C.blue },
              { label: 'SQL', value: safe(is.sql), color: C.teal },
              { label: '방문', value: safe(is.visit), color: C.orange },
              { label: 'CW', value: isCwTotal, color: C.green },
            ]}
          />

          {/* Daily Trend */}
          <SectionTitle>일별 추이</SectionTitle>
          <TrendChart
            data={isTrendData}
            bars={[{ key: 'lead', color: C.gray, name: 'Lead' }]}
            lines={[
              { key: 'sqlConversionRate', color: C.blue, name: 'SQL전환율', yAxisId: 'right' },
              { key: 'frtRate', color: C.teal, name: 'FRT 20분이내', yAxisId: 'right' },
            ]}
          />

          {/* FRT Analysis */}
          <SectionTitle>FRT 분석</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: C.secondary, fontWeight: 600, marginBottom: 8 }}>
                응답시간 분포
              </div>
              <CardWrap>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={frtBucketData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: C.secondary }}
                      tickLine={false}
                      axisLine={{ stroke: C.border }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: C.secondary }}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        fontSize: 13,
                      }}
                    />
                    <Bar dataKey="value" fill={C.blue} radius={[4, 4, 0, 0]} barSize={28} name="건수" />
                  </BarChart>
                </ResponsiveContainer>
              </CardWrap>
            </div>
            <div>
              <div style={{ fontSize: 13, color: C.secondary, fontWeight: 600, marginBottom: 8 }}>
                시간대별 비교
              </div>
              <CardWrap>
                <div style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'flex-end', height: 240 }}>
                  {frtTimeSlotData.map((slot) => (
                    <div key={slot.name} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: slot.rate >= 50 ? C.green : C.red, marginBottom: 4 }}>
                        {slot.rate}%
                      </div>
                      <div style={{
                        height: `${Math.max(slot.rate * 1.8, 4)}px`,
                        background: slot.rate >= 50 ? C.teal : '#FF6B6B',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.3s',
                      }} />
                      <div style={{ fontSize: 11, color: C.secondary, marginTop: 8 }}>{slot.name}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{slot.ok}/{slot.total}건</div>
                    </div>
                  ))}
                </div>
              </CardWrap>
            </div>
          </div>

          {/* Owner Comparison */}
          <SectionTitle>담당자별 비교</SectionTitle>
          <OwnerBarChart
            data={is.byOwner || []}
            bars={[
              { key: 'sqlConversionRate', color: C.blue, name: 'SQL전환율' },
              { key: 'frtRate', color: C.teal, name: 'FRT달성률' },
              { key: 'visitRate', color: C.orange, name: '방문전환율' },
            ]}
          />

          {/* Task Productivity */}
          <SectionTitle>Task 생산성</SectionTitle>
          <CardWrap>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart
                data={is.dailyTask?.byOwner || []}
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
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: C.secondary, paddingTop: 8 }}
                />
                <Bar
                  dataKey="dailyAvgTask"
                  name="일평균 Task"
                  fill={C.purple}
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                />
                <ReferenceLine
                  y={30}
                  stroke={C.red}
                  strokeDasharray="6 4"
                  label={{
                    value: 'Target: 30',
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: C.red,
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardWrap>
        </div>
      )}

      {/* FS Tab */}
      {activeTab === 'fs' && fs && (
        <div>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <KPICard
              label="Total SQL"
              value={fsTotals.sql}
              unit="건"
              prevValue={prevFsTotals.sql}
            />
            <KPICard
              label="CW"
              value={fsTotals.cw}
              unit="건"
              prevValue={prevFsTotals.cw}
              color={C.green}
            />
            <KPICard
              label="CW전환율"
              value={pct(fsCwRate)}
              unit="%"
              prevValue={prevFsTotals.cwRate}
              color={C.blue}
            />
            <KPICard
              label="Stale건수"
              value={safe(fs.staleVisit?.total)}
              unit="건"
              color={C.orange}
            />
          </div>

          {/* CW by Owner */}
          <SectionTitle>담당자별 CW/CL</SectionTitle>
          <OwnerBarChart
            data={fs.cwConversionRate?.byUser || []}
            bars={[
              { key: 'cw', color: C.green, name: 'CW' },
              { key: 'cl', color: C.red, name: 'CL' },
              { key: 'open', color: C.gray, name: 'Open' },
            ]}
            stacked
          />

          {/* Daily CW/CL Trend */}
          <SectionTitle>일별 CW/CL 추이</SectionTitle>
          <TrendChart
            data={fsTrendData}
            bars={[
              { key: 'cw', color: C.green, name: 'CW' },
              { key: 'cl', color: C.red, name: 'CL' },
            ]}
            lines={[
              { key: 'cwRate', color: C.blue, name: 'CW전환율', yAxisId: 'right' },
            ]}
          />

          {/* Aging Distribution */}
          <SectionTitle>Aging 분포</SectionTitle>
          {fs.agingSummary && <AgingPieChart data={fs.agingSummary} />}

          {/* Golden Time */}
          <SectionTitle>Golden Time</SectionTitle>
          {fs.goldenTime && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <CardWrap>
                <div style={{ fontSize: 13, color: C.secondary, fontWeight: 500, marginBottom: 8 }}>
                  견적 미발송
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.orange }}>
                  {safe(fs.goldenTime.noQuote)}
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.secondary, marginLeft: 4 }}>건</span>
                </div>
              </CardWrap>
              <CardWrap>
                <div style={{ fontSize: 13, color: C.secondary, fontWeight: 500, marginBottom: 8 }}>
                  Stale 4~7일
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.orange }}>
                  {safe(fs.goldenTime.stale4to7)}
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.secondary, marginLeft: 4 }}>건</span>
                </div>
              </CardWrap>
              <CardWrap>
                <div style={{ fontSize: 13, color: C.secondary, fontWeight: 500, marginBottom: 8 }}>
                  Stale 8일+
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: C.red }}>
                  {safe(fs.goldenTime.stale8plus)}
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.secondary, marginLeft: 4 }}>건</span>
                </div>
              </CardWrap>
            </div>
          )}

          {/* Carryover CW */}
          <SectionTitle>이월 포함 CW</SectionTitle>
          <OwnerBarChart
            data={fs.cwWithCarryover?.byUser || []}
            bars={[
              { key: 'thisMonthCW', color: C.green, name: '당월 CW' },
              { key: 'carryoverCW', color: C.blue, name: '이월 CW' },
            ]}
            stacked
          />

          {/* Loss Reasons */}
          <SectionTitle>Loss 사유 분포</SectionTitle>
          <HorizontalBarChart data={lossReasonData} color={C.red} />
        </div>
      )}

      {/* BO Tab */}
      {activeTab === 'bo' && bo && (
        <div>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <KPICard
              label="CW"
              value={safe(bo.cwConversionRate?.cw)}
              unit="건"
              prevValue={prevBo?.cwConversionRate?.cw}
              color={C.green}
            />
            <KPICard
              label="계약건수"
              value={safe(bo.contractSummary?.total)}
              unit="건"
              prevValue={prevBo?.contractSummary?.total}
              color={C.blue}
            />
            <KPICard
              label="일평균마감"
              value={pct(bo.dailyClose?.avg)}
              unit="건"
              prevValue={prevBo?.dailyClose?.avg}
              color={C.teal}
            />
            <KPICard
              label="잔량 (7일+)"
              value={safe(bo.sqlBacklog?.over7)}
              unit="건"
              color={C.red}
            />
          </div>

          {/* Contract Summary by BO */}
          <SectionTitle>BO 담당자별 계약</SectionTitle>
          <OwnerBarChart
            data={boContractData}
            bars={[
              { key: 'new', color: C.blue, name: '신규' },
              { key: 'addInstall', color: C.teal, name: '추가설치' },
            ]}
            stacked
          />

          {/* Daily Close Trend */}
          <SectionTitle>일별 마감 추이</SectionTitle>
          <TrendChart
            data={boTrendData}
            bars={[
              { key: 'cw', color: C.green, name: 'CW' },
              { key: 'cl', color: C.red, name: 'CL' },
            ]}
            lines={[
              { key: 'contracts', color: C.blue, name: '계약', yAxisId: 'left' },
            ]}
          />

          {/* CW Rate by Owner */}
          <SectionTitle>담당자별 CW (이월 포함)</SectionTitle>
          <OwnerBarChart
            data={bo.cwWithCarryover?.byUser || []}
            bars={[
              { key: 'thisMonthCW', color: C.green, name: '당월 CW' },
              { key: 'carryoverCW', color: C.blue, name: '이월 CW' },
            ]}
            stacked
          />

          {/* Backlog Trend */}
          <SectionTitle>잔량 추이</SectionTitle>
          <CardWrap>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={boTrendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: C.secondary }}
                  tickLine={false}
                  axisLine={{ stroke: C.border }}
                  tickFormatter={(v: string) => {
                    if (!v) return '';
                    const parts = v.split('-');
                    return parts.length >= 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : v;
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
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: C.secondary, paddingTop: 8 }}
                />
                <Area
                  type="monotone"
                  dataKey="sqlBacklogOpen"
                  name="전체 잔량"
                  fill={`${C.blue}20`}
                  stroke={C.blue}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="sqlBacklogOver7"
                  name="7일+ 잔량"
                  fill={`${C.red}20`}
                  stroke={C.red}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardWrap>

          {/* Daily Close Productivity */}
          <SectionTitle>일평균 마감 생산성</SectionTitle>
          <CardWrap>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart
                data={bo.dailyClose?.byUser || []}
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
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: C.secondary, paddingTop: 8 }}
                />
                <Bar
                  dataKey="avgDailyClose"
                  name="일평균 마감"
                  fill={C.purple}
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                />
                <ReferenceLine
                  y={safe(bo.dailyClose?.target, 0)}
                  stroke={C.red}
                  strokeDasharray="6 4"
                  label={{
                    value: `Target: ${safe(bo.dailyClose?.target, 0)}`,
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: C.red,
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardWrap>
        </div>
      )}
    </div>
  );
}
