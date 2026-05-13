'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { fetchExceptionTM, fetchKPIMonths } from '@/lib/api';
import TossBadge from '@/components/TossBadge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
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

const tooltipStyle = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  fontSize: 13,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

const thStyle: React.CSSProperties = { padding: '8px 10px', color: C.secondary, fontWeight: 600, fontSize: 13 };

// ============ Helpers ============

function CardWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: '32px 0 12px' }}>{children}</h3>;
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <CardWrap>
      <div style={{ fontSize: 13, color: C.secondary, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </CardWrap>
  );
}

function managementBadge(status: string) {
  const map: Record<string, { color: 'green' | 'yellow' | 'red'; label: string }> = {
    '관리중': { color: 'green', label: '관리중' },
    '관리느슨': { color: 'yellow', label: '관리느슨' },
    '방치의심': { color: 'red', label: '방치의심' },
  };
  const m = map[status] || { color: 'red' as const, label: status };
  return <TossBadge variant="fill" size="xsmall" color={m.color}>{m.label}</TossBadge>;
}

// ============ Main Page ============

export default function ExceptionTMPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchKPIMonths()
      .then((res) => {
        const m = res?.months || [];
        setMonths(m);
        if (m.length > 0) setSelectedMonth(m[0]);
      })
      .catch(() => setError('월 목록 로드 실패'));
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    setLoading(true);
    setError(null);
    setExpandedOwners(new Set());
    fetchExceptionTM(selectedMonth)
      .then(setData)
      .catch(() => setError('데이터 로드 실패'))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  const summary = data?.summary;
  // Support both field naming conventions from backend
  const section1 = data?.section1_ownerOverview || data?.section1_ownerConversion;
  const section2 = data?.section2_unconvertedBreakdown;
  const section3 = data?.section3_closedAnalysis;
  const section4 = data?.section4_activeManagement;

  // Section 2: Donut chart data
  const donutData = useMemo(() => {
    if (!section2) return [];
    return [
      { name: '종료', value: section2.closed?.total ?? 0, color: C.red },
      { name: '활성', value: section2.active?.total ?? 0, color: C.orange },
    ].filter(d => d.value > 0);
  }, [section2]);

  const donutTotal = useMemo(() => donutData.reduce((s, d) => s + d.value, 0), [donutData]);

  // Section 2: Closed reasons (support both byReason and byCategory)
  const closedReasons = useMemo(() => {
    const items = section2?.closed?.byReason || section2?.closed?.byCategory || [];
    return items.map((c: any) => ({ name: c.reason || c.category, value: c.count, rate: c.rate }));
  }, [section2]);

  // Section 2: Active age buckets
  const activeBuckets = useMemo(() => {
    return (section2?.active?.byAgeBucket || []).map((b: any) => ({ name: b.bucket, value: b.count, rate: b.rate }));
  }, [section2]);

  const activeBucketColors = ['#20C997', '#F59E0B', '#FF6B6B', '#F04452'];

  // Section 3: Closed reasons detail (support both byReason and byCategoryDetail)
  const closedAnalysisReasons = section3?.byReason || section3?.byCategoryDetail || [];

  const toggleOwner = (ownerId: string) => {
    setExpandedOwners(prev => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: C.secondary }}>로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: C.red }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0 }}>
            Exception Report: IS TM
          </h1>
          <p style={{ fontSize: 14, color: C.secondary, margin: '4px 0 0' }}>
            {data?.period?.label || ''} 미전환 예외 분석
          </p>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          style={{
            padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.border}`,
            fontSize: 14, color: C.text, background: C.bg,
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* Summary Cards — 3개 */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 8 }}>
          <StatCard
            label="전체 미전환율"
            value={`${summary.unconvertedRate ?? 0}%`}
            sub={`MQL ${summary.totalMQL ?? summary.mql ?? 0}건 중 ${(summary.unconvertedClosed ?? 0) + (summary.unconvertedActive ?? 0)}건 미전환`}
            color={C.red}
          />
          <StatCard
            label="종료 건수"
            value={`${summary.unconvertedClosed ?? 0}건`}
            sub="LossReason 있는 종료 건"
            color={C.orange}
          />
          <StatCard
            label="방치 의심"
            value={`${summary.staleCaseCount ?? 0}건`}
            sub="활성 중 6일+ 무터치"
            color={summary.staleCaseCount > 0 ? C.red : C.green}
          />
        </div>
      )}

      {/* ================================================================ */}
      {/* Section 1: 담당자별 전환율 + 보유건 */}
      {/* ================================================================ */}
      {section1 && section1.length > 0 && (
        <>
          <SectionTitle>담당자별 전환율 + 보유건</SectionTitle>
          <CardWrap>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>담당자</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>MQL</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>SQL</th>
                    <th style={{ ...thStyle, textAlign: 'left', minWidth: 180 }}>전환율</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>활성 보유</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>종료</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>FRT 중앙값</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>FRT 20분내</th>
                  </tr>
                </thead>
                <tbody>
                  {section1.map((o: any) => {
                    const sqlVal = o.sql ?? o.converted ?? 0;
                    const rate = o.conversionRate ?? o.convertedRate ?? (o.mql > 0 ? +((sqlVal / o.mql) * 100).toFixed(1) : 0);
                    return (
                      <tr key={o.ownerId} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '10px', fontWeight: 600, color: C.text }}>
                          {o.ownerName}
                          {o.structuralFlags && o.structuralFlags.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                              {o.structuralFlags.map((flag: string, fi: number) => (
                                <TossBadge
                                  key={fi}
                                  variant="weak"
                                  size="xsmall"
                                  color={flag.includes('품질') ? 'yellow' : flag.includes('지연') ? 'red' : 'purple'}
                                >
                                  {flag}
                                </TossBadge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{o.mql}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>{sqlVal}</td>
                        <td style={{ padding: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 16, background: '#F2F4F6', borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{
                                width: `${Math.min(rate, 100)}%`,
                                height: '100%',
                                background: rate >= 80 ? C.green : rate >= 60 ? C.orange : C.red,
                                borderRadius: 4,
                                transition: 'width 0.3s',
                              }} />
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, minWidth: 42 }}>{rate}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {(o.activeCount ?? o.unconvertedActive ?? 0) > 0
                            ? <TossBadge variant="weak" size="xsmall" color="yellow">{o.activeCount ?? o.unconvertedActive}</TossBadge>
                            : <span style={{ color: C.muted }}>0</span>}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {(o.closedCount ?? o.unconvertedClosed ?? 0) > 0
                            ? <TossBadge variant="weak" size="xsmall" color="red">{o.closedCount ?? o.unconvertedClosed}</TossBadge>
                            : <span style={{ color: C.muted }}>0</span>}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {o.frt?.median != null ? (
                            <>
                              <TossBadge variant="weak" size="xsmall" color={o.frt.median <= 20 ? 'green' : o.frt.median <= 30 ? 'yellow' : 'red'}>
                                {o.frt.median}분
                              </TossBadge>
                              {o.frt.p25 != null && o.frt.p75 != null && (
                                <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>({o.frt.p25}~{o.frt.p75})</span>
                              )}
                            </>
                          ) : <span style={{ color: C.muted }}>-</span>}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {o.frt?.within20minRate != null
                            ? <TossBadge variant="weak" size="xsmall" color={o.frt.within20minRate >= 80 ? 'green' : 'red'}>{o.frt.within20minRate}%</TossBadge>
                            : <span style={{ color: C.muted }}>-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardWrap>
        </>
      )}

      {/* ================================================================ */}
      {/* Section 2: 미전환 건 대분류 */}
      {/* ================================================================ */}
      {section2 && (
        <>
          <SectionTitle>미전환 건 대분류</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
            {/* Donut Chart */}
            <CardWrap style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'relative', width: 200, height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v}건`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{donutTotal}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>미전환</div>
                </div>
              </div>
              <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: C.secondary }}>
                종료 {section2.closed?.total ?? 0}건 ({donutTotal > 0 ? ((section2.closed?.total ?? 0) / donutTotal * 100).toFixed(0) : 0}%)
                {' / '}
                활성 {section2.active?.total ?? 0}건 ({donutTotal > 0 ? ((section2.active?.total ?? 0) / donutTotal * 100).toFixed(0) : 0}%)
              </div>
            </CardWrap>

            {/* Right: Closed reasons + Active age */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Closed reasons horizontal bar */}
              <CardWrap style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: C.secondary, fontWeight: 600, marginBottom: 8 }}>
                  종료 사유별 ({section2.closed?.total ?? 0}건)
                </div>
                {closedReasons.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(closedReasons.length * 32, 120)}>
                    <BarChart data={closedReasons} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: C.secondary }} tickLine={false} axisLine={false} width={80} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: string, entry: any) => [`${v}건 (${entry.payload.rate}%)`, '건수']} />
                      <Bar dataKey="value" fill={C.red} radius={[0, 4, 4, 0]} barSize={18} name="건수"
                        label={{ position: 'right', fontSize: 11, fill: C.secondary, formatter: (v: number) => `${v}건` }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: 12, textAlign: 'center', color: C.muted }}>종료 건 없음</div>
                )}
              </CardWrap>

              {/* Active age buckets horizontal bar */}
              <CardWrap style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: C.secondary, fontWeight: 600, marginBottom: 8 }}>
                  활성 경과일 ({section2.active?.total ?? 0}건)
                </div>
                {activeBuckets.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(activeBuckets.length * 32, 100)}>
                    <BarChart data={activeBuckets} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: C.secondary }} tickLine={false} axisLine={false} width={80} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _: string, entry: any) => [`${v}건 (${entry.payload.rate}%)`, '건수']} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18} name="건수"
                        label={{ position: 'right', fontSize: 11, fill: C.secondary, formatter: (v: number) => `${v}건` }}
                      >
                        {activeBuckets.map((_: any, idx: number) => (
                          <Cell key={idx} fill={activeBucketColors[idx] || C.blue} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: 12, textAlign: 'center', color: C.muted }}>활성 건 없음</div>
                )}
              </CardWrap>
            </div>
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* Section 3: 종료 건 — 사유 + 속도 분석 */}
      {/* ================================================================ */}
      {section3 && (
        <>
          <SectionTitle>종료 건 — 사유 + 속도 분석</SectionTitle>

          {/* 3-1: Reason detail table */}
          {closedAnalysisReasons.length > 0 && (
            <CardWrap style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: C.secondary, fontWeight: 600, marginBottom: 12 }}>종료 사유별 분석</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>종료 사유</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>건수</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>비율</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>FRT 중앙값</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>터치 중앙값</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>관리기간 중앙값</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>1~2회 종료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedAnalysisReasons.map((c: any) => (
                      <tr key={c.reason || c.category} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: C.text }}>{c.reason || c.category}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{c.count}건</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{c.rate}%</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {c.frtMedian != null ? (
                            <TossBadge variant="weak" size="xsmall" color={c.frtMedian <= 20 ? 'green' : c.frtMedian <= 30 ? 'yellow' : 'red'}>
                              {c.frtMedian}분
                            </TossBadge>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{c.touchMedian ?? '-'}회</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{c.managementDaysMedian != null ? `${c.managementDaysMedian}일` : '-'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {c.quickCloseRate != null ? (
                            <TossBadge variant="weak" size="xsmall" color={c.quickCloseRate > 40 ? 'red' : 'green'}>
                              {c.quickCloseRate}%
                            </TossBadge>
                          ) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardWrap>
          )}

          {/* 3-2: Quick close highlight card */}
          {section3.quickClose && (
            <CardWrap style={{ marginBottom: 16, background: '#FFF8F0', borderColor: '#FFE0B2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>&#x1F4A1;</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>빠른 포기 하이라이트</span>
              </div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.8 }}>
                <div>
                  전체 종료 건 중 1~2회 터치 종료: <strong style={{ color: C.red }}>{section3.quickClose.total}건 ({section3.quickClose.rateOfClosed}%)</strong>
                </div>
                <div>
                  이 중 FRT 20분 이내: <strong style={{ color: C.orange }}>{section3.quickClose.frtWithin20minRate}%</strong>
                  <span style={{ color: C.muted }}> — 빠르게 잡았는데도 1~2회로 포기</span>
                </div>
                {section3.quickClose.topReasons && section3.quickClose.topReasons.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    사유 Top: {section3.quickClose.topReasons.map((r: any, i: number) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        <TossBadge variant="weak" size="xsmall" color="elephant">{r.reason} {r.count}건</TossBadge>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </CardWrap>
          )}

          {/* 3-3: FRT bucket conversion/closed rate table */}
          {section3.byFRTBucket && section3.byFRTBucket.length > 0 && (
            <CardWrap style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: C.secondary, fontWeight: 600, marginBottom: 12 }}>FRT 구간별 전환/종료 비교</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>FRT 구간</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>전체 MQL</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>전환</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>종료</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>전환율</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>종료율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section3.byFRTBucket.map((b: any) => (
                      <tr key={b.bucket} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: C.text }}>{b.bucket}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{b.totalMQL ?? b.total}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{b.converted}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{b.closed}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <TossBadge variant="weak" size="xsmall" color={b.conversionRate >= 50 ? 'green' : 'red'}>
                            {b.conversionRate}%
                          </TossBadge>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <TossBadge variant="weak" size="xsmall" color={b.closedRate > 50 ? 'red' : 'green'}>
                            {b.closedRate}%
                          </TossBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardWrap>
          )}

          {/* Insights */}
          {section3.insights && section3.insights.length > 0 && (
            <CardWrap style={{ background: '#F8FAFF', borderColor: '#D6EAFF' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 8 }}>인사이트</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: C.text, lineHeight: 1.8 }}>
                {section3.insights.map((insight: string, i: number) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </CardWrap>
          )}
        </>
      )}

      {/* ================================================================ */}
      {/* Section 4: 활성 건 — 관리 현황 (접기/펼치기) */}
      {/* ================================================================ */}
      {section4?.byOwner && section4.byOwner.length > 0 && (
        <>
          <SectionTitle>활성 건 — 관리 현황</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {section4.byOwner.map((owner: any) => {
              const oid = owner.ownerId || owner.ownerName;
              const isOpen = expandedOwners.has(oid);
              const managed = owner.managed ?? owner.normal ?? 0;
              const loose = owner.loose ?? owner.caution ?? 0;
              const stale = owner.stale ?? 0;

              return (
                <CardWrap key={oid} style={{ padding: 0, overflow: 'hidden' }}>
                  {/* Owner header — click to toggle */}
                  <button
                    onClick={() => toggleOwner(oid)}
                    style={{
                      width: '100%', padding: '14px 20px', background: 'none', border: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                      fontSize: 14, fontWeight: 600, color: C.text, textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 12, color: C.muted }}>{isOpen ? '\u25BC' : '\u25B6'}</span>
                    <span>{owner.ownerName}</span>
                    <span style={{ color: C.secondary, fontWeight: 400 }}>
                      — 활성 {owner.activeCount}건
                    </span>
                    <span style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                      {managed > 0 && <TossBadge variant="weak" size="xsmall" color="green">관리중 {managed}</TossBadge>}
                      {loose > 0 && <TossBadge variant="weak" size="xsmall" color="yellow">관리느슨 {loose}</TossBadge>}
                      {stale > 0 && <TossBadge variant="fill" size="xsmall" color="red">방치의심 {stale}</TossBadge>}
                    </span>
                  </button>

                  {/* Expanded lead list */}
                  {isOpen && owner.leads && owner.leads.length > 0 && (
                    <div style={{ borderTop: `1px solid ${C.border}`, overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: C.bgSub }}>
                            <th style={{ ...thStyle, textAlign: 'left' }}>매장명</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>상태</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>경과일</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Task</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>부재중</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>마지막 활동</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>관리상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {owner.leads.map((lead: any) => {
                            const isStale = lead.highlight?.isStale || lead.managementStatus === '방치의심';
                            const ageDaysOver7 = lead.highlight?.ageDaysOver7 || lead.ageDays > 7;
                            return (
                              <tr
                                key={lead.leadId}
                                style={{
                                  borderBottom: `1px solid ${C.border}`,
                                  background: isStale ? '#FFF5F5' : undefined,
                                }}
                              >
                                <td style={{ padding: '8px 10px', fontWeight: 600, color: C.text }}>
                                  {lead.company || lead.leadName || '-'}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  <TossBadge variant="weak" size="xsmall" color={
                                    lead.status === '부재중' ? 'red'
                                    : lead.status === '미접촉' ? 'elephant'
                                    : lead.status === '리터치예정' ? 'yellow'
                                    : lead.status === '고민중' ? 'purple'
                                    : 'teal'
                                  }>
                                    {lead.status || '-'}
                                  </TossBadge>
                                </td>
                                <td style={{
                                  padding: '8px 10px', textAlign: 'right',
                                  background: ageDaysOver7 ? '#FFF0F0' : undefined,
                                  color: ageDaysOver7 ? C.red : C.text,
                                  fontWeight: ageDaysOver7 ? 700 : 400,
                                }}>
                                  {lead.ageDays}일
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{lead.taskCount}회</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  {lead.missedCount > 0 ? (
                                    <TossBadge
                                      variant={lead.highlight?.missedOver3 || lead.missedCount >= 3 ? 'fill' : 'weak'}
                                      size="xsmall"
                                      color="red"
                                    >
                                      {lead.missedLabel || `부재 ${lead.missedCount}차`}
                                    </TossBadge>
                                  ) : (
                                    <span style={{ color: C.muted }}>-</span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 10px', fontSize: 12, color: C.secondary }}>
                                  {lead.lastActivity?.label || '(활동 없음)'}
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                  {managementBadge(lead.managementStatus)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isOpen && (!owner.leads || owner.leads.length === 0) && (
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: 16, textAlign: 'center', color: C.muted, fontSize: 13 }}>
                      활성 리드 없음
                    </div>
                  )}
                </CardWrap>
              );
            })}
          </div>
        </>
      )}

      {/* Footer */}
      {data?.generatedAt && (
        <div style={{ textAlign: 'right', marginTop: 32, fontSize: 12, color: C.muted }}>
          데이터 생성: {new Date(data.generatedAt).toLocaleString('ko-KR')}
        </div>
      )}
    </div>
  );
}
