/**
 * 날짜 유틸리티
 */

// KST → UTC 변환 (Salesforce 쿼리용)
function kstToUTC(kstDateStr, isStart = true) {
  const [year, month, day] = kstDateStr.split('-').map(Number);
  if (isStart) {
    // KST 00:00:00 → UTC (전날 15:00:00)
    return new Date(Date.UTC(year, month - 1, day - 1, 15, 0, 0)).toISOString();
  } else {
    // KST 23:59:59 → UTC (당일 14:59:59)
    return new Date(Date.UTC(year, month - 1, day, 14, 59, 59)).toISOString();
  }
}

// 기간 계산
function getDateRange(mode, customStart = null, customEnd = null) {
  // 커스텀 기간
  if (mode === 'custom' && customStart && customEnd) {
    return {
      startDate: customStart,
      endDate: customEnd,
      periodLabel: `${customStart} ~ ${customEnd}`
    };
  }

  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let startDate, endDate, periodLabel;

  if (mode === 'daily') {
    const yesterday = new Date(kstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = yesterday.toISOString().split('T')[0];
    endDate = startDate;
    periodLabel = startDate;

  } else if (mode === 'weekly') {
    const dayOfWeek = kstNow.getDay();
    const lastSunday = new Date(kstNow);
    lastSunday.setDate(kstNow.getDate() - dayOfWeek);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);
    startDate = lastMonday.toISOString().split('T')[0];
    endDate = lastSunday.toISOString().split('T')[0];
    periodLabel = `${startDate} ~ ${endDate}`;

  } else if (mode === 'monthly') {
    const lastMonth = new Date(kstNow.getFullYear(), kstNow.getMonth() - 1, 1);
    const lastDay = new Date(kstNow.getFullYear(), kstNow.getMonth(), 0).getDate();
    startDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-${lastDay}`;
    periodLabel = `${lastMonth.getFullYear()}년 ${lastMonth.getMonth() + 1}월`;

  } else if (mode === 'monthly-current') {
    const kstYear = kstNow.getUTCFullYear();
    const kstMonth = kstNow.getUTCMonth();
    const kstDate = kstNow.getUTCDate();

    const yesterdayKST = new Date(Date.UTC(kstYear, kstMonth, kstDate - 1));
    const targetYear = yesterdayKST.getUTCFullYear();
    const targetMonth = yesterdayKST.getUTCMonth();
    const yesterdayDate = yesterdayKST.getUTCDate();

    startDate = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
    endDate = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(yesterdayDate).padStart(2, '0')}`;
    periodLabel = `${targetYear}년 ${targetMonth + 1}월 (${yesterdayDate}일까지)`;

  } else {
    // 기본값: daily
    const yesterday = new Date(kstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = yesterday.toISOString().split('T')[0];
    endDate = startDate;
    periodLabel = startDate;
  }

  return { startDate, endDate, periodLabel };
}

// 이전 기간 계산 (비교용)
function getPreviousPeriodRange(startDate, endDate, mode) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  let prevStart, prevEnd;

  if (mode === 'daily') {
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 1);
    prevEnd = prevStart;
  } else if (mode === 'weekly') {
    prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    prevEnd = new Date(end);
    prevEnd.setDate(prevEnd.getDate() - 7);
  } else {
    // monthly: 전월
    prevStart = new Date(start);
    prevStart.setMonth(prevStart.getMonth() - 1);
    prevEnd = new Date(end);
    prevEnd.setMonth(prevEnd.getMonth() - 1);
    // 월말 보정
    const lastDayOfPrevMonth = new Date(prevEnd.getFullYear(), prevEnd.getMonth() + 1, 0).getDate();
    if (prevEnd.getDate() > lastDayOfPrevMonth) {
      prevEnd.setDate(lastDayOfPrevMonth);
    }
  }

  return {
    startDate: prevStart.toISOString().split('T')[0],
    endDate: prevEnd.toISOString().split('T')[0]
  };
}

module.exports = {
  kstToUTC,
  getDateRange,
  getPreviousPeriodRange
};
