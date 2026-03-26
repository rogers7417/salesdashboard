/**
 * 통계 계산 모듈
 */

// 1일~endDate까지의 영업일수 (주말 제외)
function countWorkdays(year, month, endDay) {
  let count = 0;
  for (let d = 1; d <= endDay; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Lead → Account ID 추출 (Partner__c 우선, PartnerName__c 폴백)
function getLeadAccountId(l) {
  return l.Partner__c || l.PartnerName__c;
}

function calculateStats(data, targetMonth = null, options = {}) {
  const { includeClosed = false } = options;
  const { partners, franchiseBrands, franchiseStores, storesByBrand, franchiseHQList, franchiseHQAccounts, leads, opportunities, partnerSourceLeads, franchiseSourceLeads, channelEvents, channelTasks, channelUsers, channelUserMap, contactTasksMap, channelCaseMap, partnerReferredStores, channelLeadOpportunities, channelLeadOppMap } = data;

  // Account ID → Name 매핑
  const accountMap = new Map();
  [...partners, ...franchiseBrands].forEach(a => {
    accountMap.set(a.Id, {
      name: a.Name,
      type: a.fm_AccountType__c,
      owner: a.Owner?.Name || '미배정',
      progress: a.Progress__c || null,
      mouStart: a.MOUstartdate__c || null,
      mouEnd: a.MOUenddate__c || null
    });
  });

  // Lead를 Account별로 그룹핑
  const leadsByAccount = new Map();
  leads.forEach(l => {
    const accountId = getLeadAccountId(l);
    if (accountId && accountMap.has(accountId)) {
      if (!leadsByAccount.has(accountId)) {
        leadsByAccount.set(accountId, []);
      }
      leadsByAccount.get(accountId).push(l);
    }
  });

  // LeadSource 기반 Lead를 Account별로 그룹핑
  const partnerSourceLeadsByAccount = new Map();
  const franchiseSourceLeadsByAccount = new Map();

  (partnerSourceLeads || []).forEach(l => {
    const accountId = getLeadAccountId(l);
    if (accountId) {
      if (!partnerSourceLeadsByAccount.has(accountId)) {
        partnerSourceLeadsByAccount.set(accountId, []);
      }
      partnerSourceLeadsByAccount.get(accountId).push(l);
    }
  });

  (franchiseSourceLeads || []).forEach(l => {
    const accountId = getLeadAccountId(l);
    if (accountId) {
      if (!franchiseSourceLeadsByAccount.has(accountId)) {
        franchiseSourceLeadsByAccount.set(accountId, []);
      }
      franchiseSourceLeadsByAccount.get(accountId).push(l);
    }
  });

  // 프랜차이즈소개 Lead를 BrandName__c로 그룹핑
  const franchiseLeadsByBrand = new Map();
  (franchiseSourceLeads || []).forEach(l => {
    const brandId = l.BrandName__c;
    if (brandId) {
      if (!franchiseLeadsByBrand.has(brandId)) {
        franchiseLeadsByBrand.set(brandId, []);
      }
      franchiseLeadsByBrand.get(brandId).push(l);
    }
  });

  // Opportunity를 Account별로 그룹핑
  const oppsByAccount = new Map();
  opportunities.forEach(o => {
    const accountId = o.AccountId;
    if (accountId) {
      if (!oppsByAccount.has(accountId)) {
        oppsByAccount.set(accountId, []);
      }
      oppsByAccount.get(accountId).push(o);
    }
  });

  // 파트너사 상세
  const partnerStats = partners.map(p => {
    const accountLeads = leadsByAccount.get(p.Id) || [];
    const accountOpps = oppsByAccount.get(p.Id) || [];
    const referredStores = p.AccountPartners__r?.records || [];
    const partnerLeads = partnerSourceLeadsByAccount.get(p.Id) || [];
    const franchiseLeads = franchiseSourceLeadsByAccount.get(p.Id) || [];
    const totalSourceLeads = [...partnerLeads, ...franchiseLeads];

    return {
      id: p.Id,
      name: p.Name,
      type: '파트너사',
      owner: p.Owner?.Name || '미배정',
      phone: p.Phone || '-',
      progress: p.Progress__c || '-',
      mouStart: p.MOUstartdate__c || '-',
      mouEnd: p.MOUenddate__c || '-',
      mouContractDate: p.MOU_ContractDate__c || null,
      isPartner: p.IsPartner,
      createdDate: p.CreatedDate,
      absoluteFirstLeadDate: totalSourceLeads.length > 0
        ? totalSourceLeads.reduce((min, l) => l.CreatedDate < min ? l.CreatedDate : min, totalSourceLeads[0].CreatedDate).substring(0, 10)
        : null,
      referredStoreCount: referredStores.length,
      referredStores: referredStores.map(s => ({
        id: s.Id,
        name: s.Name,
        accountPartnerId: s.AccountPartner__c,
        accountPartnerName: s.AccountPartner__r?.Name || null
      })),
      leadCount: accountLeads.length,
      leadConverted: accountLeads.filter(l => l.IsConverted).length,
      leadOpen: accountLeads.filter(l => !l.IsConverted && l.Status !== 'Closed').length,
      partnerLeadCount: partnerLeads.length,
      partnerLeadConverted: partnerLeads.filter(l => l.IsConverted).length,
      partnerLeadOpen: partnerLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      partnerLeadConversionRate: partnerLeads.length > 0 ? ((partnerLeads.filter(l => l.IsConverted).length / partnerLeads.length) * 100).toFixed(1) : 0,
      franchiseLeadCount: franchiseLeads.length,
      franchiseLeadConverted: franchiseLeads.filter(l => l.IsConverted).length,
      franchiseLeadOpen: franchiseLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      franchiseLeadConversionRate: franchiseLeads.length > 0 ? ((franchiseLeads.filter(l => l.IsConverted).length / franchiseLeads.length) * 100).toFixed(1) : 0,
      sourceLeadCount: totalSourceLeads.length,
      sourceLeadConverted: totalSourceLeads.filter(l => l.IsConverted).length,
      sourceLeadOpen: totalSourceLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      sourceLeadConversionRate: totalSourceLeads.length > 0 ? ((totalSourceLeads.filter(l => l.IsConverted).length / totalSourceLeads.length) * 100).toFixed(1) : 0,
      oppCount: accountOpps.length,
      oppWon: accountOpps.filter(o => o.IsWon).length,
      oppLost: accountOpps.filter(o => o.IsClosed && !o.IsWon).length,
      oppOpen: accountOpps.filter(o => !o.IsClosed).length,
      leads: accountLeads,
      opportunities: accountOpps
    };
  });

  // 프랜차이즈 브랜드 상세
  const franchiseStats = franchiseBrands.map(f => {
    const accountLeads = leadsByAccount.get(f.Id) || [];
    const accountOpps = oppsByAccount.get(f.Id) || [];
    const franchiseStoreList = storesByBrand?.get(f.Id) || [];
    const brandLeads = franchiseLeadsByBrand.get(f.Id) || [];

    return {
      id: f.Id,
      name: f.Name,
      type: '브랜드',
      owner: f.Owner?.Name || '미배정',
      phone: f.Phone || '-',
      progress: f.Progress__c || '-',
      mouStart: f.MOUstartdate__c || '-',
      mouEnd: f.MOUenddate__c || '-',
      isPartner: f.IsPartner,
      createdDate: f.CreatedDate,
      hqId: f.FRHQ__c || null,
      hqName: f.FRHQ__r?.Name || null,
      referredStoreCount: franchiseStoreList.length,
      referredStores: franchiseStoreList.map(s => ({
        id: s.Id,
        name: s.Name,
        ownerId: s.OwnerId,
        ownerName: s.Owner?.Name || null
      })),
      leadCount: accountLeads.length,
      leadConverted: accountLeads.filter(l => l.IsConverted).length,
      leadOpen: accountLeads.filter(l => !l.IsConverted && l.Status !== 'Closed').length,
      sourceLeadCount: brandLeads.length,
      sourceLeadConverted: brandLeads.filter(l => l.IsConverted).length,
      sourceLeadOpen: brandLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      sourceLeadConversionRate: brandLeads.length > 0 ? ((brandLeads.filter(l => l.IsConverted).length / brandLeads.length) * 100).toFixed(1) : 0,
      oppCount: accountOpps.length,
      oppWon: accountOpps.filter(o => o.IsWon).length,
      oppLost: accountOpps.filter(o => o.IsClosed && !o.IsWon).length,
      oppOpen: accountOpps.filter(o => !o.IsClosed).length,
      leads: accountLeads,
      opportunities: accountOpps
    };
  });

  // 시간 관련 변수
  let now;
  if (targetMonth) {
    const [y, m] = targetMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const todayDate = new Date();
    const isCurrentMonth = todayDate.getFullYear() === y && (todayDate.getMonth() + 1) === m;
    now = isCurrentMonth ? todayDate : new Date(y, m - 1, lastDay);
  } else {
    now = new Date();
  }
  const thisMonth = targetMonth || now.toISOString().substring(0, 7);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().substring(0, 7);
  const isThisMonth = (lead) => lead.CreatedDate?.substring(0, 7) === thisMonth;

  // 담당자별 요약
  const ownerStats = {};
  partnerStats.forEach(account => {
    const owner = account.owner;
    if (!ownerStats[owner]) {
      ownerStats[owner] = {
        name: owner,
        partnerCount: 0,
        franchiseCount: 0,
        partnerLeads: 0,
        partnerLeadsConverted: 0,
        franchiseLeads: 0,
        franchiseLeadsConverted: 0,
        totalLeads: 0,
        totalConverted: 0
      };
    }
    ownerStats[owner].partnerCount++;
    const monthLeads = (account.leads || []).filter(isThisMonth);
    const monthConverted = monthLeads.filter(l => l.IsConverted).length;
    ownerStats[owner].partnerLeads += monthLeads.length;
    ownerStats[owner].partnerLeadsConverted += monthConverted;
    ownerStats[owner].totalLeads += monthLeads.length;
    ownerStats[owner].totalConverted += monthConverted;
  });

  franchiseStats.forEach(account => {
    const owner = account.owner;
    if (!ownerStats[owner]) {
      ownerStats[owner] = {
        name: owner,
        partnerCount: 0,
        franchiseCount: 0,
        partnerLeads: 0,
        partnerLeadsConverted: 0,
        franchiseLeads: 0,
        franchiseLeadsConverted: 0,
        totalLeads: 0,
        totalConverted: 0
      };
    }
    ownerStats[owner].franchiseCount++;
    const monthLeads = (account.leads || []).filter(isThisMonth);
    const monthConverted = monthLeads.filter(l => l.IsConverted).length;
    ownerStats[owner].franchiseLeads += monthLeads.length;
    ownerStats[owner].franchiseLeadsConverted += monthConverted;
    ownerStats[owner].totalLeads += monthLeads.length;
    ownerStats[owner].totalConverted += monthConverted;
  });

  // 전체 요약
  const totalPartnerStores = partnerStats.reduce((sum, a) => sum + a.referredStoreCount, 0);
  const totalFranchiseStores = franchiseHQList.reduce((sum, hq) => sum + hq.totalStores, 0);
  const totalFranchiseHQ = franchiseHQAccounts.length;
  const totalFranchiseBrands = franchiseBrands.length;

  // LeadSource 기반 채널 활동 지표
  const calcLeadStats = (leadList) => {
    const total = leadList.length;
    const converted = leadList.filter(l => l.IsConverted).length;
    const open = leadList.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length;
    const closed = leadList.filter(l => !l.IsConverted && ['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length;
    const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(1) : 0;

    const byOwner = {};
    leadList.forEach(l => {
      const owner = l.Owner?.Name || '미배정';
      if (!byOwner[owner]) {
        byOwner[owner] = { total: 0, converted: 0, open: 0 };
      }
      byOwner[owner].total++;
      if (l.IsConverted) byOwner[owner].converted++;
      else if (!['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)) byOwner[owner].open++;
    });

    const byStatus = {};
    leadList.forEach(l => {
      const status = l.Status || '(없음)';
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    const byMonth = {};
    leadList.forEach(l => {
      const month = l.CreatedDate?.substring(0, 7) || 'unknown';
      if (!byMonth[month]) {
        byMonth[month] = { total: 0, converted: 0 };
      }
      byMonth[month].total++;
      if (l.IsConverted) byMonth[month].converted++;
    });

    return {
      total, converted, open, closed, conversionRate,
      byOwner: Object.entries(byOwner)
        .map(([name, stats]) => ({ name, ...stats, conversionRate: stats.total > 0 ? ((stats.converted / stats.total) * 100).toFixed(1) : 0 }))
        .sort((a, b) => b.total - a.total),
      byStatus: Object.entries(byStatus)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      byMonth: Object.entries(byMonth)
        .map(([month, stats]) => ({ month, ...stats }))
        .sort((a, b) => b.month.localeCompare(a.month))
        .slice(0, 12)
    };
  };

  const partnerLeadStats = calcLeadStats(partnerSourceLeads || []);
  const franchiseLeadStats = calcLeadStats(franchiseSourceLeads || []);

  // 제외 사유 (오인입, 중복, 오생성)
  const excludedLossReasons = ['오인입', '중복유입', '오생성'];
  const isValidLead = (l) => !excludedLossReasons.includes(l.LossReason__c);

  // 이번 달 소유자별 채널 Lead 통계 (MQL/SQL)
  const thisMonthChannelLeads = [...(partnerSourceLeads || []), ...(franchiseSourceLeads || [])]
    .filter(l => l.CreatedDate?.substring(0, 7) === thisMonth);

  // 제외된 Lead 수
  const thisMonthExcluded = thisMonthChannelLeads.filter(l => !isValidLead(l));

  const channelLeadsByOwnerThisMonth = {};
  thisMonthChannelLeads.forEach(l => {
    const owner = l.Owner?.Name || '(미지정)';
    if (!channelLeadsByOwnerThisMonth[owner]) {
      channelLeadsByOwnerThisMonth[owner] = {
        partner: 0, franchise: 0,
        partnerMQL: 0, franchiseMQL: 0,
        partnerSQL: 0, franchiseSQL: 0,
        partnerExcluded: 0, franchiseExcluded: 0
      };
    }
    const isPartner = l.LeadSource === '파트너사 소개';
    const isFranchise = l.LeadSource === '프랜차이즈소개';
    const isValid = isValidLead(l);
    const isSQL = l.IsConverted === true;

    // 전체 카운트
    if (isPartner) channelLeadsByOwnerThisMonth[owner].partner++;
    if (isFranchise) channelLeadsByOwnerThisMonth[owner].franchise++;

    // MQL (유효 Lead - 제외 사유 없는 것)
    if (isValid) {
      if (isPartner) channelLeadsByOwnerThisMonth[owner].partnerMQL++;
      if (isFranchise) channelLeadsByOwnerThisMonth[owner].franchiseMQL++;
    } else {
      // 제외된 Lead
      if (isPartner) channelLeadsByOwnerThisMonth[owner].partnerExcluded++;
      if (isFranchise) channelLeadsByOwnerThisMonth[owner].franchiseExcluded++;
    }

    // SQL (전환된 Lead)
    if (isSQL) {
      if (isPartner) channelLeadsByOwnerThisMonth[owner].partnerSQL++;
      if (isFranchise) channelLeadsByOwnerThisMonth[owner].franchiseSQL++;
    }
  });

  // TM 담당자별 일별 Lead 히트맵 데이터 (Lead Owner 기준)
  const dailyLeadsByOwner = {};
  const daysInMonth = new Set();

  thisMonthChannelLeads.forEach(l => {
    const owner = l.Owner?.Name || '(미지정)';
    const day = l.CreatedDate?.substring(8, 10); // DD
    if (!day) return;

    daysInMonth.add(day);
    if (!dailyLeadsByOwner[owner]) {
      dailyLeadsByOwner[owner] = {};
    }
    dailyLeadsByOwner[owner][day] = (dailyLeadsByOwner[owner][day] || 0) + 1;
  });

  // 일별 정렬된 배열
  const sortedDays = Array.from(daysInMonth).sort();

  // TM 담당자별 히트맵 데이터 (0건인 담당자 제외)
  const leadHeatmap = Object.entries(dailyLeadsByOwner)
    .filter(([owner, days]) => Object.values(days).reduce((a, b) => a + b, 0) > 0)
    .map(([owner, days]) => {
      const dailyData = sortedDays.map(day => ({
        day: parseInt(day),
        count: days[day] || 0
      }));
      const total = dailyData.reduce((sum, d) => sum + d.count, 0);
      const maxDay = Math.max(...dailyData.map(d => d.count));
      return { owner, dailyData, total, maxDay, role: 'TM' };
    })
    .sort((a, b) => b.total - a.total);

  // AM 담당자별 일별 Lead 히트맵 데이터 (Account Owner 기준)
  const dailyLeadsByAccountOwner = {};

  thisMonthChannelLeads.forEach(l => {
    const day = l.CreatedDate?.substring(8, 10);
    if (!day) return;

    // 파트너사 소개: Partner__c/PartnerName__c로 Account Owner 조회
    // 프랜차이즈소개: BrandName__c로 Account Owner 조회
    let accountOwner = null;
    if (l.LeadSource === '파트너사 소개') {
      const acctId = getLeadAccountId(l);
      if (acctId) accountOwner = accountMap.get(acctId)?.owner;
    } else if (l.LeadSource === '프랜차이즈소개' && l.BrandName__c) {
      accountOwner = accountMap.get(l.BrandName__c)?.owner;
    }

    if (!accountOwner) return;

    if (!dailyLeadsByAccountOwner[accountOwner]) {
      dailyLeadsByAccountOwner[accountOwner] = {};
    }
    dailyLeadsByAccountOwner[accountOwner][day] = (dailyLeadsByAccountOwner[accountOwner][day] || 0) + 1;
  });

  // 캘린더용 - 이번 달의 모든 날짜 생성
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=일, 1=월, ...

  // 1일부터 오늘까지의 모든 날짜
  const allDaysUpToToday = [];
  for (let d = 1; d <= today; d++) {
    const dayStr = String(d).padStart(2, '0');
    const dayOfWeek = new Date(year, month, d).getDay();
    allDaysUpToToday.push({
      day: d,
      dayStr,
      dayOfWeek, // 0=일, 1=월, ..., 6=토
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6
    });
  }

  // AM 담당자별 캘린더 데이터 (0건인 담당자 제외)
  const amLeadHeatmap = Object.entries(dailyLeadsByAccountOwner)
    .filter(([owner, days]) => Object.values(days).reduce((a, b) => a + b, 0) > 0)
    .map(([owner, days]) => {
      const dailyData = allDaysUpToToday.map(d => ({
        day: d.day,
        dayOfWeek: d.dayOfWeek,
        isWeekend: d.isWeekend,
        count: days[d.dayStr] || 0
      }));
      const total = dailyData.reduce((sum, d) => sum + d.count, 0);
      const maxDay = Math.max(...dailyData.map(d => d.count));
      const zeroDays = dailyData.filter(d => d.count === 0 && !d.isWeekend).length; // 주말 제외 0건 일수
      return { owner, dailyData, total, maxDay, zeroDays, role: 'AM' };
    })
    .sort((a, b) => b.total - a.total);

  const amHeatmapMaxValue = Math.max(...amLeadHeatmap.map(h => h.maxDay), 1);

  // 캘린더 메타 정보
  const calendarMeta = {
    year,
    month: month + 1,
    today,
    lastDayOfMonth,
    firstDayOfWeek,
    dayNames: ['일', '월', '화', '수', '목', '금', '토']
  };

  // 전체 최대값 (색상 스케일용)
  const heatmapMaxValue = Math.max(...leadHeatmap.map(h => h.maxDay), 1);

  const channelLeadsByOwnerStats = Object.entries(channelLeadsByOwnerThisMonth)
    .map(([owner, data]) => {
      const mql = data.partnerMQL + data.franchiseMQL;
      const sql = data.partnerSQL + data.franchiseSQL;
      return {
        owner,
        partner: data.partner,
        franchise: data.franchise,
        total: data.partner + data.franchise,
        partnerMQL: data.partnerMQL,
        franchiseMQL: data.franchiseMQL,
        mql,
        partnerSQL: data.partnerSQL,
        franchiseSQL: data.franchiseSQL,
        sql,
        excluded: data.partnerExcluded + data.franchiseExcluded,
        conversionRate: mql > 0 ? ((sql / mql) * 100).toFixed(1) : '0.0'
      };
    })
    .sort((a, b) => b.mql - a.mql);

  // FRT (First Response Time) 계산 - Lead 생성 → 첫 수동 Task 생성까지
  // 자동발송 Task 제외: 생성자가 "그로스팀 공용계정"이거나 Subject에 "웰컴톡" 포함
  const isAutoTask = (task) => {
    const creatorName = task.CreatedBy?.Name || '';
    const subject = task.Subject || '';
    return creatorName.includes('그로스팀 공용계정') || subject.includes('웰컴톡');
  };

  const thisMonthMQLLeads = thisMonthChannelLeads.filter(l => isValidLead(l));
  const frtData = thisMonthMQLLeads.map(l => {
    // Lead에 직접 연결된 Task
    let allTasks = l.Tasks?.records || [];

    // 전환된 Lead의 경우 Contact에 연결된 Task도 포함
    if (l.IsConverted && l.ConvertedContactId && contactTasksMap) {
      const contactTasks = contactTasksMap.get(l.ConvertedContactId) || [];
      allTasks = [...allTasks, ...contactTasks];
      // 생성일 기준 정렬
      allTasks.sort((a, b) => new Date(a.CreatedDate) - new Date(b.CreatedDate));
    }

    // 자동발송 Task 제외하고 첫 번째 수동 Task 찾기
    const firstManualTask = allTasks.find(t => !isAutoTask(t));

    if (!firstManualTask) return { leadId: l.Id, frt: null, hasTask: false, hasAnyTask: allTasks.length > 0 };

    const leadCreated = new Date(l.CreatedDate);
    const taskCreated = new Date(firstManualTask.CreatedDate);
    const frtMinutes = Math.round((taskCreated - leadCreated) / 60000);

    return {
      leadId: l.Id,
      leadName: l.Name,
      owner: l.Owner?.Name || '(미지정)',
      leadCreated: l.CreatedDate,
      taskCreated: firstManualTask.CreatedDate,
      taskSubject: firstManualTask.Subject,
      taskCreator: firstManualTask.CreatedBy?.Name || '-',
      frt: frtMinutes,
      hasTask: true,
      hasAnyTask: true,
      frtOver20: frtMinutes > 20,
      isConverted: l.IsConverted
    };
  });

  const leadsWithTask = frtData.filter(f => f.hasTask);
  const leadsWithoutTask = frtData.filter(f => !f.hasTask);
  const leadsWithOnlyAutoTask = frtData.filter(f => !f.hasTask && f.hasAnyTask);
  const frtOver20 = leadsWithTask.filter(f => f.frtOver20);
  const avgFRT = leadsWithTask.length > 0
    ? Math.round(leadsWithTask.reduce((sum, f) => sum + f.frt, 0) / leadsWithTask.length)
    : 0;

  // ====== 1) 담당자별 FRT & Task 상세 ======
  const frtByOwner = {};
  frtData.forEach(f => {
    const owner = f.owner || '(미지정)';
    if (!frtByOwner[owner]) {
      frtByOwner[owner] = { total: 0, withTask: 0, frtOk: 0, frtSum: 0, over20: 0 };
    }
    frtByOwner[owner].total++;
    if (f.hasTask) {
      frtByOwner[owner].withTask++;
      frtByOwner[owner].frtSum += f.frt;
      if (f.frt <= 20) frtByOwner[owner].frtOk++;
      else frtByOwner[owner].over20++;
    }
  });
  const frtByOwnerStats = Object.entries(frtByOwner).map(([name, d]) => ({
    name,
    total: d.total,
    withTask: d.withTask,
    frtOk: d.frtOk,
    over20: d.over20,
    avgFrt: d.withTask > 0 ? Math.round(d.frtSum / d.withTask) : null,
    frtRate: d.withTask > 0 ? ((d.frtOk / d.withTask) * 100).toFixed(1) : '0.0'
  })).sort((a, b) => b.total - a.total);

  // ====== 2) 시간대별 분석 (KST 기준) ======
  const classifyTimeSlot = (lead) => {
    // CreatedTime__c (KST) 사용, 없으면 CreatedDate(UTC) → KST 변환
    let hour, dayOfWeek;
    if (lead.CreatedTime__c) {
      const [datePart, timePart] = lead.CreatedTime__c.split(' ');
      const [y, m, d] = datePart.split('-').map(Number);
      hour = parseInt(timePart.split(':')[0]);
      dayOfWeek = new Date(y, m - 1, d).getDay();
    } else {
      const utc = new Date(lead.CreatedDate);
      const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
      hour = kst.getHours();
      dayOfWeek = kst.getDay();
    }
    if (dayOfWeek === 0 || dayOfWeek === 6) return 'WEEKEND';
    if (hour >= 10 && hour < 19) return 'BUSINESS_HOUR';
    return 'OFF_HOUR';
  };

  const TIME_SLOT_LABELS = {
    'BUSINESS_HOUR': '영업시간 (10~19시)',
    'OFF_HOUR': '영업외',
    'WEEKEND': '주말'
  };

  // 담당자별 시간대별 통계
  const timeSlotByOwner = {};
  thisMonthMQLLeads.forEach(l => {
    const owner = l.Owner?.Name || '(미지정)';
    const slot = classifyTimeSlot(l);
    if (!timeSlotByOwner[owner]) {
      timeSlotByOwner[owner] = {
        BUSINESS_HOUR: { total: 0, converted: 0 },
        OFF_HOUR: { total: 0, converted: 0 },
        WEEKEND: { total: 0, converted: 0 }
      };
    }
    timeSlotByOwner[owner][slot].total++;
    if (l.IsConverted) timeSlotByOwner[owner][slot].converted++;
  });

  const timeSlotByOwnerStats = Object.entries(timeSlotByOwner)
    .map(([name, slots]) => {
      const total = slots.BUSINESS_HOUR.total + slots.OFF_HOUR.total + slots.WEEKEND.total;
      return { name, total, ...slots };
    })
    .sort((a, b) => b.total - a.total);

  // ====== 3) FRT 구간별 오인입/전환 분석 ======
  const classifyFRTBucket = (frtMinutes) => {
    if (frtMinutes === null) return 'Task 없음';
    if (frtMinutes <= 10) return '10분 이내';
    if (frtMinutes <= 20) return '10~20분';
    if (frtMinutes <= 30) return '20~30분';
    if (frtMinutes <= 60) return '30~60분';
    if (frtMinutes <= 120) return '1~2시간';
    if (frtMinutes <= 240) return '2~4시간';
    if (frtMinutes <= 480) return '4~8시간';
    return '8시간 초과';
  };

  const frtBucketOrder = ['10분 이내', '10~20분', '20~30분', '30~60분', '1~2시간', '2~4시간', '4~8시간', '8시간 초과', 'Task 없음'];
  const frtBucketStats = {};
  frtBucketOrder.forEach(b => { frtBucketStats[b] = { total: 0, converted: 0, wrongEntry: 0 }; });

  frtData.forEach(f => {
    const bucket = classifyFRTBucket(f.frt);
    if (!frtBucketStats[bucket]) frtBucketStats[bucket] = { total: 0, converted: 0, wrongEntry: 0 };
    frtBucketStats[bucket].total++;
    if (f.isConverted) frtBucketStats[bucket].converted++;
    // 오인입 체크: 원본 Lead에서 확인
    const lead = thisMonthMQLLeads.find(l => l.Id === f.leadId);
    if (lead && lead.LossReason__c === '오인입') frtBucketStats[bucket].wrongEntry++;
  });

  const frtBucketArray = frtBucketOrder.map(bucket => ({
    bucket,
    total: frtBucketStats[bucket]?.total || 0,
    converted: frtBucketStats[bucket]?.converted || 0,
    wrongEntry: frtBucketStats[bucket]?.wrongEntry || 0,
    convRate: (frtBucketStats[bucket]?.total || 0) > 0
      ? (((frtBucketStats[bucket]?.converted || 0) / frtBucketStats[bucket].total) * 100).toFixed(1) : '0.0',
    wrongRate: (frtBucketStats[bucket]?.total || 0) > 0
      ? (((frtBucketStats[bucket]?.wrongEntry || 0) / frtBucketStats[bucket].total) * 100).toFixed(1) : '0.0'
  })).filter(b => b.total > 0);

  // ====== 4) 시간대별 FRT 상세 (영업시간/영업외/주말 각각) ======
  const frtByTimeSlot = { BUSINESS_HOUR: [], OFF_HOUR: [], WEEKEND: [] };
  frtData.forEach(f => {
    const lead = thisMonthMQLLeads.find(l => l.Id === f.leadId);
    if (!lead) return;
    const slot = classifyTimeSlot(lead);
    frtByTimeSlot[slot].push(f);
  });

  const frtByTimeSlotStats = {};
  Object.entries(frtByTimeSlot).forEach(([slot, data]) => {
    const withTask = data.filter(f => f.hasTask);
    const frtOk = withTask.filter(f => f.frt <= 20);
    frtByTimeSlotStats[slot] = {
      label: TIME_SLOT_LABELS[slot],
      total: data.length,
      withTask: withTask.length,
      frtOk: frtOk.length,
      over20: withTask.filter(f => f.frt > 20).length,
      avgFrt: withTask.length > 0 ? Math.round(withTask.reduce((s, f) => s + f.frt, 0) / withTask.length) : null,
      frtRate: withTask.length > 0 ? ((frtOk.length / withTask.length) * 100).toFixed(1) : '0.0',
      converted: data.filter(f => f.isConverted).length,
      convRate: data.length > 0 ? ((data.filter(f => f.isConverted).length / data.length) * 100).toFixed(1) : '0.0'
    };
  });

  // ====== 5) 오인입 사유별 분석 ======
  const wrongEntryLeads = thisMonthChannelLeads.filter(l => l.LossReason__c === '오인입');
  const wrongEntryReasons = {};
  wrongEntryLeads.forEach(l => {
    const reason = l.LossReason_Contract__c || '(사유 미기입)';
    if (!wrongEntryReasons[reason]) wrongEntryReasons[reason] = 0;
    wrongEntryReasons[reason]++;
  });

  const wrongEntryStats = {
    total: wrongEntryLeads.length,
    rate: thisMonthChannelLeads.length > 0
      ? ((wrongEntryLeads.length / thisMonthChannelLeads.length) * 100).toFixed(1) : '0.0',
    byReason: Object.entries(wrongEntryReasons)
      .map(([reason, count]) => ({
        reason,
        count,
        rate: wrongEntryLeads.length > 0 ? ((count / wrongEntryLeads.length) * 100).toFixed(1) : '0.0'
      }))
      .sort((a, b) => b.count - a.count)
  };

  // MQL → SQL 미전환 건수
  const mqlNotConverted = thisMonthMQLLeads.filter(l => !l.IsConverted);
  const mqlNotConvertedByOwner = {};
  mqlNotConverted.forEach(l => {
    const owner = l.Owner?.Name || '(미지정)';
    if (!mqlNotConvertedByOwner[owner]) mqlNotConvertedByOwner[owner] = [];
    mqlNotConvertedByOwner[owner].push({
      id: l.Id,
      name: l.Name || l.Company || '-',
      status: l.Status,
      createdDate: l.CreatedDate?.substring(0, 10)
    });
  });

  // SQL 파이프라인 (이번달 전환된 Lead의 Opportunity 현황)
  const thisMonthSQLLeads = thisMonthMQLLeads.filter(l => l.IsConverted && l.ConvertedOpportunityId);
  const sqlPipeline = {
    total: thisMonthSQLLeads.length,
    byStage: {},
    byOwner: {},
    byAging: { within3: 0, day4to7: 0, day8to14: 0, over14: 0 },
    cw: 0,
    cl: 0,
    open: 0,
    openList: []
  };

  thisMonthSQLLeads.forEach(lead => {
    const opp = channelLeadOppMap?.get(lead.ConvertedOpportunityId);
    if (!opp) return;

    const stage = opp.StageName || '(없음)';
    const owner = opp.Owner?.Name || lead.Owner?.Name || '(미지정)';
    const ageInDays = opp.AgeInDays || 0;

    // Stage별 집계
    if (!sqlPipeline.byStage[stage]) {
      sqlPipeline.byStage[stage] = { count: 0, amount: 0 };
    }
    sqlPipeline.byStage[stage].count++;
    sqlPipeline.byStage[stage].amount += (opp.Amount || 0);

    // Owner별 집계
    if (!sqlPipeline.byOwner[owner]) {
      sqlPipeline.byOwner[owner] = { total: 0, cw: 0, cl: 0, open: 0, openByAge: { within3: 0, day4to7: 0, day8to14: 0, over14: 0 } };
    }
    sqlPipeline.byOwner[owner].total++;

    // CW/CL/Open 분류
    if (opp.IsWon) {
      sqlPipeline.cw++;
      sqlPipeline.byOwner[owner].cw++;
    } else if (opp.IsClosed) {
      sqlPipeline.cl++;
      sqlPipeline.byOwner[owner].cl++;
    } else {
      sqlPipeline.open++;
      sqlPipeline.byOwner[owner].open++;

      // Aging 분류 (진행중인 건만)
      if (ageInDays <= 3) {
        sqlPipeline.byAging.within3++;
        sqlPipeline.byOwner[owner].openByAge.within3++;
      } else if (ageInDays <= 7) {
        sqlPipeline.byAging.day4to7++;
        sqlPipeline.byOwner[owner].openByAge.day4to7++;
      } else if (ageInDays <= 14) {
        sqlPipeline.byAging.day8to14++;
        sqlPipeline.byOwner[owner].openByAge.day8to14++;
      } else {
        sqlPipeline.byAging.over14++;
        sqlPipeline.byOwner[owner].openByAge.over14++;
      }

      // 진행중 건 리스트
      sqlPipeline.openList.push({
        oppId: opp.Id,
        oppName: opp.Name,
        leadId: lead.Id,
        leadName: lead.Name || lead.Company || '-',
        stage,
        owner,
        ageInDays,
        createdDate: opp.CreatedDate?.substring(0, 10),
        amount: opp.Amount || 0
      });
    }
  });

  // Stage별 정렬
  sqlPipeline.byStageList = Object.entries(sqlPipeline.byStage)
    .map(([stage, data]) => ({ stage, ...data }))
    .sort((a, b) => b.count - a.count);

  // Owner별 정렬
  sqlPipeline.byOwnerList = Object.entries(sqlPipeline.byOwner)
    .map(([owner, data]) => ({
      owner,
      ...data,
      cwRate: data.total > 0 ? ((data.cw / data.total) * 100).toFixed(1) : '0.0'
    }))
    .sort((a, b) => b.total - a.total);

  // 진행중 건 Aging 순 정렬 (오래된 건 먼저)
  sqlPipeline.openList.sort((a, b) => b.ageInDays - a.ageInDays);

  // 파트너사별 최근 활동 계산 (Lead + 미팅)
  const calcPartnerActivity = (partnerList, partnerLeads, franchiseLeads, events, tasks) => {
    const allLeads = [...(partnerLeads || []), ...(franchiseLeads || [])];

    return partnerList.map(p => {
      const myLeads = allLeads.filter(l => getLeadAccountId(l) === p.id);
      const thisMonthLeads = myLeads.filter(l => l.CreatedDate?.substring(0, 7) === thisMonth);
      const last3MonthLeads = myLeads.filter(l => l.CreatedDate?.substring(0, 7) >= threeMonthsAgo);
      const lastLeadDate = myLeads.length > 0
        ? myLeads.reduce((max, l) => l.CreatedDate > max ? l.CreatedDate : max, '').substring(0, 10)
        : null;

      // MOU 전 리드 카운트
      const effectiveMouDate = p.mouContractDate || (p.mouStart !== '-' ? p.mouStart : null);
      const preMouLeadCount = effectiveMouDate
        ? myLeads.filter(l => (l.CreatedDate?.substring(0, 10) || '') < effectiveMouDate).length
        : 0;

      // Task 카운트 & 마지막 Task 일자
      const myTasks = (tasks || []).filter(t => t.WhatId === p.id);
      const taskCount = myTasks.length;
      const lastTaskDate = myTasks.length > 0
        ? myTasks.reduce((max, t) => t.ActivityDate > max ? t.ActivityDate : max, myTasks[0].ActivityDate)
        : null;

      // 일별 Lead 데이터
      const dailyLeadMap = {};
      thisMonthLeads.forEach(l => {
        const day = l.CreatedDate?.substring(8, 10);
        if (day) dailyLeadMap[day] = (dailyLeadMap[day] || 0) + 1;
      });
      const dailyLeads = allDaysUpToToday.map(d => ({
        day: d.day,
        count: dailyLeadMap[d.dayStr] || 0,
        isWeekend: d.isWeekend
      }));

      // 일별 미팅 데이터 (Event.WhatId === partner account id)
      const myMeetings = (events || []).filter(e =>
        e.WhatId === p.id && e.ActivityDate?.substring(0, 7) === thisMonth
      );
      const dailyMeetingMap = {};
      myMeetings.forEach(e => {
        const day = e.ActivityDate?.substring(8, 10);
        if (day) dailyMeetingMap[day] = (dailyMeetingMap[day] || 0) + 1;
      });

      // 일별 통합 데이터 (Lead + 미팅)
      const dailyActivity = allDaysUpToToday.map(d => ({
        day: d.day,
        leads: dailyLeadMap[d.dayStr] || 0,
        meetings: dailyMeetingMap[d.dayStr] || 0,
        isWeekend: d.isWeekend
      }));

      return {
        ...p,
        thisMonthLeadCount: thisMonthLeads.length,
        last3MonthLeadCount: last3MonthLeads.length,
        lastLeadDate,
        dailyLeads,
        dailyActivity,
        meetingCount: myMeetings.length,
        taskCount,
        lastTaskDate,
        preMouLeadCount,
        isActiveThisMonth: thisMonthLeads.length > 0,
        isActiveLast3Months: last3MonthLeads.length > 0
      };
    });
  };

  // 프랜차이즈 본사별 최근 활동 계산 (Lead + 미팅)
  const calcFranchiseHQActivity = (hqList, franchiseLeads, franchiseStatsMap, events, tasks) => {
    return hqList.map(hq => {
      let thisMonthLeads = 0;
      let last3MonthLeads = 0;
      let lastLeadDate = null;

      // 본사 산하 브랜드 ID + 본사 ID 목록 (미팅 매칭에 사용)
      const brandIds = new Set(hq.brands.map(b => b.id));
      if (hq.hqId) brandIds.add(hq.hqId);  // 본사 계정에 직접 연결된 미팅도 매칭

      const enrichedBrands = hq.brands.map(brand => {
        const brandLeads = (franchiseLeads || []).filter(l => l.BrandName__c === brand.id);
        const brandThisMonth = brandLeads.filter(l => l.CreatedDate?.substring(0, 7) === thisMonth).length;
        const brandLast3Month = brandLeads.filter(l => l.CreatedDate?.substring(0, 7) >= threeMonthsAgo).length;
        const brandLastDate = brandLeads.length > 0
          ? brandLeads.reduce((max, l) => l.CreatedDate > max ? l.CreatedDate : max, '').substring(0, 10)
          : null;

        thisMonthLeads += brandThisMonth;
        last3MonthLeads += brandLast3Month;
        if (brandLastDate && (!lastLeadDate || brandLastDate > lastLeadDate)) {
          lastLeadDate = brandLastDate;
        }

        const brandStats = franchiseStatsMap.get(brand.id) || {};
        return {
          ...brand,
          leadCount: brandStats.sourceLeadCount || 0,
          leadConverted: brandStats.sourceLeadConverted || 0,
          leadOpen: brandStats.sourceLeadOpen || 0,
          conversionRate: brandStats.sourceLeadConversionRate || 0,
          thisMonthLeadCount: brandThisMonth,
          last3MonthLeadCount: brandLast3Month,
          lastLeadDate: brandLastDate
        };
      });

      const totalLeads = enrichedBrands.reduce((sum, b) => sum + b.leadCount, 0);
      const totalConverted = enrichedBrands.reduce((sum, b) => sum + b.leadConverted, 0);

      // 일별 Lead 데이터 (본사 전체 합산)
      const hqThisMonthLeads = (franchiseLeads || []).filter(l =>
        brandIds.has(l.BrandName__c) && l.CreatedDate?.substring(0, 7) === thisMonth
      );
      const dailyLeadMap = {};
      hqThisMonthLeads.forEach(l => {
        const day = l.CreatedDate?.substring(8, 10);
        if (day) dailyLeadMap[day] = (dailyLeadMap[day] || 0) + 1;
      });

      // 일별 미팅 데이터 (Event.WhatId가 본사 산하 브랜드 ID 중 하나)
      const hqMeetings = (events || []).filter(e =>
        brandIds.has(e.WhatId) && e.ActivityDate?.substring(0, 7) === thisMonth
      );
      const dailyMeetingMap = {};
      hqMeetings.forEach(e => {
        const day = e.ActivityDate?.substring(8, 10);
        if (day) dailyMeetingMap[day] = (dailyMeetingMap[day] || 0) + 1;
      });

      // 일별 통합 데이터 (Lead + 미팅)
      const dailyActivity = allDaysUpToToday.map(d => ({
        day: d.day,
        leads: dailyLeadMap[d.dayStr] || 0,
        meetings: dailyMeetingMap[d.dayStr] || 0,
        isWeekend: d.isWeekend
      }));

      // Task 카운트 & 마지막 Task 일자 (본사 + 산하 브랜드)
      const hqTasks = (tasks || []).filter(t => brandIds.has(t.WhatId));
      const hqTaskCount = hqTasks.length;
      const hqLastTaskDate = hqTasks.length > 0
        ? hqTasks.reduce((max, t) => t.ActivityDate > max ? t.ActivityDate : max, hqTasks[0].ActivityDate)
        : null;

      // MOU 전 리드 카운트
      const effectiveHQMouDate = hq.mouContractDate || (hq.mouStart && hq.mouStart !== '-' ? hq.mouStart : null);
      const allHQLeads = (franchiseLeads || []).filter(l => brandIds.has(l.BrandName__c));
      const hqPreMouLeadCount = effectiveHQMouDate
        ? allHQLeads.filter(l => (l.CreatedDate?.substring(0, 10) || '') < effectiveHQMouDate).length
        : 0;

      return {
        ...hq,
        brands: enrichedBrands,
        totalLeads,
        totalConverted,
        conversionRate: totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0,
        thisMonthLeadCount: thisMonthLeads,
        last3MonthLeadCount: last3MonthLeads,
        lastLeadDate,
        dailyActivity,
        meetingCount: hqMeetings.length,
        taskCount: hqTaskCount,
        lastTaskDate: hqLastTaskDate,
        preMouLeadCount: hqPreMouLeadCount,
        isActiveThisMonth: thisMonthLeads > 0,
        isActiveLast3Months: last3MonthLeads > 0
      };
    });
  };

  // franchiseStats를 Id로 매핑
  const franchiseStatsMap = new Map();
  franchiseStats.forEach(f => franchiseStatsMap.set(f.id, f));

  // 파트너사에 활동 정보 추가
  const enrichedPartnerStats = calcPartnerActivity(partnerStats, partnerSourceLeads, franchiseSourceLeads, channelEvents, channelTasks);

  // franchiseHQList에 브랜드별 Lead 정보 + 활동 정보 추가
  const enrichedFranchiseHQList = calcFranchiseHQActivity(franchiseHQList, franchiseSourceLeads, franchiseStatsMap, channelEvents, channelTasks);

  // 활동 중인 파트너사/본사 요약
  const activePartnerThisMonth = enrichedPartnerStats.filter(p => p.isActiveThisMonth);
  const activePartnerLast3Months = enrichedPartnerStats.filter(p => p.isActiveLast3Months);
  const activeHQThisMonth = enrichedFranchiseHQList.filter(hq => hq.isActiveThisMonth);
  const activeHQLast3Months = enrichedFranchiseHQList.filter(hq => hq.isActiveLast3Months);

  // MOU 체결 현황 및 초기 안착률 계산
  const allLeadsForMOU = [...(partnerSourceLeads || []), ...(franchiseSourceLeads || [])];

  const mouPartnerThisMonth = enrichedPartnerStats.filter(p => p.mouStart && p.mouStart !== '-' && p.mouStart.substring(0, 7) === thisMonth);
  const mouPartnerLast3Months = enrichedPartnerStats.filter(p => p.mouStart && p.mouStart !== '-' && p.mouStart.substring(0, 7) >= threeMonthsAgo);

  const mouHQThisMonth = enrichedFranchiseHQList.filter(hq => hq.mouStart && hq.mouStart !== '-' && hq.mouStart.substring(0, 7) === thisMonth);
  const mouHQLast3Months = enrichedFranchiseHQList.filter(hq => hq.mouStart && hq.mouStart !== '-' && hq.mouStart.substring(0, 7) >= threeMonthsAgo);

  // 초기 안착률 계산 함수
  const calcOnboardingRate = (mouList, allLeads, isPartner = true, caseMap = null, referredStoresMap = null, events = null, tasks = null) => {
    if (mouList.length === 0) return { total: 0, settled: 0, rate: 0, list: [] };

    const settledList = mouList.map(item => {
      // 안착 window 시작점: MOU 체결일(MOU_ContractDate__c) 우선, 없으면 mouStart 폴백
      const effectiveMouDate = item.mouContractDate || item.mouStart;
      const mouDate = new Date(effectiveMouDate);
      const mouEndWindow = new Date(mouDate.getFullYear(), mouDate.getMonth() + 3, mouDate.getDate());
      const mouEndWindowStr = mouEndWindow.toISOString().substring(0, 10);

      let hasLeadWithinWindow = false;
      let leadCountWithinWindow = 0;
      let firstLeadDate = null;
      let myLeads = [];

      if (isPartner) {
        myLeads = allLeads.filter(l => getLeadAccountId(l) === item.id);
        const leadsInWindow = myLeads.filter(l => {
          const leadDate = l.CreatedDate?.substring(0, 10);
          return leadDate >= effectiveMouDate && leadDate <= mouEndWindowStr;
        });
        hasLeadWithinWindow = leadsInWindow.length > 0;
        leadCountWithinWindow = leadsInWindow.length;
        if (leadsInWindow.length > 0) {
          firstLeadDate = leadsInWindow.reduce((min, l) => l.CreatedDate < min ? l.CreatedDate : min, leadsInWindow[0].CreatedDate).substring(0, 10);
        }
      } else {
        const brandIds = item.brands.map(b => b.id);
        myLeads = allLeads.filter(l => brandIds.includes(l.BrandName__c));
        const leadsInWindow = myLeads.filter(l => {
          const leadDate = l.CreatedDate?.substring(0, 10);
          return leadDate >= effectiveMouDate && leadDate <= mouEndWindowStr;
        });
        hasLeadWithinWindow = leadsInWindow.length > 0;
        leadCountWithinWindow = leadsInWindow.length;
        if (leadsInWindow.length > 0) {
          firstLeadDate = leadsInWindow.reduce((min, l) => l.CreatedDate < min ? l.CreatedDate : min, leadsInWindow[0].CreatedDate).substring(0, 10);
        }
      }

      // 전체 리드 상세 (MOU 전후 모두 포함) + Case 정보
      const leadDetails = myLeads.slice(0, 20).map(l => {
        const accId = l.ConvertedAccountId;
        const cases = (caseMap && accId) ? (caseMap.get(accId) || []) : [];
        return {
          id: l.Id,
          company: l.Company || l.Name || '-',
          status: l.Status,
          createdDate: l.CreatedDate?.substring(0, 10),
          isConverted: l.IsConverted || false,
          convertedAccountId: accId || null,
          isPreMou: (l.CreatedDate?.substring(0, 10) || '') < effectiveMouDate,
          caseCount: cases.length,
          caseSummary: cases.length > 0 ? cases.slice(0, 5).map(c => ({
            type: c.Type || '-',
            type2: c.Type2__c || '-',
            type3: c.Type3__c || '-',
            status: c.Status,
            createdDate: c.CreatedDate?.substring(0, 10),
            leadtime: c.CaseLeadtime__c
          })) : []
        };
      });

      const totalLeadCount = myLeads.length;
      const preMouLeadCount = myLeads.filter(l => (l.CreatedDate?.substring(0, 10) || '') < effectiveMouDate).length;
      const leadCaseCount = leadDetails.reduce((sum, l) => sum + l.caseCount, 0);

      // AccountPartner__c 기반 소개 매장 (Lead PartnerName__c와 별도)
      const referredStores = (isPartner && referredStoresMap) ? (referredStoresMap.get(item.id) || []) : [];
      const storeDetails = referredStores.slice(0, 10).map(s => {
        const cases = (caseMap) ? (caseMap.get(s.storeId) || []) : [];
        return {
          storeId: s.storeId,
          storeName: s.storeName,
          createdDate: s.createdDate,
          caseCount: cases.length,
          caseSummary: cases.slice(0, 5).map(c => ({
            type: c.Type || '-',
            type2: c.Type2__c || '-',
            type3: c.Type3__c || '-',
            status: c.Status,
            createdDate: c.CreatedDate?.substring(0, 10),
            leadtime: c.CaseLeadtime__c
          }))
        };
      });
      const storeCaseCount = storeDetails.reduce((sum, s) => sum + s.caseCount, 0);
      const totalCaseCount = leadCaseCount + storeCaseCount;

      // Event(미팅) & Task 카운트 (MOU 날짜 무관 — 전체)
      let eventCount = 0, taskCount = 0, lastTaskDate = null;
      const matchIds = isPartner ? [item.id] : (item.brands || []).map(b => b.id).concat(item.hqId ? [item.hqId] : []);
      const matchSet = new Set(matchIds);
      if (events) {
        eventCount = events.filter(e => matchSet.has(e.WhatId)).length;
      }
      if (tasks) {
        const myTasks = tasks.filter(t => matchSet.has(t.WhatId));
        taskCount = myTasks.length;
        if (myTasks.length > 0) {
          lastTaskDate = myTasks.reduce((latest, t) => t.ActivityDate > latest ? t.ActivityDate : latest, myTasks[0].ActivityDate);
        }
      }

      return {
        ...item,
        mouEndWindow: mouEndWindowStr,
        hasLeadWithinWindow,
        leadCountWithinWindow,
        firstLeadDate,
        isSettled: hasLeadWithinWindow,
        totalLeadCount,
        preMouLeadCount,
        totalCaseCount,
        leadDetails,
        referredStoreCount: referredStores.length,
        storeDetails,
        eventCount,
        taskCount,
        lastTaskDate,
      };
    });

    const settledCount = settledList.filter(item => item.isSettled).length;

    return {
      total: mouList.length,
      settled: settledCount,
      rate: mouList.length > 0 ? ((settledCount / mouList.length) * 100).toFixed(1) : 0,
      list: settledList
    };
  };

  const caseMapObj = channelCaseMap || new Map();
  const referredStoresMap = partnerReferredStores || new Map();
  const partnerOnboarding = calcOnboardingRate(mouPartnerLast3Months, allLeadsForMOU, true, caseMapObj, referredStoresMap, channelEvents, channelTasks);
  const hqOnboarding = calcOnboardingRate(mouHQLast3Months, allLeadsForMOU, false, caseMapObj, referredStoresMap, channelEvents, channelTasks);

  // 브랜드 단위 초기 안착률 계산
  const calcBrandOnboarding = (mouHQList, franchiseLeads) => {
    const brandList = [];

    mouHQList.forEach(hq => {
      // 안착 window 시작점: MOU 체결일 우선, 없으면 mouStart 폴백
      const effectiveMouDate = hq.mouContractDate || hq.mouStart;
      const mouDate = new Date(effectiveMouDate);
      const mouEndWindow = new Date(mouDate.getFullYear(), mouDate.getMonth() + 3, mouDate.getDate());
      const mouEndWindowStr = mouEndWindow.toISOString().substring(0, 10);

      hq.brands.forEach(brand => {
        const brandLeads = (franchiseLeads || []).filter(l => l.BrandName__c === brand.id);
        const leadsInWindow = brandLeads.filter(l => {
          const leadDate = l.CreatedDate?.substring(0, 10);
          return leadDate >= effectiveMouDate && leadDate <= mouEndWindowStr;
        });

        const hasLeadWithinWindow = leadsInWindow.length > 0;
        const leadCountWithinWindow = leadsInWindow.length;
        const firstLeadDate = leadsInWindow.length > 0
          ? leadsInWindow.reduce((min, l) => l.CreatedDate < min ? l.CreatedDate : min, leadsInWindow[0].CreatedDate).substring(0, 10)
          : null;

        brandList.push({
          id: brand.id,
          brandName: brand.brandName,
          hqId: hq.hqId,
          hqName: hq.hqName,
          owner: brand.owner || hq.owner,
          mouStart: hq.mouStart,
          mouContractDate: hq.mouContractDate || null,
          mouEndWindow: mouEndWindowStr,
          storeCount: brand.storeCount,
          totalLeadCount: brand.leadCount || 0,
          leadCountWithinWindow,
          firstLeadDate,
          isSettled: hasLeadWithinWindow
        });
      });
    });

    const settledCount = brandList.filter(b => b.isSettled).length;

    return {
      total: brandList.length,
      settled: settledCount,
      rate: brandList.length > 0 ? ((settledCount / brandList.length) * 100).toFixed(1) : 0,
      list: brandList
    };
  };

  const mouBrandThisMonth = calcBrandOnboarding(mouHQThisMonth, franchiseSourceLeads);
  const mouBrandLast3Months = calcBrandOnboarding(mouHQLast3Months, franchiseSourceLeads);

  // KPI 계산
  const kpi = calculateKPI({
    now, thisMonth, threeMonthsAgo,
    partners, franchiseHQAccounts, franchiseBrands,
    partnerSourceLeads, franchiseSourceLeads,
    channelEvents,
    enrichedPartnerStats, enrichedFranchiseHQList,
    mouPartnerThisMonth, mouHQThisMonth,
    partnerOnboarding
  });

  // MOU 체결 현황 요약
  const mouStats = {
    thisMonth,
    threeMonthsAgo,
    partner: {
      thisMonth: mouPartnerThisMonth.length,
      last3Months: mouPartnerLast3Months.length,
      thisMonthList: mouPartnerThisMonth,
      last3MonthsList: mouPartnerLast3Months
    },
    franchiseHQ: {
      thisMonth: mouHQThisMonth.length,
      last3Months: mouHQLast3Months.length,
      thisMonthList: mouHQThisMonth,
      last3MonthsList: mouHQLast3Months
    },
    franchiseBrand: {
      thisMonth: mouBrandThisMonth,
      last3Months: mouBrandLast3Months
    },
    onboarding: {
      partner: partnerOnboarding,
      franchiseHQ: hqOnboarding,
      franchiseBrand: mouBrandLast3Months
    }
  };

  const summary = {
    totalPartners: partners.length,
    totalPartnerStores,
    totalFranchiseHQ,
    totalFranchiseBrands,
    totalFranchiseStores,
    totalAccounts: partners.length + franchiseBrands.length,
    totalReferredStores: totalPartnerStores + totalFranchiseStores,
    totalLeads: leads.length,
    convertedLeads: leads.filter(l => l.IsConverted).length,
    totalOpportunities: opportunities.length,
    wonOpportunities: opportunities.filter(o => o.IsWon).length,
    openOpportunities: opportunities.filter(o => !o.IsClosed).length,
    partnerLeads: partnerLeadStats,
    franchiseLeads: franchiseLeadStats,
    activity: {
      thisMonth,
      threeMonthsAgo,
      activePartnerThisMonth: activePartnerThisMonth.length,
      activePartnerLast3Months: activePartnerLast3Months.length,
      activeHQThisMonth: activeHQThisMonth.length,
      activeHQLast3Months: activeHQLast3Months.length
    },
    channelLeadsByOwner: {
      thisMonth,
      data: channelLeadsByOwnerStats,
      totalPartner: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.partner, 0),
      totalFranchise: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.franchise, 0),
      total: thisMonthChannelLeads.length,
      // MQL (유효 Lead - 오인입/중복/오생성 제외)
      totalMQL: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.mql, 0),
      partnerMQL: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.partnerMQL, 0),
      franchiseMQL: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.franchiseMQL, 0),
      // SQL (전환된 Lead)
      totalSQL: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.sql, 0),
      partnerSQL: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.partnerSQL, 0),
      franchiseSQL: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.franchiseSQL, 0),
      // 제외된 Lead
      totalExcluded: thisMonthExcluded.length,
      // 전환율
      conversionRate: channelLeadsByOwnerStats.reduce((sum, o) => sum + o.mql, 0) > 0
        ? ((channelLeadsByOwnerStats.reduce((sum, o) => sum + o.sql, 0) / channelLeadsByOwnerStats.reduce((sum, o) => sum + o.mql, 0)) * 100).toFixed(1)
        : '0.0',
      // FRT (First Response Time)
      frt: {
        totalMQL: thisMonthMQLLeads.length,
        withTask: leadsWithTask.length,
        withoutTask: leadsWithoutTask.length,
        avgFRT,
        over20: frtOver20.length,
        over20List: frtOver20.slice(0, 10),
        // 담당자별 FRT 상세
        byOwner: frtByOwnerStats,
        // FRT 구간별 (오인입/전환)
        byBucket: frtBucketArray,
        // 시간대별 FRT
        byTimeSlot: frtByTimeSlotStats
      },
      // 담당자별 시간대별 분석
      timeSlotByOwner: timeSlotByOwnerStats,
      timeSlotLabels: TIME_SLOT_LABELS,
      // 오인입 사유 분석
      wrongEntry: wrongEntryStats,
      // MQL → SQL 미전환
      notConverted: {
        total: mqlNotConverted.length,
        byOwner: Object.entries(mqlNotConvertedByOwner)
          .map(([owner, leads]) => ({ owner, count: leads.length, leads: leads.slice(0, 5) }))
          .sort((a, b) => b.count - a.count)
      },
      // SQL 파이프라인
      sqlPipeline,
      // TM 일별 히트맵 (Lead Owner 기준)
      heatmap: {
        days: sortedDays,
        data: leadHeatmap,
        maxValue: heatmapMaxValue
      },
      // AM 일별 히트맵 (Account Owner 기준) - 캘린더 형식
      amHeatmap: {
        data: amLeadHeatmap,
        maxValue: amHeatmapMaxValue,
        calendar: calendarMeta
      }
    },
    mou: mouStats,
    kpi
  };

  // 파이프라인 통계
  const pipeline = calculatePipeline({
    thisMonth, leads, opportunities, partners, franchiseBrands, channelUsers
  });

  // 데이터 필터링 (CL 제외 + 마지막 활동 2024년 이전 제외)
  const clFilter = (item) => includeClosed || item.progress !== 'Closed Lost';
  const activityFilter = (item) => item.lastLeadDate && item.lastLeadDate >= '2025';

  const applyFilters = (item) => clFilter(item) && activityFilter(item);

  const filteredPartnerStats = enrichedPartnerStats.filter(applyFilters);
  const filteredFranchiseStats = franchiseStats.filter(clFilter); // 브랜드는 날짜/활동 필터 미적용 (HQ에서 관리)
  const filteredFranchiseHQList = enrichedFranchiseHQList.filter(applyFilters);

  return {
    summary,
    partnerStats: filteredPartnerStats,
    franchiseStats: filteredFranchiseStats,
    franchiseHQList: filteredFranchiseHQList,
    ownerStats: Object.values(ownerStats).sort((a, b) => b.totalLeads - a.totalLeads),
    activePartnerThisMonth,
    activePartnerLast3Months,
    activeHQThisMonth,
    activeHQLast3Months,
    mouStats,
    kpi,
    pipeline,
    rawData: data
  };
}

// KPI 계산 함수
function calculateKPI(params) {
  const {
    now, thisMonth, threeMonthsAgo,
    partners, franchiseHQAccounts, franchiseBrands,
    partnerSourceLeads, franchiseSourceLeads,
    channelEvents,
    enrichedPartnerStats, enrichedFranchiseHQList,
    mouPartnerThisMonth, mouHQThisMonth,
    partnerOnboarding
  } = params;

  const today = now.toISOString().substring(0, 10);
  const thisMonthDays = now.getDate();
  const workdays = countWorkdays(now.getFullYear(), now.getMonth(), now.getDate());

  // MOU 신규 체결
  const mouNewThisMonth = mouPartnerThisMonth.length + mouHQThisMonth.length;

  // 네고 단계
  const allChannelAccounts = [...partners, ...franchiseHQAccounts, ...franchiseBrands];
  const negoAccounts = allChannelAccounts.filter(a => a.Progress__c === 'Negotiation');
  const negoThisMonth = negoAccounts.filter(a =>
    a.CreatedDate && a.CreatedDate.substring(0, 7) === thisMonth
  );

  // MOU 완료/미완료 분류
  const mouCompletedAccountIds = new Set();
  const mouIncompleteAccountIds = new Set();
  allChannelAccounts.forEach(a => {
    if (a.MOUstartdate__c) {
      mouCompletedAccountIds.add(a.Id);
    } else {
      mouIncompleteAccountIds.add(a.Id);
    }
  });

  // 미팅 계산
  const channelAccountIdSet = new Set(allChannelAccounts.map(a => a.Id));
  const meetingEvents = (channelEvents || []).filter(e => channelAccountIdSet.has(e.WhatId));

  const meetingsMouIncomplete = meetingEvents.filter(e => mouIncompleteAccountIds.has(e.WhatId));
  const meetingsMouIncompleteToday = meetingsMouIncomplete.filter(e => e.ActivityDate === today);
  const meetingsMouIncompleteThisMonth = meetingsMouIncomplete.filter(e =>
    e.ActivityDate && e.ActivityDate.substring(0, 7) === thisMonth
  );

  const meetingsMouComplete = meetingEvents.filter(e => mouCompletedAccountIds.has(e.WhatId));
  const meetingsMouCompleteToday = meetingsMouComplete.filter(e => e.ActivityDate === today);
  const meetingsMouCompleteThisMonth = meetingsMouComplete.filter(e =>
    e.ActivityDate && e.ActivityDate.substring(0, 7) === thisMonth
  );

  // 채널 리드
  const allChannelLeads = [...(partnerSourceLeads || []), ...(franchiseSourceLeads || [])];
  const leadsToday = allChannelLeads.filter(l => l.CreatedDate && l.CreatedDate.substring(0, 10) === today);
  const leadsThisMonth = allChannelLeads.filter(l =>
    l.CreatedDate && l.CreatedDate.substring(0, 7) === thisMonth
  );
  const leadsDailyAvg = workdays > 0 ? (leadsThisMonth.length / workdays).toFixed(1) : 0;

  // 90일 활성 파트너
  const ninetyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90).toISOString().substring(0, 10);

  const activePartners90d = enrichedPartnerStats.filter(p => {
    const myLeads = allChannelLeads.filter(l => getLeadAccountId(l) === p.id);
    return myLeads.some(l => l.CreatedDate && l.CreatedDate.substring(0, 10) >= ninetyDaysAgo);
  });

  const activeHQ90d = enrichedFranchiseHQList.filter(hq => {
    const brandIds = hq.brands.map(b => b.id);
    const hqLeads = (franchiseSourceLeads || []).filter(l => brandIds.includes(l.BrandName__c));
    return hqLeads.some(l => l.CreatedDate && l.CreatedDate.substring(0, 10) >= ninetyDaysAgo);
  });

  const totalActiveChannels90d = activePartners90d.length + activeHQ90d.length;

  // 담당자별 미팅
  const meetingsByOwner = {};
  const thisMonthMeetings = meetingEvents.filter(e => e.ActivityDate && e.ActivityDate.substring(0, 7) === thisMonth);
  thisMonthMeetings.forEach(e => {
    const owner = e.Owner?.Name || '미배정';
    if (!meetingsByOwner[owner]) {
      meetingsByOwner[owner] = { mouComplete: 0, mouIncomplete: 0, total: 0 };
    }
    meetingsByOwner[owner].total++;
    if (mouCompletedAccountIds.has(e.WhatId)) meetingsByOwner[owner].mouComplete++;
    else meetingsByOwner[owner].mouIncomplete++;
  });

  // 미팅 캘린더
  const meetingCalendar = {};
  thisMonthMeetings.forEach(e => {
    const date = e.ActivityDate;
    if (!date) return;
    if (!meetingCalendar[date]) meetingCalendar[date] = [];
    meetingCalendar[date].push({
      id: e.Id,
      subject: e.Subject || '(제목 없음)',
      accountName: e.What?.Name || '-',
      accountId: e.WhatId,
      owner: e.Owner?.Name || '미배정',
      startTime: e.StartDateTime ? e.StartDateTime.substring(11, 16) : '-',
      type: e.Type || '-',
      isMouComplete: mouCompletedAccountIds.has(e.WhatId),
      isCompleted: date < today
    });
  });

  const calYear = now.getFullYear();
  const calMonth = now.getMonth();
  const firstDayOfMonth = new Date(calYear, calMonth, 1);
  const lastDayOfMonth = new Date(calYear, calMonth + 1, 0);
  const calendarMeta = {
    year: calYear,
    month: calMonth + 1,
    monthLabel: `${calYear}년 ${calMonth + 1}월`,
    firstDay: firstDayOfMonth.getDay(),
    totalDays: lastDayOfMonth.getDate(),
    today: now.getDate()
  };

  return {
    date: today,
    thisMonth,
    thisMonthDays,
    workdays,
    bd: {
      mouNewThisMonth: { value: mouNewThisMonth, target: 4, label: '신규 MOU 체결 수 (월)' },
      negoEntryThisMonth: { value: negoThisMonth.length, total: negoAccounts.length, target: 10, label: 'MOU 네고 단계 진입 (월)' },
      meetingsIncompleteToday: { value: meetingsMouIncompleteToday.length, target: 2, label: 'MOU 미완료 곳 미팅 (오늘)' },
      meetingsIncompleteAvg: { value: workdays > 0 ? (meetingsMouIncompleteThisMonth.length / workdays).toFixed(1) : 0, target: 2, label: 'MOU 미완료 곳 미팅 (일평균)' },
      meetingsIncompleteThisMonth: { value: meetingsMouIncompleteThisMonth.length, label: 'MOU 미완료 곳 미팅 (이번달 합계)' }
    },
    am: {
      leadsToday: { value: leadsToday.length, target: '20~25', label: '채널 리드 확보 (오늘)' },
      leadsDailyAvg: { value: parseFloat(leadsDailyAvg), target: '20~25', label: '채널 리드 확보 (일평균)' },
      leadsThisMonth: { value: leadsThisMonth.length, label: '채널 리드 확보 (이번달 합계)' },
      meetingsCompleteToday: { value: meetingsMouCompleteToday.length, target: 2, label: 'MOU 완료 곳 미팅 (오늘)' },
      meetingsCompleteAvg: { value: workdays > 0 ? (meetingsMouCompleteThisMonth.length / workdays).toFixed(1) : 0, target: 2, label: 'MOU 완료 곳 미팅 (일평균)' },
      meetingsCompleteThisMonth: { value: meetingsMouCompleteThisMonth.length, label: 'MOU 완료 곳 미팅 (이번달 합계)' },
      onboardingRate: { value: parseFloat(partnerOnboarding.rate) || 0, settled: partnerOnboarding.settled, total: partnerOnboarding.total, target: 80, label: '신규 파트너 초기 안착률 (%)' },
      activeChannels90d: { value: totalActiveChannels90d, partners: activePartners90d.length, hq: activeHQ90d.length, target: 70, label: '기존 파트너 활성 유지 (90일)' }
    },
    meetingsByOwner: Object.entries(meetingsByOwner)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.total - a.total),
    meetingCalendar,
    calendarMeta
  };
}

// 파이프라인 통계 계산
function calculatePipeline(params) {
  const { thisMonth, leads, opportunities, partners, franchiseBrands, channelUsers } = params;

  const thisMonthLeadsAll = leads.filter(l => l.CreatedDate?.substring(0, 7) === thisMonth);
  const thisMonthLeadsConverted = thisMonthLeadsAll.filter(l => l.IsConverted);

  const partnerLeadsThisMonth = thisMonthLeadsAll.filter(l => {
    const partnerId = l.Partner__c || l.PartnerName__c;
    return partnerId && partners.some(p => p.Id === partnerId);
  });
  const franchiseLeadsThisMonth = thisMonthLeadsAll.filter(l => {
    const partnerId = l.Partner__c || l.PartnerName__c;
    return partnerId && franchiseBrands.some(f => f.Id === partnerId);
  });

  const conversionStats = {
    total: {
      leads: thisMonthLeadsAll.length,
      converted: thisMonthLeadsConverted.length,
      rate: thisMonthLeadsAll.length > 0
        ? ((thisMonthLeadsConverted.length / thisMonthLeadsAll.length) * 100).toFixed(1) : '0.0'
    },
    partner: {
      leads: partnerLeadsThisMonth.length,
      converted: partnerLeadsThisMonth.filter(l => l.IsConverted).length,
      rate: partnerLeadsThisMonth.length > 0
        ? ((partnerLeadsThisMonth.filter(l => l.IsConverted).length / partnerLeadsThisMonth.length) * 100).toFixed(1) : '0.0'
    },
    franchise: {
      leads: franchiseLeadsThisMonth.length,
      converted: franchiseLeadsThisMonth.filter(l => l.IsConverted).length,
      rate: franchiseLeadsThisMonth.length > 0
        ? ((franchiseLeadsThisMonth.filter(l => l.IsConverted).length / franchiseLeadsThisMonth.length) * 100).toFixed(1) : '0.0'
    }
  };

  const openOpps = opportunities.filter(o => !o.IsClosed);
  const stageDistribution = {};
  openOpps.forEach(o => {
    const stage = o.StageName || '(미지정)';
    if (!stageDistribution[stage]) {
      stageDistribution[stage] = { count: 0, amount: 0 };
    }
    stageDistribution[stage].count++;
    stageDistribution[stage].amount += (o.Amount || 0);
  });

  const thisMonthCW = opportunities.filter(o => o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth);
  const thisMonthCL = opportunities.filter(o => o.IsClosed && !o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth);
  const thisMonthClosed = [...thisMonthCW, ...thisMonthCL];
  const winRate = thisMonthClosed.length > 0
    ? ((thisMonthCW.length / thisMonthClosed.length) * 100).toFixed(1) : '0.0';

  const oppStageStats = {
    openTotal: openOpps.length,
    stageDistribution: Object.entries(stageDistribution)
      .map(([stage, data]) => ({ stage, ...data }))
      .sort((a, b) => b.count - a.count),
    thisMonthCW: thisMonthCW.length,
    thisMonthCL: thisMonthCL.length,
    winRate
  };

  const ownerPipeline = {};
  (channelUsers || []).forEach(u => {
    ownerPipeline[u.Id] = {
      name: u.Name,
      leadsThisMonth: 0,
      leadsConverted: 0,
      openOpps: 0,
      cwThisMonth: 0,
      clThisMonth: 0,
      byStage: {},
      openAmount: 0,
      cwAmount: 0
    };
  });

  thisMonthLeadsAll.forEach(l => {
    const ownerId = l.OwnerId;
    if (ownerPipeline[ownerId]) {
      ownerPipeline[ownerId].leadsThisMonth++;
      if (l.IsConverted) ownerPipeline[ownerId].leadsConverted++;
    }
  });

  opportunities.forEach(o => {
    const ownerId = o.OwnerId;
    if (!ownerPipeline[ownerId]) return;

    if (!o.IsClosed) {
      ownerPipeline[ownerId].openOpps++;
      ownerPipeline[ownerId].openAmount += (o.Amount || 0);
      const stage = o.StageName || '(미지정)';
      ownerPipeline[ownerId].byStage[stage] = (ownerPipeline[ownerId].byStage[stage] || 0) + 1;
    }
    if (o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth) {
      ownerPipeline[ownerId].cwThisMonth++;
      ownerPipeline[ownerId].cwAmount += (o.Amount || 0);
    }
    if (o.IsClosed && !o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth) {
      ownerPipeline[ownerId].clThisMonth++;
    }
  });

  const ownerPipelineStats = Object.values(ownerPipeline)
    .sort((a, b) => (b.cwThisMonth + b.openOpps) - (a.cwThisMonth + a.openOpps));

  return {
    conversionStats,
    oppStageStats,
    ownerPipelineStats
  };
}

module.exports = {
  calculateStats
};
