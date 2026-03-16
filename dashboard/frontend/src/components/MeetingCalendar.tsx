'use client';

import React, { useState } from 'react';

interface Meeting {
  id: string;
  subject: string;
  accountName: string;
  accountId: string;
  owner: string;
  startTime: string;
  type: string;
  isMouComplete: boolean;
  isCompleted: boolean;
}

interface CalendarMeta {
  year: number;
  month: number;
  monthLabel: string;
  firstDay: number;   // 0=일, 1=월, ...
  totalDays: number;
  today: number;       // 오늘 날짜 (1~31)
}

interface MeetingCalendarProps {
  calendarMeta: CalendarMeta;
  meetingCalendar: Record<string, Meeting[]>;
  todayStr: string; // YYYY-MM-DD
}

export default function MeetingCalendar({ calendarMeta, meetingCalendar, todayStr }: MeetingCalendarProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  if (!calendarMeta) return null;

  const { year, month, firstDay, totalDays, today } = calendarMeta;
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  // 캘린더 그리드 생성
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null); // 빈 셀
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  // 마지막 행 패딩
  while (cells.length % 7 !== 0) cells.push(null);

  const getMeetingsForDay = (day: number): Meeting[] => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return meetingCalendar[dateStr] || [];
  };

  const getDayStyle = (day: number): React.CSSProperties => {
    const meetings = getMeetingsForDay(day);
    const isPast = day < today;
    const isToday = day === today;
    const isFuture = day > today;
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let background = '#fff';
    let border = '1px solid #e0e0e0';

    if (isToday) {
      border = '2px solid #1976d2';
      background = '#e3f2fd';
    } else if (isWeekend) {
      background = '#f9f9f9';
    }

    if (meetings.length > 0 && !isToday) {
      background = isPast ? '#f1f8e9' : '#fff8e1';
    }

    return {
      background,
      border,
      borderRadius: '6px',
      padding: '4px',
      minHeight: '70px',
      cursor: meetings.length > 0 ? 'pointer' : 'default',
      transition: 'all 0.15s',
      position: 'relative',
    };
  };

  const selectedMeetings = selectedDay ? getMeetingsForDay(selectedDay) : [];

  return (
    <div>
      {/* 캘린더 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {/* 요일 헤더 */}
        {dayNames.map((name, i) => (
          <div key={name} style={{
            textAlign: 'center', padding: '6px 0', fontSize: '0.8em', fontWeight: 600,
            color: i === 0 ? '#e53935' : i === 6 ? '#1565c0' : '#666',
          }}>
            {name}
          </div>
        ))}

        {/* 날짜 셀 */}
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} style={{ minHeight: '70px' }} />;
          }

          const meetings = getMeetingsForDay(day);
          const mouCompleteCount = meetings.filter(m => m.isMouComplete).length;
          const mouIncompleteCount = meetings.filter(m => !m.isMouComplete).length;
          const dayOfWeek = new Date(year, month - 1, day).getDay();

          return (
            <div
              key={day}
              style={getDayStyle(day)}
              onClick={() => meetings.length > 0 && setSelectedDay(selectedDay === day ? null : day)}
            >
              {/* 날짜 번호 */}
              <div style={{
                fontSize: '0.75em', fontWeight: day === today ? 700 : 500,
                color: dayOfWeek === 0 ? '#e53935' : dayOfWeek === 6 ? '#1565c0' : '#333',
                marginBottom: '2px',
              }}>
                {day}
              </div>

              {/* 미팅 뱃지 */}
              {meetings.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {mouIncompleteCount > 0 && (
                    <div style={{
                      fontSize: '0.65em', padding: '1px 4px', borderRadius: '3px',
                      background: '#ffebee', color: '#c62828', fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      미완료 {mouIncompleteCount}
                    </div>
                  )}
                  {mouCompleteCount > 0 && (
                    <div style={{
                      fontSize: '0.65em', padding: '1px 4px', borderRadius: '3px',
                      background: '#e0f2f1', color: '#00695c', fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      완료 {mouCompleteCount}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 범례 */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '0.8em', color: '#666' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#ffebee', border: '1px solid #ffcdd2' }} />
          MOU 미완료
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#e0f2f1', border: '1px solid #b2dfdb' }} />
          MOU 완료
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#e3f2fd', border: '2px solid #1976d2' }} />
          오늘
        </div>
      </div>

      {/* 선택된 날짜 미팅 상세 */}
      {selectedDay && selectedMeetings.length > 0 && (
        <div style={{
          marginTop: '16px', padding: '16px', background: '#fafafa',
          borderRadius: '8px', border: '1px solid #e0e0e0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ fontSize: '0.95em', fontWeight: 600, color: '#333' }}>
              {month}월 {selectedDay}일 미팅 ({selectedMeetings.length}건)
            </h4>
            <button
              onClick={() => setSelectedDay(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1em', color: '#999' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedMeetings.map((m, i) => (
              <div key={m.id || i} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', background: '#fff', borderRadius: '6px',
                border: `1px solid ${m.isMouComplete ? '#b2dfdb' : '#ffcdd2'}`,
              }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: m.isMouComplete ? '#00897b' : '#e53935',
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85em', fontWeight: 600, color: '#333' }}>
                    {m.accountName}
                  </div>
                  <div style={{ fontSize: '0.75em', color: '#888' }}>
                    {m.subject} · {m.startTime} · {m.owner}
                  </div>
                </div>
                <div style={{
                  fontSize: '0.7em', padding: '2px 8px', borderRadius: '10px',
                  background: m.isMouComplete ? '#e0f2f1' : '#ffebee',
                  color: m.isMouComplete ? '#00695c' : '#c62828',
                  fontWeight: 600, flexShrink: 0,
                }}>
                  {m.isMouComplete ? 'MOU완료' : 'MOU미완료'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
