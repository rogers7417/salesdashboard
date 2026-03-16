'use client';

import React from 'react';

interface DailyData {
  day: number;
  dayOfWeek: number;
  isWeekend: boolean;
  count: number;
}

interface AMHeatmapEntry {
  owner: string;
  dailyData: DailyData[];
  total: number;
  maxDay: number;
  zeroDays: number;
  role: string;
}

interface CalendarMeta {
  year: number;
  month: number;
  today: number;
  lastDayOfMonth: number;
  firstDayOfWeek: number;
  dayNames: string[];
}

interface LeadHeatmapProps {
  data: AMHeatmapEntry[];
  calendarMeta: CalendarMeta;
  maxValue: number;
}

function getHeatColor(count: number, maxVal: number, isWeekend: boolean, isFuture: boolean): React.CSSProperties {
  if (isFuture) {
    return { background: '#f5f5f5', color: '#ccc' };
  }
  if (isWeekend) {
    if (count === 0) return { background: '#f0f0f0', color: '#bbb' };
    return { background: '#fff3e0', color: '#e65100' };
  }
  if (count === 0) {
    return { background: '#fff', color: '#e53935', border: '1px solid #ffcdd2' };
  }

  // 색상 강도 계산
  const intensity = Math.min(count / Math.max(maxVal, 5), 1);
  if (intensity <= 0.2) return { background: '#fff8e1', color: '#f57f17' };
  if (intensity <= 0.4) return { background: '#ffecb3', color: '#e65100' };
  if (intensity <= 0.6) return { background: '#ffe082', color: '#bf360c' };
  if (intensity <= 0.8) return { background: '#ffd54f', color: '#bf360c' };
  return { background: '#ffb300', color: '#fff', fontWeight: 700 };
}

export default function LeadHeatmap({ data, calendarMeta, maxValue }: LeadHeatmapProps) {
  if (!data || data.length === 0 || !calendarMeta) return null;

  const { year, month, today, lastDayOfMonth, firstDayOfWeek, dayNames } = calendarMeta;

  // 전체 캘린더 셀 생성 (1일~말일)
  const allDays: { day: number; dayOfWeek: number; isWeekend: boolean }[] = [];
  for (let d = 1; d <= lastDayOfMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    allDays.push({ day: d, dayOfWeek: dow, isWeekend: dow === 0 || dow === 6 });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
      {data.map((am) => {
        // dailyData를 day 기준 맵으로 변환
        const countByDay: Record<number, number> = {};
        am.dailyData.forEach(d => { countByDay[d.day] = d.count; });

        // 캘린더 셀 (빈 셀 포함)
        const cells: (typeof allDays[0] | null)[] = [];
        for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
        allDays.forEach(d => cells.push(d));
        while (cells.length % 7 !== 0) cells.push(null);

        return (
          <div key={am.owner} style={{
            background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0',
            padding: '12px',
          }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9em', color: '#333' }}>
                {am.owner}
              </span>
              <div style={{ display: 'flex', gap: '8px', fontSize: '0.75em' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '10px',
                  background: '#e8f5e9', color: '#2e7d32', fontWeight: 600,
                }}>
                  {am.total}건
                </span>
                {am.zeroDays > 0 && (
                  <span style={{
                    padding: '2px 8px', borderRadius: '10px',
                    background: '#ffebee', color: '#c62828', fontWeight: 600,
                  }}>
                    0건 {am.zeroDays}일
                  </span>
                )}
              </div>
            </div>

            {/* 미니 캘린더 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
              {/* 요일 헤더 */}
              {(dayNames || ['일', '월', '화', '수', '목', '금', '토']).map((name, i) => (
                <div key={name} style={{
                  textAlign: 'center', fontSize: '0.6em', fontWeight: 600, padding: '2px 0',
                  color: i === 0 ? '#e53935' : i === 6 ? '#1565c0' : '#999',
                }}>
                  {name}
                </div>
              ))}

              {/* 날짜 셀 */}
              {cells.map((cell, idx) => {
                if (!cell) {
                  return <div key={`e-${idx}`} style={{ height: '24px' }} />;
                }

                const count = countByDay[cell.day] ?? 0;
                const isFuture = cell.day > today;
                const style = getHeatColor(count, maxValue, cell.isWeekend, isFuture);

                return (
                  <div
                    key={cell.day}
                    title={`${cell.day}일: ${count}건`}
                    style={{
                      height: '24px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: '3px',
                      fontSize: '0.65em',
                      fontWeight: count > 0 ? 600 : 400,
                      border: style.border || '1px solid transparent',
                      ...style,
                    }}
                  >
                    {isFuture ? '' : count > 0 ? count : cell.isWeekend ? '' : '0'}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 범례 (마지막에 1열로) */}
      <div style={{
        gridColumn: '1 / -1',
        display: 'flex', gap: '12px', justifyContent: 'center',
        fontSize: '0.75em', color: '#666', paddingTop: '4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#fff', border: '1px solid #ffcdd2' }} />
          0건 (평일)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#fff8e1' }} />
          1~2건
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#ffe082' }} />
          3~4건
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#ffb300' }} />
          5건+
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: '#f0f0f0' }} />
          주말
        </div>
      </div>
    </div>
  );
}
