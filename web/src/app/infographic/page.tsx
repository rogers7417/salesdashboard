'use client';

import React from 'react';

// ============ Design Tokens ============
const C = {
  bg1: '#0F172A', bg2: '#1E293B',
  card: 'rgba(255,255,255,0.05)',
  cardBorder: 'rgba(255,255,255,0.08)',
  white: '#FFFFFF', textSub: '#94A3B8', textMuted: '#64748B',
  blue: '#3182F6', green: '#20C997', red: '#F04452',
  orange: '#FF8C00', teal: '#0EA5E9', purple: '#8B5CF6',
  yellow: '#FBBF24',
};

const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif';

const sectionStyle: React.CSSProperties = {
  background: C.card, border: `1px solid ${C.cardBorder}`,
  borderRadius: 24, padding: '40px 36px', marginBottom: 32,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 24, fontWeight: 800, color: C.white, marginBottom: 8,
};

const insightBox: React.CSSProperties = {
  marginTop: 24, padding: '16px 20px', borderRadius: 12,
  background: 'rgba(49,130,246,0.1)', borderLeft: `4px solid ${C.blue}`,
  fontSize: 15, lineHeight: 1.7, color: C.textSub,
};

// ============ Section 1: Pipeline Funnel ============
function PipelineFunnel() {
  const steps = [
    { label: 'Lead', value: 997, pct: 100, color: C.blue },
    { label: 'MQL', value: 516, pct: 51.8, color: C.teal },
    { label: 'SQL', value: 470, pct: 47.1, color: C.green },
    { label: 'CW', value: 233, pct: 23.4, color: C.purple },
  ];
  const conversions = [
    { label: 'Lead→MQL', rate: '51.8%', icon: '' },
    { label: 'MQL→SQL', rate: '91.1%', icon: ' ✅' },
    { label: 'SQL→CW', rate: '54.2%', detail: '당월 77 + 이월 156' },
  ];

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>3월 인바운드 파이프라인</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>Lead → MQL → SQL → CW 전환 퍼널</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((s, i) => (
          <React.Fragment key={s.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0' }}>
              <div style={{ width: 48, fontSize: 14, fontWeight: 700, color: C.textSub, textAlign: 'right' }}>{s.label}</div>
              <div style={{ flex: 1, position: 'relative' }}>
                <div style={{
                  width: `${Math.max(s.pct, 12)}%`, height: 40, borderRadius: 8,
                  background: `linear-gradient(90deg, ${s.color}, ${s.color}99)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 12,
                  transition: 'width 0.6s ease',
                }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: C.white }}>{s.value.toLocaleString()}건</span>
                </div>
              </div>
              <div style={{ width: 60, fontSize: 13, color: C.textMuted, textAlign: 'right' }}>{s.pct}%</div>
            </div>
            {i < conversions.length && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '2px 0' }}>
                <div style={{ width: 48 }} />
                <div style={{ fontSize: 12, color: C.textMuted, paddingLeft: 8 }}>
                  ▼ {conversions[i].label} {conversions[i].rate}{conversions[i].icon || ''}
                  {conversions[i].detail && <span style={{ color: C.textMuted, marginLeft: 8 }}>({conversions[i].detail})</span>}
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* CW 분리 */}
      <div style={{
        marginTop: 20, padding: '14px 20px', borderRadius: 12,
        background: 'rgba(139,92,246,0.1)', border: `1px solid rgba(139,92,246,0.2)`,
      }}>
        <div style={{ fontSize: 15, color: C.white, fontWeight: 600, marginBottom: 8 }}>
          CW 233건 = 당월 77건 (33%) + 이월 156건 (67%)
        </div>
        <div style={{ display: 'flex', gap: 0, height: 8, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: '33%', background: C.blue }} />
          <div style={{ width: '67%', background: C.orange }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: C.textMuted }}>
          <span>당월 33%</span>
          <span>이월 67%</span>
        </div>
      </div>

      {/* Tablet */}
      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <span style={{ fontSize: 14, color: C.textMuted }}>태블릿 총 </span>
        <span style={{ fontSize: 32, fontWeight: 800, color: C.yellow }}>2,685</span>
        <span style={{ fontSize: 14, color: C.textMuted }}> 대</span>
      </div>
    </div>
  );
}

// ============ Section 2: BO Weekly Pattern ============
function BOWeeklyPattern() {
  const weeks = [
    { label: 'W1', period: '1~7일', cw: 42, carry: 42, thisMonth: 0, carryPct: 100 },
    { label: 'W2', period: '8~14일', cw: 53, carry: 41, thisMonth: 12, carryPct: 77 },
    { label: 'W3', period: '15~21일', cw: 53, carry: 35, thisMonth: 18, carryPct: 66 },
    { label: 'W4', period: '22~31일', cw: 89, carry: 42, thisMonth: 47, carryPct: 47 },
  ];
  const maxCW = Math.max(...weeks.map(w => w.cw));

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>BO는 언제 CW를 만드는가?</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>3월 주차별 CW 처리 패턴</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {weeks.map(w => {
          const totalWidth = (w.cw / maxCW) * 100;
          const carryWidth = (w.carry / w.cw) * totalWidth;
          const thisWidth = totalWidth - carryWidth;
          return (
            <div key={w.label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <div style={{ width: 100, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.white }}>{w.label}</span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{w.period}</span>
                </div>
                <div style={{ flex: 1, display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${carryWidth}%`, background: C.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: carryWidth > 5 ? 30 : 0 }}>
                    {carryWidth > 10 && <span style={{ fontSize: 11, fontWeight: 700, color: C.white }}>{w.carry}</span>}
                  </div>
                  <div style={{ width: `${thisWidth}%`, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: thisWidth > 5 ? 30 : 0 }}>
                    {thisWidth > 10 && <span style={{ fontSize: 11, fontWeight: 700, color: C.white }}>{w.thisMonth}</span>}
                  </div>
                </div>
                <div style={{ width: 80, textAlign: 'right' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: C.white }}>{w.cw}건</span>
                </div>
                <div style={{ width: 70, textAlign: 'right' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: w.carryPct >= 80 ? C.orange : C.textSub }}>이월 {w.carryPct}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 24, marginTop: 20, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: C.orange }} />
          <span style={{ fontSize: 13, color: C.textSub }}>이월건</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: C.blue }} />
          <span style={{ fontSize: 13, color: C.textSub }}>당월 신규</span>
        </div>
      </div>

      <div style={insightBox}>
        월초 2주는 이월건 정리에 집중. <b style={{ color: C.white }}>당월 신규 CW는 3주차부터 본격 발생.</b>
      </div>
    </div>
  );
}

// ============ Section 3: Lead Time Comparison ============
function LeadTimeComparison() {
  const gauges = [
    { label: '영업중', median: 29, color: C.blue, dist: [12, 26, 74] },
    { label: '오픈전', median: 30, color: C.orange, dist: [4, 21, 79] },
  ];

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>오픈전이라서 느린 걸까?</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>SQL→CW 리드타임 비교</div>

      {/* Gauges */}
      <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginBottom: 32 }}>
        {gauges.map(g => (
          <div key={g.label} style={{ textAlign: 'center', flex: 1, maxWidth: 260 }}>
            <div style={{ position: 'relative', width: 180, height: 100, margin: '0 auto' }}>
              {/* Semi-circle background */}
              <svg viewBox="0 0 180 100" style={{ width: '100%', height: '100%' }}>
                <path d="M 10 95 A 80 80 0 0 1 170 95" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="16" strokeLinecap="round" />
                <path d="M 10 95 A 80 80 0 0 1 170 95" fill="none" stroke={g.color} strokeWidth="16" strokeLinecap="round"
                  strokeDasharray={`${(g.median / 60) * 251} 251`} />
              </svg>
              <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: C.white }}>{g.median}</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>일 (중앙값)</div>
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: g.color, marginTop: 8 }}>{g.label}</div>
          </div>
        ))}
      </div>

      {/* Center insight */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: C.yellow }}>차이 없음. 둘 다 약 30일.</span>
      </div>

      {/* Distribution bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {gauges.map(g => (
          <div key={g.label}>
            <div style={{ fontSize: 13, fontWeight: 600, color: g.color, marginBottom: 6 }}>{g.label}</div>
            <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${g.dist[0]}%`, background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.white }}>{g.dist[0]}%</span>
              </div>
              <div style={{ width: `${g.dist[1] - g.dist[0]}%`, background: C.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.white }}>{g.dist[1]}%</span>
              </div>
              <div style={{ width: `${100 - g.dist[1]}%`, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub }}>{g.dist[2]}%</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: C.textMuted }}>
              <span>14일 이내</span>
              <span>21일 이내</span>
              <span>21일+</span>
            </div>
          </div>
        ))}
      </div>

      <div style={insightBox}>
        오픈전이라서 느린 게 아니라, <b style={{ color: C.white }}>파이프라인 자체가 평균 1달 걸리는 구조.</b>
      </div>
    </div>
  );
}

// ============ Section 4: April Forecast ============
function AprilForecast() {
  const scenarios = [
    { label: '보수적', carryover: 150, tablets: 1650, needed: 950, color: C.red },
    { label: '기본', carryover: 170, tablets: 1870, needed: 730, color: C.blue },
    { label: '낙관적', carryover: 200, tablets: 2200, needed: 400, color: C.green },
  ];

  return (
    <div style={sectionStyle}>
      <div style={sectionTitle}>4월 목표 2,600대, 달성 가능한가?</div>
      <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 28 }}>저금통 구조 — 3월말 잔량 → 4월 이월 CW</div>

      {/* Piggy bank flow */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: '24px 0', marginBottom: 28,
      }}>
        <div style={{ textAlign: 'center', padding: '16px 20px', borderRadius: 12, background: 'rgba(255,140,0,0.15)', border: `1px solid rgba(255,140,0,0.3)` }}>
          <div style={{ fontSize: 13, color: C.orange, fontWeight: 600 }}>3월말 잔량</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.white, marginTop: 4 }}>259건</div>
        </div>
        <div style={{ fontSize: 24, color: C.textMuted }}>→</div>
        <div style={{ textAlign: 'center', padding: '16px 24px', borderRadius: 16, background: 'rgba(49,130,246,0.15)', border: `1px solid rgba(49,130,246,0.3)` }}>
          <div style={{ fontSize: 13, color: C.blue, fontWeight: 600 }}>4월 저금통</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 4 }}>이월 CW</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.white, marginTop: 4 }}>150~200건</div>
        </div>
        <div style={{ fontSize: 24, color: C.textMuted }}>→</div>
        <div style={{ textAlign: 'center', padding: '16px 20px', borderRadius: 12, background: 'rgba(32,201,151,0.15)', border: `1px solid rgba(32,201,151,0.3)` }}>
          <div style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>태블릿</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.white, marginTop: 4 }}>1,650~2,200</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>대</div>
        </div>
      </div>

      {/* Target bar */}
      <div style={{ marginBottom: 28, padding: '0 20px' }}>
        <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8 }}>목표 2,600대 = 이월 + 당월</div>
        <div style={{ position: 'relative', height: 16, background: 'rgba(255,255,255,0.1)', borderRadius: 8 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '72%', borderRadius: 8, background: `linear-gradient(90deg, ${C.orange}, ${C.blue})` }} />
          <div style={{ position: 'absolute', right: 0, top: -20, fontSize: 12, color: C.yellow, fontWeight: 700 }}>2,600</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: C.textMuted }}>
          <span>이월 1,650~2,200대</span>
          <span>당월 400~950대</span>
        </div>
      </div>

      {/* Scenario cards */}
      <div style={{ display: 'flex', gap: 16 }}>
        {scenarios.map(s => (
          <div key={s.label} style={{
            flex: 1, textAlign: 'center', padding: '24px 16px', borderRadius: 16,
            background: `${s.color}10`, border: `1px solid ${s.color}30`,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.color, marginBottom: 12 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>이월</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.white }}>{s.carryover}건</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{s.tablets.toLocaleString()}대</div>
            <div style={{ margin: '12px auto', width: 40, height: 1, background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ fontSize: 12, color: C.textMuted }}>당월 필요</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.needed}대</div>
          </div>
        ))}
      </div>

      <div style={{ ...insightBox, background: 'rgba(251,191,36,0.1)', borderLeftColor: C.yellow }}>
        <b style={{ color: C.yellow }}>Lead는 넉넉. 핵심은 BO 마감 속도.</b>
      </div>
    </div>
  );
}

// ============ Main Page ============
export default function InfographicPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(180deg, ${C.bg1} 0%, ${C.bg2} 100%)`,
      padding: '48px 24px 80px',
      fontFamily,
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.blue, letterSpacing: 2, marginBottom: 8 }}>SALES PIPELINE INSIGHT</div>
          <h1 style={{ fontSize: 40, fontWeight: 800, color: C.white, margin: 0, lineHeight: 1.3 }}>
            3월 세일즈 파이프라인
          </h1>
          <div style={{ fontSize: 16, color: C.textSub, marginTop: 12 }}>
            인바운드 세일즈 · 2025.03 · 구조적 분석
          </div>
        </div>

        <PipelineFunnel />
        <BOWeeklyPattern />
        <LeadTimeComparison />
        <AprilForecast />

        {/* Footer */}
        <div style={{ textAlign: 'center', paddingTop: 24, fontSize: 13, color: C.textMuted }}>
          Generated from Salesforce data · {new Date().toISOString().slice(0, 10)}
        </div>
      </div>
    </div>
  );
}
