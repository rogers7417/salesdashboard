require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// ============================================
// Salesforce 연결
// ============================================
async function getSalesforceToken() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function soqlQuery(instanceUrl, accessToken, query) {
  const url = `${instanceUrl}/services/data/v59.0/query`;
  const res = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    params: { q: query }
  });
  return res.data;
}

// 대량 쿼리용 (nextRecordsUrl 처리)
async function soqlQueryAll(instanceUrl, accessToken, query) {
  let allRecords = [];
  let result = await soqlQuery(instanceUrl, accessToken, query);
  allRecords.push(...(result.records || []));

  while (result.nextRecordsUrl) {
    const nextUrl = `${instanceUrl}${result.nextRecordsUrl}`;
    const res = await axios.get(nextUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    result = res.data;
    allRecords.push(...(result.records || []));
  }

  return allRecords;
}

// Contracts API 호출 (계약 시작일 기준)
async function fetchContracts(month, ownerDept = '채널세일즈팀') {
  try {
    const url = `http://localhost:4000/contracts?month=${month}&ownerDept=${encodeURIComponent(ownerDept)}`;
    const res = await axios.get(url);
    return res.data || [];
  } catch (err) {
    console.log('⚠️ Contracts API 호출 실패:', err.message);
    return [];
  }
}

// ============================================
// 데이터 수집
// ============================================
async function collectChannelData(targetMonth = null) {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공');

  // targetMonth 기준으로 조회 기간 계산 (90일 = 약 3개월)
  let activityEndDate, activityStartDate;
  if (targetMonth) {
    const [year, month] = targetMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    activityEndDate = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
    // 3개월 전
    const startDate = new Date(year, month - 4, 1);
    activityStartDate = startDate.toISOString().substring(0, 10);
  } else {
    const now = new Date();
    activityEndDate = now.toISOString().substring(0, 10);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
    activityStartDate = startDate.toISOString().substring(0, 10);
  }

  // 1. 파트너사 Account 조회 (소개매장 AccountPartners__r 포함)
  const partnerQuery = `
    SELECT
      Id, Name, Phone, OwnerId, Owner.Name, IsPartner,
      fm_AccountType__c, Progress__c, RecordTypeId,
      MOUstartdate__c, MOUenddate__c,
      CreatedDate, LastModifiedDate,
      (SELECT Id, Name, AccountPartner__c, AccountPartner__r.Name, AccountPartner__r.Id FROM AccountPartners__r)
    FROM Account
    WHERE fm_AccountType__c = '파트너사'
    ORDER BY Name
  `;
  const partners = await soqlQueryAll(instanceUrl, accessToken, partnerQuery);
  console.log(`📦 파트너사: ${partners.length}건`);

  // 소개매장 총 개수 계산
  const totalReferredStores = partners.reduce((sum, p) => {
    const stores = p.AccountPartners__r?.records || [];
    return sum + stores.length;
  }, 0);
  console.log(`🏪 소개매장 (파트너사): ${totalReferredStores}건`);

  // 2. 프랜차이즈 본사 Account 조회 (fm_AccountType__c = '프랜차이즈본사')
  const hqQuery = `
    SELECT
      Id, Name, Phone, OwnerId, Owner.Name, IsPartner,
      fm_AccountType__c, Progress__c, RecordTypeId,
      MOUstartdate__c, MOUenddate__c,
      CreatedDate, LastModifiedDate
    FROM Account
    WHERE fm_AccountType__c = '프랜차이즈본사'
    ORDER BY Name
  `;
  const franchiseHQAccounts = await soqlQueryAll(instanceUrl, accessToken, hqQuery);
  console.log(`🏢 프랜차이즈 본사: ${franchiseHQAccounts.length}건`);

  // 3. 프랜차이즈 브랜드 Account 조회 (fm_AccountType__c = '브랜드', FRHQ__c가 본사 ID)
  const brandQuery = `
    SELECT
      Id, Name, Phone, OwnerId, Owner.Name, IsPartner,
      fm_AccountType__c, Progress__c, RecordTypeId,
      MOUstartdate__c, MOUenddate__c,
      FRHQ__c, FRHQ__r.Name,
      CreatedDate, LastModifiedDate
    FROM Account
    WHERE fm_AccountType__c = '브랜드'
    ORDER BY FRHQ__c, Name
  `;
  const franchiseBrands = await soqlQueryAll(instanceUrl, accessToken, brandQuery);
  console.log(`🏷️ 프랜차이즈 브랜드: ${franchiseBrands.length}건`);

  // 4. 가맹점 조회 (FRBrand__c가 브랜드 ID를 가리킴)
  const brandIds = franchiseBrands.map(b => b.Id);
  let franchiseStores = [];
  if (brandIds.length > 0) {
    // 브랜드 ID를 FRBrand__c로 가지는 Account들이 가맹점
    const storeQuery = `
      SELECT
        Id, Name, FRBrand__c,
        OwnerId, Owner.Name, Phone,
        fm_AccountType__c,
        CreatedDate
      FROM Account
      WHERE FRBrand__c != null
      ORDER BY FRBrand__c, Name
    `;
    franchiseStores = await soqlQueryAll(instanceUrl, accessToken, storeQuery);
    console.log(`🏪 프랜차이즈 가맹점: ${franchiseStores.length}건`);
  }

  // 브랜드별 가맹점 그룹핑 (FRBrand__c로 연결)
  const storesByBrand = new Map();
  brandIds.forEach(id => storesByBrand.set(id, []));
  franchiseStores.forEach(store => {
    const brandId = store.FRBrand__c;
    if (storesByBrand.has(brandId)) {
      storesByBrand.get(brandId).push(store);
    }
  });

  // 본사별 브랜드 그룹핑 (브랜드의 FRHQ__c가 본사 ID를 가리킴)
  const franchiseHQMap = new Map(); // 본사 ID -> { hqId, hqName, brands: [...], totalStores: 0 }

  // 본사 정보 초기화
  franchiseHQAccounts.forEach(hq => {
    franchiseHQMap.set(hq.Id, {
      hqId: hq.Id,
      hqName: hq.Name,
      owner: hq.Owner?.Name || '미배정',
      progress: hq.Progress__c || '-',
      mouStart: hq.MOUstartdate__c || '-',
      mouEnd: hq.MOUenddate__c || '-',
      brands: [],
      totalStores: 0
    });
  });

  // FRHQ__c가 없는 브랜드용 "미지정 본사" 추가
  franchiseHQMap.set('__NO_HQ__', {
    hqId: null,
    hqName: '(본사 미지정)',
    owner: '-',
    progress: '-',
    mouStart: '-',
    mouEnd: '-',
    brands: [],
    totalStores: 0
  });

  // 브랜드를 본사별로 그룹핑
  franchiseBrands.forEach(brand => {
    const hqId = brand.FRHQ__c || '__NO_HQ__';
    const storeCount = (storesByBrand.get(brand.Id) || []).length;

    if (!franchiseHQMap.has(hqId)) {
      // FRHQ__c가 있지만 본사 조회 결과에 없는 경우 (데이터 정합성 이슈)
      franchiseHQMap.set(hqId, {
        hqId: hqId,
        hqName: brand.FRHQ__r?.Name || `(본사ID: ${hqId})`,
        owner: '-',
        progress: '-',
        mouStart: '-',
        mouEnd: '-',
        brands: [],
        totalStores: 0
      });
    }

    const hqData = franchiseHQMap.get(hqId);
    hqData.brands.push({
      id: brand.Id,
      brandName: brand.Name,
      storeCount,
      owner: brand.Owner?.Name || '미배정'
    });
    hqData.totalStores += storeCount;
  });

  // 본사 목록 (배열로 변환, 가맹점 수 기준 정렬)
  const franchiseHQList = Array.from(franchiseHQMap.values())
    .filter(hq => hq.brands.length > 0)
    .sort((a, b) => b.totalStores - a.totalStores);

  // 3. 파트너/프랜차이즈 관련 Lead 조회
  // Partner__c 필드 존재 여부 확인 후 쿼리
  let leads = [];
  try {
    const leadQueryWithPartner = `
      SELECT
        Id, Name, LastName, Company, Status,
        Partner__c, Partner__r.Name, PartnerName__c,
        LeadSource, CreatedDate, OwnerId, Owner.Name,
        ConvertedOpportunityId, ConvertedAccountId, IsConverted, ConvertedDate
      FROM Lead
      WHERE Partner__c != null OR PartnerName__c != null
      ORDER BY CreatedDate DESC
    `;
    leads = await soqlQueryAll(instanceUrl, accessToken, leadQueryWithPartner);
    console.log(`📋 채널 관련 Lead (Partner__c 사용): ${leads.length}건`);
  } catch (err) {
    // Partner__c 필드가 없으면 PartnerName__c만 사용
    console.log('⚠️ Partner__c 필드 없음, PartnerName__c로 조회');
    const leadQueryFallback = `
      SELECT
        Id, Name, LastName, Company, Status,
        PartnerName__c,
        LeadSource, CreatedDate, OwnerId, Owner.Name,
        ConvertedOpportunityId, ConvertedAccountId, IsConverted, ConvertedDate
      FROM Lead
      WHERE PartnerName__c != null
      ORDER BY CreatedDate DESC
    `;
    leads = await soqlQueryAll(instanceUrl, accessToken, leadQueryFallback);
    console.log(`📋 채널 관련 Lead (PartnerName__c): ${leads.length}건`);
  }

  // 5. LeadSource 기반 채널 Lead 조회 (파트너사 소개, 프랜차이즈소개)
  const channelLeadQuery = `
    SELECT
      Id, Name, LastName, Company, Status,
      PartnerName__c, BrandName__c,
      LeadSource, CreatedDate, OwnerId, Owner.Name,
      ConvertedOpportunityId, ConvertedAccountId, IsConverted, ConvertedDate
    FROM Lead
    WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
    ORDER BY LeadSource, CreatedDate DESC
  `;
  const channelLeads = await soqlQueryAll(instanceUrl, accessToken, channelLeadQuery);

  // 파트너사 소개 / 프랜차이즈소개 분리
  const partnerSourceLeads = channelLeads.filter(l => l.LeadSource === '파트너사 소개');
  const franchiseSourceLeads = channelLeads.filter(l => l.LeadSource === '프랜차이즈소개');
  console.log(`📋 LeadSource 기반 - 파트너사 소개: ${partnerSourceLeads.length}건, 프랜차이즈소개: ${franchiseSourceLeads.length}건`);

  // 4. 채널세일즈팀 User 조회
  const channelUserQuery = `SELECT Id, Name FROM User WHERE Department = '채널세일즈팀' AND IsActive = true`;
  const channelUsersResult = await soqlQuery(instanceUrl, accessToken, channelUserQuery);
  const channelUsers = channelUsersResult.records || [];
  const channelUserMap = {};
  channelUsers.forEach(u => { channelUserMap[u.Id] = u.Name; });
  console.log(`👥 채널세일즈팀 인원: ${channelUsers.length}명`);

  // 5. 채널세일즈팀 Owner 기준 Opportunity 조회
  let opportunities = [];

  if (channelUsers.length > 0) {
    const channelUserIds = channelUsers.map(u => "'" + u.Id + "'").join(',');
    const oppQuery = `
      SELECT
        Id, Name, StageName, Amount, CloseDate,
        AccountId, Account.Name, Account.fm_AccountType__c,
        OwnerId, Owner.Name, CreatedDate,
        LeadSource, IsClosed, IsWon, Loss_Reason__c,
        fm_AccountPartner__c, fm_AccountFRName__c
      FROM Opportunity
      WHERE OwnerId IN (${channelUserIds})
      ORDER BY CreatedDate DESC
    `;
    opportunities = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
    console.log(`💼 채널세일즈팀 Opportunity: ${opportunities.length}건`);
  }

  // 6. 채널 Account 관련 Event (미팅) 조회 - targetMonth 기준
  const eventQuery = `
    SELECT
      Id, Subject, Description, WhatId, What.Name,
      OwnerId, Owner.Name,
      ActivityDate, StartDateTime, EndDateTime,
      Type, CreatedDate
    FROM Event
    WHERE What.Type = 'Account'
      AND ActivityDate >= ${activityStartDate}
      AND ActivityDate <= ${activityEndDate}
    ORDER BY ActivityDate DESC
  `;
  const allEvents = await soqlQueryAll(instanceUrl, accessToken, eventQuery);

  // 채널 Account ID Set 생성
  const allAccountIds = [...partners, ...franchiseBrands, ...franchiseHQAccounts].map(a => a.Id);
  const channelAccountIds = new Set(allAccountIds);
  const channelEvents = allEvents.filter(e => channelAccountIds.has(e.WhatId));
  console.log(`📅 채널 관련 Event (미팅): ${channelEvents.length}건 (전체 ${allEvents.length}건 중, ${activityStartDate} ~ ${activityEndDate})`);

  // 7. 채널 Account 관련 Task 조회 - targetMonth 기준
  const taskQuery = `
    SELECT
      Id, Subject, WhatId, What.Name,
      OwnerId, Owner.Name,
      ActivityDate, Status, Type, CreatedDate
    FROM Task
    WHERE What.Type = 'Account'
      AND ActivityDate >= ${activityStartDate}
      AND ActivityDate <= ${activityEndDate}
    ORDER BY ActivityDate DESC
  `;
  const allTasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
  const channelTasks = allTasks.filter(t => channelAccountIds.has(t.WhatId));
  console.log(`📝 채널 관련 Task: ${channelTasks.length}건 (전체 ${allTasks.length}건 중, ${activityStartDate} ~ ${activityEndDate})`);

  // 8. 미래 예정된 Task 조회 (정체 Opp 제외용)
  const todayStr = new Date().toISOString().substring(0, 10);
  // Account에 연결된 Task
  const futureTaskAccountQuery = `
    SELECT Id, WhatId, ActivityDate, Status
    FROM Task
    WHERE What.Type = 'Account'
      AND ActivityDate > ${todayStr}
      AND Status != 'Completed'
  `;
  // Opportunity에 연결된 Task
  const futureTaskOppQuery = `
    SELECT Id, WhatId, What.Name, ActivityDate, Status
    FROM Task
    WHERE What.Type = 'Opportunity'
      AND ActivityDate > ${todayStr}
      AND Status != 'Completed'
  `;
  const [allFutureTasksAccount, allFutureTasksOpp] = await Promise.all([
    soqlQueryAll(instanceUrl, accessToken, futureTaskAccountQuery),
    soqlQueryAll(instanceUrl, accessToken, futureTaskOppQuery)
  ]);

  // Account에 직접 연결된 Task의 AccountId
  const futureTaskAccountIds = new Set(allFutureTasksAccount.filter(t => channelAccountIds.has(t.WhatId)).map(t => t.WhatId));
  // Opportunity에 연결된 Task의 OpportunityId
  const futureTaskOppIds = new Set(allFutureTasksOpp.map(t => t.WhatId));
  console.log(`📅 예정된 Task: Account 연결 ${futureTaskAccountIds.size}개, Opportunity 연결 ${futureTaskOppIds.size}개`);

  return {
    partners, franchiseBrands, franchiseStores, storesByBrand, franchiseHQList, franchiseHQAccounts,
    leads, opportunities,
    partnerSourceLeads, franchiseSourceLeads,
    channelEvents, channelTasks,
    channelUsers, channelUserMap,
    futureTaskAccountIds, futureTaskOppIds
  };
}

// ============================================
// 통계 계산
// ============================================
function calculateStats(data, targetMonth = null) {
  const { partners, franchiseBrands, franchiseStores, storesByBrand, franchiseHQList, franchiseHQAccounts, leads, opportunities, partnerSourceLeads, franchiseSourceLeads, channelEvents, channelTasks, channelUsers, channelUserMap, contracts, futureTaskAccountIds, futureTaskOppIds } = data;

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

  // Lead를 Account별로 그룹핑 (PartnerName__c가 Account Id를 저장함)
  const leadsByAccount = new Map();

  leads.forEach(l => {
    // PartnerName__c에 Account Id가 저장되어 있음
    const accountId = l.PartnerName__c;

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
    const accountId = l.PartnerName__c;
    if (accountId) {
      if (!partnerSourceLeadsByAccount.has(accountId)) {
        partnerSourceLeadsByAccount.set(accountId, []);
      }
      partnerSourceLeadsByAccount.get(accountId).push(l);
    }
  });

  (franchiseSourceLeads || []).forEach(l => {
    const accountId = l.PartnerName__c;
    if (accountId) {
      if (!franchiseSourceLeadsByAccount.has(accountId)) {
        franchiseSourceLeadsByAccount.set(accountId, []);
      }
      franchiseSourceLeadsByAccount.get(accountId).push(l);
    }
  });

  // 프랜차이즈소개 Lead를 BrandName__c (브랜드 Account Id)로 그룹핑
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
    // LeadSource 기반 Lead (파트너사 소개)
    const partnerLeads = partnerSourceLeadsByAccount.get(p.Id) || [];
    // LeadSource 기반 Lead (프랜차이즈소개) - 파트너사를 통한 프랜차이즈 소개
    const franchiseLeads = franchiseSourceLeadsByAccount.get(p.Id) || [];
    // 합산
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
      isPartner: p.IsPartner,
      createdDate: p.CreatedDate,
      // 소개매장 통계
      referredStoreCount: referredStores.length,
      referredStores: referredStores.map(s => ({
        id: s.Id,
        name: s.Name,
        accountPartnerId: s.AccountPartner__c,
        accountPartnerName: s.AccountPartner__r?.Name || null
      })),
      // Lead 통계 (PartnerName__c 연결)
      leadCount: accountLeads.length,
      leadConverted: accountLeads.filter(l => l.IsConverted).length,
      leadOpen: accountLeads.filter(l => !l.IsConverted && l.Status !== 'Closed').length,
      // LeadSource 기반 Lead (파트너사 소개)
      partnerLeadCount: partnerLeads.length,
      partnerLeadConverted: partnerLeads.filter(l => l.IsConverted).length,
      partnerLeadOpen: partnerLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      partnerLeadConversionRate: partnerLeads.length > 0 ? ((partnerLeads.filter(l => l.IsConverted).length / partnerLeads.length) * 100).toFixed(1) : 0,
      // LeadSource 기반 Lead (프랜차이즈소개)
      franchiseLeadCount: franchiseLeads.length,
      franchiseLeadConverted: franchiseLeads.filter(l => l.IsConverted).length,
      franchiseLeadOpen: franchiseLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      franchiseLeadConversionRate: franchiseLeads.length > 0 ? ((franchiseLeads.filter(l => l.IsConverted).length / franchiseLeads.length) * 100).toFixed(1) : 0,
      // 합산 (총 채널 Lead)
      sourceLeadCount: totalSourceLeads.length,
      sourceLeadConverted: totalSourceLeads.filter(l => l.IsConverted).length,
      sourceLeadOpen: totalSourceLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      sourceLeadConversionRate: totalSourceLeads.length > 0 ? ((totalSourceLeads.filter(l => l.IsConverted).length / totalSourceLeads.length) * 100).toFixed(1) : 0,
      // Opportunity 통계
      oppCount: accountOpps.length,
      oppWon: accountOpps.filter(o => o.IsWon).length,
      oppLost: accountOpps.filter(o => o.IsClosed && !o.IsWon).length,
      oppOpen: accountOpps.filter(o => !o.IsClosed).length,
      // 상세 데이터
      leads: accountLeads,
      opportunities: accountOpps
    };
  });

  // 프랜차이즈 브랜드 상세
  const franchiseStats = franchiseBrands.map(f => {
    const accountLeads = leadsByAccount.get(f.Id) || [];
    const accountOpps = oppsByAccount.get(f.Id) || [];
    // 프랜차이즈 가맹점 (FRHQ__c로 연결)
    const franchiseStoreList = storesByBrand?.get(f.Id) || [];
    // BrandName__c 기반 Lead (프랜차이즈소개)
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
      // 가맹점 통계
      referredStoreCount: franchiseStoreList.length,
      referredStores: franchiseStoreList.map(s => ({
        id: s.Id,
        name: s.Name,
        ownerId: s.OwnerId,
        ownerName: s.Owner?.Name || null
      })),
      // Lead 통계
      leadCount: accountLeads.length,
      leadConverted: accountLeads.filter(l => l.IsConverted).length,
      leadOpen: accountLeads.filter(l => !l.IsConverted && l.Status !== 'Closed').length,
      // BrandName__c 기반 Lead (프랜차이즈소개)
      sourceLeadCount: brandLeads.length,
      sourceLeadConverted: brandLeads.filter(l => l.IsConverted).length,
      sourceLeadOpen: brandLeads.filter(l => !l.IsConverted && !['Closed', 'Unqualified', 'Disqualified'].includes(l.Status)).length,
      sourceLeadConversionRate: brandLeads.length > 0 ? ((brandLeads.filter(l => l.IsConverted).length / brandLeads.length) * 100).toFixed(1) : 0,
      // Opportunity 통계
      oppCount: accountOpps.length,
      oppWon: accountOpps.filter(o => o.IsWon).length,
      oppLost: accountOpps.filter(o => o.IsClosed && !o.IsWon).length,
      oppOpen: accountOpps.filter(o => !o.IsClosed).length,
      // 상세 데이터
      leads: accountLeads,
      opportunities: accountOpps
    };
  });

  // 담당자별 요약 (지정 월 또는 이번 달 Lead 기준)
  const now = new Date();
  const thisMonth = targetMonth || now.toISOString().substring(0, 7); // 'YYYY-MM'
  const [targetYear, targetMonthNum] = thisMonth.split('-').map(Number);
  const threeMonthsAgo = new Date(targetYear, targetMonthNum - 3, 1).toISOString().substring(0, 7);
  const isThisMonth = (lead) => lead.CreatedDate?.substring(0, 7) === thisMonth;

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

    // 담당자별 그룹핑
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

    // Status별 분포
    const byStatus = {};
    leadList.forEach(l => {
      const status = l.Status || '(없음)';
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    // 월별 추이 (최근 12개월)
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

  // 활동 중인 파트너사/프랜차이즈 계산 (Lead 생성일 기준)
  // now, thisMonth, threeMonthsAgo는 513행에서 정의됨

  // 파트너사별 최근 활동 계산
  const calcPartnerActivity = (partnerList, partnerLeads, franchiseLeads) => {
    const allLeads = [...(partnerLeads || []), ...(franchiseLeads || [])];

    return partnerList.map(p => {
      const myLeads = allLeads.filter(l => l.PartnerName__c === p.id);
      const thisMonthLeads = myLeads.filter(l => l.CreatedDate?.substring(0, 7) === thisMonth);
      const last3MonthLeads = myLeads.filter(l => l.CreatedDate?.substring(0, 7) >= threeMonthsAgo);
      const lastLeadDate = myLeads.length > 0
        ? myLeads.reduce((max, l) => l.CreatedDate > max ? l.CreatedDate : max, '').substring(0, 10)
        : null;

      return {
        ...p,
        thisMonthLeadCount: thisMonthLeads.length,
        last3MonthLeadCount: last3MonthLeads.length,
        lastLeadDate,
        isActiveThisMonth: thisMonthLeads.length > 0,
        isActiveLast3Months: last3MonthLeads.length > 0
      };
    });
  };

  // 프랜차이즈 본사별 최근 활동 계산 (BrandName__c 기준)
  const calcFranchiseHQActivity = (hqList, franchiseLeads, franchiseStatsMap) => {
    return hqList.map(hq => {
      // 본사 하위 브랜드들의 Lead 합산
      let thisMonthLeads = 0;
      let last3MonthLeads = 0;
      let lastLeadDate = null;

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

      return {
        ...hq,
        brands: enrichedBrands,
        totalLeads,
        totalConverted,
        conversionRate: totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0,
        thisMonthLeadCount: thisMonthLeads,
        last3MonthLeadCount: last3MonthLeads,
        lastLeadDate,
        isActiveThisMonth: thisMonthLeads > 0,
        isActiveLast3Months: last3MonthLeads > 0
      };
    });
  };

  // franchiseStats를 Id로 매핑
  const franchiseStatsMap = new Map();
  franchiseStats.forEach(f => franchiseStatsMap.set(f.id, f));

  // 파트너사에 활동 정보 추가
  const enrichedPartnerStats = calcPartnerActivity(partnerStats, partnerSourceLeads, franchiseSourceLeads);

  // franchiseHQList에 브랜드별 Lead 정보 + 활동 정보 추가
  const enrichedFranchiseHQList = calcFranchiseHQActivity(franchiseHQList, franchiseSourceLeads, franchiseStatsMap);

  // 활동 중인 파트너사/본사 요약
  const activePartnerThisMonth = enrichedPartnerStats.filter(p => p.isActiveThisMonth);
  const activePartnerLast3Months = enrichedPartnerStats.filter(p => p.isActiveLast3Months);
  const activeHQThisMonth = enrichedFranchiseHQList.filter(hq => hq.isActiveThisMonth);
  const activeHQLast3Months = enrichedFranchiseHQList.filter(hq => hq.isActiveLast3Months);

  // ============================================
  // MOU 체결 현황 및 초기 안착률 계산
  // ============================================
  const allLeadsForMOU = [...(partnerSourceLeads || []), ...(franchiseSourceLeads || [])];

  // MOU 체결 파트너사 (이번달, 최근 3개월)
  const mouPartnerThisMonth = enrichedPartnerStats.filter(p => p.mouStart && p.mouStart !== '-' && p.mouStart.substring(0, 7) === thisMonth);
  const mouPartnerLast3Months = enrichedPartnerStats.filter(p => p.mouStart && p.mouStart !== '-' && p.mouStart.substring(0, 7) >= threeMonthsAgo);

  // MOU 체결 프랜차이즈 본사 (이번달, 최근 3개월)
  const mouHQThisMonth = enrichedFranchiseHQList.filter(hq => hq.mouStart && hq.mouStart !== '-' && hq.mouStart.substring(0, 7) === thisMonth);
  const mouHQLast3Months = enrichedFranchiseHQList.filter(hq => hq.mouStart && hq.mouStart !== '-' && hq.mouStart.substring(0, 7) >= threeMonthsAgo);

  // 초기 안착률 계산 함수
  // MOU 체결 후 3개월 이내에 Lead를 생산했는지 확인
  const calcOnboardingRate = (mouList, allLeads, isPartner = true) => {
    if (mouList.length === 0) return { total: 0, settled: 0, rate: 0, list: [] };

    const settledList = mouList.map(item => {
      const mouDate = new Date(item.mouStart);
      const mouEndWindow = new Date(mouDate.getFullYear(), mouDate.getMonth() + 3, mouDate.getDate());
      const mouEndWindowStr = mouEndWindow.toISOString().substring(0, 10);

      // MOU 체결일 이후 ~ 3개월 이내 Lead 확인
      let hasLeadWithinWindow = false;
      let leadCountWithinWindow = 0;
      let firstLeadDate = null;

      if (isPartner) {
        // 파트너사: PartnerName__c로 매칭
        const myLeads = allLeads.filter(l => l.PartnerName__c === item.id);
        const leadsInWindow = myLeads.filter(l => {
          const leadDate = l.CreatedDate?.substring(0, 10);
          return leadDate >= item.mouStart && leadDate <= mouEndWindowStr;
        });
        hasLeadWithinWindow = leadsInWindow.length > 0;
        leadCountWithinWindow = leadsInWindow.length;
        if (leadsInWindow.length > 0) {
          firstLeadDate = leadsInWindow.reduce((min, l) => l.CreatedDate < min ? l.CreatedDate : min, leadsInWindow[0].CreatedDate).substring(0, 10);
        }
      } else {
        // 프랜차이즈 본사: 하위 브랜드의 BrandName__c로 매칭
        const brandIds = item.brands.map(b => b.id);
        const myLeads = allLeads.filter(l => brandIds.includes(l.BrandName__c));
        const leadsInWindow = myLeads.filter(l => {
          const leadDate = l.CreatedDate?.substring(0, 10);
          return leadDate >= item.mouStart && leadDate <= mouEndWindowStr;
        });
        hasLeadWithinWindow = leadsInWindow.length > 0;
        leadCountWithinWindow = leadsInWindow.length;
        if (leadsInWindow.length > 0) {
          firstLeadDate = leadsInWindow.reduce((min, l) => l.CreatedDate < min ? l.CreatedDate : min, leadsInWindow[0].CreatedDate).substring(0, 10);
        }
      }

      return {
        ...item,
        mouEndWindow: mouEndWindowStr,
        hasLeadWithinWindow,
        leadCountWithinWindow,
        firstLeadDate,
        isSettled: hasLeadWithinWindow
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

  // 최근 3개월 MOU 체결 파트너사의 초기 안착률
  const partnerOnboarding = calcOnboardingRate(mouPartnerLast3Months, allLeadsForMOU, true);
  const hqOnboarding = calcOnboardingRate(mouHQLast3Months, allLeadsForMOU, false);

  // ============================================
  // 브랜드 단위 초기 안착률 계산
  // ============================================
  // MOU 체결 본사의 각 브랜드를 개별적으로 추출하여 안착률 계산
  const calcBrandOnboarding = (mouHQList, franchiseLeads) => {
    const brandList = [];

    mouHQList.forEach(hq => {
      const mouDate = new Date(hq.mouStart);
      const mouEndWindow = new Date(mouDate.getFullYear(), mouDate.getMonth() + 3, mouDate.getDate());
      const mouEndWindowStr = mouEndWindow.toISOString().substring(0, 10);

      hq.brands.forEach(brand => {
        // 해당 브랜드의 Lead 확인 (BrandName__c로 매칭)
        const brandLeads = (franchiseLeads || []).filter(l => l.BrandName__c === brand.id);
        const leadsInWindow = brandLeads.filter(l => {
          const leadDate = l.CreatedDate?.substring(0, 10);
          return leadDate >= hq.mouStart && leadDate <= mouEndWindowStr;
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

  // 이번달 MOU 체결 본사의 브랜드
  const mouBrandThisMonth = calcBrandOnboarding(mouHQThisMonth, franchiseSourceLeads);
  // 최근 3개월 MOU 체결 본사의 브랜드 (초기 안착률 계산 대상)
  const mouBrandLast3Months = calcBrandOnboarding(mouHQLast3Months, franchiseSourceLeads);

  // ============================================
  // KPI 계산
  // ============================================
  // 지정 월의 마지막 날과 경과 일수 계산
  const currentMonth = new Date().toISOString().substring(0, 7);
  const isCurrentMonth = thisMonth === currentMonth;

  let today, thisMonthDays;
  if (isCurrentMonth) {
    // 현재 월이면 오늘 날짜 기준
    today = now.toISOString().substring(0, 10);
    thisMonthDays = now.getDate();
  } else {
    // 과거 월이면 해당 월의 마지막 날 기준
    const lastDayOfMonth = new Date(targetYear, targetMonthNum, 0).getDate();
    today = `${thisMonth}-${String(lastDayOfMonth).padStart(2, '0')}`;
    thisMonthDays = lastDayOfMonth;
  }

  // --- BD 파트 KPI ---

  // 1. 신규 MOU 체결 수 (월): mouPartnerThisMonth + mouHQThisMonth (이미 계산됨)
  const mouNewThisMonth = mouPartnerThisMonth.length + mouHQThisMonth.length;

  // 2. MOU 네고 단계 진입 건수 (월): Progress__c === 'Negotiation'인 Account 중 이번달 수정된 것
  const allChannelAccounts = [...partners, ...franchiseHQAccounts, ...franchiseBrands];
  const negoAccounts = allChannelAccounts.filter(a => a.Progress__c === 'Negotiation');
  const negoThisMonth = negoAccounts.filter(a =>
    a.CreatedDate && a.CreatedDate.substring(0, 7) === thisMonth
  );

  // 3. MOU 미완료/완료 Account 분류
  const mouCompletedAccountIds = new Set();
  const mouIncompleteAccountIds = new Set();
  allChannelAccounts.forEach(a => {
    if (a.MOUstartdate__c) {
      mouCompletedAccountIds.add(a.Id);
    } else {
      mouIncompleteAccountIds.add(a.Id);
    }
  });

  // 4. 미팅 수 계산 (Event 기반)
  const channelAccountIdSet = new Set(allChannelAccounts.map(a => a.Id));
  const meetingEvents = (channelEvents || []).filter(e => channelAccountIdSet.has(e.WhatId));

  // MOU 미완료 곳 미팅 (BD)
  const meetingsMouIncomplete = meetingEvents.filter(e => mouIncompleteAccountIds.has(e.WhatId));
  const meetingsMouIncompleteToday = meetingsMouIncomplete.filter(e => e.ActivityDate === today);
  const meetingsMouIncompleteThisMonth = meetingsMouIncomplete.filter(e =>
    e.ActivityDate && e.ActivityDate.substring(0, 7) === thisMonth
  );

  // MOU 완료 곳 미팅 (AM)
  const meetingsMouComplete = meetingEvents.filter(e => mouCompletedAccountIds.has(e.WhatId));
  const meetingsMouCompleteToday = meetingsMouComplete.filter(e => e.ActivityDate === today);
  const meetingsMouCompleteThisMonth = meetingsMouComplete.filter(e =>
    e.ActivityDate && e.ActivityDate.substring(0, 7) === thisMonth
  );

  // --- AM 파트 KPI ---

  // 5. 채널 리드 확보 수 (일별)
  const allChannelLeads = [...(partnerSourceLeads || []), ...(franchiseSourceLeads || [])];
  const leadsToday = allChannelLeads.filter(l => l.CreatedDate && l.CreatedDate.substring(0, 10) === today);
  const leadsThisMonth = allChannelLeads.filter(l =>
    l.CreatedDate && l.CreatedDate.substring(0, 7) === thisMonth
  );
  const leadsDailyAvg = thisMonthDays > 0 ? (leadsThisMonth.length / thisMonthDays).toFixed(1) : 0;

  // 6. 기존 파트너 활성 유지: 90일 이내 Lead >= 1인 파트너사/본사 수
  // 지정 월의 마지막 날 기준으로 90일 전 계산
  const targetDate = new Date(targetYear, targetMonthNum - 1, isCurrentMonth ? now.getDate() : thisMonthDays);
  const ninetyDaysAgo = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - 90).toISOString().substring(0, 10);

  // 파트너사 활성 (90일 이내 Lead)
  const activePartners90d = enrichedPartnerStats.filter(p => {
    const myLeads = allChannelLeads.filter(l => l.PartnerName__c === p.id);
    return myLeads.some(l => l.CreatedDate && l.CreatedDate.substring(0, 10) >= ninetyDaysAgo);
  });

  // 프랜차이즈 본사 활성 (90일 이내 하위 브랜드에 Lead)
  const activeHQ90d = enrichedFranchiseHQList.filter(hq => {
    const brandIds = hq.brands.map(b => b.id);
    const hqLeads = (franchiseSourceLeads || []).filter(l => brandIds.includes(l.BrandName__c));
    return hqLeads.some(l => l.CreatedDate && l.CreatedDate.substring(0, 10) >= ninetyDaysAgo);
  });

  const totalActiveChannels90d = activePartners90d.length + activeHQ90d.length;

  // 담당자별 미팅 현황 (이번달)
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

  // 미팅 캘린더 데이터 (이번달)
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

  // 캘린더 메타데이터 (지정 월 기준)
  const calYear = targetYear;
  const calMonth = targetMonthNum - 1; // 0-indexed
  const firstDayOfMonthCal = new Date(calYear, calMonth, 1);
  const lastDayOfMonthCal = new Date(calYear, calMonth + 1, 0);
  const calendarMeta = {
    year: calYear,
    month: calMonth + 1,
    monthLabel: `${calYear}년 ${calMonth + 1}월`,
    firstDay: firstDayOfMonthCal.getDay(), // 0=일, 1=월, ...
    totalDays: lastDayOfMonthCal.getDate(),
    today: isCurrentMonth ? now.getDate() : lastDayOfMonthCal.getDate()
  };

  // 파트너사/프랜차이즈 소유자별 Lead 생성 캘린더 (히트맵용)
  const leadCalendar = {};
  const channelOwners = new Set();
  leadsThisMonth.forEach(l => {
    const date = l.CreatedDate?.substring(0, 10);
    if (!date) return;

    // 파트너사 또는 프랜차이즈의 소유자 찾기
    let channelOwner = null;
    if (l.PartnerName__c && accountMap.has(l.PartnerName__c)) {
      channelOwner = accountMap.get(l.PartnerName__c).owner;
    } else if (l.BrandName__c && accountMap.has(l.BrandName__c)) {
      channelOwner = accountMap.get(l.BrandName__c).owner;
    }

    if (!channelOwner) return; // 파트너/프랜차이즈 소유자가 없으면 제외

    channelOwners.add(channelOwner);
    if (!leadCalendar[date]) leadCalendar[date] = {};
    if (!leadCalendar[date][channelOwner]) leadCalendar[date][channelOwner] = 0;
    leadCalendar[date][channelOwner]++;
  });
  const leadOwnerList = Array.from(channelOwners).sort();

  // KPI 종합
  const kpi = {
    date: today,
    thisMonth: thisMonth,
    thisMonthDays: thisMonthDays,
    bd: {
      mouNewThisMonth: { value: mouNewThisMonth, target: 4, label: '신규 MOU 체결 수 (월)' },
      negoEntryThisMonth: { value: negoThisMonth.length, total: negoAccounts.length, target: 10, label: 'MOU 네고 단계 진입 (월)' },
      meetingsIncompleteToday: { value: meetingsMouIncompleteToday.length, target: 2, label: 'MOU 미완료 곳 미팅 (오늘)' },
      meetingsIncompleteAvg: { value: thisMonthDays > 0 ? (meetingsMouIncompleteThisMonth.length / thisMonthDays).toFixed(1) : 0, target: 2, label: 'MOU 미완료 곳 미팅 (일평균)' },
      meetingsIncompleteThisMonth: { value: meetingsMouIncompleteThisMonth.length, label: 'MOU 미완료 곳 미팅 (이번달 합계)' }
    },
    am: {
      leadsToday: { value: leadsToday.length, target: '20~25', label: '채널 리드 확보 (오늘)' },
      leadsDailyAvg: { value: parseFloat(leadsDailyAvg), target: '20~25', label: '채널 리드 확보 (일평균)' },
      leadsThisMonth: { value: leadsThisMonth.length, label: '채널 리드 확보 (이번달 합계)' },
      meetingsCompleteToday: { value: meetingsMouCompleteToday.length, target: 2, label: 'MOU 완료 곳 미팅 (오늘)' },
      meetingsCompleteAvg: { value: thisMonthDays > 0 ? (meetingsMouCompleteThisMonth.length / thisMonthDays).toFixed(1) : 0, target: 2, label: 'MOU 완료 곳 미팅 (일평균)' },
      meetingsCompleteThisMonth: { value: meetingsMouCompleteThisMonth.length, label: 'MOU 완료 곳 미팅 (이번달 합계)' },
      onboardingRate: { value: parseFloat(partnerOnboarding.rate) || 0, settled: partnerOnboarding.settled, total: partnerOnboarding.total, target: 80, label: '신규 파트너 초기 안착률 (%)' },
      activeChannels90d: { value: totalActiveChannels90d, partners: activePartners90d.length, hq: activeHQ90d.length, target: 70, label: '기존 파트너 활성 유지 (90일)' }
    },
    meetingsByOwner: Object.entries(meetingsByOwner)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.total - a.total),
    meetingCalendar: meetingCalendar,
    calendarMeta: calendarMeta,
    leadCalendar: leadCalendar,
    leadOwnerList: leadOwnerList
  };

  // MOU 체결 현황 요약
  const mouStats = {
    thisMonth: thisMonth,
    threeMonthsAgo: threeMonthsAgo,
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
    // 브랜드 단위 (신규)
    franchiseBrand: {
      thisMonth: mouBrandThisMonth,
      last3Months: mouBrandLast3Months
    },
    onboarding: {
      partner: partnerOnboarding,
      franchiseHQ: hqOnboarding,
      // 브랜드 단위 안착률 (신규)
      franchiseBrand: mouBrandLast3Months
    }
  };

  const summary = {
    totalPartners: partners.length,
    totalPartnerStores: totalPartnerStores,
    totalFranchiseHQ: totalFranchiseHQ,
    totalFranchiseBrands: totalFranchiseBrands,
    totalFranchiseStores: totalFranchiseStores,
    totalAccounts: partners.length + franchiseBrands.length,
    totalReferredStores: totalPartnerStores + totalFranchiseStores,
    totalLeads: leads.length,
    convertedLeads: leads.filter(l => l.IsConverted).length,
    totalOpportunities: opportunities.length,
    wonOpportunities: opportunities.filter(o => o.IsWon).length,
    openOpportunities: opportunities.filter(o => !o.IsClosed).length,
    // LeadSource 기반 채널 활동 지표
    partnerLeads: partnerLeadStats,
    franchiseLeads: franchiseLeadStats,
    // 활동 중인 파트너사/본사 (Lead 생성 기준)
    activity: {
      thisMonth: thisMonth,
      threeMonthsAgo: threeMonthsAgo,
      activePartnerThisMonth: activePartnerThisMonth.length,
      activePartnerLast3Months: activePartnerLast3Months.length,
      activeHQThisMonth: activeHQThisMonth.length,
      activeHQLast3Months: activeHQLast3Months.length
    },
    // MOU 체결 현황 및 초기 안착률
    mou: mouStats,
    // KPI
    kpi: kpi
  };

  // ============================================
  // 파이프라인 통계 (이번 달 기준)
  // ============================================
  const thisMonthOpps = opportunities.filter(o => o.CreatedDate?.substring(0, 7) === thisMonth);

  // 1) Lead → Opp 전환율 (파트너사/프랜차이즈 구분, 이번 달)
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

  // 2) Opportunity Stage별 현황 (이번달 생성 + Open 기준)
  const openOpps = opportunities.filter(o => !o.IsClosed && o.CreatedDate?.substring(0, 7) === thisMonth);
  const stageDistribution = {};
  openOpps.forEach(o => {
    const stage = o.StageName || '(미지정)';
    if (!stageDistribution[stage]) {
      stageDistribution[stage] = { count: 0, amount: 0 };
    }
    stageDistribution[stage].count++;
    stageDistribution[stage].amount += (o.Amount || 0);
  });

  // 이번 달 CW/CL - 계약 시작일(contracts) 기준으로 변경
  // contracts가 있으면 계약 시작일 기준, 없으면 기존 CloseDate 기준
  let thisMonthCW, thisMonthCL, thisMonthCW_createdThisMonth, thisMonthCW_createdBefore;
  let thisMonthCW_partner, thisMonthCW_franchise;

  if (contracts && contracts.length > 0) {
    // 계약 시작일(contractDateStart) 기준 CW
    // contracts는 이미 해당 월의 계약만 필터링되어 있음
    const cwContracts = contracts.filter(c => c.opportunity?.stageName === 'Closed Won');
    thisMonthCW = cwContracts;

    // CL은 여전히 Opportunity 기준
    thisMonthCL = opportunities.filter(o => o.IsClosed && !o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth);

    // 생성월 기준 분리 (Opportunity 생성일)
    thisMonthCW_createdThisMonth = cwContracts.filter(c => c.opportunity?.createdDate?.substring(0, 7) === thisMonth);
    thisMonthCW_createdBefore = cwContracts.filter(c => c.opportunity?.createdDate?.substring(0, 7) !== thisMonth);

    // 파트너사/프랜차이즈 분리 (fmStoreType 또는 leadSource 기준)
    thisMonthCW_partner = cwContracts.filter(c =>
      c.fmStoreType === '파트너사제휴' ||
      c.leadSourceOpportunity === '파트너사 소개'
    );
    thisMonthCW_franchise = cwContracts.filter(c =>
      c.fmStoreType === '프랜차이즈제휴' ||
      c.leadSourceOpportunity === '프랜차이즈소개'
    );
  } else {
    // 기존 CloseDate 기준 (fallback)
    thisMonthCW = opportunities.filter(o => o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth);
    thisMonthCL = opportunities.filter(o => o.IsClosed && !o.IsWon && o.CloseDate?.substring(0, 7) === thisMonth);
    thisMonthCW_createdThisMonth = thisMonthCW.filter(o => o.CreatedDate?.substring(0, 7) === thisMonth);
    thisMonthCW_createdBefore = thisMonthCW.filter(o => o.CreatedDate?.substring(0, 7) !== thisMonth);
    thisMonthCW_partner = thisMonthCW.filter(o => o.fm_AccountPartner__c);
    thisMonthCW_franchise = thisMonthCW.filter(o => o.fm_AccountFRName__c);
  }

  const thisMonthClosed = [...(Array.isArray(thisMonthCW) ? thisMonthCW : []), ...thisMonthCL];
  const winRate = thisMonthClosed.length > 0
    ? ((thisMonthCW.length / thisMonthClosed.length) * 100).toFixed(1) : '0.0';

  // Open Opp도 파트너사/프랜차이즈 구분
  const openOpps_partner = openOpps.filter(o => o.fm_AccountPartner__c);
  const openOpps_franchise = openOpps.filter(o => o.fm_AccountFRName__c);

  const oppStageStats = {
    openTotal: openOpps.length,
    openPartner: openOpps_partner.length,       // 파트너사 Open Opp
    openFranchise: openOpps_franchise.length,   // 프랜차이즈 Open Opp
    stageDistribution: Object.entries(stageDistribution)
      .map(([stage, data]) => ({ stage, ...data }))
      .sort((a, b) => b.count - a.count),
    thisMonthCW: thisMonthCW.length,
    thisMonthCW_new: thisMonthCW_createdThisMonth.length,  // 이번달 생성 → 이번달 CW
    thisMonthCW_old: thisMonthCW_createdBefore.length,     // 이전 생성 → 이번달 CW
    thisMonthCW_partner: thisMonthCW_partner.length,       // 파트너사 소개 CW
    thisMonthCW_franchise: thisMonthCW_franchise.length,   // 프랜차이즈소개 CW
    thisMonthCL: thisMonthCL.length,
    winRate
  };

  // 3) 담당자별 파이프라인 현황 (채널세일즈팀 기준)
  const ownerPipeline = {};
  // 채널세일즈팀 유저 초기화
  (channelUsers || []).forEach(u => {
    ownerPipeline[u.Id] = {
      name: u.Name,
      // 이번달 Lead
      leadsThisMonth: 0,
      leadsConverted: 0,
      // Opp 현황
      openOpps: 0,
      cwThisMonth: 0,
      clThisMonth: 0,
      // Stage별
      byStage: {},
      // 금액
      openAmount: 0,
      cwAmount: 0
    };
  });

  // Lead 집계 (이번 달)
  thisMonthLeadsAll.forEach(l => {
    const ownerId = l.OwnerId;
    if (ownerPipeline[ownerId]) {
      ownerPipeline[ownerId].leadsThisMonth++;
      if (l.IsConverted) ownerPipeline[ownerId].leadsConverted++;
    }
  });

  // Opportunity 집계
  opportunities.forEach(o => {
    const ownerId = o.OwnerId;
    if (!ownerPipeline[ownerId]) return;

    const createdMonth = o.CreatedDate?.substring(0, 7);

    // 이번달 생성된 Open Opp (계류 중)
    if (!o.IsClosed && createdMonth === thisMonth) {
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

  const pipeline = {
    conversionStats,
    oppStageStats,
    ownerPipelineStats
  };

  // ============================================
  // 공통 전처리: activityByAccount 맵
  // ============================================
  // today 는 이미 KPI 섹션에서 선언됨 (let today)

  const activityByAccount = new Map();
  (channelTasks || []).forEach(t => {
    const accountId = t.WhatId;
    if (!accountId) return;
    if (!activityByAccount.has(accountId)) activityByAccount.set(accountId, []);
    activityByAccount.get(accountId).push({
      date: t.CreatedDate,
      activityDate: t.ActivityDate,
      type: 'Task',
      ownerId: t.OwnerId
    });
  });
  (channelEvents || []).forEach(e => {
    const accountId = e.WhatId;
    if (!accountId) return;
    if (!activityByAccount.has(accountId)) activityByAccount.set(accountId, []);
    activityByAccount.get(accountId).push({
      date: e.CreatedDate,
      activityDate: e.ActivityDate,
      type: 'Event',
      ownerId: e.OwnerId
    });
  });
  activityByAccount.forEach(activities => {
    activities.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  });

  // ============================================
  // Section 1: Task 활동 분석 (지정 월 기준)
  // ============================================
  // 지정 월의 Task만 필터링
  const thisMonthTasks = (channelTasks || []).filter(t =>
    t.ActivityDate && t.ActivityDate.substring(0, 7) === thisMonth
  );

  const tasksByOwner = {};
  (channelUsers || []).forEach(u => {
    tasksByOwner[u.Id] = {
      name: u.Name,
      tasksThisMonth: 0,
      completed: 0,
      notCompleted: 0,
      overdue: 0,
      byType: {},
      byDate: {}
    };
  });

  thisMonthTasks.forEach(t => {
    const ownerId = t.OwnerId;
    if (!tasksByOwner[ownerId]) return;
    tasksByOwner[ownerId].tasksThisMonth++;
    if (t.Status === 'Completed') {
      tasksByOwner[ownerId].completed++;
    } else {
      tasksByOwner[ownerId].notCompleted++;
      if (t.ActivityDate && t.ActivityDate < today && t.Status !== 'Completed') {
        tasksByOwner[ownerId].overdue++;
      }
    }
    const type = t.Type || '(미지정)';
    tasksByOwner[ownerId].byType[type] = (tasksByOwner[ownerId].byType[type] || 0) + 1;
    const date = t.ActivityDate;
    if (date) {
      tasksByOwner[ownerId].byDate[date] = (tasksByOwner[ownerId].byDate[date] || 0) + 1;
    }
  });

  const taskActivityByOwner = Object.values(tasksByOwner).map(owner => {
    const total = owner.tasksThisMonth;
    const completionRate = total > 0 ? ((owner.completed / total) * 100).toFixed(1) : '0.0';
    const uniqueDays = Object.keys(owner.byDate).length;
    const dailyAvg = uniqueDays > 0 ? (total / uniqueDays).toFixed(1) : '0.0';
    return {
      name: owner.name,
      tasksThisMonth: owner.tasksThisMonth,
      completed: owner.completed,
      notCompleted: owner.notCompleted,
      overdue: owner.overdue,
      completionRate,
      dailyAvg,
      typeDistribution: Object.entries(owner.byType)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
    };
  }).sort((a, b) => b.tasksThisMonth - a.tasksThisMonth);

  const teamTaskTypeDistribution = {};
  thisMonthTasks.forEach(t => {
    const type = t.Type || '(미지정)';
    teamTaskTypeDistribution[type] = (teamTaskTypeDistribution[type] || 0) + 1;
  });

  const taskAnalysis = {
    thisMonth: thisMonth,
    totalTasksThisMonth: thisMonthTasks.length,
    totalCompleted: thisMonthTasks.filter(t => t.Status === 'Completed').length,
    totalOverdue: thisMonthTasks.filter(t => t.ActivityDate && t.ActivityDate < today && t.Status !== 'Completed').length,
    teamCompletionRate: thisMonthTasks.length > 0
      ? ((thisMonthTasks.filter(t => t.Status === 'Completed').length / thisMonthTasks.length) * 100).toFixed(1)
      : '0.0',
    byOwner: taskActivityByOwner,
    teamTypeDistribution: Object.entries(teamTaskTypeDistribution)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
  };

  // ============================================
  // Section 2: Lead 전환 분석
  // ============================================
  // allChannelLeads 는 KPI 섹션에서 이미 선언됨
  // 대상월 기준 필터링: 대상월에 생성된 Lead만 분석
  const targetMonthEnd = `${thisMonth}-${String(new Date(targetYear, targetMonthNum, 0).getDate()).padStart(2, '0')}T23:59:59`;
  const monthFilteredLeads = allChannelLeads.filter(l =>
    l.CreatedDate && l.CreatedDate.substring(0, 7) === thisMonth
  );

  // Lead → Opp 전환 속도 계산 (ConvertedDate 활용)
  const convertedLeads = monthFilteredLeads.filter(l => l.IsConverted && l.ConvertedDate);
  const unconvertedLeads = monthFilteredLeads.filter(l => !l.IsConverted);
  const conversionDays = convertedLeads.map(l => {
    const days = Math.round((new Date(l.ConvertedDate) - new Date(l.CreatedDate)) / (1000 * 60 * 60 * 24));
    return { ...l, conversionDays: Math.max(0, days) };
  });
  const avgConversionDays = conversionDays.length > 0
    ? (conversionDays.reduce((s, l) => s + l.conversionDays, 0) / conversionDays.length).toFixed(1)
    : null;
  const conversionRate = monthFilteredLeads.length > 0
    ? ((convertedLeads.length / monthFilteredLeads.length) * 100).toFixed(1)
    : '0.0';

  // 전환 속도 분포
  const conversionSpeedBuckets = [
    { label: '당일 (0일)', min: 0, max: 1 },
    { label: '1-3일', min: 1, max: 4 },
    { label: '4-7일', min: 4, max: 8 },
    { label: '8-14일', min: 8, max: 15 },
    { label: '15-30일', min: 15, max: 31 },
    { label: '30일+', min: 31, max: Infinity },
    { label: '미전환', min: null, max: null }
  ];
  const conversionSpeedDistribution = conversionSpeedBuckets.map(bucket => {
    let count;
    if (bucket.min === null) {
      count = unconvertedLeads.length;
    } else {
      count = conversionDays.filter(l => l.conversionDays >= bucket.min && l.conversionDays < bucket.max).length;
    }
    return {
      label: bucket.label,
      count,
      percentage: monthFilteredLeads.length > 0 ? ((count / monthFilteredLeads.length) * 100).toFixed(1) : '0.0'
    };
  });

  // 미전환 Lead 목록 (14일+ 경과)
  const unconvertedOldLeads = unconvertedLeads
    .filter(l => {
      const st = l.Status || '';
      if (['Closed', 'Unqualified', 'Disqualified', '종료', '실격'].some(s => st.includes(s))) return false;
      const ageDays = Math.round((new Date(today) - new Date(l.CreatedDate)) / (1000 * 60 * 60 * 24));
      return ageDays >= 14;
    })
    .map(l => ({
      name: l.Name || l.LastName || '-',
      status: l.Status,
      owner: l.Owner?.Name || '미배정',
      createdDate: (l.CreatedDate || '').substring(0, 10),
      ageDays: Math.round((new Date(today) - new Date(l.CreatedDate)) / (1000 * 60 * 60 * 24))
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  // 담당자별 전환 현황 (대상월 생성 Lead 기준)
  const leadConversionByOwner = {};
  monthFilteredLeads.forEach(lead => {
    const owner = lead.Owner?.Name || '미배정';
    if (!leadConversionByOwner[owner]) {
      leadConversionByOwner[owner] = { total: 0, converted: 0, totalDays: 0, convertedCount: 0 };
    }
    leadConversionByOwner[owner].total++;
    if (lead.IsConverted) {
      leadConversionByOwner[owner].converted++;
      if (lead.ConvertedDate) {
        const days = Math.max(0, Math.round((new Date(lead.ConvertedDate) - new Date(lead.CreatedDate)) / (1000 * 60 * 60 * 24)));
        leadConversionByOwner[owner].totalDays += days;
        leadConversionByOwner[owner].convertedCount++;
      }
    }
  });

  const leadProcessing = {
    totalLeadsInMonth: monthFilteredLeads.length,
    totalConverted: convertedLeads.length,
    conversionRate,
    avgConversionDays,
    unconvertedCount: unconvertedLeads.length,
    unconvertedOldCount: unconvertedOldLeads.length,
    unconvertedOldLeads: unconvertedOldLeads.slice(0, 20),
    conversionSpeedDistribution,
    byOwner: Object.entries(leadConversionByOwner)
      .map(([owner, d]) => ({
        owner,
        total: d.total,
        converted: d.converted,
        conversionRate: d.total > 0 ? ((d.converted / d.total) * 100).toFixed(1) : '0.0',
        avgDays: d.convertedCount > 0 ? (d.totalDays / d.convertedCount).toFixed(1) : '-'
      }))
      .sort((a, b) => b.total - a.total)
  };

  // ============================================
  // Section 3: Opp 파이프라인 심층 분석
  // ============================================
  // 대상월 기준 필터링: CloseDate가 대상월인 CL/CW + 대상월 말 기준 Open Opp
  const closedLostOpps = opportunities.filter(o => o.IsClosed && !o.IsWon && o.CloseDate && o.CloseDate.substring(0, 7) === thisMonth);
  const lossReasonBreakdown = {};
  closedLostOpps.forEach(o => {
    const reason = o.Loss_Reason__c || '(미지정)';
    if (!lossReasonBreakdown[reason]) lossReasonBreakdown[reason] = { count: 0, byOwner: {} };
    lossReasonBreakdown[reason].count++;
    const owner = o.Owner?.Name || '미배정';
    lossReasonBreakdown[reason].byOwner[owner] = (lossReasonBreakdown[reason].byOwner[owner] || 0) + 1;
  });

  // 대상월 생성 기준 Open Opp: 대상월에 생성되었고 아직 닫히지 않았거나 대상월 이후에 닫힌 Opp
  const openOppsAll = opportunities.filter(o => {
    if (!o.CreatedDate || o.CreatedDate.substring(0, 7) !== thisMonth) return false;
    if (!o.IsClosed) return true;
    // 대상월 이후에 닫힌 건은 해당 월 시점에서는 Open이었음
    return o.CloseDate && o.CloseDate.substring(0, 7) > thisMonth;
  });
  const oppAgeBuckets = [
    { label: '0-7일', min: 0, max: 7 },
    { label: '8-14일', min: 7, max: 14 },
    { label: '15-30일', min: 14, max: 30 },
    { label: '30일+', min: 30, max: Infinity }
  ];
  const oppAgeDistribution = oppAgeBuckets.map(bucket => {
    const count = openOppsAll.filter(o => {
      const age = Math.round((new Date(today) - new Date(o.CreatedDate)) / (1000 * 60 * 60 * 24));
      return age >= bucket.min && age < bucket.max;
    }).length;
    return { label: bucket.label, count };
  });

  const cwOppsAll = opportunities.filter(o => o.IsWon && o.CloseDate && o.CloseDate.substring(0, 7) === thisMonth);
  const oppToCWLeadtimes = cwOppsAll.map(o => {
    return Math.round((new Date(o.CloseDate) - new Date(o.CreatedDate)) / (1000 * 60 * 60 * 24));
  }).filter(d => d >= 0);
  const avgOppToCWDays = oppToCWLeadtimes.length > 0
    ? (oppToCWLeadtimes.reduce((a, b) => a + b, 0) / oppToCWLeadtimes.length).toFixed(1)
    : null;

  // 정체 Opp (예정된 Task 있는 Account 또는 Opportunity 제외)
  const staleOppThreshold = 14;
  const staleOppCutoff = new Date(new Date(today).getTime() - staleOppThreshold * 24 * 60 * 60 * 1000).toISOString();
  const staleOppsDetected = openOppsAll.filter(o => {
    if (o.IsWon) return false; // Closed Won 제외
    if (futureTaskAccountIds && futureTaskAccountIds.has(o.AccountId)) return false; // Account에 예정된 Task 있으면 제외
    if (futureTaskOppIds && futureTaskOppIds.has(o.Id)) return false; // Opp 자체에 예정된 Task 있으면 제외
    const activities = activityByAccount.get(o.AccountId) || [];
    return !activities.some(a => a.date >= staleOppCutoff);
  }).map(o => ({
    name: o.Name,
    stageName: o.StageName,
    accountName: o.Account?.Name || '-',
    owner: o.Owner?.Name || '미배정',
    createdDate: (o.CreatedDate || '').substring(0, 10),
    ageDays: Math.round((new Date(today) - new Date(o.CreatedDate)) / (1000 * 60 * 60 * 24))
  })).sort((a, b) => b.ageDays - a.ageDays);

  // 담당자별 Stage 분포
  const oppStageByOwner = {};
  openOppsAll.forEach(o => {
    const owner = o.Owner?.Name || '미배정';
    if (!oppStageByOwner[owner]) oppStageByOwner[owner] = { stages: {}, total: 0 };
    const stage = o.StageName || '(미지정)';
    oppStageByOwner[owner].stages[stage] = (oppStageByOwner[owner].stages[stage] || 0) + 1;
    oppStageByOwner[owner].total++;
  });

  const oppDeepDive = {
    lossReasonBreakdown: Object.entries(lossReasonBreakdown)
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        percentage: closedLostOpps.length > 0 ? ((data.count / closedLostOpps.length) * 100).toFixed(1) : '0.0',
        topOwners: Object.entries(data.byOwner).map(([owner, count]) => ({ owner, count })).sort((a, b) => b.count - a.count).slice(0, 3)
      }))
      .sort((a, b) => b.count - a.count),
    totalClosedLost: closedLostOpps.length,
    oppAgeDistribution,
    avgOppToCWDays,
    cwCount: cwOppsAll.length,
    staleOpps: staleOppsDetected.slice(0, 20),
    staleOppCount: staleOppsDetected.length,
    oppStageByOwner: Object.entries(oppStageByOwner)
      .map(([owner, data]) => ({
        owner,
        total: data.total,
        stages: Object.entries(data.stages).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count)
      }))
      .sort((a, b) => b.total - a.total)
  };

  // ============================================
  // Section 4: 파트너 참여 심도 분석 (지정 월 기준 90일)
  // ============================================
  // 지정 월 기준 90일 전 계산 (예: 2026-02 → 2025-11-01 ~ 2026-02-28)
  const engagementStartDate = threeMonthsAgo + '-01'; // 3개월 전 1일
  const engagementEndDate = today; // 지정 월의 마지막 날
  const engagementPeriodLabel = `${threeMonthsAgo} ~ ${thisMonth}`;

  // 해당 기간 내의 Task/Event만 필터링
  const periodTasks = (channelTasks || []).filter(t =>
    t.ActivityDate && t.ActivityDate >= engagementStartDate && t.ActivityDate <= engagementEndDate
  );
  const periodEvents = (channelEvents || []).filter(e =>
    e.ActivityDate && e.ActivityDate >= engagementStartDate && e.ActivityDate <= engagementEndDate
  );

  // 미팅(Event)만 집계 (Task 제외)
  const partnerEngagement = enrichedPartnerStats.map(p => {
    const accountEvents = periodEvents.filter(e => e.WhatId === p.id);
    const totalActivities = accountEvents.length;

    let preMouActivities = 0, postMouActivities = 0, engagementScore = null;
    if (p.mouStart && p.mouStart !== '-') {
      accountEvents.forEach(a => {
        const actDate = a.ActivityDate || (a.CreatedDate ? a.CreatedDate.substring(0, 10) : '');
        if (actDate < p.mouStart) preMouActivities++;
        else postMouActivities++;
      });
      const monthsSinceMOU = Math.max(1, Math.round((new Date(today) - new Date(p.mouStart)) / (1000 * 60 * 60 * 24 * 30)));
      engagementScore = parseFloat((postMouActivities / monthsSinceMOU).toFixed(1));
    }

    return {
      name: p.name, owner: p.owner, mouStart: p.mouStart,
      totalActivities, eventCount: accountEvents.length,
      preMouActivities, postMouActivities, engagementScore,
      conversionRate: parseFloat(p.sourceLeadConversionRate) || 0,
      leadCount: p.sourceLeadCount || 0
    };
  });

  const hqEngagement = enrichedFranchiseHQList.map(hq => {
    const brandIds = (hq.brands || []).map(b => b.id);
    const hqAccountIds = [hq.hqId, ...brandIds].filter(Boolean);
    const accountEvents = periodEvents.filter(e => hqAccountIds.includes(e.WhatId));
    const totalActivities = accountEvents.length;

    let preMouActivities = 0, postMouActivities = 0, engagementScore = null;
    if (hq.mouStart && hq.mouStart !== '-') {
      accountEvents.forEach(a => {
        const actDate = a.ActivityDate || (a.CreatedDate ? a.CreatedDate.substring(0, 10) : '');
        if (actDate < hq.mouStart) preMouActivities++;
        else postMouActivities++;
      });
      const monthsSinceMOU = Math.max(1, Math.round((new Date(today) - new Date(hq.mouStart)) / (1000 * 60 * 60 * 24 * 30)));
      engagementScore = parseFloat((postMouActivities / monthsSinceMOU).toFixed(1));
    }

    return {
      name: hq.hqName, owner: hq.owner, mouStart: hq.mouStart,
      totalActivities, eventCount: accountEvents.length,
      preMouActivities, postMouActivities, engagementScore,
      conversionRate: parseFloat(hq.conversionRate) || 0,
      leadCount: hq.totalLeads || 0
    };
  });

  const allEngagement = [...partnerEngagement, ...hqEngagement]
    .filter(p => p.mouStart && p.mouStart !== '-')
    .sort((a, b) => ((b.engagementScore || 0) + b.conversionRate) - ((a.engagementScore || 0) + a.conversionRate));

  const scoredEngagement = allEngagement.filter(p => p.engagementScore !== null);
  const partnerEngagementStats = {
    periodLabel: engagementPeriodLabel,
    partners: partnerEngagement.sort((a, b) => b.totalActivities - a.totalActivities),
    franchiseHQ: hqEngagement.sort((a, b) => b.totalActivities - a.totalActivities),
    qualityRanking: allEngagement.slice(0, 20),
    totalPartnersWithActivity: partnerEngagement.filter(p => p.totalActivities > 0).length,
    totalHQWithActivity: hqEngagement.filter(h => h.totalActivities > 0).length,
    avgEngagementScore: scoredEngagement.length > 0
      ? (scoredEngagement.reduce((s, p) => s + p.engagementScore, 0) / scoredEngagement.length).toFixed(1)
      : null
  };

  return {
    summary,
    partnerStats: enrichedPartnerStats,
    franchiseStats,
    franchiseHQList: enrichedFranchiseHQList,
    ownerStats: Object.values(ownerStats).sort((a, b) =>
      b.totalLeads - a.totalLeads
    ),
    // 활동 중인 파트너사/본사 리스트
    activePartnerThisMonth,
    activePartnerLast3Months,
    activeHQThisMonth,
    activeHQLast3Months,
    // MOU 체결 현황
    mouStats,
    // KPI
    kpi,
    // 파이프라인
    pipeline,
    // 세부 분석
    taskAnalysis,
    leadProcessing,
    oppDeepDive,
    partnerEngagementStats,
    rawData: data
  };
}

// ============================================
// HTML 리포트 생성
// ============================================

function generateHTML(stats, targetMonth = null) {
  const { summary, partnerStats, franchiseHQList, ownerStats,
          activePartnerThisMonth, activeHQThisMonth, mouStats, kpi, pipeline,
          taskAnalysis, leadProcessing, oppDeepDive, partnerEngagementStats } = stats;
  const { conversionStats, oppStageStats, ownerPipelineStats } = pipeline;
  const reportMonth = targetMonth || new Date().toISOString().substring(0, 7);
  const now = targetMonth || new Date().toISOString().split('T')[0];

  // MOU 관련 헬퍼 함수들
  const renderMOUPartnerRow = (p) => {
    const settled = p.isSettled !== undefined ? p.isSettled : (p.sourceLeadCount > 0);
    return `
    <tr style="${settled ? 'background:#1d3d1d;' : 'background:#3d2d2d;'}">
      <td><strong style="font-weight:500;">${p.name}</strong></td>
      <td>${p.owner}</td>
      <td class="text-center">${p.mouStart || '-'}</td>
      <td class="text-center">${p.leadCountWithinWindow || p.sourceLeadCount || 0}</td>
      <td class="text-center">${settled ? '<span style="color:#107c10;">✓</span>' : '<span style="color:#ff8c00;">-</span>'}</td>
    </tr>`;
  };

  const renderMOUHQRow = (hq) => {
    const settled = hq.isSettled !== undefined ? hq.isSettled : (hq.totalLeads > 0);
    return `
    <tr style="${settled ? 'background:#1d3d1d;' : 'background:#3d2d2d;'}">
      <td><strong style="font-weight:500;">${hq.hqName}</strong></td>
      <td>${hq.owner}</td>
      <td class="text-center">${hq.mouStart || '-'}</td>
      <td class="text-center">${hq.leadCountWithinWindow || hq.totalLeads || 0}</td>
      <td class="text-center">${settled ? '<span style="color:#107c10;">✓</span>' : '<span style="color:#ff8c00;">-</span>'}</td>
    </tr>`;
  };

  // 헬퍼 함수들
  const renderActivePartnerRow = (p) => `
    <tr>
      <td>${p.name}</td>
      <td class="text-center"><strong style="font-weight:500; color:#e81123;">${p.thisMonthLeadCount}</strong></td>
      <td class="text-center" style="color:#00b7c3;">${p.last3MonthLeadCount}</td>
      <td class="text-center" style="font-size:0.85em; color:#aaa;">${p.lastLeadDate || '-'}</td>
    </tr>`;

  const renderActiveHQRow = (hq) => `
    <tr>
      <td>${hq.hqName}</td>
      <td class="text-center"><strong style="font-weight:500; color:#e81123;">${hq.thisMonthLeadCount}</strong></td>
      <td class="text-center" style="color:#00b7c3;">${hq.last3MonthLeadCount}</td>
      <td class="text-center" style="font-size:0.85em; color:#aaa;">${hq.lastLeadDate || '-'}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>채널세일즈 리포트 - ${now}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Roboto', -apple-system, sans-serif; background: #1a1a1a; color: #fff; line-height: 1.5; }
    .container { width: 100%; padding: 30px 40px; }
    h1 { text-align: left; margin-bottom: 40px; color: #fff; font-size: 2.5em; font-weight: 300; letter-spacing: -1px; }
    h2 { margin: 40px 0 20px; padding-bottom: 10px; border-bottom: 3px solid #0078d4; color: #fff; font-size: 1.6em; font-weight: 400; }
    h3 { font-weight: 400; font-size: 1.2em; }
    h4 { font-weight: 500; font-size: 1.1em; color: #fff; }
    .card { background: #2d2d2d; padding: 25px; margin-bottom: 25px; border-left: 4px solid #0078d4; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; }
    .stat-box { text-align: center; padding: 25px; background: #0078d4; color: white; }
    .stat-box.green { background: #107c10; }
    .stat-box.orange { background: #ff8c00; }
    .stat-box.blue { background: #00b7c3; }
    .stat-box.purple { background: #8661c5; }
    .stat-box.red { background: #e81123; }
    .stat-number { font-size: 3em; font-weight: 300; }
    .stat-label { font-size: 0.95em; opacity: 0.9; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; background: #252525; }
    th, td { padding: 14px 18px; text-align: left; border-bottom: 1px solid #3d3d3d; }
    th { background: #333; font-weight: 500; color: #fff; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.5px; }
    tr:hover { background: #333; }
    .badge { display: inline-block; padding: 4px 10px; font-size: 0.8em; font-weight: 500; }
    .badge-partner { background: #0078d4; color: #fff; }
    .badge-franchise { background: #ff8c00; color: #fff; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .tile { padding: 25px; color: #fff; }
    .tile-blue { background: #0078d4; }
    .tile-orange { background: #ff8c00; }
    .tile-green { background: #107c10; }
    .tile-purple { background: #8661c5; }
    .tile-red { background: #e81123; }
    .tile-teal { background: #00b7c3; }
    .tile-dark { background: #333; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>채널세일즈 리포트</h1>
    <p style="text-align:left; color:#888; margin-bottom:40px; font-size:1.1em;">생성일: ${now}</p>

    <!-- KPI 대시보드 -->
    ${kpi ? `
    <div class="card" style="border-left-color:#e81123;">
      <h2 style="border-bottom-color:#e81123;">KPI 대시보드</h2>
      <p style="color:#888; margin-bottom:20px;">기준일: ${kpi.date} | 이번달 경과일: ${kpi.thisMonthDays}일</p>

      <!-- BD 파트 -->
      <h4 style="margin-bottom:15px; color:#0078d4;">BD 파트 — 신규 MOU 확보</h4>
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:15px; margin-bottom:30px;">
        <div class="tile" style="background:${kpi.bd.mouNewThisMonth.value >= kpi.bd.mouNewThisMonth.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">신규 MOU 체결 (월)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.bd.mouNewThisMonth.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.bd.mouNewThisMonth.target}건</div>
          </div>
        </div>
        <div class="tile" style="background:${kpi.bd.negoEntryThisMonth.value >= kpi.bd.negoEntryThisMonth.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">네고 단계 진입 (월)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.bd.negoEntryThisMonth.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.bd.negoEntryThisMonth.target}건</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">현재 네고중: ${kpi.bd.negoEntryThisMonth.total}건</div>
        </div>
        <div class="tile" style="background:${kpi.bd.meetingsIncompleteToday.value >= kpi.bd.meetingsIncompleteToday.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">MOU 미완료 곳 미팅 (일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.bd.meetingsIncompleteToday.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.bd.meetingsIncompleteToday.target}건+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">일평균 ${kpi.bd.meetingsIncompleteAvg.value}건 | 이번달 ${kpi.bd.meetingsIncompleteThisMonth.value}건</div>
        </div>
      </div>

      <!-- AM 파트 -->
      <h4 style="margin-bottom:15px; color:#ff8c00;">AM 파트 — 파트너 활성화 · 리드 안정화</h4>
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:25px;">
        <div class="tile" style="background:${kpi.am.leadsToday.value >= 20 ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">채널 리드 확보 (일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.leadsToday.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.leadsToday.target}건</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">일평균 ${kpi.am.leadsDailyAvg.value}건 | 이번달 ${kpi.am.leadsThisMonth.value}건</div>
        </div>
        <div class="tile" style="background:${kpi.am.meetingsCompleteToday.value >= kpi.am.meetingsCompleteToday.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">MOU 완료 곳 미팅 (일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.meetingsCompleteToday.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.meetingsCompleteToday.target}건+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">일평균 ${kpi.am.meetingsCompleteAvg.value}건 | 이번달 ${kpi.am.meetingsCompleteThisMonth.value}건</div>
        </div>
        <div class="tile" style="background:${kpi.am.onboardingRate.value >= kpi.am.onboardingRate.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">신규 파트너 안착률</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.onboardingRate.value}%</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.onboardingRate.target}%+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">${kpi.am.onboardingRate.settled}/${kpi.am.onboardingRate.total}개사</div>
        </div>
        <div class="tile" style="background:${kpi.am.activeChannels90d.value >= kpi.am.activeChannels90d.target ? '#107c10' : '#e81123'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">활성 파트너 (90일)</div>
          <div style="display:flex; align-items:baseline; gap:10px;">
            <div style="font-size:3em; font-weight:300;">${kpi.am.activeChannels90d.value}</div>
            <div style="font-size:1.2em; opacity:0.7;">/ ${kpi.am.activeChannels90d.target}개+</div>
          </div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">파트너 ${kpi.am.activeChannels90d.partners}개 + 본사 ${kpi.am.activeChannels90d.hq}개</div>
        </div>
      </div>

      <!-- 미팅 캘린더 -->
      ${kpi.calendarMeta ? (() => {
        const cm = kpi.calendarMeta;
        const cal = kpi.meetingCalendar || {};
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const pad2 = n => String(n).padStart(2, '0');

        // 캘린더 셀 생성
        let cells = '';
        // 빈 셀 (1일 이전)
        for (let i = 0; i < cm.firstDay; i++) {
          cells += '<div style="background:#1a1a1a; min-height:120px;"></div>';
        }
        // 날짜 셀
        for (let d = 1; d <= cm.totalDays; d++) {
          const dateStr = `${cm.year}-${pad2(cm.month)}-${pad2(d)}`;
          const dayMeetings = cal[dateStr] || [];
          const isToday = d === cm.today;
          const isPast = dateStr < kpi.date;
          const dayOfWeek = (cm.firstDay + d - 1) % 7;
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

          let bg = '#252525';
          if (isToday) bg = '#333';
          if (isWeekend) bg = '#1e1e1e';

          const meetingHtml = dayMeetings.slice(0, 4).map(m => {
            const statusColor = isPast ? '#107c10' : isToday ? '#0078d4' : '#ff8c00';
            const mouColor = m.isMouComplete ? '#00b7c3' : '#e81123';
            return `<div style="font-size:0.75em; padding:3px 5px; margin:2px 0; border-left:3px solid ${statusColor}; background:#333; display:flex; justify-content:space-between; align-items:center;">
              <div style="overflow:hidden; white-space:nowrap; text-overflow:ellipsis; flex:1;">
                <span style="color:${mouColor}; font-size:0.9em;">●</span>
                <span style="color:#ccc;">${m.startTime !== '-' ? m.startTime + ' ' : ''}${m.accountName.substring(0, 15)}</span>
              </div>
              <div style="color:#888; font-size:0.9em; margin-left:5px; white-space:nowrap;">${m.owner.substring(0, 4)}</div>
            </div>`;
          }).join('');

          const moreCount = dayMeetings.length > 4 ? `<div style="font-size:0.7em; color:#888; text-align:center;">+${dayMeetings.length - 4}건 더</div>` : '';

          cells += `<div style="background:${bg}; min-height:120px; padding:5px; border:1px solid ${isToday ? '#0078d4' : '#3d3d3d'}; ${isToday ? 'box-shadow:0 0 0 2px #0078d4;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span style="font-size:0.9em; font-weight:${isToday ? '500' : '300'}; color:${isToday ? '#0078d4' : isWeekend ? '#888' : '#ccc'};">${d}</span>
              ${dayMeetings.length > 0 ? '<span style="font-size:0.7em; background:#555; color:#fff; padding:1px 6px; border-radius:2px;">' + dayMeetings.length + '</span>' : ''}
            </div>
            ${meetingHtml}${moreCount}
          </div>`;
        }

        return `
      <h4 style="margin:30px 0 15px;">미팅 캘린더 (${cm.monthLabel})</h4>
      <div style="margin-bottom:10px; display:flex; gap:20px; font-size:0.85em; color:#888;">
        <span><span style="color:#107c10;">●</span> 완료</span>
        <span><span style="color:#0078d4;">●</span> 오늘</span>
        <span><span style="color:#ff8c00;">●</span> 예정</span>
        <span style="margin-left:20px;"><span style="color:#00b7c3;">●</span> MOU완료</span>
        <span><span style="color:#e81123;">●</span> MOU미완료</span>
      </div>
      <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:2px;">
        ${dayNames.map(d => '<div style="text-align:center; padding:8px; background:#333; font-size:0.85em; font-weight:500; color:#aaa; text-transform:uppercase;">' + d + '</div>').join('')}
        ${cells}
      </div>`;
      })() : ''}

      <!-- 담당자별 미팅 요약 -->
      ${kpi.meetingsByOwner && kpi.meetingsByOwner.length > 0 ? `
      <h4 style="margin:30px 0 15px;">담당자별 미팅 요약 (이번달)</h4>
      <table>
        <thead>
          <tr><th>담당자</th><th class="text-center">합계</th><th class="text-center">MOU완료</th><th class="text-center">MOU미완료</th></tr>
        </thead>
        <tbody>
          ${kpi.meetingsByOwner.slice(0, 10).map(o => `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.total}</td>
            <td class="text-center">${o.mouComplete}</td>
            <td class="text-center">${o.mouIncomplete}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}

      <!-- Lead 생성 캘린더 히트맵 (소유자별 개별 캘린더) -->
      ${kpi.leadCalendar && kpi.leadOwnerList && kpi.leadOwnerList.length > 0 ? (() => {
        const cm = kpi.calendarMeta;
        const cal = kpi.leadCalendar;
        const owners = kpi.leadOwnerList;
        const pad2 = n => String(n).padStart(2, '0');
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

        // 소유자별 통계 계산
        const ownerStats = {};
        owners.forEach(o => {
          ownerStats[o] = { total: 0, zeroDays: 0 };
        });
        for (let d = 1; d <= cm.totalDays; d++) {
          const dateStr = cm.year + '-' + pad2(cm.month) + '-' + pad2(d);
          const dayOfWeek = new Date(cm.year, cm.month - 1, d).getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) continue; // 주말 제외
          const dayData = cal[dateStr] || {};
          owners.forEach(o => {
            const count = dayData[o] || 0;
            ownerStats[o].total += count;
            if (count === 0) ownerStats[o].zeroDays++;
          });
        }

        // 소유자를 총 Lead 수 기준 내림차순 정렬
        const sortedOwners = [...owners].sort((a, b) => ownerStats[b].total - ownerStats[a].total);

        // 개별 캘린더 생성
        const calendarsHtml = sortedOwners.map(owner => {
          const stats = ownerStats[owner];

          // 캘린더 셀 생성
          let cells = '';
          // 빈 셀 (1일 이전)
          for (let i = 0; i < cm.firstDay; i++) {
            cells += '<div style="background:#1a1a1a; min-height:32px;"></div>';
          }
          // 날짜 셀
          for (let d = 1; d <= cm.totalDays; d++) {
            const dateStr = cm.year + '-' + pad2(cm.month) + '-' + pad2(d);
            const dayData = cal[dateStr] || {};
            const count = dayData[owner] || 0;
            const dayOfWeek = (cm.firstDay + d - 1) % 7;
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isZeroWeekday = count === 0 && !isWeekend;

            // 히트맵 색상
            let bgColor = '#252525';
            if (count > 0) {
              if (count >= 10) bgColor = '#b45309';
              else if (count >= 5) bgColor = '#d97706';
              else if (count >= 3) bgColor = '#f59e0b';
              else bgColor = '#fbbf24';
            }
            if (isWeekend) bgColor = '#1e1e1e';

            const borderStyle = isZeroWeekday ? 'border:1px solid #dc2626;' : '';

            cells += '<div style="background:' + bgColor + '; min-height:32px; display:flex; flex-direction:column; justify-content:center; align-items:center; ' + borderStyle + '">' +
              '<div style="font-size:0.7em; color:' + (isWeekend ? '#555' : '#888') + ';">' + d + '</div>' +
              '<div style="font-size:0.85em; font-weight:600; color:' + (count > 0 ? '#fff' : '#555') + ';">' + (count > 0 ? count : '-') + '</div>' +
            '</div>';
          }

          return '<div style="background:#1e1e2e; border-radius:8px; padding:12px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
              '<div style="font-weight:600; color:#fff;">' + owner + '</div>' +
              '<div style="font-size:0.85em;">' +
                '<span style="color:#f59e0b; font-weight:600;">' + stats.total + '건</span> ' +
                '<span style="color:#888;">0건:</span><span style="color:#dc2626;">' + stats.zeroDays + '일</span>' +
              '</div>' +
            '</div>' +
            '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px; font-size:0.75em; margin-bottom:4px;">' +
              dayNames.map(d => '<div style="text-align:center; color:' + (d === '일' ? '#dc2626' : d === '토' ? '#3b82f6' : '#888') + ';">' + d + '</div>').join('') +
            '</div>' +
            '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px;">' + cells + '</div>' +
          '</div>';
        }).join('');

        return '<h4 style="margin:30px 0 15px;">AM이 관리하는 파트너사/프랜차이즈에서 발생한 Lead 현황 (' + cm.monthLabel + ')</h4>' +
          '<div style="margin-bottom:15px; font-size:0.85em; color:#888;">' +
            '<span style="color:#dc2626;">빨간 테두리</span> = 평일 0건' +
          '</div>' +
          '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:15px;">' +
            calendarsHtml +
          '</div>';
      })() : ''}
    </div>
    ` : ''}

    <!-- 활동 현황 (Lead 생성일 기준) -->
    <div class="card">
      <h2>활동 현황 (Lead 생성일 기준)</h2>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:25px;">
        <!-- 이번 달 -->
        <div class="tile tile-red">
          <h3 style="margin-bottom:20px;">이번 달 (${summary.activity.thisMonth})</h3>
          <div style="display:flex; gap:40px;">
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activePartnerThisMonth}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activeHQThisMonth}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 프랜차이즈본사</div>
            </div>
          </div>
        </div>
        <!-- 최근 3개월 -->
        <div class="tile tile-teal">
          <h3 style="margin-bottom:20px;">최근 3개월 (${summary.activity.threeMonthsAgo} ~ ${summary.activity.thisMonth})</h3>
          <div style="display:flex; gap:40px;">
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activePartnerLast3Months}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:3em; font-weight:300;">${summary.activity.activeHQLast3Months}</div>
              <div style="font-size:0.9em; opacity:0.85; text-transform:uppercase;">활동 프랜차이즈본사</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 이번 달 활동 상세 -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <!-- 이번 달 활동 파트너사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 활동 파트너사 (${activePartnerThisMonth?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>파트너명</th><th class="text-center">이번달</th><th class="text-center">3개월</th><th class="text-center">최근Lead</th></tr>
            </thead>
            <tbody>
              ${(activePartnerThisMonth || []).sort((a, b) => b.thisMonthLeadCount - a.thisMonthLeadCount).slice(0, 15).map(renderActivePartnerRow).join('')}
            </tbody>
          </table>
        </div>
        <!-- 이번 달 활동 프랜차이즈 본사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 활동 프랜차이즈 본사 (${activeHQThisMonth?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>본사명</th><th class="text-center">이번달</th><th class="text-center">3개월</th><th class="text-center">최근Lead</th></tr>
            </thead>
            <tbody>
              ${(activeHQThisMonth || []).sort((a, b) => b.thisMonthLeadCount - a.thisMonthLeadCount).slice(0, 15).map(renderActiveHQRow).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MOU 체결 현황 및 초기 안착률 -->
    <div class="card">
      <h2>MOU 체결 현황 및 초기 안착률</h2>
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:15px; margin-bottom:25px;">
        <!-- 이번 달 MOU 체결 -->
        <div class="tile tile-green">
          <h3 style="margin-bottom:20px;">이번 달 MOU 체결</h3>
          <div style="display:flex; gap:30px;">
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.partner?.thisMonth || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.franchiseHQ?.thisMonth || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">본사</div>
            </div>
          </div>
        </div>
        <!-- 최근 3개월 MOU 체결 -->
        <div class="tile tile-purple">
          <h3 style="margin-bottom:20px;">최근 3개월 MOU</h3>
          <div style="display:flex; gap:30px;">
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.partner?.last3Months || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">파트너사</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:2.5em; font-weight:300;">${summary.mou?.franchiseHQ?.last3Months || 0}</div>
              <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase;">본사</div>
            </div>
          </div>
        </div>
        <!-- 초기 안착률 -->
        <div class="tile tile-red">
          <h3 style="margin-bottom:20px;">초기 안착률 (3개월)</h3>
          <div style="display:flex; gap:25px; flex-wrap:wrap;">
            <div style="text-align:center;">
              <div style="font-size:2.2em; font-weight:300;">${summary.mou?.onboarding?.partner?.rate || 0}%</div>
              <div style="font-size:0.8em; opacity:0.85; text-transform:uppercase;">파트너사 (${summary.mou?.onboarding?.partner?.settled || 0}/${summary.mou?.onboarding?.partner?.total || 0})</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:2.2em; font-weight:300;">${summary.mou?.onboarding?.franchiseBrand?.rate || 0}%</div>
              <div style="font-size:0.8em; opacity:0.85; text-transform:uppercase;">브랜드 (${summary.mou?.onboarding?.franchiseBrand?.settled || 0}/${summary.mou?.onboarding?.franchiseBrand?.total || 0})</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 이번 달 MOU 체결 상세 -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        <!-- 이번 달 MOU 체결 파트너사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 MOU 체결 파트너사 (${mouStats?.partner?.thisMonthList?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>파트너명</th><th>담당자</th><th class="text-center">MOU시작</th><th class="text-center">Lead</th><th class="text-center">안착</th></tr>
            </thead>
            <tbody>
              ${(mouStats?.partner?.thisMonthList || []).map(renderMOUPartnerRow).join('') || '<tr><td colspan="5" class="text-center">-</td></tr>'}
            </tbody>
          </table>
        </div>
        <!-- 이번 달 MOU 체결 프랜차이즈 본사 -->
        <div>
          <h4 style="margin-bottom:15px;">이번 달 MOU 체결 프랜차이즈 본사 (${mouStats?.franchiseHQ?.thisMonthList?.length || 0}개)</h4>
          <table>
            <thead>
              <tr><th>본사명</th><th>담당자</th><th class="text-center">MOU시작</th><th class="text-center">Lead</th><th class="text-center">안착</th></tr>
            </thead>
            <tbody>
              ${(mouStats?.franchiseHQ?.thisMonthList || []).map(renderMOUHQRow).join('') || '<tr><td colspan="5" class="text-center">-</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 미안착 파트너사/브랜드 -->
      ${(() => {
        const unsettledPartners = mouStats?.onboarding?.partner?.list?.filter(p => !p.isSettled) || [];
        const unsettledBrands = mouStats?.onboarding?.franchiseBrand?.list?.filter(b => !b.isSettled) || [];
        if (unsettledPartners.length === 0 && unsettledBrands.length === 0) return '';
        return `
      <div style="margin-top:25px;">
        <h4 style="margin-bottom:15px; color:#e81123;">미안착 현황 - MOU 체결 후 Lead 미생산</h4>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
          <div>
            <p style="color:#888; font-size:0.9em; margin-bottom:10px;">파트너사 (${unsettledPartners.length}개)</p>
            <table>
              <thead>
                <tr><th>파트너명</th><th>담당자</th><th class="text-center">MOU시작</th><th class="text-center">안착기한</th></tr>
              </thead>
              <tbody>
                ${unsettledPartners.map(p => `
                <tr style="background:#3d2d2d;">
                  <td>${p.name}</td>
                  <td>${p.owner}</td>
                  <td class="text-center">${p.mouStart || '-'}</td>
                  <td class="text-center">${p.mouEndWindow || '-'}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="text-center">-</td></tr>'}
              </tbody>
            </table>
          </div>
          <div>
            <p style="color:#888; font-size:0.9em; margin-bottom:10px;">프랜차이즈 브랜드 (${unsettledBrands.length}개)</p>
            <table>
              <thead>
                <tr><th>브랜드명</th><th>본사명</th><th class="text-center">MOU시작</th><th class="text-center">안착기한</th></tr>
              </thead>
              <tbody>
                ${unsettledBrands.slice(0, 15).map(b => `
                <tr style="background:#3d2d2d;">
                  <td>${b.brandName}</td>
                  <td style="font-size:0.85em;">${b.hqName}</td>
                  <td class="text-center">${b.mouStart || '-'}</td>
                  <td class="text-center">${b.mouEndWindow || '-'}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="text-center">-</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
      })()}
    </div>

    <!-- 담당자별 Lead 현황 -->
    <div class="card">
      <h2>담당자별 Lead 현황 (${stats.kpi.thisMonth})</h2>
      <table>
        <thead>
          <tr>
            <th>담당자</th>
            <th class="text-center">파트너사</th>
            <th class="text-center">파트너 Lead</th>
            <th class="text-center">프랜차이즈</th>
            <th class="text-center">프랜차이즈 Lead</th>
            <th class="text-center">합계 Lead</th>
            <th class="text-center">전환</th>
            <th class="text-center">전환율</th>
          </tr>
        </thead>
        <tbody>
          ${ownerStats.map(o => {
            const convRate = o.totalLeads > 0 ? ((o.totalConverted / o.totalLeads) * 100).toFixed(1) : '0.0';
            return `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.partnerCount}</td>
            <td class="text-center">${o.partnerLeads}</td>
            <td class="text-center">${o.franchiseCount}</td>
            <td class="text-center">${o.franchiseLeads}</td>
            <td class="text-center" style="font-weight:600; color:#4fc3f7;">${o.totalLeads}</td>
            <td class="text-center">${o.totalConverted}</td>
            <td class="text-center" style="color:${parseFloat(convRate) >= 30 ? '#66bb6a' : '#ef5350'};">${convRate}%</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Lead 전환 분석 (NEW) -->
    ${leadProcessing ? `
    <div class="card" style="border-left-color:#00b7c3;">
      <h2 style="border-bottom-color:#00b7c3;">Lead 전환 분석 (${stats.kpi.thisMonth})</h2>
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:25px;">
        <div class="tile tile-blue">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">이번달 Lead</div>
          <div style="font-size:3em; font-weight:300;">${leadProcessing.totalLeadsInMonth}</div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">신규 생성</div>
        </div>
        <div class="tile" style="background:${parseFloat(leadProcessing.conversionRate) >= 50 ? '#107c10' : '#ff8c00'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">전환율</div>
          <div style="font-size:3em; font-weight:300;">${leadProcessing.conversionRate}%</div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">${leadProcessing.totalConverted} / ${leadProcessing.totalLeadsInMonth}건 전환</div>
        </div>
        <div class="tile tile-teal">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">평균 전환일</div>
          <div style="font-size:3em; font-weight:300;">${leadProcessing.avgConversionDays || '-'}</div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">Lead 생성 → Opp 전환</div>
        </div>
        <div class="tile tile-red">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">미전환 (14일+)</div>
          <div style="font-size:3em; font-weight:300;">${leadProcessing.unconvertedOldCount}</div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">전환 지연 Lead</div>
        </div>
      </div>

      <h4 style="margin-bottom:15px;">전환 속도 분포</h4>
      <table>
        <thead><tr><th>전환 소요일</th><th class="text-center">건수</th><th class="text-center">비율</th><th style="width:250px;">분포</th></tr></thead>
        <tbody>
          ${leadProcessing.conversionSpeedDistribution.map(r => {
            const pct = parseFloat(r.percentage);
            const barColor = r.label === '미전환' ? '#ef5350' : pct >= 20 ? '#4fc3f7' : '#66bb6a';
            return `<tr>
              <td>${r.label}</td>
              <td class="text-center">${r.count}</td>
              <td class="text-center">${r.percentage}%</td>
              <td><div style="background:#333; height:16px; width:100%;"><div style="background:${barColor}; height:100%; width:${Math.min(pct, 100)}%;"></div></div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:25px;">
        <div>
          <h4 style="margin-bottom:15px;">담당자별 전환 현황</h4>
          <table>
            <thead><tr><th>담당자</th><th class="text-center">Lead</th><th class="text-center">전환</th><th class="text-center">전환율</th><th class="text-center">평균 전환일</th></tr></thead>
            <tbody>
              ${(leadProcessing.byOwner || []).map(o => {
                const rateColor = parseFloat(o.conversionRate) >= 50 ? '#66bb6a' : parseFloat(o.conversionRate) >= 30 ? '#ffb74d' : '#ef5350';
                return `<tr>
                  <td>${o.owner}</td>
                  <td class="text-center">${o.total}</td>
                  <td class="text-center" style="color:#4fc3f7; font-weight:600;">${o.converted}</td>
                  <td class="text-center" style="color:${rateColor}; font-weight:600;">${o.conversionRate}%</td>
                  <td class="text-center">${o.avgDays}일</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div>
          <h4 style="margin-bottom:15px;">미전환 Lead (14일+, ${leadProcessing.unconvertedOldCount}건)</h4>
          <table>
            <thead><tr><th>Lead</th><th>Status</th><th>담당자</th><th class="text-center">생성일</th><th class="text-center">경과일</th></tr></thead>
            <tbody>
              ${leadProcessing.unconvertedOldLeads.map(l => `
              <tr style="background:#3d2d2d;">
                <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${l.name}</td>
                <td>${l.status}</td>
                <td>${l.owner}</td>
                <td class="text-center" style="font-size:0.85em;">${l.createdDate}</td>
                <td class="text-center" style="color:#ef5350; font-weight:600;">${l.ageDays}일</td>
              </tr>`).join('')}
              ${leadProcessing.unconvertedOldLeads.length === 0 ? '<tr><td colspan="5" class="text-center" style="color:#888;">-</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Lead → Opportunity 전환율 -->
    <div class="card">
      <h2>Lead → Opportunity 전환율 (${stats.kpi.thisMonth})</h2>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:20px;">
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">전체</div>
          <div style="font-size:28px; font-weight:700; color:#4fc3f7;">${conversionStats.total.rate}%</div>
          <div style="color:#888; font-size:12px; margin-top:4px;">${conversionStats.total.converted} / ${conversionStats.total.leads}건</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">파트너사</div>
          <div style="font-size:28px; font-weight:700; color:#81c784;">${conversionStats.partner.rate}%</div>
          <div style="color:#888; font-size:12px; margin-top:4px;">${conversionStats.partner.converted} / ${conversionStats.partner.leads}건</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">프랜차이즈</div>
          <div style="font-size:28px; font-weight:700; color:#ffb74d;">${conversionStats.franchise.rate}%</div>
          <div style="color:#888; font-size:12px; margin-top:4px;">${conversionStats.franchise.converted} / ${conversionStats.franchise.leads}건</div>
        </div>
      </div>
    </div>

    <!-- Opportunity Stage별 현황 -->
    <div class="card">
      <h2>Opportunity 현황</h2>
      <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:16px; margin-bottom:20px;">
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">진행 중</div>
          <div style="font-size:28px; font-weight:700; color:#4fc3f7;">${oppStageStats.openTotal}</div>
          <div style="display:flex; justify-content:center; gap:12px; margin-top:6px; border-top:1px solid #333; padding-top:6px;">
            <span style="color:#81c784; font-size:11px;">파트너 ${oppStageStats.openPartner || 0}</span>
            <span style="color:#ffb74d; font-size:11px;">프랜차이즈 ${oppStageStats.openFranchise || 0}</span>
          </div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">이번달 CW</div>
          <div style="font-size:28px; font-weight:700; color:#66bb6a;">${oppStageStats.thisMonthCW}</div>
          <div style="display:flex; justify-content:center; gap:12px; margin-top:6px;">
            <span style="color:#81c784; font-size:12px;">신규 ${oppStageStats.thisMonthCW_new || 0}</span>
            <span style="color:#aaa; font-size:12px;">이전 ${oppStageStats.thisMonthCW_old || 0}</span>
          </div>
          <div style="display:flex; justify-content:center; gap:12px; margin-top:4px; border-top:1px solid #333; padding-top:6px;">
            <span style="color:#81c784; font-size:11px;">파트너 ${oppStageStats.thisMonthCW_partner || 0}</span>
            <span style="color:#ffb74d; font-size:11px;">프랜차이즈 ${oppStageStats.thisMonthCW_franchise || 0}</span>
          </div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">이번달 CL</div>
          <div style="font-size:28px; font-weight:700; color:#ef5350;">${oppStageStats.thisMonthCL}</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">Win Rate</div>
          <div style="font-size:28px; font-weight:700; color:${parseFloat(oppStageStats.winRate) >= 50 ? '#66bb6a' : '#ef5350'};">${oppStageStats.winRate}%</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">신규 전환율</div>
          <div style="font-size:28px; font-weight:700; color:#ba68c8;">${oppStageStats.thisMonthCW_new && (oppStageStats.thisMonthCW_new + oppStageStats.openTotal) > 0 ? ((oppStageStats.thisMonthCW_new / (oppStageStats.thisMonthCW_new + oppStageStats.openTotal)) * 100).toFixed(1) : '0.0'}%</div>
          <div style="color:#888; font-size:11px; margin-top:4px;">CW/(CW+Open)</div>
        </div>
      </div>
      ${oppStageStats.stageDistribution.length > 0 ? `
      <h3 style="color:#ccc; margin:16px 0 10px;">Stage별 분포 (Open)</h3>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th class="text-center">건수</th>
            <th class="text-center">비율</th>
          </tr>
        </thead>
        <tbody>
          ${oppStageStats.stageDistribution.map(s => {
            const pct = oppStageStats.openTotal > 0 ? ((s.count / oppStageStats.openTotal) * 100).toFixed(1) : '0.0';
            return `
          <tr>
            <td>${s.stage}</td>
            <td class="text-center">${s.count}</td>
            <td class="text-center">${pct}%</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
      ` : ''}
    </div>

    <!-- Opp 파이프라인 심층 분석 (NEW) -->
    ${oppDeepDive ? `
    <div class="card" style="border-left-color:#e81123;">
      <h2 style="border-bottom-color:#e81123;">Opportunity 파이프라인 심층 분석 (${stats.kpi.thisMonth})</h2>
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:25px;">
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">Open Opp</div>
          <div style="font-size:28px; font-weight:700; color:#4fc3f7;">${oppStageStats.openTotal}</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">평균 CW 소요일</div>
          <div style="font-size:28px; font-weight:700; color:#66bb6a;">${oppDeepDive.avgOppToCWDays || '-'}</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">정체 Opp (14일+)</div>
          <div style="font-size:28px; font-weight:700; color:#ef5350;">${oppDeepDive.staleOppCount}</div>
        </div>
        <div style="background:#1e1e2e; border-radius:10px; padding:18px; text-align:center;">
          <div style="color:#aaa; font-size:13px; margin-bottom:6px;">Closed Lost</div>
          <div style="font-size:28px; font-weight:700; color:#ff8c00;">${oppDeepDive.totalClosedLost}</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:25px;">
        <div>
          <h4 style="margin-bottom:15px;">Open Opp 경과일 분포</h4>
          <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px;">
            ${oppDeepDive.oppAgeDistribution.map((b, i) => {
              const colors = ['#4fc3f7', '#81c784', '#ffb74d', '#ef5350'];
              return `<div style="background:${colors[i]}22; border:1px solid ${colors[i]}44; border-radius:8px; padding:15px; text-align:center;">
                <div style="font-size:24px; font-weight:700; color:${colors[i]};">${b.count}</div>
                <div style="font-size:12px; color:#aaa; margin-top:4px;">${b.label}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div>
          <h4 style="margin-bottom:15px;">Loss Reason 분석 (CL ${oppDeepDive.totalClosedLost}건)</h4>
          <table>
            <thead><tr><th>사유</th><th class="text-center">건수</th><th class="text-center">비율</th><th>주요 담당자</th></tr></thead>
            <tbody>
              ${oppDeepDive.lossReasonBreakdown.slice(0, 10).map(r => `
              <tr>
                <td>${r.reason}</td>
                <td class="text-center">${r.count}</td>
                <td class="text-center">${r.percentage}%</td>
                <td style="font-size:0.85em; color:#aaa;">${r.topOwners.map(o => o.owner + '(' + o.count + ')').join(', ')}</td>
              </tr>`).join('')}
              ${oppDeepDive.lossReasonBreakdown.length === 0 ? '<tr><td colspan="4" class="text-center" style="color:#888;">-</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
        <div>
          <h4 style="margin-bottom:15px;">담당자별 Open Opp Stage 분포</h4>
          <table>
            <thead><tr><th>담당자</th><th class="text-center">합계</th>${(() => {
              const stageSet = new Set();
              (oppDeepDive.oppStageByOwner || []).forEach(o => o.stages.forEach(s => stageSet.add(s.stage)));
              return [...stageSet].slice(0, 6).map(s => '<th class="text-center" style="font-size:0.75em;">' + s + '</th>').join('');
            })()}</tr></thead>
            <tbody>
              ${(oppDeepDive.oppStageByOwner || []).map(o => {
                const stageSet = new Set();
                (oppDeepDive.oppStageByOwner || []).forEach(o2 => o2.stages.forEach(s => stageSet.add(s.stage)));
                const stageCols = [...stageSet].slice(0, 6).map(s => {
                  const found = o.stages.find(st => st.stage === s);
                  return '<td class="text-center">' + (found ? found.count : 0) + '</td>';
                }).join('');
                return '<tr><td>' + o.owner + '</td><td class="text-center" style="font-weight:600; color:#4fc3f7;">' + o.total + '</td>' + stageCols + '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>
        <div>
          <h4 style="margin-bottom:15px;">정체 Opp (14일+ 활동 없음, ${oppDeepDive.staleOppCount}건)</h4>
          <table>
            <thead><tr><th>Opp</th><th>Stage</th><th>담당자</th><th class="text-center">생성일</th><th class="text-center">경과일</th></tr></thead>
            <tbody>
              ${oppDeepDive.staleOpps.map(o => `
              <tr style="background:#3d2d2d;">
                <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${o.name}</td>
                <td style="font-size:0.85em;">${o.stageName}</td>
                <td>${o.owner}</td>
                <td class="text-center" style="font-size:0.85em;">${o.createdDate}</td>
                <td class="text-center" style="color:#ef5350; font-weight:600;">${o.ageDays}일</td>
              </tr>`).join('')}
              ${oppDeepDive.staleOpps.length === 0 ? '<tr><td colspan="5" class="text-center" style="color:#888;">-</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- 담당자별 파이프라인 -->
    <div class="card">
      <h2>담당자별 파이프라인 (${stats.kpi.thisMonth})</h2>
      <table>
        <thead>
          <tr>
            <th>담당자</th>
            <th class="text-center">이번달 Lead</th>
            <th class="text-center">전환</th>
            <th class="text-center">Open Opp</th>
            <th class="text-center">CW</th>
            <th class="text-center">CL</th>
            <th class="text-center">Win Rate</th>
          </tr>
        </thead>
        <tbody>
          ${ownerPipelineStats.map(o => {
            const closed = o.cwThisMonth + o.clThisMonth;
            const wr = closed > 0 ? ((o.cwThisMonth / closed) * 100).toFixed(1) : '-';
            return `
          <tr>
            <td>${o.name}</td>
            <td class="text-center">${o.leadsThisMonth}</td>
            <td class="text-center">${o.leadsConverted}</td>
            <td class="text-center" style="color:#4fc3f7; font-weight:600;">${o.openOpps}</td>
            <td class="text-center" style="color:#66bb6a; font-weight:600;">${o.cwThisMonth}</td>
            <td class="text-center" style="color:#ef5350;">${o.clThisMonth}</td>
            <td class="text-center" style="color:${wr !== '-' && parseFloat(wr) >= 50 ? '#66bb6a' : '#ef5350'};">${wr === '-' ? '-' : wr + '%'}</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Task 활동 분석 (NEW) -->
    ${taskAnalysis ? `
    <div class="card" style="border-left-color:#8661c5;">
      <h2 style="border-bottom-color:#8661c5;">Task 활동 분석 (${taskAnalysis.thisMonth})</h2>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:25px;">
        <div class="tile tile-purple">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">총 Task</div>
          <div style="font-size:3em; font-weight:300;">${taskAnalysis.totalTasksThisMonth}</div>
        </div>
        <div class="tile" style="background:${parseFloat(taskAnalysis.teamCompletionRate) >= 80 ? '#107c10' : '#ff8c00'};">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">완료율</div>
          <div style="font-size:3em; font-weight:300;">${taskAnalysis.teamCompletionRate}%</div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">${taskAnalysis.totalCompleted} / ${taskAnalysis.totalTasksThisMonth}</div>
        </div>
        <div class="tile tile-red">
          <div style="font-size:0.85em; opacity:0.85; text-transform:uppercase; margin-bottom:10px;">지연 Task</div>
          <div style="font-size:3em; font-weight:300;">${taskAnalysis.totalOverdue}</div>
          <div style="font-size:0.85em; opacity:0.7; margin-top:5px;">기한 초과 미완료</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 2fr; gap:20px;">
        <div>
          <h4 style="margin-bottom:15px;">Task Type 분포</h4>
          <table>
            <thead><tr><th>Type</th><th class="text-center">건수</th><th class="text-center">비율</th></tr></thead>
            <tbody>
              ${taskAnalysis.teamTypeDistribution.map(t => {
                const pct = taskAnalysis.totalTasksThisMonth > 0 ? ((t.count / taskAnalysis.totalTasksThisMonth) * 100).toFixed(1) : '0.0';
                return `<tr><td>${t.type}</td><td class="text-center">${t.count}</td><td class="text-center">${pct}%</td></tr>`;
              }).join('')}
              ${taskAnalysis.teamTypeDistribution.length === 0 ? '<tr><td colspan="3" class="text-center" style="color:#888;">-</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        <div>
          <h4 style="margin-bottom:15px;">담당자별 Task 활동</h4>
          <table>
            <thead><tr><th>담당자</th><th class="text-center">Task</th><th class="text-center">완료</th><th class="text-center">미완료</th><th class="text-center">지연</th><th class="text-center">완료율</th><th class="text-center">일평균</th></tr></thead>
            <tbody>
              ${taskAnalysis.byOwner.map(o => `
              <tr>
                <td>${o.name}</td>
                <td class="text-center" style="font-weight:600; color:#4fc3f7;">${o.tasksThisMonth}</td>
                <td class="text-center" style="color:#66bb6a;">${o.completed}</td>
                <td class="text-center">${o.notCompleted}</td>
                <td class="text-center" style="color:${o.overdue > 0 ? '#ef5350' : '#888'};">${o.overdue}</td>
                <td class="text-center" style="color:${parseFloat(o.completionRate) >= 80 ? '#66bb6a' : '#ef5350'};">${o.completionRate}%</td>
                <td class="text-center">${o.dailyAvg}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ` : ''}

  </div>
</body>
</html>`;

  const filename = `ChannelSales_Report_${reportMonth.replace(/-/g, '')}.html`;
  fs.writeFileSync(filename, html);
  console.log(`\n📄 HTML 리포트 생성: ${filename} (${reportMonth})`);
  return filename;
}

// ============================================
// JSON 생성
// ============================================
function generateJSON(stats) {
  const now = new Date().toISOString().split('T')[0];

  const jsonData = {
    generatedAt: new Date().toISOString(),
    summary: {
      ...stats.summary,
      // LeadSource 기반 통계 간소화
      partnerLeads: {
        total: stats.summary.partnerLeads.total,
        converted: stats.summary.partnerLeads.converted,
        conversionRate: stats.summary.partnerLeads.conversionRate
      },
      franchiseLeads: {
        total: stats.summary.franchiseLeads.total,
        converted: stats.summary.franchiseLeads.converted,
        conversionRate: stats.summary.franchiseLeads.conversionRate
      },
      // 활동 현황
      activity: stats.summary.activity
    },
    // 파트너사 현황
    partners: stats.partnerStats.map(p => ({
      id: p.id,
      name: p.name,
      owner: p.owner,
      progress: p.progress,
      mouStart: p.mouStart,
      mouEnd: p.mouEnd,
      // Lead 정보
      leads: {
        partnerLead: p.partnerLeadCount,
        partnerLeadConverted: p.partnerLeadConverted,
        franchiseLead: p.franchiseLeadCount,
        franchiseLeadConverted: p.franchiseLeadConverted,
        total: p.sourceLeadCount,
        converted: p.sourceLeadConverted,
        conversionRate: p.sourceLeadConversionRate
      },
      // 활동 정보
      activity: {
        thisMonthLeadCount: p.thisMonthLeadCount,
        last3MonthLeadCount: p.last3MonthLeadCount,
        lastLeadDate: p.lastLeadDate,
        isActiveThisMonth: p.isActiveThisMonth,
        isActiveLast3Months: p.isActiveLast3Months
      },
      referredStoreCount: p.referredStoreCount,
      oppCount: p.oppCount,
      oppWon: p.oppWon
    })),
    // 프랜차이즈 본사 → 브랜드 현황
    franchiseHQ: stats.franchiseHQList.map(hq => ({
      hqId: hq.hqId,
      hqName: hq.hqName,
      owner: hq.owner,
      progress: hq.progress,
      mouStart: hq.mouStart,
      mouEnd: hq.mouEnd,
      totalStores: hq.totalStores,
      // 본사 Lead 합계
      leads: {
        total: hq.totalLeads,
        converted: hq.totalConverted,
        conversionRate: hq.conversionRate
      },
      // 활동 정보
      activity: {
        thisMonthLeadCount: hq.thisMonthLeadCount,
        last3MonthLeadCount: hq.last3MonthLeadCount,
        lastLeadDate: hq.lastLeadDate,
        isActiveThisMonth: hq.isActiveThisMonth,
        isActiveLast3Months: hq.isActiveLast3Months
      },
      brandCount: hq.brands.length,
      brands: hq.brands.map(b => ({
        id: b.id,
        brandName: b.brandName,
        owner: b.owner,
        storeCount: b.storeCount,
        // 브랜드 Lead 정보
        leads: {
          total: b.leadCount,
          converted: b.leadConverted,
          open: b.leadOpen,
          conversionRate: b.conversionRate
        },
        // 활동 정보
        activity: {
          thisMonthLeadCount: b.thisMonthLeadCount,
          last3MonthLeadCount: b.last3MonthLeadCount,
          lastLeadDate: b.lastLeadDate
        }
      }))
    })),
    // 활동 중인 파트너사/본사 목록
    activePartners: {
      thisMonth: (stats.activePartnerThisMonth || []).map(p => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        thisMonthLeadCount: p.thisMonthLeadCount,
        last3MonthLeadCount: p.last3MonthLeadCount,
        lastLeadDate: p.lastLeadDate
      })),
      last3Months: (stats.activePartnerLast3Months || []).map(p => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        thisMonthLeadCount: p.thisMonthLeadCount,
        last3MonthLeadCount: p.last3MonthLeadCount,
        lastLeadDate: p.lastLeadDate
      }))
    },
    activeFranchiseHQ: {
      thisMonth: (stats.activeHQThisMonth || []).map(hq => ({
        hqId: hq.hqId,
        hqName: hq.hqName,
        owner: hq.owner,
        thisMonthLeadCount: hq.thisMonthLeadCount,
        last3MonthLeadCount: hq.last3MonthLeadCount,
        lastLeadDate: hq.lastLeadDate
      })),
      last3Months: (stats.activeHQLast3Months || []).map(hq => ({
        hqId: hq.hqId,
        hqName: hq.hqName,
        owner: hq.owner,
        thisMonthLeadCount: hq.thisMonthLeadCount,
        last3MonthLeadCount: hq.last3MonthLeadCount,
        lastLeadDate: hq.lastLeadDate
      }))
    },
    // MOU 체결 현황 및 초기 안착률
    mou: {
      thisMonth: stats.mouStats?.thisMonth,
      threeMonthsAgo: stats.mouStats?.threeMonthsAgo,
      partner: {
        thisMonth: stats.mouStats?.partner?.thisMonth || 0,
        last3Months: stats.mouStats?.partner?.last3Months || 0,
        thisMonthList: (stats.mouStats?.partner?.thisMonthList || []).map(p => ({
          id: p.id,
          name: p.name,
          owner: p.owner,
          mouStart: p.mouStart,
          leadCount: p.sourceLeadCount || 0,
          isSettled: p.isSettled !== undefined ? p.isSettled : (p.sourceLeadCount > 0)
        }))
      },
      franchiseHQ: {
        thisMonth: stats.mouStats?.franchiseHQ?.thisMonth || 0,
        last3Months: stats.mouStats?.franchiseHQ?.last3Months || 0,
        thisMonthList: (stats.mouStats?.franchiseHQ?.thisMonthList || []).map(hq => ({
          hqId: hq.hqId,
          hqName: hq.hqName,
          owner: hq.owner,
          mouStart: hq.mouStart,
          leadCount: hq.totalLeads || 0,
          isSettled: hq.isSettled !== undefined ? hq.isSettled : (hq.totalLeads > 0)
        }))
      },
      onboarding: {
        partner: {
          total: stats.mouStats?.onboarding?.partner?.total || 0,
          settled: stats.mouStats?.onboarding?.partner?.settled || 0,
          rate: stats.mouStats?.onboarding?.partner?.rate || 0,
          unsettledList: (stats.mouStats?.onboarding?.partner?.list || []).filter(p => !p.isSettled).map(p => ({
            id: p.id,
            name: p.name,
            owner: p.owner,
            mouStart: p.mouStart,
            mouEndWindow: p.mouEndWindow
          }))
        },
        franchiseHQ: {
          total: stats.mouStats?.onboarding?.franchiseHQ?.total || 0,
          settled: stats.mouStats?.onboarding?.franchiseHQ?.settled || 0,
          rate: stats.mouStats?.onboarding?.franchiseHQ?.rate || 0,
          unsettledList: (stats.mouStats?.onboarding?.franchiseHQ?.list || []).filter(hq => !hq.isSettled).map(hq => ({
            hqId: hq.hqId,
            hqName: hq.hqName,
            owner: hq.owner,
            mouStart: hq.mouStart,
            mouEndWindow: hq.mouEndWindow
          }))
        },
        // 브랜드 단위 안착률
        franchiseBrand: {
          total: stats.mouStats?.onboarding?.franchiseBrand?.total || 0,
          settled: stats.mouStats?.onboarding?.franchiseBrand?.settled || 0,
          rate: stats.mouStats?.onboarding?.franchiseBrand?.rate || 0,
          settledList: (stats.mouStats?.onboarding?.franchiseBrand?.list || []).filter(b => b.isSettled).map(b => ({
            id: b.id,
            brandName: b.brandName,
            hqId: b.hqId,
            hqName: b.hqName,
            owner: b.owner,
            mouStart: b.mouStart,
            leadCountWithinWindow: b.leadCountWithinWindow,
            firstLeadDate: b.firstLeadDate
          })),
          unsettledList: (stats.mouStats?.onboarding?.franchiseBrand?.list || []).filter(b => !b.isSettled).map(b => ({
            id: b.id,
            brandName: b.brandName,
            hqId: b.hqId,
            hqName: b.hqName,
            owner: b.owner,
            mouStart: b.mouStart,
            mouEndWindow: b.mouEndWindow
          }))
        }
      }
    },
    // KPI
    kpi: stats.kpi ? {
      date: stats.kpi.date,
      thisMonth: stats.kpi.thisMonth,
      thisMonthDays: stats.kpi.thisMonthDays,
      bd: {
        mouNewThisMonth: stats.kpi.bd.mouNewThisMonth.value,
        mouNewTarget: stats.kpi.bd.mouNewThisMonth.target,
        negoEntryThisMonth: stats.kpi.bd.negoEntryThisMonth.value,
        negoTotal: stats.kpi.bd.negoEntryThisMonth.total,
        negoTarget: stats.kpi.bd.negoEntryThisMonth.target,
        meetingsIncompleteToday: stats.kpi.bd.meetingsIncompleteToday.value,
        meetingsIncompleteDailyAvg: parseFloat(stats.kpi.bd.meetingsIncompleteAvg.value),
        meetingsIncompleteThisMonth: stats.kpi.bd.meetingsIncompleteThisMonth.value,
        meetingsIncompleteTarget: stats.kpi.bd.meetingsIncompleteToday.target
      },
      am: {
        leadsToday: stats.kpi.am.leadsToday.value,
        leadsDailyAvg: stats.kpi.am.leadsDailyAvg.value,
        leadsThisMonth: stats.kpi.am.leadsThisMonth.value,
        leadsTarget: stats.kpi.am.leadsToday.target,
        meetingsCompleteToday: stats.kpi.am.meetingsCompleteToday.value,
        meetingsCompleteDailyAvg: parseFloat(stats.kpi.am.meetingsCompleteAvg.value),
        meetingsCompleteThisMonth: stats.kpi.am.meetingsCompleteThisMonth.value,
        meetingsCompleteTarget: stats.kpi.am.meetingsCompleteToday.target,
        onboardingRate: stats.kpi.am.onboardingRate.value,
        onboardingSettled: stats.kpi.am.onboardingRate.settled,
        onboardingTotal: stats.kpi.am.onboardingRate.total,
        onboardingTarget: stats.kpi.am.onboardingRate.target,
        activeChannels90d: stats.kpi.am.activeChannels90d.value,
        activePartners90d: stats.kpi.am.activeChannels90d.partners,
        activeHQ90d: stats.kpi.am.activeChannels90d.hq,
        activeTarget: stats.kpi.am.activeChannels90d.target
      },
      meetingsByOwner: stats.kpi.meetingsByOwner
    } : null
  };

  const filename = `ChannelSales_Report_${now.replace(/-/g, '')}.json`;
  fs.writeFileSync(filename, JSON.stringify(jsonData, null, 2));
  console.log(`\n📄 JSON 데이터 생성: ${filename}`);
  return filename;
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const generateJson = process.argv.includes('--json');

  // 월 지정 인자 파싱 (예: 2026-02)
  const monthArg = process.argv.find(arg => /^\d{4}-\d{2}$/.test(arg));
  let targetMonth;

  if (monthArg) {
    targetMonth = monthArg;
    console.log(`\n📅 지정 월: ${targetMonth}`);
  } else {
    targetMonth = new Date().toISOString().substring(0, 7);
    console.log(`\n📅 현재 월: ${targetMonth}`);
  }

  console.log('📊 채널세일즈 리포트 생성 시작...\n');

  try {
    const data = await collectChannelData(targetMonth);

    // Contracts API에서 계약 데이터 가져오기 (계약 시작일 기준)
    const contracts = await fetchContracts(targetMonth);
    console.log(`📋 계약 데이터 (계약시작일 기준): ${contracts.length}건`);
    data.contracts = contracts;

    const stats = calculateStats(data, targetMonth);

    // HTML 생성 (기본)
    const filename = generateHTML(stats, targetMonth);
    console.log(`\n🌐 브라우저에서 열기: open ${filename}`);

    // JSON 생성 (옵션)
    if (generateJson) {
      generateJSON(stats);
    }

  } catch (err) {
    console.error('❌ 에러:', err.message);
    if (err.response) console.error('   상세:', err.response.data);
  }
}

main();