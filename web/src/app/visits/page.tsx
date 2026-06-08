'use client';

import { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar,
} from 'recharts';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4003';

type Summary = {
  generatedAt: string;
  period: { start: string; end: string };
  total: { opps: number; cw: number; cl: number; open: number; stuck: number; cwRate: number };
  byStage: { stage: string; count: number }[];
  byOwner: { owner: string; visits: number; cw: number; cl: number; stuck: number; open: number; closed: number; cwRate: number }[];
  trend: { date: string; visits: number; cw: number }[];
};

type StuckItem = {
  oppId: string;
  name: string;
  owner: string;
  stage: string;
  sido: string;
  sigugun: string;
  firstVisit: string;
  lastTaskDate: string;
  daysSinceLastTask: number;
  lastTaskSubject: string;
  hasOpenTask: boolean;
  lightningUrl: string;
};

const STAGE_COLORS: Record<string, string> = {
  '견적': '#ff9800',
  'Closed Won': '#2e7d32',
  'Closed Lost': '#d32f2f',
  '방문배정': '#1976d2',
  '계약 연장 제안': '#9c27b0',
  '계약진행': '#0288d1',
  '출고진행': '#388e3c',
  '선납금': '#f57c00',
  '방문상담': '#7b1fa2',
  '설치진행': '#00796b',
};
const fallbackColor = (i: number) => ['#607d8b', '#5d4037', '#455a64', '#827717', '#3e2723'][i % 5];

export default function VisitsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stuck, setStuck] = useState<StuckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, st] = await Promise.all([
          fetch(`${API}/api/visits/summary`).then(r => r.json()),
          fetch(`${API}/api/visits/stuck`).then(r => r.json()),
        ]);
        setSummary(s);
        setStuck(st.items || []);
      } catch (e: unknown) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ padding: 40 }}>불러오는 중…</div>;
  if (err) return <div style={{ padding: 40, color: '#d32f2f' }}>오류: {err}</div>;
  if (!summary) return <div style={{ padding: 40 }}>데이터 없음</div>;

  const t = summary.total;

  return (
    <div style={{ padding: '24px 40px', maxWidth: 1400, margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.7em', fontWeight: 600, marginBottom: 6 }}>방문 트래킹</h1>
        <div style={{ color: '#666', fontSize: '0.9em' }}>
          기간 {summary.period.start} ~ {summary.period.end} · 데이터 생성 {summary.generatedAt.slice(0, 16).replace('T', ' ')}
        </div>
      </div>

      {/* KPI 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        <Kpi label="방문 Opp 총" value={t.opps} />
        <Kpi label="계약 (CW)" value={t.cw} sub={`${t.cwRate}%`} color="#2e7d32" />
        <Kpi label="실주 (CL)" value={t.cl} color="#d32f2f" />
        <Kpi label="진행 중" value={t.open} color="#1976d2" />
        <Kpi label="견적 8일+ 정체" value={t.stuck} color="#ff9800" highlight />
      </div>

      {/* 단계 분포 + 일별 추이 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 24 }}>
        <Card title="단계 분포">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={summary.byStage} dataKey="count" nameKey="stage" cx="50%" cy="50%" outerRadius={90} label={(e: { stage: string; count: number }) => `${e.stage} ${e.count}`}>
                {summary.byStage.map((s, i) => (
                  <Cell key={s.stage} fill={STAGE_COLORS[s.stage] || fallbackColor(i)} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card title="일별 방문 → 계약 추이">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={summary.trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="visits" stroke="#1976d2" name="방문 건수" />
              <Line type="monotone" dataKey="cw" stroke="#2e7d32" name="계약 (CW)" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* 담당자별 표 */}
      <Card title={`담당자별 (${summary.byOwner.length}명)`}>
        <div style={{ overflow: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>담당자</th>
                <th style={thNum}>방문 Opp</th>
                <th style={thNum}>CW</th>
                <th style={thNum}>CL</th>
                <th style={thNum}>진행 중</th>
                <th style={thNum}>견적 정체</th>
                <th style={thNum}>CW 전환율</th>
              </tr>
            </thead>
            <tbody>
              {summary.byOwner.map(o => (
                <tr key={o.owner} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>{o.owner}</td>
                  <td style={tdNum}>{o.visits}</td>
                  <td style={{ ...tdNum, color: '#2e7d32', fontWeight: 600 }}>{o.cw}</td>
                  <td style={{ ...tdNum, color: '#d32f2f' }}>{o.cl}</td>
                  <td style={tdNum}>{o.open}</td>
                  <td style={{ ...tdNum, color: o.stuck > 0 ? '#ff9800' : '#999', fontWeight: o.stuck > 0 ? 600 : 400 }}>{o.stuck}</td>
                  <td style={{ ...tdNum, fontWeight: 600 }}>{o.closed > 0 ? `${o.cwRate}%` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 견적 정체 리스트 — 핵심 인사이트 */}
      <div style={{ marginTop: 24 }} />
      <Card title={`견적 단계 8일+ 정체 ${stuck.length}건 — 마지막 활동 이후 경과일 순`} accent="#ff9800">
        <div style={{ overflow: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#fff3e0' }}>
                <th style={th}>매장</th>
                <th style={th}>담당</th>
                <th style={th}>지역</th>
                <th style={th}>첫 방문</th>
                <th style={th}>마지막 활동</th>
                <th style={thNum}>경과일</th>
                <th style={th}>마지막 task</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {stuck.map(s => (
                <tr key={s.oppId} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>{s.name}</td>
                  <td style={td}>{s.owner}</td>
                  <td style={td}>{s.sido} {s.sigugun}</td>
                  <td style={td}>{s.firstVisit}</td>
                  <td style={td}>{s.lastTaskDate}</td>
                  <td style={{ ...tdNum, color: s.daysSinceLastTask >= 20 ? '#d32f2f' : '#ff9800', fontWeight: 600 }}>{s.daysSinceLastTask}일</td>
                  <td style={{ ...td, fontSize: '0.85em', color: '#666' }}>{s.lastTaskSubject}</td>
                  <td style={td}>
                    <a href={s.lightningUrl} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#1976d2', textDecoration: 'none', fontSize: '0.85em' }}>SF →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, color, highlight }: { label: string; value: number; sub?: string; color?: string; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? '#fff8e1' : '#fff',
      border: highlight ? '1px solid #ffb74d' : '1px solid #e0e0e0',
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: '0.82em', color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.6em', fontWeight: 700, color: color || '#222' }}>{value.toLocaleString()}</div>
      {sub && <div style={{ fontSize: '0.85em', color: '#666', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Card({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
      <div style={{
        fontSize: '0.95em', fontWeight: 600, marginBottom: 12,
        paddingLeft: 10, borderLeft: `3px solid ${accent || '#1976d2'}`,
      }}>{title}</div>
      {children}
    </div>
  );
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.88em' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: '0.85em', color: '#555' };
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px 10px' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right' };
