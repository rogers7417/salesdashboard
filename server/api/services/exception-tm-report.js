/**
 * Exception-Based TM Report 서비스
 * 미전환 리드 분석: 종료사유, 활성관리, FRT/터치 크로스분석
 */
const { collectData } = require('./inbound-report');
const { getDateRange } = require('./date-utils');

// ============================================
// LossReason 매핑
// ============================================
const LOSS_REASON_LABEL = {
  'LossReasonProcess': '미도입',
  'LossReasonContract': '타사계약'
};

const LOSS_REASON_CATEGORY = {
  '연락불가': ['장기부재'],
  '경쟁사': ['LossReasonContract'],
  '니즈 부적합': ['LossReasonProcess', '타겟 부적합', '요구사항 불일치', '기술 요건 미충족', '문의하지 않음', '단순 정보 수집'],
  '가격/비용': ['예산 부족 / 비용부담'],
  '고객 사정': ['결정 권한 없음', '시기 미정', '기존 사용 유지', '양도양수'],
  '서비스 문제': ['성과 불만족', '서비스 불만족'],
  '거절': ['단호한 거절(파악 불가)'],
  '데이터 품질': ['오인입', '중복유입', '기고객상담', '추가설치', '중복 접수', '오생성']
};

// LossReason 값 → 대분류 역매핑 생성
const REASON_TO_CATEGORY = {};
Object.entries(LOSS_REASON_CATEGORY).forEach(([category, reasons]) => {
  reasons.forEach(reason => { REASON_TO_CATEGORY[reason] = category; });
});

function getLossReasonCategory(lossReason) {
  if (!lossReason) return '기타';
  return REASON_TO_CATEGORY[lossReason] || '기타';
}

function getLossReasonLabel(lossReason) {
  if (!lossReason) return null;
  return LOSS_REASON_LABEL[lossReason] || lossReason;
}

// ============================================
// 통계 유틸 (중앙값/사분위수)
// ============================================
function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const frac = idx - lower;
  return Math.round((sorted[lower] + frac * ((sorted[lower + 1] || sorted[lower]) - sorted[lower])) * 10) / 10;
}

function roundOne(v) {
  return v !== null ? Math.round(v * 10) / 10 : null;
}

// ============================================
// 리드 분류
// ============================================

// MQL 제외 사유 (inbound-report.js와 동일)
const MQL_EXCLUDE_LOSS_REASONS = [
  '오생성', '오인입', '중복유입', '추가설치',
  '마케팅 전달', '전략실 전달', '파트너스 전달',
  '프랜차이즈본사문의', '기고객상담', '부서이관'
];

function isMQL(lead) {
  if (lead.Status === '배정대기') return false;
  if (!lead.LossReason__c) return true;
  return !MQL_EXCLUDE_LOSS_REASONS.some(reason => lead.LossReason__c.includes(reason));
}

function isClosedStatus(status) {
  const closedStatuses = ['Closed', 'Disqualified', '종료', '미전환종료'];
  return closedStatuses.some(s => status && status.includes(s));
}

function classifyLead(lead, leadData) {
  const mql = leadData.isMQL;
  const hasOpp = !!lead.ConvertedOpportunityId;
  const hasClosed = !!lead.LossReason__c || isClosedStatus(lead.Status);

  if (!mql) return 'nonMQL';
  if (hasOpp) return 'converted';
  if (hasClosed) return 'unconvertedClosed';
  return 'unconvertedActive';
}

// ============================================
// 시간대 분류 (inbound-report.js와 동일)
// ============================================
function parseKSTDateTime(kstDateStr) {
  if (!kstDateStr) return { dateStr: null, hour: 0, dayOfWeek: 0 };
  const [datePart, timePart] = kstDateStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour] = (timePart || '00:00:00').split(':').map(Number);
  return { dateStr: datePart, hour, dayOfWeek: new Date(year, month - 1, day).getDay() };
}

function classifyTimeSlot(kstDateStr) {
  const { dayOfWeek, hour } = parseKSTDateTime(kstDateStr);
  if (dayOfWeek === 0 || dayOfWeek === 6) return 'WEEKEND';
  if (hour >= 10 && hour < 19) return 'BUSINESS_HOUR';
  return 'OFF_HOUR';
}

// ============================================
// 메인: Exception Report 생성
// ============================================
async function generateExceptionReport(month) {
  const now = new Date(Date.now() + 9 * 3600000); // KST
  const targetMonth = month || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = targetMonth.split('-').map(Number);

  const startDate = `${targetMonth}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  // 현재 월이면 오늘까지, 아니면 말일까지
  const isCurrentMonth = now.getUTCFullYear() === year && (now.getUTCMonth() + 1) === mon;
  const endDay = isCurrentMonth ? Math.min(now.getUTCDate(), lastDay) : lastDay;
  const endDate = `${targetMonth}-${String(endDay).padStart(2, '0')}`;

  console.log(`📊 Exception TM 리포트 생성: ${year}년 ${mon}월 (${endDay}일까지)`);

  // 기존 collectData() 재활용
  const data = await collectData(startDate, endDate);
  const { leads, insideUsers, tmUsers, userNameMap, firstTaskByLead, allTasksByLead, oppDataMap } = data;

  // TM 파트 유저 ID 셋
  const tmUserIds = new Set(tmUsers.map(u => u.Id));

  // TM 소속 리드만 필터
  const tmLeads = leads.filter(l => tmUserIds.has(l.OwnerId));

  // 리드별 enriched data 생성
  const today = new Date();
  const enrichedLeads = tmLeads.map(lead => {
    const mql = isMQL(lead);
    const oppData = lead.ConvertedOpportunityId ? oppDataMap[lead.ConvertedOpportunityId] : null;
    const leadTasks = allTasksByLead[lead.Id] || [];
    const firstTask = firstTaskByLead[lead.Id];
    const taskCount = leadTasks.length;
    const missedCount = leadTasks.filter(t => t.Subject && t.Subject.includes('부재')).length;
    const connectedCount = taskCount - missedCount;

    let frtMinutes = null;
    if (firstTask) {
      frtMinutes = Math.round((new Date(firstTask.CreatedDate) - new Date(lead.CreatedDate)) / 1000 / 60 * 10) / 10;
    }

    const timeSlot = classifyTimeSlot(lead.CreatedTime__c);
    const isOffHour = timeSlot === 'OFF_HOUR' || timeSlot === 'WEEKEND';

    // 마지막 Task 날짜
    let lastTaskDate = null;
    let daysSinceLastTask = null;
    if (leadTasks.length > 0) {
      const sorted = leadTasks.map(t => new Date(t.CreatedDate)).sort((a, b) => b - a);
      lastTaskDate = sorted[0];
      daysSinceLastTask = Math.floor((today - lastTaskDate) / (1000 * 60 * 60 * 24));
    }

    // Task 간 간격 (중앙값)
    let taskGaps = [];
    if (leadTasks.length >= 2) {
      const taskDates = leadTasks.map(t => new Date(t.CreatedDate).getTime()).sort((a, b) => a - b);
      for (let i = 1; i < taskDates.length; i++) {
        taskGaps.push(Math.round((taskDates[i] - taskDates[i - 1]) / (1000 * 60 * 60 * 24) * 10) / 10);
      }
    }

    // 생성 후 경과일
    const ageDays = Math.floor((today - new Date(lead.CreatedDate)) / (1000 * 60 * 60 * 24));

    // KST 날짜
    const { dateStr: createdDateKST } = parseKSTDateTime(lead.CreatedTime__c);

    const leadData = { isMQL: mql };
    const classification = classifyLead(lead, leadData);

    return {
      id: lead.Id,
      name: lead.Name,
      company: lead.Company,
      status: lead.Status,
      ownerId: lead.OwnerId,
      ownerName: userNameMap[lead.OwnerId] || lead.OwnerId,
      createdDate: createdDateKST || lead.CreatedDate?.split('T')[0],
      ageDays,
      lossReason: lead.LossReason__c,
      lossReasonLabel: getLossReasonLabel(lead.LossReason__c),
      lossReasonCategory: getLossReasonCategory(lead.LossReason__c),
      convertedOpportunityId: lead.ConvertedOpportunityId,
      isMQL: mql,
      classification, // 'converted' | 'unconvertedClosed' | 'unconvertedActive' | 'nonMQL'
      timeSlot,
      isOffHour,
      frtMinutes,
      hasTask: !!firstTask,
      taskCount,
      missedCount,
      connectedCount,
      missedRate: taskCount > 0 ? Math.round(missedCount / taskCount * 100 * 10) / 10 : 0,
      lastTaskDate: lastTaskDate ? lastTaskDate.toISOString().split('T')[0] : null,
      daysSinceLastTask,
      taskGaps,
      taskGapMedian: roundOne(median(taskGaps)),
      oppData
    };
  });

  // 분류별 그룹
  const converted = enrichedLeads.filter(l => l.classification === 'converted');
  const unconvertedClosed = enrichedLeads.filter(l => l.classification === 'unconvertedClosed');
  const unconvertedActive = enrichedLeads.filter(l => l.classification === 'unconvertedActive');
  const nonMQL = enrichedLeads.filter(l => l.classification === 'nonMQL');
  const mqlLeads = enrichedLeads.filter(l => l.isMQL);

  // ============================================
  // Summary
  // ============================================
  const staleCaseCount = unconvertedActive.filter(l => l.daysSinceLastTask === null || l.daysSinceLastTask >= 15).length;
  const summary = {
    totalLeads: enrichedLeads.length,
    mql: mqlLeads.length,
    converted: converted.length,
    unconvertedClosed: unconvertedClosed.length,
    unconvertedActive: unconvertedActive.length,
    nonMQL: nonMQL.length,
    unconvertedRate: mqlLeads.length > 0 ? Math.round((unconvertedClosed.length + unconvertedActive.length) / mqlLeads.length * 1000) / 10 : 0,
    staleCaseCount
  };

  // ============================================
  // Section 1: 담당자별 전환율 + 보유건
  // ============================================
  const section1_ownerConversion = tmUsers.map(u => {
    const id = u.Id;
    const ownerLeads = enrichedLeads.filter(l => l.ownerId === id);
    const ownerMQL = ownerLeads.filter(l => l.isMQL);
    const ownerConverted = ownerLeads.filter(l => l.classification === 'converted');
    const ownerClosed = ownerLeads.filter(l => l.classification === 'unconvertedClosed');
    const ownerActive = ownerLeads.filter(l => l.classification === 'unconvertedActive');
    const ownerNonMQL = ownerLeads.filter(l => l.classification === 'nonMQL');
    const ownerOffHour = ownerLeads.filter(l => l.isOffHour);

    const frtValues = ownerLeads.filter(l => l.frtMinutes !== null).map(l => l.frtMinutes);

    const frt = {
      median: roundOne(median(frtValues)),
      p25: percentile(frtValues, 25),
      p75: percentile(frtValues, 75),
      within20min: ownerLeads.filter(l => l.hasTask).length > 0
        ? Math.round(ownerLeads.filter(l => l.frtMinutes !== null && l.frtMinutes <= 20).length / ownerLeads.filter(l => l.hasTask).length * 1000) / 10
        : 0
    };

    const offHourRate = ownerLeads.length > 0 ? Math.round(ownerOffHour.length / ownerLeads.length * 1000) / 10 : 0;
    const nonMQLRate = ownerLeads.length > 0 ? Math.round(ownerNonMQL.length / ownerLeads.length * 1000) / 10 : 0;

    // 구조적 플래그
    const structuralFlags = [];
    if (offHourRate >= 30) structuralFlags.push('업무외 배정 높음');
    if (nonMQLRate >= 20) structuralFlags.push('낮은 리드 품질');
    if (frt.median !== null && frt.median >= 30) structuralFlags.push('응대 지연');

    return {
      ownerId: id,
      ownerName: u.Name,
      total: ownerLeads.length,
      mql: ownerMQL.length,
      mqlRate: ownerLeads.length > 0 ? Math.round(ownerMQL.length / ownerLeads.length * 1000) / 10 : 0,
      converted: ownerConverted.length,
      sql: ownerConverted.length,
      convertedRate: ownerMQL.length > 0 ? Math.round(ownerConverted.length / ownerMQL.length * 1000) / 10 : 0,
      unconvertedClosed: ownerClosed.length,
      unconvertedActive: ownerActive.length,
      nonMQL: ownerNonMQL.length,
      nonMQLRate,
      offHourRate,
      frt,
      structuralFlags
    };
  }).sort((a, b) => {
    // 미전환율(종료+활성) 높은 순
    const aUnconvertedRate = a.mql > 0 ? (a.unconvertedClosed + a.unconvertedActive) / a.mql : 0;
    const bUnconvertedRate = b.mql > 0 ? (b.unconvertedClosed + b.unconvertedActive) / b.mql : 0;
    return bUnconvertedRate - aUnconvertedRate;
  });

  // ============================================
  // Section 2: 미전환 종료/활성 대분류
  // ============================================
  // 2-1. 종료 사유 대분류
  const closedByCategory = {};
  unconvertedClosed.forEach(l => {
    const cat = l.lossReasonCategory;
    if (!closedByCategory[cat]) closedByCategory[cat] = 0;
    closedByCategory[cat]++;
  });

  const closedCategoryList = Object.entries(closedByCategory)
    .map(([category, count]) => ({
      category,
      count,
      rate: unconvertedClosed.length > 0 ? Math.round(count / unconvertedClosed.length * 1000) / 10 : 0
    }))
    .sort((a, b) => b.count - a.count);

  // 2-2. 활성 리드 경과일 구간
  const ageBuckets = [
    { bucket: '7일 이내', min: 0, max: 7 },
    { bucket: '8~14일', min: 8, max: 14 },
    { bucket: '15~30일', min: 15, max: 30 },
    { bucket: '31일+', min: 31, max: Infinity }
  ];

  const activeByAge = ageBuckets.map(({ bucket, min, max }) => {
    const count = unconvertedActive.filter(l => l.ageDays >= min && l.ageDays <= max).length;
    return {
      bucket,
      count,
      rate: unconvertedActive.length > 0 ? Math.round(count / unconvertedActive.length * 1000) / 10 : 0
    };
  });

  const section2_unconvertedBreakdown = {
    closed: {
      total: unconvertedClosed.length,
      byCategory: closedCategoryList
    },
    active: {
      total: unconvertedActive.length,
      byAgeBucket: activeByAge
    }
  };

  // ============================================
  // Section 3: 종료 사유 + FRT/터치 크로스분석
  // ============================================
  // 3-1. 종료 사유별 상세
  const categoryGroups = {};
  unconvertedClosed.forEach(l => {
    const cat = l.lossReasonCategory;
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(l);
  });

  const byCategoryDetail = Object.entries(categoryGroups)
    .map(([category, leads]) => {
      const frtValues = leads.filter(l => l.frtMinutes !== null).map(l => l.frtMinutes);
      const touchValues = leads.map(l => l.taskCount);
      const connectedValues = leads.map(l => l.connectedCount);
      const gapValues = leads.filter(l => l.taskGapMedian !== null).map(l => l.taskGapMedian);
      const totalTasks = leads.reduce((sum, l) => sum + l.taskCount, 0);
      const totalMissed = leads.reduce((sum, l) => sum + l.missedCount, 0);

      // 관리기간 중앙값: 마지막 Task ~ 생성일 간 일수
      const mgmtDays = leads
        .filter(l => l.lastTaskDate)
        .map(l => Math.floor((new Date(l.lastTaskDate) - new Date(l.createdDate)) / (1000 * 60 * 60 * 24)));
      // 빠른 포기율: taskCount <= 2인 비율
      const quickCloseCount = leads.filter(l => l.taskCount <= 2).length;

      return {
        category,
        count: leads.length,
        rate: unconvertedClosed.length > 0 ? Math.round(leads.length / unconvertedClosed.length * 1000) / 10 : 0,
        frtMedian: roundOne(median(frtValues)),
        frtIQR: [percentile(frtValues, 25), percentile(frtValues, 75)],
        touchMedian: median(touchValues),
        missedRate: totalTasks > 0 ? Math.round(totalMissed / totalTasks * 1000) / 10 : 0,
        connectedMedian: median(connectedValues),
        touchGapMedian: roundOne(median(gapValues)),
        managementDaysMedian: roundOne(median(mgmtDays)),
        quickCloseRate: leads.length > 0 ? roundOne(quickCloseCount / leads.length * 100) : 0
      };
    })
    .sort((a, b) => b.count - a.count);

  // 3-2. FRT 구간별 종료율
  const frtBucketDefs = [
    { bucket: '10분 이내', min: 0, max: 10 },
    { bucket: '10~20분', min: 10, max: 20 },
    { bucket: '20~30분', min: 20, max: 30 },
    { bucket: '30~60분', min: 30, max: 60 },
    { bucket: '1~2시간', min: 60, max: 120 },
    { bucket: '2시간 초과', min: 120, max: Infinity },
    { bucket: '무응대', min: null, max: null }
  ];

  // MQL 기준으로 FRT 구간 분석 (비MQL 제외)
  const byFRTBucket = frtBucketDefs.map(({ bucket, min, max }) => {
    const inBucket = mqlLeads.filter(l => {
      if (min === null) return l.frtMinutes === null;
      if (max === Infinity) return l.frtMinutes !== null && l.frtMinutes > min;
      if (min === 0) return l.frtMinutes !== null && l.frtMinutes <= max;
      return l.frtMinutes !== null && l.frtMinutes > min && l.frtMinutes <= max;
    });
    const convertedCount = inBucket.filter(l => l.classification === 'converted').length;
    const closedCount = inBucket.filter(l => l.classification === 'unconvertedClosed').length;
    const activeCount = inBucket.filter(l => l.classification === 'unconvertedActive').length;

    return {
      bucket,
      total: inBucket.length,
      converted: convertedCount,
      closed: closedCount,
      active: activeCount,
      conversionRate: inBucket.length > 0 ? Math.round(convertedCount / inBucket.length * 1000) / 10 : 0,
      closedRate: inBucket.length > 0 ? Math.round(closedCount / inBucket.length * 1000) / 10 : 0
    };
  });

  // 3-3. 터치 횟수별 종료율
  const touchBucketDefs = [
    { bucket: '0회', min: 0, max: 0 },
    { bucket: '1회', min: 1, max: 1 },
    { bucket: '2~3회', min: 2, max: 3 },
    { bucket: '4~5회', min: 4, max: 5 },
    { bucket: '6회+', min: 6, max: Infinity }
  ];

  const byTouchBucket = touchBucketDefs.map(({ bucket, min, max }) => {
    const inBucket = mqlLeads.filter(l => l.taskCount >= min && l.taskCount <= max);
    const convertedCount = inBucket.filter(l => l.classification === 'converted').length;
    const closedCount = inBucket.filter(l => l.classification === 'unconvertedClosed').length;
    const activeCount = inBucket.filter(l => l.classification === 'unconvertedActive').length;

    // 종료 사유 Top 3
    const closeReasonCounts = {};
    inBucket.filter(l => l.classification === 'unconvertedClosed').forEach(l => {
      const cat = l.lossReasonCategory;
      if (!closeReasonCounts[cat]) closeReasonCounts[cat] = 0;
      closeReasonCounts[cat]++;
    });
    const topCloseReasons = Object.entries(closeReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat);

    return {
      bucket,
      total: inBucket.length,
      converted: convertedCount,
      closed: closedCount,
      active: activeCount,
      topCloseReasons
    };
  });

  // 3-4. FRT×터치 히트맵
  const frtTouchHeatmap = [];
  frtBucketDefs.forEach(frtDef => {
    touchBucketDefs.forEach(touchDef => {
      const inCell = mqlLeads.filter(l => {
        const frtMatch = frtDef.min === null
          ? l.frtMinutes === null
          : frtDef.max === Infinity
            ? l.frtMinutes !== null && l.frtMinutes > frtDef.min
            : frtDef.min === 0
              ? l.frtMinutes !== null && l.frtMinutes <= frtDef.max
              : l.frtMinutes !== null && l.frtMinutes > frtDef.min && l.frtMinutes <= frtDef.max;
        const touchMatch = l.taskCount >= touchDef.min && l.taskCount <= touchDef.max;
        return frtMatch && touchMatch;
      });

      if (inCell.length > 0) {
        const closedCount = inCell.filter(l => l.classification === 'unconvertedClosed').length;
        frtTouchHeatmap.push({
          frtBucket: frtDef.bucket,
          touchBucket: touchDef.bucket,
          total: inCell.length,
          closedRate: Math.round(closedCount / inCell.length * 1000) / 10
        });
      }
    });
  });

  // 3-5. 인사이트 자동 생성
  const insights = [];

  // 전환 리드 FRT 중앙값
  const convertedFRTs = converted.filter(l => l.frtMinutes !== null).map(l => l.frtMinutes);
  const convertedFRTMedian = roundOne(median(convertedFRTs));

  // 연락불가 FRT 비교
  const unreachable = categoryGroups['연락불가'] || [];
  if (unreachable.length > 0 && convertedFRTMedian !== null) {
    const unreachableFRTs = unreachable.filter(l => l.frtMinutes !== null).map(l => l.frtMinutes);
    const unreachableFRTMedian = roundOne(median(unreachableFRTs));
    if (unreachableFRTMedian !== null) {
      const diff = roundOne(unreachableFRTMedian - convertedFRTMedian);
      if (diff > 0) {
        insights.push(`연락불가 종료의 FRT 중앙값은 ${unreachableFRTMedian}분으로, 전환 리드(${convertedFRTMedian}분) 대비 ${diff}분 느림`);
      }
    }
  }

  // 터치 횟수와 종료율 관계
  const touchThresholds = [2, 3, 4];
  for (const threshold of touchThresholds) {
    const below = mqlLeads.filter(l => l.taskCount < threshold);
    const above = mqlLeads.filter(l => l.taskCount >= threshold);
    if (below.length >= 5 && above.length >= 5) {
      const belowClosedRate = below.length > 0 ? below.filter(l => l.classification === 'unconvertedClosed').length / below.length * 100 : 0;
      const aboveClosedRate = above.length > 0 ? above.filter(l => l.classification === 'unconvertedClosed').length / above.length * 100 : 0;
      const diff = Math.round(belowClosedRate - aboveClosedRate);
      if (diff > 10) {
        insights.push(`터치 ${threshold}회 이상 시 종료율이 ${diff}% 감소 — 최소 ${threshold}회 터치 권장`);
        break;
      }
    }
  }

  // 빠른 포기 분석: 1~2회 터치 후 종료
  const quickCloseLeads = unconvertedClosed.filter(l => l.taskCount <= 2);
  const quickCloseReasonCounts = {};
  quickCloseLeads.forEach(l => {
    const cat = l.lossReasonCategory;
    quickCloseReasonCounts[cat] = (quickCloseReasonCounts[cat] || 0) + 1;
  });
  const quickCloseTopReasons = Object.entries(quickCloseReasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  const quickClose = {
    total: quickCloseLeads.length,
    rateOfClosed: unconvertedClosed.length > 0 ? roundOne(quickCloseLeads.length / unconvertedClosed.length * 100) : 0,
    frtWithin20minRate: quickCloseLeads.length > 0
      ? roundOne(quickCloseLeads.filter(l => l.frtMinutes !== null && l.frtMinutes <= 20).length / quickCloseLeads.length * 100)
      : 0,
    topReasons: quickCloseTopReasons
  };

  const section3_closedAnalysis = {
    byCategoryDetail,
    byFRTBucket,
    byTouchBucket,
    frtTouchHeatmap,
    insights,
    quickClose
  };

  // ============================================
  // Section 4: 활성 관리현황
  // ============================================
  function classifyActiveStatus(lead) {
    const days = lead.daysSinceLastTask;
    // Task 없으면 생성 후 경과일 기준
    const effectiveDays = days !== null ? days : lead.ageDays;
    if (effectiveDays <= 7) return 'normal';
    if (effectiveDays <= 14) return 'caution';
    return 'stale';
  }

  // 활성 리드에 관리 상태 부여
  const activeWithStatus = unconvertedActive.map(l => ({
    ...l,
    managementStatus: classifyActiveStatus(l)
  }));

  // 4-1. 담당자별 활성 관리현황
  const activeByOwner = tmUsers.map(u => {
    const ownerActive = activeWithStatus.filter(l => l.ownerId === u.Id);
    const normal = ownerActive.filter(l => l.managementStatus === 'normal').length;
    const caution = ownerActive.filter(l => l.managementStatus === 'caution').length;
    const stale = ownerActive.filter(l => l.managementStatus === 'stale').length;
    const ageDaysValues = ownerActive.map(l => l.ageDays);
    const touchValues = ownerActive.map(l => l.taskCount);

    // 담당자별 활성 리드 상세 배열
    const leads = ownerActive
      .sort((a, b) => (b.daysSinceLastTask || b.ageDays) - (a.daysSinceLastTask || a.ageDays))
      .map(l => {
        const lastTask = (allTasksByLead[l.id] || []).sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate))[0];
        return {
          leadId: l.id,
          leadName: l.name,
          company: l.company,
          status: l.status,
          ageDays: l.ageDays,
          taskCount: l.taskCount,
          missedCount: l.missedCount,
          daysSinceLastTask: l.daysSinceLastTask,
          lastActivity: lastTask
            ? { label: lastTask.Subject || '(제목 없음)', date: lastTask.CreatedDate?.split('T')[0] }
            : null,
          managementStatus: l.managementStatus === 'normal' ? '관리중' : l.managementStatus === 'caution' ? '관리느슨' : '방치의심',
          highlight: { isStale: l.managementStatus === 'stale', ageDaysOver7: l.ageDays > 7, missedOver3: l.missedCount >= 3 }
        };
      });

    return {
      ownerId: u.Id,
      ownerName: u.Name,
      activeCount: ownerActive.length,
      normal,
      caution,
      stale,
      ageDaysMedian: median(ageDaysValues),
      touchMedian: median(touchValues),
      leads
    };
  }).filter(o => o.activeCount > 0)
    .sort((a, b) => b.stale - a.stale);

  // 4-2. 방치 리드 상세
  const staleLeads = activeWithStatus
    .filter(l => l.managementStatus === 'stale')
    .map(l => ({
      leadId: l.id,
      leadName: l.name,
      company: l.company,
      createdDate: l.createdDate,
      ageDays: l.ageDays,
      lastTaskDate: l.lastTaskDate,
      daysSinceLastTask: l.daysSinceLastTask,
      taskCount: l.taskCount,
      missedRate: l.missedRate,
      status: l.status,
      ownerId: l.ownerId,
      ownerName: l.ownerName
    }))
    .sort((a, b) => (b.daysSinceLastTask || b.ageDays) - (a.daysSinceLastTask || a.ageDays));

  const section4_activeManagement = {
    byOwner: activeByOwner,
    staleLeads
  };

  // ============================================
  // 최종 응답
  // ============================================
  return {
    period: {
      year,
      month: mon,
      label: `${year}년 ${mon}월`,
      startDate,
      endDate
    },
    summary,
    section1_ownerConversion,
    section2_unconvertedBreakdown,
    section3_closedAnalysis,
    section4_activeManagement,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateExceptionReport };
