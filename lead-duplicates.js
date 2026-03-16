/**
 * Lead 중복 패턴 분석 & 케이스 자동 분류
 * 
 * 기존 lead-duplicates.js 확장 버전
 * - 케이스 1: 기존 고객 재문의 (Account/Contract 매칭)
 * - 케이스 2: 진행 중 재인입 (Open Lead/Opportunity 매칭)
 * - 케이스 3: 과거 CL 재문의 (Closed Lost Opportunity 매칭)
 * - 케이스 4: 장난/오인입 (Company명 패턴 필터)
 * - 미분류: 위 어디에도 해당하지 않는 순수 중복
 * 
 * 추가 분석:
 * - 중복 그룹 내 CreatedDate 간격 (재문의 패턴)
 * - Task 유무 및 응대 패턴
 * - Lead Status 분포
 * 
 * 사용법: node lead-duplicate-analysis.js YYYY-MM
 */

require('dotenv').config({ path: __dirname + '/.env' });
const axios = require('axios');
const fs = require('fs');

// ============================================================
//  공통 유틸
// ============================================================

async function soqlQueryAll(instanceUrl, accessToken, query) {
  let records = [];
  let url = instanceUrl + '/services/data/v59.0/query?q=' + encodeURIComponent(query);
  while (url) {
    const res = await axios.get(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    records = records.concat(res.data.records);
    url = res.data.nextRecordsUrl ? instanceUrl + res.data.nextRecordsUrl : null;
  }
  return records;
}

async function soqlQueryBatch(instanceUrl, accessToken, queryTemplate, values, batchSize = 150) {
  let allRecords = [];
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize);
    const inClause = batch.map(v => `'${v}'`).join(',');
    // {{IN_CLAUSE}} 가 여러 번 나올 수 있으므로 전체 치환
    const query = queryTemplate.replace(/\{\{IN_CLAUSE\}\}/g, inClause);
    try {
      const records = await soqlQueryAll(instanceUrl, accessToken, query);
      allRecords = allRecords.concat(records);
    } catch (e) {
      // 배치 실패 시 skip (정규화된 번호 불일치 등)
    }
  }
  return allRecords;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  if (digits.startsWith('82') && digits.length > 9) {
    return '0' + digits.slice(2);
  }
  return digits;
}

function getMonthRange(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const start = `${yearMonth}-01T00:00:00Z`;
  const nextMonth = month === 12
    ? `${year + 1}-01-01T00:00:00Z`
    : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00Z`;
  return { start, end: nextMonth };
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
}

function minutesBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.abs(d2 - d1) / (1000 * 60);
}

// ============================================================
//  케이스 4: 장난/오인입 필터
// ============================================================

const SPAM_PATTERNS = [
  // 비속어/장난 패턴
  /비속어/i, /장난/i, /테스트/i, /test/i, /ㅋㅋ/i, /ㅎㅎ/i,
  /fuck/i, /shit/i, /ass/i,
  // 의미없는 1~2글자 (한글)
  /^[가-힣]{1}$/,
  // 숫자만
  /^[0-9]+$/,
  // 모유수유, 성인 관련
  /모유수유/i, /섹스/i, /야동/i,
];

function isSpamCompany(company) {
  if (!company) return false;
  const trimmed = company.trim();
  if (trimmed.length === 0) return true;
  return SPAM_PATTERNS.some(p => p.test(trimmed));
}

// ============================================================
//  메인
// ============================================================

async function main() {
  const targetMonth = process.argv[2];
  if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
    console.log('사용법: node lead-duplicate-analysis.js YYYY-MM');
    console.log('예시:   node lead-duplicate-analysis.js 2026-01');
    process.exit(1);
  }

  // 인증
  const authUrl = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const auth = await axios.post(authUrl, params);
  const accessToken = auth.data.access_token;
  const instanceUrl = auth.data.instance_url;

  const { start, end } = getMonthRange(targetMonth);

  console.log(`\n================================================================`);
  console.log(`  Lead 중복 패턴 분석 & 케이스 분류: ${targetMonth}`);
  console.log(`================================================================`);

  // ────────────────────────────────────────────
  //  STEP 1: 해당 월 Lead 조회
  // ────────────────────────────────────────────
  console.log(`\n[STEP 1] 해당 월 Lead 조회 중...`);
  const leadQuery = `
    SELECT Id, Name, FirstName, LastName, Company, Email, Phone, MobilePhone,
           Status, LeadSource, Owner.Name, CreatedDate,
           IsConverted, ConvertedOpportunityId, ConvertedAccountId
    FROM Lead
    WHERE CreatedDate >= ${start}
      AND CreatedDate < ${end}
      AND CurrencyIsoCode = 'KRW'
      AND LeadSource != '아웃바운드'
  `;
  const leads = await soqlQueryAll(instanceUrl, accessToken, leadQuery);
  console.log(`  → Lead ${leads.length}건 조회 완료`);

  // 전화번호 기준 중복 그룹 생성
  const phoneGroups = {};
  leads.forEach(l => {
    const phone = normalizePhone(l.Phone);
    if (!phone) return;
    if (!phoneGroups[phone]) phoneGroups[phone] = [];
    phoneGroups[phone].push(l);
  });

  const dupGroups = Object.entries(phoneGroups)
    .filter(([, items]) => items.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  const dupPhones = dupGroups.map(([phone]) => phone);
  const totalDupRecords = dupGroups.reduce((sum, [, items]) => sum + items.length, 0);

  console.log(`  → 중복 그룹: ${dupGroups.length}개 (${totalDupRecords}건 관련)`);

  if (dupGroups.length === 0) {
    console.log('\n중복 그룹이 없습니다. 분석 종료.');
    return;
  }

  // ────────────────────────────────────────────
  //  STEP 2: 크로스 매칭용 데이터 조회
  //  전략: Contact.Phone/MobilePhone 경유 → AccountId → Contract/Opportunity
  //  (Account.Phone 직접 매칭은 비어있는 경우가 많아 Contact 경유가 핵심)
  // ────────────────────────────────────────────
  console.log(`\n[STEP 2] 크로스 매칭용 데이터 조회 중...`);

  // 2-1) Contact 매칭 (Phone, MobilePhone 양방향)
  //      SOQL IN 절은 포맷(하이픈 등) 불일치 시 매칭 실패하므로,
  //      정규화 번호 + 원본 번호 + 포맷 변환 번호 모두로 조회 후 JS에서 정규화 매칭
  console.log(`  Contact 크로스 매칭 중 (Phone + MobilePhone)...`);

  // 전화번호를 여러 포맷으로 변환하여 조회 범위 확대
  function phoneVariants(normalizedPhone) {
    const variants = [normalizedPhone];
    // 010-XXXX-XXXX
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('0')) {
      variants.push(`${normalizedPhone.slice(0,3)}-${normalizedPhone.slice(3,7)}-${normalizedPhone.slice(7)}`);
    }
    // 0XX-XXX-XXXX (지역번호)
    if (normalizedPhone.length === 10 && normalizedPhone.startsWith('0')) {
      variants.push(`${normalizedPhone.slice(0,2)}-${normalizedPhone.slice(2,5)}-${normalizedPhone.slice(5)}`);
      variants.push(`${normalizedPhone.slice(0,3)}-${normalizedPhone.slice(3,6)}-${normalizedPhone.slice(6)}`);
    }
    // 0XX-XXXX-XXXX (지역번호 11자리)
    if (normalizedPhone.length === 11 && !normalizedPhone.startsWith('010')) {
      variants.push(`${normalizedPhone.slice(0,3)}-${normalizedPhone.slice(3,7)}-${normalizedPhone.slice(7)}`);
      variants.push(`${normalizedPhone.slice(0,2)}-${normalizedPhone.slice(2,6)}-${normalizedPhone.slice(6)}`);
    }
    // 8자리 (지역번호 없는 유선)
    if (normalizedPhone.length === 8) {
      variants.push(`${normalizedPhone.slice(0,4)}-${normalizedPhone.slice(4)}`);
    }
    return variants;
  }

  // 모든 중복 번호의 모든 변환 형태를 수집
  const allPhoneVariants = [];
  dupPhones.forEach(p => {
    phoneVariants(p).forEach(v => allPhoneVariants.push(v));
  });
  // 중복 제거
  const uniqueVariants = [...new Set(allPhoneVariants)];
  console.log(`  → 조회 번호: ${dupPhones.length}개 원본 → ${uniqueVariants.length}개 변환 형태`);

  const matchedContacts = await soqlQueryBatch(instanceUrl, accessToken, `
    SELECT Id, Name, Phone, MobilePhone, Email,
           AccountId, Account.Name, Account.Phone,
           Account.Id
    FROM Contact
    WHERE (Phone IN ({{IN_CLAUSE}}) OR MobilePhone IN ({{IN_CLAUSE}}))
      AND CurrencyIsoCode = 'KRW'
  `, uniqueVariants, 100);

  // Contact → Phone 매핑 (JS 측 정규화 매칭)
  const contactByPhone = new Map(); // normalizedPhone → [contacts]
  matchedContacts.forEach(c => {
    const contactPhones = [normalizePhone(c.Phone), normalizePhone(c.MobilePhone)].filter(Boolean);
    contactPhones.forEach(cp => {
      // 중복 그룹 번호와 매칭되는지 확인
      if (dupPhones.includes(cp)) {
        if (!contactByPhone.has(cp)) contactByPhone.set(cp, []);
        contactByPhone.get(cp).push(c);
      }
    });
  });
  console.log(`  → Contact ${matchedContacts.length}건 조회, ${contactByPhone.size}개 번호 매칭`);

  // 매칭된 AccountId 수집
  const matchedAccountIds = [...new Set(matchedContacts.map(c => c.AccountId).filter(Boolean))];
  console.log(`  → 연결된 Account ${matchedAccountIds.length}개`);

  // 2-2) 매칭된 Account의 Contract 조회 (기존 고객 = 계약 존재)
  let accountContracts = new Map(); // accountId → contract info
  if (matchedAccountIds.length > 0) {
    console.log(`  Account의 Contract 조회 중...`);
    const contracts = await soqlQueryBatch(instanceUrl, accessToken, `
      SELECT Id, AccountId, Account.Name, Status, ContractNumber, StartDate, EndDate
      FROM Contract
      WHERE AccountId IN ({{IN_CLAUSE}})
      ORDER BY StartDate DESC
    `, matchedAccountIds);

    contracts.forEach(ct => {
      if (!accountContracts.has(ct.AccountId)) {
        accountContracts.set(ct.AccountId, ct); // 최신 계약만
      }
    });
    console.log(`  → Contract ${contracts.length}건 (${accountContracts.size}개 Account)`);
  }

  // Account.Phone 직접 매칭도 병행 (변환 형태 포함)
  console.log(`  Account 직접 Phone 매칭 중...`);
  const directAccounts = await soqlQueryBatch(instanceUrl, accessToken, `
    SELECT Id, Name, Phone
    FROM Account
    WHERE Phone IN ({{IN_CLAUSE}})
      AND CurrencyIsoCode = 'KRW'
  `, uniqueVariants, 100);

  const directAccountByPhone = new Map();
  directAccounts.forEach(a => {
    const phone = normalizePhone(a.Phone);
    if (phone && dupPhones.includes(phone)) directAccountByPhone.set(phone, a);
  });
  console.log(`  → Account 직접 매칭 ${directAccountByPhone.size}건`);

  // ── 통합 accountByPhone: Contact 경유 + Account 직접 ──
  const accountByPhone = new Map(); // phone → { account, contract, matchedVia }
  // Contact 경유
  for (const [phone, contacts] of contactByPhone) {
    const c = contacts[0];
    if (c.AccountId) {
      const contract = accountContracts.get(c.AccountId);
      accountByPhone.set(phone, {
        id: c.AccountId,
        name: c.Account?.Name || '(이름없음)',
        phone: c.Account?.Phone,
        contractStatus: contract?.Status || '계약 없음',
        contractNumber: contract?.ContractNumber || null,
        matchedVia: 'Contact',
        contactName: c.Name,
      });
    }
  }
  // Account 직접 (Contact 경유로 이미 잡힌 건은 덮어쓰지 않음)
  for (const [phone, a] of directAccountByPhone) {
    if (!accountByPhone.has(phone)) {
      const contract = accountContracts.get(a.Id);
      accountByPhone.set(phone, {
        id: a.Id,
        name: a.Name,
        phone: a.Phone,
        contractStatus: contract?.Status || '계약 없음',
        contractNumber: contract?.ContractNumber || null,
        matchedVia: 'Account.Phone',
      });
    }
  }
  console.log(`  → 통합 Account 매칭: ${accountByPhone.size}개 번호 (Contact 경유: ${contactByPhone.size}, Account 직접: ${directAccountByPhone.size})`);

  // 2-3) 기존 Open Lead 매칭 (해당 월 이전에 생성된 Open Lead)
  console.log(`  기존 Open Lead 조회 중...`);
  const priorOpenLeads = await soqlQueryBatch(instanceUrl, accessToken, `
    SELECT Id, Name, Company, Phone, Status, Owner.Name, CreatedDate,
           (SELECT Id, Subject, CreatedDate, Status FROM Tasks ORDER BY CreatedDate DESC LIMIT 5)
    FROM Lead
    WHERE Phone IN ({{IN_CLAUSE}})
      AND CreatedDate < ${start}
      AND IsConverted = false
      AND Status != 'Closed - Not Converted'
      AND CurrencyIsoCode = 'KRW'
  `, uniqueVariants, 100);

  // MobilePhone으로도 조회
  const priorOpenLeadsMobile = await soqlQueryBatch(instanceUrl, accessToken, `
    SELECT Id, Name, Company, Phone, MobilePhone, Status, Owner.Name, CreatedDate,
           (SELECT Id, Subject, CreatedDate, Status FROM Tasks ORDER BY CreatedDate DESC LIMIT 5)
    FROM Lead
    WHERE MobilePhone IN ({{IN_CLAUSE}})
      AND CreatedDate < ${start}
      AND IsConverted = false
      AND Status != 'Closed - Not Converted'
      AND CurrencyIsoCode = 'KRW'
  `, uniqueVariants, 100);

  // 합치고 중복 제거
  const priorLeadMap = new Map();
  [...priorOpenLeads, ...priorOpenLeadsMobile].forEach(l => priorLeadMap.set(l.Id, l));
  const allPriorLeads = [...priorLeadMap.values()];

  const priorLeadByPhone = new Map();
  allPriorLeads.forEach(l => {
    const phones = [normalizePhone(l.Phone), normalizePhone(l.MobilePhone)].filter(Boolean);
    phones.forEach(p => {
      if (dupPhones.includes(p)) {
        if (!priorLeadByPhone.has(p)) priorLeadByPhone.set(p, []);
        priorLeadByPhone.get(p).push(l);
      }
    });
  });
  console.log(`  → 기존 Open Lead ${allPriorLeads.length}건 조회, ${priorLeadByPhone.size}개 번호 매칭`);

  // 2-4) Open Opportunity 매칭 (Contact 경유 AccountId 사용)
  let openOppByPhone = new Map();
  if (matchedAccountIds.length > 0) {
    console.log(`  Open Opportunity 조회 중 (AccountId 경유)...`);
    const openOpps = await soqlQueryBatch(instanceUrl, accessToken, `
      SELECT Id, Name, StageName, AccountId, Account.Name, Account.Phone, CreatedDate, Owner.Name
      FROM Opportunity
      WHERE AccountId IN ({{IN_CLAUSE}})
        AND IsClosed = false
        AND CurrencyIsoCode = 'KRW'
    `, matchedAccountIds);

    // AccountId → Phone 역매핑
    const accountIdToPhones = new Map();
    for (const [phone, info] of accountByPhone) {
      if (!accountIdToPhones.has(info.id)) accountIdToPhones.set(info.id, []);
      accountIdToPhones.get(info.id).push(phone);
    }

    openOpps.forEach(o => {
      const phones = accountIdToPhones.get(o.AccountId) || [];
      phones.forEach(p => {
        if (!openOppByPhone.has(p)) openOppByPhone.set(p, []);
        openOppByPhone.get(p).push(o);
      });
    });
    console.log(`  → Open Opportunity ${openOpps.length}건 매칭`);
  }

  // 2-5) Closed Lost Opportunity 매칭 (AccountId 경유)
  let clOppByPhone = new Map();
  if (matchedAccountIds.length > 0) {
    console.log(`  Closed Lost Opportunity 조회 중 (AccountId 경유)...`);
    const clOpps = await soqlQueryBatch(instanceUrl, accessToken, `
      SELECT Id, Name, StageName, LossReason__c, AccountId, Account.Name,
             CloseDate, CreatedDate, Owner.Name
      FROM Opportunity
      WHERE AccountId IN ({{IN_CLAUSE}})
        AND StageName = 'Closed Lost'
        AND CurrencyIsoCode = 'KRW'
      ORDER BY CloseDate DESC
    `, matchedAccountIds);

    const accountIdToPhones = new Map();
    for (const [phone, info] of accountByPhone) {
      if (!accountIdToPhones.has(info.id)) accountIdToPhones.set(info.id, []);
      accountIdToPhones.get(info.id).push(phone);
    }

    clOpps.forEach(o => {
      const phones = accountIdToPhones.get(o.AccountId) || [];
      phones.forEach(p => {
        if (!clOppByPhone.has(p)) clOppByPhone.set(p, []);
        clOppByPhone.get(p).push(o);
      });
    });
    console.log(`  → Closed Lost Opportunity ${clOpps.length}건 매칭`);
  }

  // 2-5) 해당 월 중복 Lead의 Task 조회
  console.log(`  중복 Lead의 Task 조회 중...`);
  const dupLeadIds = dupGroups.flatMap(([, items]) => items.map(l => l.Id));
  const tasks = await soqlQueryBatch(instanceUrl, accessToken, `
    SELECT Id, WhoId, Subject, Status, CreatedDate, Owner.Name
    FROM Task
    WHERE WhoId IN ({{IN_CLAUSE}})
    ORDER BY CreatedDate ASC
  `, dupLeadIds);

  const tasksByLeadId = new Map();
  tasks.forEach(t => {
    if (!tasksByLeadId.has(t.WhoId)) tasksByLeadId.set(t.WhoId, []);
    tasksByLeadId.get(t.WhoId).push(t);
  });
  console.log(`  → Task ${tasks.length}건 조회 완료`);

  // ────────────────────────────────────────────
  //  STEP 3: 케이스 자동 분류
  // ────────────────────────────────────────────
  console.log(`\n[STEP 3] 케이스 자동 분류 중...`);

  const classified = {
    case1_existing_customer: [],  // 기존 고객 재문의
    case2_open_reinquiry: [],     // 진행 중 재인입
    case3_cl_reinquiry: [],       // 과거 CL 재문의
    case4_spam: [],               // 장난/오인입
    case5_pure_duplicate: [],     // 순수 중복 (신규끼리)
  };

  dupGroups.forEach(([phone, items]) => {
    // 중복 그룹 내 시간 분석
    const sortedByDate = [...items].sort((a, b) => new Date(a.CreatedDate) - new Date(b.CreatedDate));
    const firstCreated = sortedByDate[0].CreatedDate;
    const lastCreated = sortedByDate[sortedByDate.length - 1].CreatedDate;
    const spanDays = daysBetween(firstCreated, lastCreated);

    // 인접 Lead 간 간격
    const intervals = [];
    for (let i = 1; i < sortedByDate.length; i++) {
      intervals.push({
        minutes: minutesBetween(sortedByDate[i - 1].CreatedDate, sortedByDate[i].CreatedDate),
        days: daysBetween(sortedByDate[i - 1].CreatedDate, sortedByDate[i].CreatedDate),
      });
    }

    // Task 분석
    const leadTaskInfo = items.map(l => {
      const ts = tasksByLeadId.get(l.Id) || [];
      return {
        leadId: l.Id,
        taskCount: ts.length,
        firstTaskDate: ts.length > 0 ? ts[0].CreatedDate : null,
        frtMinutes: ts.length > 0 ? minutesBetween(l.CreatedDate, ts[0].CreatedDate) : null,
      };
    });
    const totalTasks = leadTaskInfo.reduce((sum, t) => sum + t.taskCount, 0);
    const leadsWithTask = leadTaskInfo.filter(t => t.taskCount > 0).length;
    const leadsWithoutTask = items.length - leadsWithTask;

    // Status 분포
    const statusDist = {};
    items.forEach(l => {
      statusDist[l.Status || 'Unknown'] = (statusDist[l.Status || 'Unknown'] || 0) + 1;
    });

    // 그룹 메타 정보
    const groupMeta = {
      phone,
      count: items.length,
      company: items[0].Company,
      spanDays: Math.round(spanDays * 10) / 10,
      intervals: intervals.map(iv => ({
        minutes: Math.round(iv.minutes),
        days: Math.round(iv.days * 10) / 10,
      })),
      statusDistribution: statusDist,
      taskSummary: {
        totalTasks,
        leadsWithTask,
        leadsWithoutTask,
      },
      leads: sortedByDate.map(l => ({
        id: l.Id,
        name: l.Name,
        company: l.Company,
        status: l.Status,
        owner: l.Owner?.Name,
        createdDate: l.CreatedDate,
        taskCount: (tasksByLeadId.get(l.Id) || []).length,
      })),
    };

    // ── 분류 로직 ──

    // 케이스 4: 장난/오인입 (먼저 체크)
    const spamLeads = items.filter(l => isSpamCompany(l.Company));
    if (spamLeads.length > 0) {
      groupMeta.classification = 'CASE4_SPAM';
      groupMeta.reason = `Company명 스팸 패턴 감지: "${spamLeads[0].Company}"`;
      classified.case4_spam.push(groupMeta);
      return;
    }

    // 케이스 1: 기존 고객 재문의 (Contact 경유 또는 Account 직접 매칭)
    const matchedAccount = accountByPhone.get(phone);
    if (matchedAccount) {
      groupMeta.classification = 'CASE1_EXISTING_CUSTOMER';
      groupMeta.reason = `기존 Account 존재: "${matchedAccount.name}" (${matchedAccount.matchedVia} 경유)`;
      groupMeta.matchedAccount = {
        id: matchedAccount.id,
        name: matchedAccount.name,
        contractStatus: matchedAccount.contractStatus,
        contractNumber: matchedAccount.contractNumber,
        matchedVia: matchedAccount.matchedVia,
        contactName: matchedAccount.contactName || null,
      };
      classified.case1_existing_customer.push(groupMeta);
      return;
    }

    // 케이스 2: 진행 중 재인입 (기존 Open Lead 또는 Open Opportunity)
    const priorLeads = priorLeadByPhone.get(phone) || [];
    const openOppList = openOppByPhone.get(phone) || [];
    if (priorLeads.length > 0 || openOppList.length > 0) {
      groupMeta.classification = 'CASE2_OPEN_REINQUIRY';
      groupMeta.reason = priorLeads.length > 0
        ? `기존 Open Lead ${priorLeads.length}건 존재 (최초: ${priorLeads[0].CreatedDate?.substring(0, 10)})`
        : `기존 Open Opportunity ${openOppList.length}건 존재`;
      groupMeta.priorLeads = priorLeads.map(l => ({
        id: l.Id,
        name: l.Name,
        company: l.Company,
        status: l.Status,
        owner: l.Owner?.Name,
        createdDate: l.CreatedDate,
        taskCount: l.Tasks?.records?.length || 0,
      }));
      groupMeta.openOpportunities = openOppList.map(o => ({
        id: o.Id,
        name: o.Name,
        stage: o.StageName,
        owner: o.Owner?.Name,
      }));
      classified.case2_open_reinquiry.push(groupMeta);
      return;
    }

    // 케이스 3: 과거 CL 재문의
    const clOppList = clOppByPhone.get(phone) || [];
    if (clOppList.length > 0) {
      const latestCL = clOppList[0];
      groupMeta.classification = 'CASE3_CL_REINQUIRY';
      groupMeta.reason = `과거 Closed Lost 존재: "${latestCL.Name}" (${latestCL.CloseDate})`;
      groupMeta.closedLostHistory = clOppList.map(o => ({
        id: o.Id,
        name: o.Name,
        lossReason: o.LossReason__c,
        closeDate: o.CloseDate,
        owner: o.Owner?.Name,
      }));
      classified.case3_cl_reinquiry.push(groupMeta);
      return;
    }

    // 미분류: 순수 중복 (같은 달 내 신규끼리 중복)
    groupMeta.classification = 'CASE5_PURE_DUPLICATE';

    // 시간 간격으로 세부 패턴 추가
    const avgIntervalMinutes = intervals.length > 0
      ? intervals.reduce((sum, iv) => sum + iv.minutes, 0) / intervals.length
      : 0;

    if (avgIntervalMinutes < 10) {
      groupMeta.subPattern = 'SYSTEM_DUP';
      groupMeta.reason = `평균 ${Math.round(avgIntervalMinutes)}분 간격 → 시스템 중복 (동시 인입)`;
    } else if (avgIntervalMinutes < 60 * 24) {
      groupMeta.subPattern = 'SAME_DAY_RETRY';
      groupMeta.reason = `평균 ${Math.round(avgIntervalMinutes / 60)}시간 간격 → 당일 재시도`;
    } else if (avgIntervalMinutes < 60 * 24 * 7) {
      groupMeta.subPattern = 'SHORT_TERM_RETRY';
      groupMeta.reason = `평균 ${Math.round(avgIntervalMinutes / (60 * 24))}일 간격 → 단기 재문의 (응대 미흡 가능성)`;
    } else {
      groupMeta.subPattern = 'LONG_TERM_RETRY';
      groupMeta.reason = `평균 ${Math.round(avgIntervalMinutes / (60 * 24))}일 간격 → 장기 재문의`;
    }

    // 응대 패턴 추가 분석
    if (leadsWithoutTask > 0 && leadsWithTask === 0) {
      groupMeta.responsePattern = 'NO_RESPONSE';
      groupMeta.responseNote = `전체 ${items.length}건 모두 Task 없음 → 완전 미응대`;
    } else if (leadsWithoutTask > 0) {
      groupMeta.responsePattern = 'PARTIAL_RESPONSE';
      groupMeta.responseNote = `${leadsWithTask}건 응대, ${leadsWithoutTask}건 미응대`;
    } else {
      groupMeta.responsePattern = 'ALL_RESPONDED';
      groupMeta.responseNote = `전체 ${items.length}건 모두 응대 (중복 인지 못하고 개별 처리)`;
    }

    classified.case5_pure_duplicate.push(groupMeta);
  });

  // ────────────────────────────────────────────
  //  STEP 4: 결과 출력
  // ────────────────────────────────────────────
  const c1 = classified.case1_existing_customer;
  const c2 = classified.case2_open_reinquiry;
  const c3 = classified.case3_cl_reinquiry;
  const c4 = classified.case4_spam;
  const c5 = classified.case5_pure_duplicate;

  const c1Records = c1.reduce((s, g) => s + g.count, 0);
  const c2Records = c2.reduce((s, g) => s + g.count, 0);
  const c3Records = c3.reduce((s, g) => s + g.count, 0);
  const c4Records = c4.reduce((s, g) => s + g.count, 0);
  const c5Records = c5.reduce((s, g) => s + g.count, 0);

  console.log(`\n================================================================`);
  console.log(`  분류 결과 요약: ${targetMonth}`);
  console.log(`================================================================`);
  console.log(`  총 Lead:                   ${leads.length}건`);
  console.log(`  중복 그룹:                 ${dupGroups.length}개 (${totalDupRecords}건)`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  케이스 1 - 기존 고객 재문의:  ${c1.length}그룹 (${c1Records}건) ${(c1Records / totalDupRecords * 100).toFixed(1)}%`);
  console.log(`  케이스 2 - 진행 중 재인입:    ${c2.length}그룹 (${c2Records}건) ${(c2Records / totalDupRecords * 100).toFixed(1)}%`);
  console.log(`  케이스 3 - 과거 CL 재문의:    ${c3.length}그룹 (${c3Records}건) ${(c3Records / totalDupRecords * 100).toFixed(1)}%`);
  console.log(`  케이스 4 - 장난/오인입:        ${c4.length}그룹 (${c4Records}건) ${(c4Records / totalDupRecords * 100).toFixed(1)}%`);
  console.log(`  케이스 5 - 순수 중복:          ${c5.length}그룹 (${c5Records}건) ${(c5Records / totalDupRecords * 100).toFixed(1)}%`);

  // ── 케이스별 상세 ──

  // 케이스 1 상세
  if (c1.length > 0) {
    console.log(`\n──── 케이스 1: 기존 고객 재문의 (상위 5건) ────`);
    console.log(`  → 액션: CS/재계약 라우팅 필요. 세일즈 리소스 낭비 방지.`);
    c1.slice(0, 5).forEach(g => {
      console.log(`  "${g.company}" (${g.phone}) ${g.count}건`);
      console.log(`    Account: ${g.matchedAccount.name} | 계약: ${g.matchedAccount.contractStatus}`);
    });
  }

  // 케이스 2 상세
  if (c2.length > 0) {
    console.log(`\n──── 케이스 2: 진행 중 재인입 (상위 5건) ────`);
    console.log(`  → 액션: 기존 담당자에게 재문의 알림. FRT/후속 응대 점검.`);
    c2.slice(0, 5).forEach(g => {
      console.log(`  "${g.company}" (${g.phone}) ${g.count}건 | 기간: ${g.spanDays}일`);
      console.log(`    Task: ${g.taskSummary.leadsWithTask}건 응대 / ${g.taskSummary.leadsWithoutTask}건 미응대`);
    });
  }

  // 케이스 3 상세
  if (c3.length > 0) {
    console.log(`\n──── 케이스 3: 과거 CL 재문의 (상위 5건) ────`);
    console.log(`  → 액션: 재영업 기회! 이전 CL 사유 참고하여 다른 접근 필요.`);
    c3.slice(0, 5).forEach(g => {
      console.log(`  "${g.company}" (${g.phone}) ${g.count}건`);
      const cl = g.closedLostHistory[0];
      console.log(`    이전 CL: ${cl.closeDate} | 사유: ${cl.lossReason || '(미기록)'} | 담당: ${cl.owner || '(없음)'}`);
    });
  }

  // 케이스 4 상세
  if (c4.length > 0) {
    console.log(`\n──── 케이스 4: 장난/오인입 (상위 5건) ────`);
    console.log(`  → 액션: 자동 필터 규칙 추가 대상.`);
    c4.slice(0, 5).forEach(g => {
      console.log(`  "${g.company}" (${g.phone}) ${g.count}건 | 사유: ${g.reason}`);
    });
  }

  // 케이스 5 상세 (서브패턴)
  if (c5.length > 0) {
    const subPatterns = {};
    c5.forEach(g => {
      const sp = g.subPattern || 'UNKNOWN';
      if (!subPatterns[sp]) subPatterns[sp] = { groups: 0, records: 0 };
      subPatterns[sp].groups++;
      subPatterns[sp].records += g.count;
    });

    console.log(`\n──── 케이스 5: 순수 중복 세부 패턴 ────`);
    Object.entries(subPatterns).forEach(([pattern, data]) => {
      const labels = {
        SYSTEM_DUP: '시스템 중복 (10분 이내)',
        SAME_DAY_RETRY: '당일 재시도',
        SHORT_TERM_RETRY: '단기 재문의 (1~7일)',
        LONG_TERM_RETRY: '장기 재문의 (7일+)',
      };
      console.log(`  ${labels[pattern] || pattern}: ${data.groups}그룹 (${data.records}건)`);
    });

    // 응대 패턴
    const responsePatterns = {};
    c5.forEach(g => {
      const rp = g.responsePattern || 'UNKNOWN';
      if (!responsePatterns[rp]) responsePatterns[rp] = { groups: 0, records: 0 };
      responsePatterns[rp].groups++;
      responsePatterns[rp].records += g.count;
    });

    console.log(`\n  [응대 패턴]`);
    Object.entries(responsePatterns).forEach(([pattern, data]) => {
      const labels = {
        NO_RESPONSE: '완전 미응대 (Task 0건)',
        PARTIAL_RESPONSE: '부분 응대',
        ALL_RESPONDED: '전건 응대 (개별 처리)',
      };
      console.log(`  ${labels[pattern] || pattern}: ${data.groups}그룹 (${data.records}건)`);
    });

    // 상위 5건
    console.log(`\n  [상위 5건]`);
    c5.slice(0, 5).forEach(g => {
      console.log(`  "${g.company}" (${g.phone}) ${g.count}건 | ${g.reason}`);
      console.log(`    응대: ${g.responseNote}`);
    });
  }

  // ── 핵심 인사이트 ──
  console.log(`\n================================================================`);
  console.log(`  핵심 인사이트 & 권장 액션`);
  console.log(`================================================================`);

  if (c2Records > 0) {
    const c2NoResponseGroups = c2.filter(g => g.taskSummary.leadsWithoutTask > 0);
    console.log(`\n  🔴 진행 중 재인입 ${c2Records}건 중 미응대 포함 그룹: ${c2NoResponseGroups.length}개`);
    console.log(`     → FRT/후속 응대 프로세스 점검 필요`);
    console.log(`     → Lead 생성 시 기존 Open Lead 존재 여부 자동 체크 권장`);
  }

  if (c1Records > 0) {
    console.log(`\n  🟡 기존 고객 재문의 ${c1Records}건이 세일즈 퍼널에 유입 중`);
    console.log(`     → Account 매칭 후 CS/재계약 라우팅 자동화 권장`);
    console.log(`     → Inside Sales 리소스 ${c1Records}건 절감 가능`);
  }

  if (c3Records > 0) {
    console.log(`\n  🟢 과거 이탈 고객 재문의 ${c3Records}건 = 재영업 기회`);
    console.log(`     → 이전 CL 사유 기반 맞춤 접근 시 전환율 향상 기대`);
    console.log(`     → 별도 '재문의' 큐로 우선 배정 권장`);
  }

  if (c4Records > 0) {
    console.log(`\n  ⚫ 장난/오인입 ${c4Records}건 자동 필터 가능`);
    console.log(`     → Trigger에 Company명 스팸 필터 추가 권장`);
  }

  const c5NoResponse = c5.filter(g => g.responsePattern === 'NO_RESPONSE');
  if (c5NoResponse.length > 0) {
    const c5NoResponseRecords = c5NoResponse.reduce((s, g) => s + g.count, 0);
    console.log(`\n  🔴 순수 중복 중 완전 미응대 ${c5NoResponse.length}그룹 (${c5NoResponseRecords}건)`);
    console.log(`     → 재문의임에도 한 번도 응대하지 않은 건. 즉시 점검 필요.`);
  }

  // ── 예상 효과 ──
  const savableRecords = c1Records + c4Records;
  const improvableRecords = c2Records + c3Records;
  console.log(`\n  ────────────────────────────────`);
  console.log(`  즉시 자동화로 제거 가능: ${savableRecords}건 (기존고객+스팸)`);
  console.log(`  프로세스 개선으로 전환 가능: ${improvableRecords}건 (재인입+CL재문의)`);
  console.log(`  월간 Inside Sales 절감 효과: 약 ${savableRecords}건 × 15분 = ${Math.round(savableRecords * 15 / 60)}시간`);

  // ────────────────────────────────────────────
  //  STEP 5: JSON 저장
  // ────────────────────────────────────────────
  const output = {
    month: targetMonth,
    totalLeads: leads.length,
    duplicateSummary: {
      totalGroups: dupGroups.length,
      totalRecords: totalDupRecords,
    },
    classification: {
      case1_existing_customer: { groups: c1.length, records: c1Records, pct: (c1Records / totalDupRecords * 100).toFixed(1) + '%' },
      case2_open_reinquiry: { groups: c2.length, records: c2Records, pct: (c2Records / totalDupRecords * 100).toFixed(1) + '%' },
      case3_cl_reinquiry: { groups: c3.length, records: c3Records, pct: (c3Records / totalDupRecords * 100).toFixed(1) + '%' },
      case4_spam: { groups: c4.length, records: c4Records, pct: (c4Records / totalDupRecords * 100).toFixed(1) + '%' },
      case5_pure_duplicate: { groups: c5.length, records: c5Records, pct: (c5Records / totalDupRecords * 100).toFixed(1) + '%' },
    },
    insights: {
      savableByAutomation: savableRecords,
      improvableByProcess: improvableRecords,
      estimatedTimeSavedHours: Math.round(savableRecords * 15 / 60),
    },
    details: {
      case1_existing_customer: c1,
      case2_open_reinquiry: c2,
      case3_cl_reinquiry: c3,
      case4_spam: c4,
      case5_pure_duplicate: c5,
    },
  };

  const filename = `Lead_Duplicate_Analysis_${targetMonth}.json`;
  fs.writeFileSync(filename, JSON.stringify(output, null, 2));
  console.log(`\n결과 저장: ${filename}`);
}

main().catch(err => {
  console.error('오류:', err.message);
  if (err.response) console.error(err.response.data);
});