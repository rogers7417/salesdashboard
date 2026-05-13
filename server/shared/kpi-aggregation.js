/**
 * KPI 주간 집계 유틸리티
 *
 * routes/kpi.js에서 추출. kpi-extract.js (S3 사전계산)와
 * routes/kpi.js (Express 서빙, 전환기간) 양쪽에서 사용.
 */
const fs = require('fs').promises;
const path = require('path');

// ============================================================
// 기본 유틸
// ============================================================

/**
 * byOwner 배열을 userId 기준으로 머지 (SUM)
 */
function mergeByOwner(arrays) {
  const map = {};
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      const id = row.userId || row.name;
      if (!map[id]) {
        map[id] = { ...row };
      } else {
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'number') {
            map[id][k] = (map[id][k] || 0) + v;
          }
        }
      }
    }
  }
  return Object.values(map);
}

/**
 * 단순 SUM 가능한 숫자 필드들을 합산
 */
function sumFields(target, source, keys) {
  for (const k of keys) {
    if (source[k] !== undefined && source[k] !== null && typeof source[k] === 'number') {
      target[k] = (target[k] || 0) + source[k];
    }
  }
}

// ============================================================
// 주간 집계 (핵심)
// ============================================================

/**
 * 여러 일별 데이터를 주간 집계
 */
function aggregateWeeklyData(dailyDataArray, weekStart, weekEnd) {
  if (!dailyDataArray || dailyDataArray.length === 0) return null;

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  const result = {
    period: `${weekStart}~${weekEnd}`,
    periodLabel: `${weekStart} ~ ${weekEnd} (주간)`,
    dateRange: { start: weekStart, end: weekEnd },
    extractedAt: new Date().toISOString(),
    periodType: 'weekly',
    parentMonth: weekStart.substring(0, 7),
    inbound: {},
    channel: {},
  };

  // ----- 인바운드 Inside Sales 집계 -----
  const isDataArr = dailyDataArray.map(d => d.inbound?.insideSales).filter(Boolean);
  if (isDataArr.length > 0) {
    const is = {};
    const sumKeys = ['lead', 'mql', 'sql', 'visitCount'];
    for (const d of isDataArr) { sumFields(is, d, sumKeys); }
    is.sqlConversionRate = is.mql > 0 ? Math.round((is.sql / is.mql) * 1000) / 10 : 0;
    is.target_sqlConversionRate = isDataArr[0].target_sqlConversionRate;
    is.visitRate = is.sql > 0 ? Math.round((is.visitCount / is.sql) * 1000) / 10 : 0;
    is.target_visitCount = isDataArr[0].target_visitCount;
    is.target_visitRate = isDataArr[0].target_visitRate;

    // FRT 집계
    const frtArr = isDataArr.map(d => d.frt).filter(Boolean);
    if (frtArr.length > 0) {
      const frt = { totalWithTask: 0, frtOk: 0, frtOver20: 0, buckets: {} };
      for (const f of frtArr) {
        frt.totalWithTask += f.totalWithTask || 0;
        frt.frtOk += f.frtOk || 0;
        frt.frtOver20 += f.frtOver20 || 0;
        if (f.buckets) {
          for (const [bk, bv] of Object.entries(f.buckets)) {
            frt.buckets[bk] = (frt.buckets[bk] || 0) + (bv || 0);
          }
        }
      }
      frt.avgFrtMinutes = frt.totalWithTask > 0
        ? Math.round(frtArr.reduce((s, f) => s + (f.avgFrtMinutes || 0) * (f.totalWithTask || 0), 0) / frt.totalWithTask * 10) / 10
        : 0;
      frt.target_frtOver20 = frtArr[0].target_frtOver20;
      is.frt = frt;
    }

    // Daily Task 집계
    const dtArr = isDataArr.map(d => d.dailyTask).filter(Boolean);
    if (dtArr.length > 0) {
      const merged = mergeByOwner(dtArr.map(d => d.byOwner));
      for (const row of merged) {
        row.avgDaily = row.totalWeekdays > 0 ? Math.round((row.totalTasks / row.totalWeekdays) * 10) / 10 : 0;
      }
      is.dailyTask = { byOwner: merged };
    }

    // byOwner 집계
    const ownerArrs = isDataArr.map(d => d.byOwner).filter(Boolean);
    if (ownerArrs.length > 0) {
      const merged = mergeByOwner(ownerArrs);
      for (const row of merged) {
        row.sqlConversionRate = row.mql > 0 ? Math.round((row.sql / row.mql) * 1000) / 10 : 0;
        row.visitRate = row.sql > 0 ? Math.round((row.visitConverted / row.sql) * 1000) / 10 : 0;
        if (row.frtOk + row.frtOver20 > 0) {
          row.avgFrt = Math.round(row.avgFrt / ownerArrs.length);
        }
      }
      is.byOwner = merged;
    }

    // rawData — rawOpenOpps: 전 기간 union
    {
      const openOppMap = {};
      for (const d of isDataArr) {
        const opps = d.rawData?.rawOpenOpps || [];
        for (const opp of opps) {
          const key = opp.oppId || opp.name;
          if (key) openOppMap[key] = opp;
        }
      }
      is.rawData = { rawOpenOpps: Object.values(openOppMap) };
    }

    // 일별 IS 상세 데이터
    is.dailyDetails = dailyDataArray.map(d => {
      const dis = d.inbound?.insideSales;
      if (!dis) return null;
      const dateStr = d.period || d.dateRange?.start || '';
      const dayOfWeek = dateStr ? new Date(dateStr).getDay() : 0;
      return {
        date: dateStr,
        dayName: dayNames[dayOfWeek] || '',
        dayOfWeek,
        lead: dis.lead || 0,
        mql: dis.mql || 0,
        sql: dis.sql || 0,
        sqlConversionRate: dis.sqlConversionRate ?? null,
        frt: dis.frt,
        visitCount: dis.visitCount || 0,
        visitRate: dis.visitRate ?? null,
        byOwner: dis.byOwner || [],
        rawData: {
          frtOver20: dis.rawData?.frtOver20 || [],
          unconvertedMQL: dis.rawData?.unconvertedMQL || [],
          noVisitSQL: dis.rawData?.noVisitSQL || [],
        },
      };
    }).filter(Boolean);

    result.inbound.insideSales = is;
  }

  // ----- 인바운드 Field Sales 집계 -----
  const fsDataArr = dailyDataArray.map(d => d.inbound?.fieldSales).filter(Boolean);
  if (fsDataArr.length > 0) {
    const fsd = {};
    const cwRateArr = fsDataArr.map(d => d.cwConversionRate).filter(Boolean);
    if (cwRateArr.length > 0) {
      const byUser = mergeByOwner(cwRateArr.map(d => d.byUser));
      for (const row of byUser) {
        row.cwRate = (row.cw + row.cl) > 0 ? Math.round((row.cw / (row.cw + row.cl)) * 1000) / 10 : 0;
        if (row.open !== undefined && row.openByAge) {
          const lastRow = cwRateArr[cwRateArr.length - 1]?.byUser?.find(u => (u.userId || u.name) === (row.userId || row.name));
          if (lastRow?.openByAge) row.openByAge = lastRow.openByAge;
        }
      }
      fsd.cwConversionRate = { byUser };
    }
    const cwCarryArr = fsDataArr.map(d => d.cwWithCarryover).filter(Boolean);
    if (cwCarryArr.length > 0) {
      const byUser = mergeByOwner(cwCarryArr.map(d => d.byUser));
      for (const row of byUser) {
        row.cwRate = row.totalClosed > 0 ? Math.round((row.cw / row.totalClosed) * 1000) / 10 : 0;
      }
      const totalCW = byUser.reduce((s, r) => s + (r.cw || 0), 0);
      const totalCarryoverCW = byUser.reduce((s, r) => s + (r.carryoverCW || 0), 0);
      const totalThisMonthCW = byUser.reduce((s, r) => s + (r.thisMonthCW || 0), 0);
      fsd.cwWithCarryover = { byUser, totalCW, totalCarryoverCW, totalThisMonthCW, note: '주간 CW (이월 포함)' };
    }
    const gtArr = fsDataArr.map(d => d.goldenTime).filter(Boolean);
    if (gtArr.length > 0) {
      fsd.goldenTime = gtArr[gtArr.length - 1];
    }
    fsd.obsLeadCount = fsDataArr.reduce((s, d) => {
      const val = typeof d.obsLeadCount === 'object' ? (d.obsLeadCount?.total ?? 0) : (d.obsLeadCount || 0);
      return s + val;
    }, 0);
    fsd.agingSummary = fsDataArr[fsDataArr.length - 1]?.agingSummary;

    // lossReasonSummary — 합산
    const fsLrArr = fsDataArr.map(d => d.lossReasonSummary).filter(Boolean);
    if (fsLrArr.length > 0) {
      const fsLrMap = {};
      for (const lr of fsLrArr) {
        if (Array.isArray(lr)) {
          for (const item of lr) {
            if (!fsLrMap[item.reason]) fsLrMap[item.reason] = { reason: item.reason, count: 0 };
            fsLrMap[item.reason].count += item.count || 0;
          }
        }
      }
      fsd.lossReasonSummary = Object.values(fsLrMap).sort((a, b) => b.count - a.count);
    }

    // rawData
    const fsOpenOppMap = {};
    for (const d of fsDataArr) {
      for (const opp of (d.rawData?.rawOpenOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key) fsOpenOppMap[key] = opp;
      }
    }
    const fsClosedOppMap = {};
    for (const d of fsDataArr) {
      for (const opp of (d.rawData?.rawClosedOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key && !fsClosedOppMap[key]) fsClosedOppMap[key] = opp;
      }
    }
    fsd.rawData = {
      rawOpenOpps: Object.values(fsOpenOppMap),
      rawClosedOpps: Object.values(fsClosedOppMap),
    };

    // visitCalendar — 전 기간 union
    const vcMerged = {};
    for (const d of fsDataArr) {
      (d.visitCalendar || []).forEach(user => {
        if (!vcMerged[user.name]) vcMerged[user.name] = {};
        Object.entries(user.dates || {}).forEach(([date, events]) => {
          if (!vcMerged[user.name][date]) vcMerged[user.name][date] = [];
          events.forEach(ev => {
            const exists = vcMerged[user.name][date].some(
              e => e.oppName === ev.oppName && e.status === ev.status
            );
            if (!exists) vcMerged[user.name][date].push(ev);
          });
        });
      });
    }
    fsd.visitCalendar = Object.entries(vcMerged).map(([name, dates]) => ({ name, dates }));
    fsd.staleVisit = fsDataArr[fsDataArr.length - 1]?.staleVisit || { total: 0, over14: 0, opps: [] };

    // 일별 FS 상세 데이터
    fsd.dailyDetails = dailyDataArray.map(d => {
      const dfs = d.inbound?.fieldSales;
      if (!dfs) return null;
      const dateStr = d.period || d.dateRange?.start || '';
      const dayOfWeek = dateStr ? new Date(dateStr).getDay() : 0;
      return {
        date: dateStr,
        dayName: dayNames[dayOfWeek] || '',
        dayOfWeek,
        cwConversionRate: dfs.cwConversionRate,
        goldenTime: dfs.goldenTime,
        obsLeadCount: typeof dfs.obsLeadCount === 'object' ? (dfs.obsLeadCount?.total ?? 0) : (dfs.obsLeadCount || 0),
        rawData: {
          rawOpenOpps: dfs.rawData?.rawOpenOpps || [],
          rawClosedOpps: dfs.rawData?.rawClosedOpps || [],
          goldenTimeViolations: dfs.goldenTime?.violations || [],
        },
        staleVisit: dfs.staleVisit || { total: 0, over14: 0, opps: [] },
        visitCalendar: dfs.visitCalendar || [],
      };
    }).filter(Boolean);

    result.inbound.fieldSales = fsd;
  }

  // ----- 인바운드 Back Office 집계 -----
  const boDataArr = dailyDataArray.map(d => d.inbound?.backOffice).filter(Boolean);
  if (boDataArr.length > 0) {
    const bo = {};
    const cwRateArr = boDataArr.map(d => d.cwConversionRate).filter(Boolean);
    if (cwRateArr.length > 0) {
      const byUser = mergeByOwner(cwRateArr.map(d => d.byUser));
      for (const row of byUser) {
        row.cwRate = (row.cw + row.cl) > 0 ? Math.round((row.cw / (row.cw + row.cl)) * 1000) / 10 : 0;
        row.avgDailyClose = dailyDataArray.length > 0 ? Math.round(((row.cw || 0) + (row.cl || 0)) / dailyDataArray.length * 10) / 10 : 0;
        const lastRow = cwRateArr[cwRateArr.length - 1]?.byUser?.find(u => (u.userId || u.name) === (row.userId || row.name));
        if (lastRow?.openByAge) row.openByAge = lastRow.openByAge;
        if (lastRow?.open !== undefined) row.open = lastRow.open;
      }
      bo.cwConversionRate = { byUser };
    }
    const cwCarryArr = boDataArr.map(d => d.cwWithCarryover).filter(Boolean);
    if (cwCarryArr.length > 0) {
      const byUser = mergeByOwner(cwCarryArr.map(d => d.byUser));
      for (const row of byUser) {
        row.cwRate = row.totalClosed > 0 ? Math.round((row.cw / row.totalClosed) * 1000) / 10 : 0;
      }
      const totalCW = byUser.reduce((s, r) => s + (r.cw || 0), 0);
      const totalCarryoverCW = byUser.reduce((s, r) => s + (r.carryoverCW || 0), 0);
      const totalThisMonthCW = byUser.reduce((s, r) => s + (r.thisMonthCW || 0), 0);
      bo.cwWithCarryover = { byUser, totalCW, totalCarryoverCW, totalThisMonthCW, note: '주간 CW (이월 포함)' };
    }
    const csArr = boDataArr.map(d => d.contractSummary).filter(Boolean);
    if (csArr.length > 0) {
      bo.contractSummary = csArr[csArr.length - 1];
    }
    const dcArr = boDataArr.map(d => d.dailyClose).filter(Boolean);
    if (dcArr.length > 0) {
      const byUser = mergeByOwner(dcArr.map(d => d.byUser));
      for (const row of byUser) {
        row.avgDailyClose = dailyDataArray.length > 0 ? Math.round((row.avgDailyClose * dcArr.length) / dailyDataArray.length * 10) / 10 : row.avgDailyClose;
      }
      bo.dailyClose = { byUser };
    }
    bo.sqlBacklog = boDataArr[boDataArr.length - 1]?.sqlBacklog;
    bo.agingSummary = boDataArr[boDataArr.length - 1]?.agingSummary;
    const lrArr = boDataArr.map(d => d.lossReasonSummary).filter(Boolean);
    if (lrArr.length > 0) {
      const lrMap = {};
      for (const lr of lrArr) {
        if (Array.isArray(lr)) {
          for (const item of lr) {
            if (!lrMap[item.reason]) lrMap[item.reason] = { reason: item.reason, count: 0 };
            lrMap[item.reason].count += item.count || 0;
          }
        }
      }
      bo.lossReasonSummary = Object.values(lrMap).sort((a, b) => b.count - a.count);
    }
    const openOppMap = {};
    for (const d of boDataArr) {
      for (const opp of (d.rawData?.rawOpenOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key) openOppMap[key] = opp;
      }
    }
    const closedOppMap = {};
    for (const d of boDataArr) {
      for (const opp of (d.rawData?.rawClosedOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key && !closedOppMap[key]) closedOppMap[key] = opp;
      }
    }
    bo.rawData = {
      rawOpenOpps: Object.values(openOppMap),
      rawClosedOpps: Object.values(closedOppMap),
    };

    result.inbound.backOffice = bo;
  }

  // ----- 채널 TM 집계 -----
  const tmDataArr = dailyDataArray.map(d => d.channel?.tm).filter(Boolean);
  if (tmDataArr.length > 0) {
    const tm = {};
    const dcArr = tmDataArr.map(d => d.dailyConversion).filter(Boolean);
    if (dcArr.length > 0) {
      const visitAssigned = dcArr.reduce((s, d) => s + (d.visitAssigned || 0), 0);
      const quoteTransitions = dcArr.reduce((s, d) => s + (d.quoteTransitions || 0), 0);
      const total = visitAssigned + quoteTransitions;
      const lastDc = dcArr[dcArr.length - 1];
      const tmMemberCount = lastDc.tmMemberCount || 1;
      const totalWeekdays = lastDc.totalWeekdays || dailyDataArray.length;
      tm.dailyConversion = {
        visitAssigned,
        quoteTransitions,
        total,
        avgDaily: totalWeekdays > 0 ? Math.round(total / totalWeekdays * 10) / 10 : 0,
        avgDailyPerPerson: totalWeekdays > 0 && tmMemberCount > 0
          ? Math.round(total / (tmMemberCount * totalWeekdays) * 10) / 10 : 0,
        tmMemberCount,
        totalWeekdays,
        target_daily: 5,
      };
    }
    const frtArr = tmDataArr.map(d => d.frt).filter(Boolean);
    if (frtArr.length > 0) {
      const frt = { totalWithTask: 0, frtOk: 0, frtOver20: 0, buckets: {} };
      for (const f of frtArr) {
        frt.totalWithTask += f.totalWithTask || 0;
        frt.frtOk += f.frtOk || 0;
        frt.frtOver20 += f.frtOver20 || 0;
        if (f.buckets) {
          for (const [bk, bv] of Object.entries(f.buckets)) {
            frt.buckets[bk] = (frt.buckets[bk] || 0) + (bv || 0);
          }
        }
      }
      frt.avgFrtMinutes = frt.totalWithTask > 0
        ? Math.round(frtArr.reduce((s, f) => s + (f.avgFrtMinutes || 0) * (f.totalWithTask || 0), 0) / frt.totalWithTask * 10) / 10
        : 0;
      frt.target_frtOver20 = frtArr[0].target_frtOver20;
      tm.frt = frt;
    }
    tm.unconvertedMQL = tmDataArr[tmDataArr.length - 1]?.unconvertedMQL;
    tm.sqlBacklog = tmDataArr[tmDataArr.length - 1]?.sqlBacklog;
    const ownerArrs = tmDataArr.map(d => d.byOwner).filter(Boolean);
    if (ownerArrs.length > 0) {
      const merged = mergeByOwner(ownerArrs);
      const twDays = tm.dailyConversion?.totalWeekdays || dailyDataArray.length || 1;
      for (const row of merged) {
        row.totalActions = (row.converted || 0) + (row.quoteTransitions || 0);
        row.avgDailyActions = twDays > 0 ? Math.round(row.totalActions / twDays * 10) / 10 : 0;
        row.avgDailyConversion = twDays > 0 ? Math.round((row.converted || 0) / twDays * 10) / 10 : row.converted;
        if (row.frtOk + row.frtOver20 > 0) {
          row.avgFrt = Math.round(row.avgFrt / ownerArrs.length);
        }
      }
      tm.byOwner = merged;
    }

    tm.dailyDetails = dailyDataArray.map(d => {
      const dtm = d.channel?.tm;
      if (!dtm) return null;
      const dateStr = d.period || d.dateRange?.start || '';
      const dayOfWeek = dateStr ? new Date(dateStr).getDay() : 0;
      return {
        date: dateStr,
        dayName: dayNames[dayOfWeek] || '',
        dayOfWeek,
        dailyConversion: dtm.dailyConversion,
        frt: dtm.frt,
        unconvertedMQL: dtm.unconvertedMQL,
        byOwner: dtm.byOwner || [],
        rawData: {
          frtOver20: dtm.rawData?.frtOver20 || [],
          unconvertedMQL: dtm.rawData?.unconvertedMQL || [],
        },
      };
    }).filter(Boolean);

    // TM rawOpenOpps 전 기간 union
    const tmOpenOppMap = {};
    for (const d of tmDataArr) {
      for (const opp of (d.rawData?.rawOpenOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key) tmOpenOppMap[key] = opp;
      }
    }
    if (!tm.rawData) tm.rawData = {};
    tm.rawData.rawOpenOpps = Object.values(tmOpenOppMap);

    result.channel.tm = tm;
  }

  // ----- 채널 AE 집계 -----
  const aeDataArr = dailyDataArray.map(d => d.channel?.ae).filter(Boolean);
  if (aeDataArr.length > 0) {
    const ae = {};
    ae.mouCount = aeDataArr.reduce((s, d) => s + (d.mouCount || 0), 0);
    ae.mouNegoProgress = aeDataArr[aeDataArr.length - 1]?.mouNegoProgress;
    const mtArr = aeDataArr.map(d => d.meetingCount).filter(Boolean);
    if (mtArr.length > 0) {
      ae.meetingCount = {
        total: mtArr.reduce((s, d) => s + (d.total || 0), 0),
        byOwner: mergeByOwner(mtArr.map(d => d.byOwner)),
      };
    }
    result.channel.ae = ae;
  }

  // ----- 채널 AM 집계 -----
  const amDataArr = dailyDataArray.map(d => d.channel?.am).filter(Boolean);
  if (amDataArr.length > 0) {
    const am = {};
    const dlArr = amDataArr.map(d => d.dailyLeadCount).filter(Boolean);
    if (dlArr.length > 0) {
      const byOwner = mergeByOwner(dlArr.map(d => d.byOwner));
      am.dailyLeadCount = {
        partner: dlArr.reduce((s, d) => s + (d.partner || 0), 0),
        franchise: dlArr.reduce((s, d) => s + (d.franchise || 0), 0),
        total: dlArr.reduce((s, d) => s + (d.total || 0), 0),
        byOwner,
      };
    }
    const mtArr = amDataArr.map(d => d.meetingCount).filter(Boolean);
    if (mtArr.length > 0) {
      am.meetingCount = {
        total: mtArr.reduce((s, d) => s + (d.total || 0), 0),
        byOwner: mergeByOwner(mtArr.map(d => d.byOwner)),
      };
    }
    am.onboardingRate = amDataArr[amDataArr.length - 1]?.onboardingRate;
    am.activePartnerCount = amDataArr[amDataArr.length - 1]?.activePartnerCount;
    result.channel.am = am;
  }

  // ----- 채널 Back Office 집계 -----
  const cboDataArr = dailyDataArray.map(d => d.channel?.backOffice).filter(Boolean);
  if (cboDataArr.length > 0) {
    const cbo = {};
    const cwRateArr = cboDataArr.map(d => d.cwConversionRate).filter(Boolean);
    if (cwRateArr.length > 0) {
      const byUser = mergeByOwner(cwRateArr.map(d => d.byUser));
      for (const row of byUser) {
        row.cwRate = (row.cw + row.cl) > 0 ? Math.round((row.cw / (row.cw + row.cl)) * 1000) / 10 : 0;
        row.avgDailyClose = dailyDataArray.length > 0 ? Math.round(((row.cw || 0) + (row.cl || 0)) / dailyDataArray.length * 10) / 10 : 0;
      }
      cbo.cwConversionRate = { byUser };
    }
    const cwCarryArr = cboDataArr.map(d => d.cwWithCarryover).filter(Boolean);
    if (cwCarryArr.length > 0) {
      const byUser = mergeByOwner(cwCarryArr.map(d => d.byUser));
      for (const row of byUser) {
        row.cwRate = row.totalClosed > 0 ? Math.round((row.cw / row.totalClosed) * 1000) / 10 : 0;
      }
      const totalCW = byUser.reduce((s, r) => s + (r.cw || 0), 0);
      const totalCarryoverCW = byUser.reduce((s, r) => s + (r.carryoverCW || 0), 0);
      const totalThisMonthCW = byUser.reduce((s, r) => s + (r.thisMonthCW || 0), 0);
      cbo.cwWithCarryover = { byUser, totalCW, totalCarryoverCW, totalThisMonthCW, note: '주간 CW (이월 포함)' };
    }
    const csArr = cboDataArr.map(d => d.contractSummary).filter(Boolean);
    if (csArr.length > 0) {
      cbo.contractSummary = csArr[csArr.length - 1];
    }
    const dcArr2 = cboDataArr.map(d => d.dailyClose).filter(Boolean);
    if (dcArr2.length > 0) {
      const byUser = mergeByOwner(dcArr2.map(d => d.byUser));
      for (const row of byUser) {
        row.avgDailyClose = dailyDataArray.length > 0 ? Math.round((row.avgDailyClose * dcArr2.length) / dailyDataArray.length * 10) / 10 : row.avgDailyClose;
      }
      cbo.dailyClose = { byUser };
    }
    cbo.sqlBacklog = cboDataArr[cboDataArr.length - 1]?.sqlBacklog;
    cbo.agingSummary = cboDataArr[cboDataArr.length - 1]?.agingSummary;
    const lrArr = cboDataArr.map(d => d.lossReasonSummary).filter(Boolean);
    if (lrArr.length > 0) {
      const lrMap = {};
      for (const lr of lrArr) {
        if (Array.isArray(lr)) {
          for (const item of lr) {
            if (!lrMap[item.reason]) lrMap[item.reason] = { reason: item.reason, count: 0 };
            lrMap[item.reason].count += item.count || 0;
          }
        }
      }
      cbo.lossReasonSummary = Object.values(lrMap).sort((a, b) => b.count - a.count);
    }
    const cboOpenOppMap = {};
    for (const d of cboDataArr) {
      for (const opp of (d.rawData?.rawOpenOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key) cboOpenOppMap[key] = opp;
      }
    }
    const cboClosedOppMap = {};
    for (const d of cboDataArr) {
      for (const opp of (d.rawData?.rawClosedOpps || [])) {
        const key = opp.oppId || opp.name;
        if (key && !cboClosedOppMap[key]) cboClosedOppMap[key] = opp;
      }
    }
    cbo.rawData = {
      rawOpenOpps: Object.values(cboOpenOppMap),
      rawClosedOpps: Object.values(cboClosedOppMap),
    };

    result.channel.backOffice = cbo;
  }

  // 주간 dailyTrends 생성
  result.dailyTrends = dailyDataArray.map(d => {
    const dateStr = d.period || d.dateRange?.start || '';
    const dayOfWeek = dateStr ? new Date(dateStr).getDay() : 0;
    const tm = d.channel?.tm;
    const dis = d.inbound?.insideSales;
    const dfs = d.inbound?.fieldSales;
    const dibo = d.inbound?.backOffice;
    const dcbo = d.channel?.backOffice;
    return {
      date: dateStr,
      dayName: dayNames[dayOfWeek] || '',
      dayOfWeek,
      channelTM: {
        lead: tm?.byOwner?.reduce((s, o) => s + (o.lead || 0), 0) || tm?.dailyConversion?.lead || 0,
        frtOver20: tm?.frt?.frtOver20 || 0,
        dailyConversion: tm?.dailyConversion?.total || 0,
        unconvertedMQL: tm?.unconvertedMQL?.count || 0,
      },
      insideSales: {
        lead: dis?.lead || 0,
        mql: dis?.mql || 0,
        sql: dis?.sql || 0,
        sqlConversionRate: dis?.sqlConversionRate ?? null,
        frtRate: dis?.frt?.totalWithTask > 0
          ? +((dis.frt.frtOk / dis.frt.totalWithTask) * 100).toFixed(1)
          : null,
        frtOver20: dis?.frt?.frtOver20 || 0,
        taskAvg: (() => {
          const owners = dis?.dailyTask?.byOwner || [];
          return owners.length > 0
            ? +(owners.reduce((s, o) => s + (o.avgDaily || 0), 0) / owners.length).toFixed(1)
            : null;
        })(),
        visitCount: dis?.visitCount || 0,
        visitRate: dis?.visitRate ?? null,
        rawCounts: {
          frtOver20: dis?.rawData?.frtOver20?.length || 0,
          unconvertedMQL: dis?.rawData?.unconvertedMQL?.length || 0,
          noVisitSQL: dis?.rawData?.noVisitSQL?.length || 0,
        },
      },
      fieldSales: (() => {
        const fsUsers = dfs?.cwConversionRate?.byUser || [];
        const totalSQL = fsUsers.reduce((s, u) => s + (u.total || 0), 0);
        const totalCW = fsUsers.reduce((s, u) => s + (u.cw || 0), 0);
        const totalCL = fsUsers.reduce((s, u) => s + (u.cl || 0), 0);
        const totalOpen = fsUsers.reduce((s, u) => s + (u.open || 0), 0);
        return {
          sqlTotal: totalSQL, cw: totalCW, cl: totalCL, open: totalOpen,
          cwRate: (totalCW + totalCL) > 0 ? +((totalCW / (totalCW + totalCL)) * 100).toFixed(1) : null,
          goldenTimeStale: dfs?.goldenTime?.staleCount || 0,
          obsLeadCount: dfs?.obsLeadCount || 0,
          staleVisitCount: dfs?.staleVisit?.total ?? 0,
        };
      })(),
      inboundBO: (() => {
        const boUsers = dibo?.cwConversionRate?.byUser || [];
        const totalSQL = boUsers.reduce((s, u) => s + (u.total || 0), 0);
        const totalCW = boUsers.reduce((s, u) => s + (u.cw || 0), 0);
        const totalCL = boUsers.reduce((s, u) => s + (u.cl || 0), 0);
        return {
          sqlTotal: totalSQL, cw: totalCW, cl: totalCL,
          totalClosed: totalCW + totalCL,
          cwRate: totalSQL > 0 ? +((totalCW / totalSQL) * 100).toFixed(1) : null,
          sqlBacklogOpen: dibo?.sqlBacklog?.totalOpen ?? 0,
          sqlBacklogOver7: dibo?.sqlBacklog?.totalOver7 ?? 0,
        };
      })(),
      channelBO: (() => {
        const cboUsers = dcbo?.cwConversionRate?.byUser || [];
        const totalSQL = cboUsers.reduce((s, u) => s + (u.total || 0), 0);
        const totalCW = cboUsers.reduce((s, u) => s + (u.cw || 0), 0);
        const totalCL = cboUsers.reduce((s, u) => s + (u.cl || 0), 0);
        return {
          sqlTotal: totalSQL, cw: totalCW, cl: totalCL,
          totalClosed: totalCW + totalCL,
          cwRate: totalSQL > 0 ? +((totalCW / totalSQL) * 100).toFixed(1) : null,
          sqlBacklogOpen: dcbo?.sqlBacklog?.totalOpen ?? 0,
          sqlBacklogOver7: dcbo?.sqlBacklog?.totalOver7 ?? 0,
        };
      })(),
    };
  });

  return result;
}

// ============================================================
// 현재 상태 어노테이션
// ============================================================

/**
 * 최신 월간 데이터에서 closedOpps를 수집하여
 * 과거 rawOpenOpps 항목에 currentStage / closedDate 필드를 추가
 *
 * @param {object} data — KPI 데이터 (mutated in place)
 * @param {string} requestedPeriod — 'YYYY-MM' 요청 기간
 * @param {string} dataDir — data/ 디렉토리 경로
 */
async function annotateCurrentStatus(data, requestedPeriod, dataDir) {
  try {
    const files = await fs.readdir(dataDir);
    const monthlyFiles = files
      .filter(f => /^kpi-extract-\d{4}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();

    const closedMap = {};
    for (const mf of monthlyFiles) {
      const mMonth = mf.match(/kpi-extract-(\d{4}-\d{2})\.json/)[1];
      if (mMonth < requestedPeriod) continue;
      try {
        const content = await fs.readFile(path.join(dataDir, mf), 'utf-8');
        const mData = JSON.parse(content);
        for (const opp of (mData.inbound?.fieldSales?.rawData?.rawClosedOpps || [])) {
          if (opp.oppId && !closedMap[opp.oppId]) {
            closedMap[opp.oppId] = { currentStage: opp.stageName, closedDate: opp.changeDate || opp.closeDate };
          }
        }
        for (const opp of (mData.inbound?.backOffice?.rawData?.rawClosedOpps || [])) {
          if (opp.oppId && !closedMap[opp.oppId]) {
            closedMap[opp.oppId] = { currentStage: opp.stageName, closedDate: opp.changeDate || opp.closeDate };
          }
        }
        for (const opp of (mData.channel?.backOffice?.rawData?.rawClosedOpps || [])) {
          if (opp.oppId && !closedMap[opp.oppId]) {
            closedMap[opp.oppId] = { currentStage: opp.stageName, closedDate: opp.changeDate || opp.closeDate };
          }
        }
      } catch (e) { /* 파일 읽기 실패 무시 */ }
    }

    if (Object.keys(closedMap).length === 0) return data;

    const sections = [
      data.inbound?.insideSales?.rawData?.rawOpenOpps,
      data.inbound?.fieldSales?.rawData?.rawOpenOpps,
      data.inbound?.backOffice?.rawData?.rawOpenOpps,
      data.channel?.backOffice?.rawData?.rawOpenOpps,
    ];
    for (const opps of sections) {
      if (!Array.isArray(opps)) continue;
      for (const opp of opps) {
        const closed = closedMap[opp.oppId];
        if (closed) {
          opp.currentStage = closed.currentStage;
          opp.closedDate = closed.closedDate;
        }
      }
    }
  } catch (e) {
    console.error('[annotateCurrentStatus] 오류:', e.message);
  }
  return data;
}

// ============================================================
// 주 목록 생성 (메타데이터용)
// ============================================================

/**
 * 특정 월의 available dates를 월요일-일요일 주차로 그룹핑
 * @param {string} month — 'YYYY-MM'
 * @param {string[]} availableDates — ['YYYY-MM-DD', ...]
 * @returns {{ month: string, weeks: Array<{ weekNum, start, end, dates }> }}
 */
function generateWeeks(month, availableDates) {
  if (!availableDates || availableDates.length === 0) {
    return { month, weeks: [] };
  }

  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0);
  const lastDate = lastDay.getDate();

  const weeks = [];
  let weekStart = 1;

  while (weekStart <= lastDate) {
    const startDate = new Date(year, mon - 1, weekStart);
    const dayOfWeek = startDate.getDay();

    let weekEndDay;
    if (dayOfWeek === 0) {
      weekEndDay = weekStart;
    } else {
      const daysUntilSunday = 7 - dayOfWeek;
      weekEndDay = Math.min(weekStart + daysUntilSunday, lastDate);
    }

    const start = `${month}-${String(weekStart).padStart(2, '0')}`;
    const end = `${month}-${String(weekEndDay).padStart(2, '0')}`;
    const dates = availableDates.filter(d => d >= start && d <= end);

    if (dates.length > 0) {
      weeks.push({
        weekNum: weeks.length + 1,
        start,
        end,
        dates,
      });
    }

    weekStart = weekEndDay + 1;
  }

  return { month, weeks };
}

module.exports = {
  mergeByOwner,
  sumFields,
  aggregateWeeklyData,
  annotateCurrentStatus,
  generateWeeks,
};
