/**
 * Salesforce 연결 및 데이터 수집 모듈
 */
const axios = require('axios');

// Salesforce 인증
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

// SOQL 쿼리 실행
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

// 채널 데이터 수집
async function collectChannelData(targetMonth = null) {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('✅ Salesforce 연결 성공');

  // targetMonth 기준으로 조회 기간 계산 (90일 = 약 3개월)
  let activityEndDate, activityStartDate;
  if (targetMonth) {
    const [year, month] = targetMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    activityEndDate = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
    const startDate = new Date(year, month - 4, 1);
    activityStartDate = startDate.toISOString().substring(0, 10);
  } else {
    const now = new Date();
    activityEndDate = now.toISOString().substring(0, 10);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 90);
    activityStartDate = startDate.toISOString().substring(0, 10);
  }

  // 1. 파트너사 Account 조회
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

  const totalReferredStores = partners.reduce((sum, p) => {
    const stores = p.AccountPartners__r?.records || [];
    return sum + stores.length;
  }, 0);
  console.log(`🏪 소개매장 (파트너사): ${totalReferredStores}건`);

  // 2. 프랜차이즈 본사 Account 조회
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

  // 3. 프랜차이즈 브랜드 Account 조회
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

  // 4. 가맹점 조회
  const brandIds = franchiseBrands.map(b => b.Id);
  let franchiseStores = [];
  if (brandIds.length > 0) {
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

  // 브랜드별 가맹점 그룹핑
  const storesByBrand = new Map();
  brandIds.forEach(id => storesByBrand.set(id, []));
  franchiseStores.forEach(store => {
    const brandId = store.FRBrand__c;
    if (storesByBrand.has(brandId)) {
      storesByBrand.get(brandId).push(store);
    }
  });

  // 본사별 브랜드 그룹핑
  const franchiseHQMap = new Map();

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

  franchiseBrands.forEach(brand => {
    const hqId = brand.FRHQ__c || '__NO_HQ__';
    const storeCount = (storesByBrand.get(brand.Id) || []).length;

    if (!franchiseHQMap.has(hqId)) {
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

  const franchiseHQList = Array.from(franchiseHQMap.values())
    .filter(hq => hq.brands.length > 0)
    .sort((a, b) => b.totalStores - a.totalStores);

  // 5. Lead 조회
  let leads = [];
  try {
    const leadQueryWithPartner = `
      SELECT
        Id, Name, LastName, Company, Status,
        Partner__c, Partner__r.Name, PartnerName__c,
        LeadSource, CreatedDate, OwnerId, Owner.Name,
        ConvertedOpportunityId, ConvertedAccountId, IsConverted
      FROM Lead
      WHERE Partner__c != null OR PartnerName__c != null
      ORDER BY CreatedDate DESC
    `;
    leads = await soqlQueryAll(instanceUrl, accessToken, leadQueryWithPartner);
    console.log(`📋 채널 관련 Lead (Partner__c 사용): ${leads.length}건`);
  } catch (err) {
    console.log('⚠️ Partner__c 필드 없음, PartnerName__c로 조회');
    const leadQueryFallback = `
      SELECT
        Id, Name, LastName, Company, Status,
        PartnerName__c,
        LeadSource, CreatedDate, OwnerId, Owner.Name,
        ConvertedOpportunityId, ConvertedAccountId, IsConverted
      FROM Lead
      WHERE PartnerName__c != null
      ORDER BY CreatedDate DESC
    `;
    leads = await soqlQueryAll(instanceUrl, accessToken, leadQueryFallback);
    console.log(`📋 채널 관련 Lead (PartnerName__c): ${leads.length}건`);
  }

  // 6. LeadSource 기반 채널 Lead 조회 (FRT 계산용 Task 포함)
  let channelLeads = [];
  try {
    const channelLeadQueryWithPartner = `
      SELECT
        Id, Name, LastName, Company, Status,
        Partner__c, PartnerName__c, BrandName__c,
        LeadSource, CreatedDate, CreatedTime__c, OwnerId, Owner.Name,
        ConvertedOpportunityId, ConvertedAccountId, ConvertedContactId, IsConverted,
        LossReason__c, LossReason_Contract__c,
        (SELECT Id, Subject, CreatedDate, CreatedBy.Name FROM Tasks ORDER BY CreatedDate ASC LIMIT 5)
      FROM Lead
      WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
      ORDER BY LeadSource, CreatedDate DESC
    `;
    channelLeads = await soqlQueryAll(instanceUrl, accessToken, channelLeadQueryWithPartner);
  } catch (err) {
    const channelLeadQueryFallback = `
      SELECT
        Id, Name, LastName, Company, Status,
        PartnerName__c, BrandName__c,
        LeadSource, CreatedDate, CreatedTime__c, OwnerId, Owner.Name,
        ConvertedOpportunityId, ConvertedAccountId, ConvertedContactId, IsConverted,
        LossReason__c, LossReason_Contract__c,
        (SELECT Id, Subject, CreatedDate, CreatedBy.Name FROM Tasks ORDER BY CreatedDate ASC LIMIT 5)
      FROM Lead
      WHERE LeadSource IN ('파트너사 소개', '프랜차이즈소개')
      ORDER BY LeadSource, CreatedDate DESC
    `;
    channelLeads = await soqlQueryAll(instanceUrl, accessToken, channelLeadQueryFallback);
    console.log('⚠️ channelLeadQuery: Partner__c 필드 없음, PartnerName__c로 폴백');
  }

  const partnerSourceLeads = channelLeads.filter(l => l.LeadSource === '파트너사 소개');
  const franchiseSourceLeads = channelLeads.filter(l => l.LeadSource === '프랜차이즈소개');
  console.log(`📋 LeadSource 기반 - 파트너사 소개: ${partnerSourceLeads.length}건, 프랜차이즈소개: ${franchiseSourceLeads.length}건`);

  // 전환된 Lead의 Contact Task 조회 (FRT 계산용)
  const convertedContactIds = channelLeads
    .filter(l => l.IsConverted && l.ConvertedContactId)
    .map(l => l.ConvertedContactId);

  let contactTasksMap = new Map();
  if (convertedContactIds.length > 0) {
    // Contact ID를 100개씩 나눠서 조회 (SOQL IN절 제한)
    const chunkSize = 100;
    for (let i = 0; i < convertedContactIds.length; i += chunkSize) {
      const chunk = convertedContactIds.slice(i, i + chunkSize);
      const contactTaskQuery = `
        SELECT Id, Subject, CreatedDate, CreatedBy.Name, WhoId
        FROM Task
        WHERE WhoId IN ('${chunk.join("','")}')
          AND CreatedDate >= ${activityStartDate}T00:00:00Z
        ORDER BY CreatedDate ASC
      `;
      const contactTasks = await soqlQueryAll(instanceUrl, accessToken, contactTaskQuery);
      contactTasks.forEach(task => {
        const whoId = task.WhoId;
        if (!contactTasksMap.has(whoId)) {
          contactTasksMap.set(whoId, []);
        }
        contactTasksMap.get(whoId).push(task);
      });
    }
    console.log(`📋 전환된 Contact Task: ${Array.from(contactTasksMap.values()).reduce((sum, arr) => sum + arr.length, 0)}건 (${convertedContactIds.length}개 Contact)`);
  }

  // 6-2. 전환된 Lead의 Account Case 조회 (초기 장애 분석용)
  const convertedAccountIds = channelLeads
    .filter(l => l.IsConverted && l.ConvertedAccountId)
    .map(l => l.ConvertedAccountId);
  const uniqueConvertedAccountIds = [...new Set(convertedAccountIds)];

  let channelCaseMap = new Map(); // AccountId → Case[]
  if (uniqueConvertedAccountIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < uniqueConvertedAccountIds.length; i += chunkSize) {
      const chunk = uniqueConvertedAccountIds.slice(i, i + chunkSize);
      const caseQuery = `
        SELECT Id, AccountId, CaseNumber, Subject, Status, Type, Type2__c, Type3__c,
               CreatedDate, ClosedDate, CaseLeadtime__c
        FROM Case
        WHERE AccountId IN ('${chunk.join("','")}')
          AND CreatedDate >= ${activityStartDate}T00:00:00Z
        ORDER BY CreatedDate DESC
      `;
      try {
        const cases = await soqlQueryAll(instanceUrl, accessToken, caseQuery);
        cases.forEach(c => {
          const accId = c.AccountId;
          if (!channelCaseMap.has(accId)) channelCaseMap.set(accId, []);
          channelCaseMap.get(accId).push(c);
        });
      } catch (err) {
        console.log(`⚠️ Case 조회 오류 (chunk ${i}): ${err.message}`);
      }
    }
    const totalCases = Array.from(channelCaseMap.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`📋 전환 매장 Case: ${totalCases}건 (${channelCaseMap.size}개 Account)`);
  }

  // 6-3. AccountPartner__c 기반 파트너사별 소개 매장 조회 (Lead PartnerName__c와 별개)
  const allPartnerIds = partners.map(p => p.Id);
  let partnerReferredStores = new Map(); // PartnerId → [{storeId, storeName, createdDate, cases}]
  if (allPartnerIds.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < allPartnerIds.length; i += chunkSize) {
      const chunk = allPartnerIds.slice(i, i + chunkSize);
      const storeQuery = `
        SELECT Id, Name, AccountPartner__c, AccountPartner__r.Name, CreatedDate
        FROM Account
        WHERE AccountPartner__c IN ('${chunk.join("','")}')
          AND fm_AccountType__c = '일반매장'
        ORDER BY CreatedDate DESC
      `;
      try {
        const stores = await soqlQueryAll(instanceUrl, accessToken, storeQuery);
        stores.forEach(s => {
          const partnerId = s.AccountPartner__c;
          if (!partnerReferredStores.has(partnerId)) partnerReferredStores.set(partnerId, []);
          partnerReferredStores.get(partnerId).push({
            storeId: s.Id,
            storeName: s.Name,
            createdDate: s.CreatedDate?.substring(0, 10),
            partnerId,
            partnerName: s.AccountPartner__r?.Name || '-'
          });
        });
      } catch (err) {
        console.log(`⚠️ AccountPartner 매장 조회 오류 (chunk ${i}): ${err.message}`);
      }
    }
    const totalStores = Array.from(partnerReferredStores.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`🏪 AccountPartner__c 기반 소개 매장: ${totalStores}건 (${partnerReferredStores.size}개 파트너)`);

    // 소개 매장의 Case 조회
    const allStoreIds = Array.from(partnerReferredStores.values()).flat().map(s => s.storeId);
    const uniqueStoreIds = [...new Set(allStoreIds)];
    if (uniqueStoreIds.length > 0) {
      for (let i = 0; i < uniqueStoreIds.length; i += chunkSize) {
        const chunk = uniqueStoreIds.slice(i, i + chunkSize);
        const caseQuery = `
          SELECT Id, AccountId, CaseNumber, Subject, Status, Type, Type2__c, Type3__c,
                 CreatedDate, ClosedDate, CaseLeadtime__c
          FROM Case
          WHERE AccountId IN ('${chunk.join("','")}')
            AND CreatedDate >= ${activityStartDate}T00:00:00Z
          ORDER BY CreatedDate DESC
        `;
        try {
          const cases = await soqlQueryAll(instanceUrl, accessToken, caseQuery);
          cases.forEach(c => {
            const accId = c.AccountId;
            if (!channelCaseMap.has(accId)) channelCaseMap.set(accId, []);
            // Avoid duplicates if already in map
            if (!channelCaseMap.get(accId).find(existing => existing.Id === c.Id)) {
              channelCaseMap.get(accId).push(c);
            }
          });
        } catch (err) {
          console.log(`⚠️ 소개매장 Case 조회 오류 (chunk ${i}): ${err.message}`);
        }
      }
      const storeCaseTotal = uniqueStoreIds.reduce((sum, id) => sum + (channelCaseMap.get(id) || []).length, 0);
      console.log(`📋 소개매장 Case: ${storeCaseTotal}건 (${uniqueStoreIds.length}개 매장)`);
    }
  }

  // 7. SQL 파이프라인용 Opportunity 조회 (전환된 채널 Lead)
  const convertedOppIds = channelLeads
    .filter(l => l.IsConverted && l.ConvertedOpportunityId)
    .map(l => l.ConvertedOpportunityId);

  let channelLeadOpportunities = [];
  if (convertedOppIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < convertedOppIds.length; i += chunkSize) {
      const chunk = convertedOppIds.slice(i, i + chunkSize);
      const oppIds = chunk.map(id => `'${id}'`).join(',');
      const oppQuery = `
        SELECT Id, Name, StageName, Amount, CloseDate, AgeInDays,
               AccountId, Account.Name,
               OwnerId, Owner.Name, CreatedDate,
               IsClosed, IsWon, Loss_Reason__c
        FROM Opportunity
        WHERE Id IN (${oppIds})
      `;
      const oppResult = await soqlQuery(instanceUrl, accessToken, oppQuery);
      channelLeadOpportunities = channelLeadOpportunities.concat(oppResult.records || []);
    }
    console.log(`💼 채널 Lead 전환 Opportunity: ${channelLeadOpportunities.length}건`);
  }

  // Opportunity ID → Data 매핑
  const channelLeadOppMap = new Map();
  channelLeadOpportunities.forEach(opp => {
    channelLeadOppMap.set(opp.Id, opp);
  });

  // 8. 채널세일즈팀 User 조회
  const channelUserQuery = `SELECT Id, Name FROM User WHERE Department = '채널세일즈팀' AND IsActive = true`;
  const channelUsersResult = await soqlQuery(instanceUrl, accessToken, channelUserQuery);
  const channelUsers = channelUsersResult.records || [];
  const channelUserMap = {};
  channelUsers.forEach(u => { channelUserMap[u.Id] = u.Name; });
  console.log(`👥 채널세일즈팀 인원: ${channelUsers.length}명`);

  // 8. Opportunity 조회
  const allAccountIds = [...partners, ...franchiseBrands, ...franchiseHQAccounts].map(a => a.Id);
  let opportunities = [];

  if (allAccountIds.length > 0) {
    const oppQuery = `
      SELECT
        Id, Name, StageName, Amount, CloseDate,
        AccountId, Account.Name, Account.fm_AccountType__c,
        OwnerId, Owner.Name, CreatedDate,
        LeadSource, IsClosed, IsWon, Loss_Reason__c
      FROM Opportunity
      WHERE Account.fm_AccountType__c IN ('파트너사', '프랜차이즈본사', '브랜드')
      ORDER BY CreatedDate DESC
    `;
    opportunities = await soqlQueryAll(instanceUrl, accessToken, oppQuery);
    console.log(`💼 채널 관련 Opportunity: ${opportunities.length}건`);
  }

  // 9. Event (미팅) 조회 - 채널 Account 한정
  const channelAccountIds = new Set(allAccountIds);
  let channelEvents = [];
  for (let i = 0; i < allAccountIds.length; i += 200) {
    const batch = allAccountIds.slice(i, i + 200);
    const eventQuery = `
      SELECT
        Id, Subject, Description, WhatId, What.Name,
        OwnerId, Owner.Name,
        ActivityDate, StartDateTime, EndDateTime,
        Type, CreatedDate
      FROM Event
      WHERE WhatId IN ('${batch.join("','")}')
        AND ActivityDate >= ${activityStartDate}
        AND ActivityDate <= ${activityEndDate}
      ORDER BY ActivityDate DESC
    `;
    const batchEvents = await soqlQueryAll(instanceUrl, accessToken, eventQuery);
    channelEvents = channelEvents.concat(batchEvents);
  }
  console.log(`📅 채널 관련 Event (미팅): ${channelEvents.length}건 (${activityStartDate} ~ ${activityEndDate})`);

  // 10. Task 조회 - 채널 Account 한정
  let channelTasks = [];
  for (let i = 0; i < allAccountIds.length; i += 200) {
    const batch = allAccountIds.slice(i, i + 200);
    const taskQuery = `
      SELECT
        Id, Subject, WhatId, What.Name,
        OwnerId, Owner.Name,
        ActivityDate, Status, Type, CreatedDate
      FROM Task
      WHERE WhatId IN ('${batch.join("','")}')
        AND ActivityDate >= ${activityStartDate}
        AND ActivityDate <= ${activityEndDate}
      ORDER BY ActivityDate DESC
    `;
    const batchTasks = await soqlQueryAll(instanceUrl, accessToken, taskQuery);
    channelTasks = channelTasks.concat(batchTasks);
  }
  console.log(`📝 채널 관련 Task: ${channelTasks.length}건`);

  return {
    partners, franchiseBrands, franchiseStores, storesByBrand, franchiseHQList, franchiseHQAccounts,
    leads, opportunities,
    partnerSourceLeads, franchiseSourceLeads,
    channelEvents, channelTasks,
    channelUsers, channelUserMap,
    channelAccountIds,
    contactTasksMap,
    channelCaseMap,
    partnerReferredStores,
    channelLeadOpportunities, channelLeadOppMap
  };
}

module.exports = {
  getSalesforceToken,
  soqlQuery,
  soqlQueryAll,
  collectChannelData
};
