// ============================================
// 태블릿 페이스 추출기 (tablet-pace-extract.js)
// 월별 태블릿 목표(IBS/OBS/CHS)를 영업일 기준 일별/주별로 소분 →
// 당월 마감 실적(CW opp 태블릿) + 계류 영업기회(열린 opp) 파이프라인을 영업단계별로 산출.
// 산출물: data/tablet-pace-{YYYY-MM}.json  (+ --s3 시 tablet-pace/{YYYY-MM}.json 업로드)
//
// 분류 기준: opp 의 Owner_Department__c → 팀. 비영업 부서면 FieldUser__r.Department 로 폴백.
//   IBS = 인바운드세일즈 계열, OBS = 아웃바운드세일즈, CHS = 채널매니지먼트 계열.
//   목표 대상 RecordType: "테이블오더 (신규)" + "테이블오더 (추가설치)" 만.
// ============================================
require('dotenv').config();
const axios = require('axios');
axios.defaults.adapter = 'fetch'; // Node 23 기본 어댑터 socket hang up 회피
const fs = require('fs');

// ---- 월별 목표 (2026 Sales Business Plan, 채널=프랜차이즈+파트너스 분리) ----
// 채널(CHS) 합계를 프랜차이즈(FR)·파트너스(PT) 50:50 으로 분할 — 월별 정확 분할 확정 시 갱신
const TABLET_TARGETS_2026 = {
  IBS: { '2026-01': 2150, '2026-02': 2160, '2026-03': 2600, '2026-04': 2850, '2026-05': 2400, '2026-06': 2410, '2026-07': 2080, '2026-08': 2250, '2026-09': 2450, '2026-10': 2650, '2026-11': 2580, '2026-12': 2100 },
  OBS: { '2026-01': 400, '2026-02': 550, '2026-03': 550, '2026-04': 550, '2026-05': 750, '2026-06': 480, '2026-07': 700, '2026-08': 700, '2026-09': 800, '2026-10': 680, '2026-11': 800, '2026-12': 600 },
  FR: { '2026-01': 1000, '2026-02': 1205, '2026-03': 1600, '2026-04': 1625, '2026-05': 1575, '2026-06': 1305, '2026-07': 1560, '2026-08': 1550, '2026-09': 1110, '2026-10': 1780, '2026-11': 1605, '2026-12': 1175 },
  PT: { '2026-01': 1000, '2026-02': 1205, '2026-03': 1600, '2026-04': 1625, '2026-05': 1575, '2026-06': 1305, '2026-07': 1560, '2026-08': 1550, '2026-09': 1110, '2026-10': 1780, '2026-11': 1605, '2026-12': 1175 },
};

// ---- 부서명 → 팀 매핑 ----
const DEPT_TEAM = {
  '인바운드세일즈': 'IBS', '인사이드세일즈': 'IBS',
  '필드세일즈1': 'IBS', '필드세일즈2': 'IBS', '필드세일즈3': 'IBS',
  '필드세일즈1팀': 'IBS', '필드세일즈2팀': 'IBS', '필드세일즈3팀': 'IBS',
  '영업지원1팀': 'IBS', '영업지원2팀': 'IBS', '영업1팀': 'IBS', '온보딩팀': 'IBS',
  '아웃바운드세일즈': 'OBS',
  '채널매니지먼트': 'CHS', '채널세일즈팀': 'CHS', '채널세일즈': 'CHS',
};
const TEAMS = ['IBS', 'OBS', 'FR', 'PT'];
const TEAM_LABEL = { IBS: '인바운드 (IBS)', OBS: '아웃바운드 (OBS)', FR: '프랜차이즈', PT: '파트너스' };
// 영업단계 정렬 순서 (파이프라인 흐름)
const STAGE_ORDER = ['방문배정', '방문상담', '견적', '재견적', '선납금', '계약진행', '출고진행', '설치진행'];

// ---- SF helpers ----
async function getToken() {
  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const p = new URLSearchParams();
  p.append('grant_type', 'password');
  p.append('client_id', process.env.SF_CLIENT_ID);
  p.append('client_secret', process.env.SF_CLIENT_SECRET);
  p.append('username', process.env.SF_USERNAME);
  p.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const r = await axios.post(url, p);
  return { accessToken: r.data.access_token, instanceUrl: r.data.instance_url };
}
async function soqlAll(inst, tok, soql) {
  const q = soql.replace(/\s+/g, ' ').trim();
  let all = [];
  let res = (await axios.get(`${inst}/services/data/v59.0/query`, { headers: { Authorization: `Bearer ${tok}` }, params: { q } })).data;
  all.push(...(res.records || []));
  while (res.nextRecordsUrl) {
    res = (await axios.get(`${inst}${res.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${tok}` } })).data;
    all.push(...(res.records || []));
  }
  return all;
}

// ---- 날짜 유틸 (KST) ----
function kstToday() {
  const now = new Date(Date.now() + 9 * 3600000);
  return now.toISOString().substring(0, 10);
}
function kstToUTC(dateStr, isStart) {
  // KST 일자 → UTC ISO. isStart=true → 00:00:00, false → 23:59:59 (KST)
  const t = isStart ? '00:00:00' : '23:59:59';
  return new Date(`${dateStr}T${t}+09:00`).toISOString();
}
function utcToKSTDate(utc) {
  return new Date(new Date(utc).getTime() + 9 * 3600000).toISOString().substring(0, 10);
}
function monthBounds(month) { // month = 'YYYY-MM'
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const nextY = m === 12 ? y + 1 : y, nextM = m === 12 ? 1 : m + 1;
  const next = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(nextY, nextM - 1, 0)).getUTCDate();
  return { start, next, lastDay };
}
function isBizDay(d) { const wd = d.getUTCDay(); return wd >= 1 && wd <= 5; }
function bizDaysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let day = 1; day <= last; day++) if (isBizDay(new Date(Date.UTC(y, m - 1, day)))) n++;
  return n;
}
function bizDaysElapsed(month, todayStr) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [, , td] = todayStr.split('-').map(Number);
  const todayInMonth = todayStr.startsWith(month);
  const upto = todayInMonth ? td : last; // 과거 월이면 전체
  let n = 0;
  for (let day = 1; day <= Math.min(upto, last); day++) if (isBizDay(new Date(Date.UTC(y, m - 1, day)))) n++;
  return n;
}
// 월의 ISO 주차별 영업일 수 (주별 할당용)
function weeklyBuckets(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = {};
  for (let day = 1; day <= last; day++) {
    const d = new Date(Date.UTC(y, m - 1, day));
    if (!isBizDay(d)) continue;
    // 주차 키: 해당 주 월요일 날짜
    const dow = d.getUTCDay(); // 1=Mon
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - (dow - 1));
    const key = monday.toISOString().substring(0, 10);
    if (!weeks[key]) weeks[key] = { weekStart: key, bizDays: 0, days: [] };
    weeks[key].bizDays++;
    weeks[key].days.push(d.toISOString().substring(0, 10));
  }
  return Object.values(weeks).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function classify(dept, fieldDept) {
  if (dept && DEPT_TEAM[dept]) return DEPT_TEAM[dept];
  if (fieldDept && DEPT_TEAM[fieldDept]) return DEPT_TEAM[fieldDept];
  return '기타';
}
// 채널 소속 판별용 부서 (소유자 User.Department 기준 — opp Owner_Department__c 는 부정확)
const CHANNEL_DEPTS = new Set(['채널세일즈', '채널매니지먼트', '채널세일즈팀']);
// B+C 보정: 인바운드로 분류된 건이라도 (B) LeadSource '파트너사 소개' 또는 (C) 실제 소유자 부서가 채널이면 채널로 재분류
function applyChannelOverride(team, leadSource, ownerUserDept) {
  if (team !== 'IBS') return team;
  if (leadSource === '파트너사 소개' || leadSource === '프랜차이즈소개' || (ownerUserDept && CHANNEL_DEPTS.has(ownerUserDept))) return 'CHS';
  return team;
}
// 채널(CHS)을 프랜차이즈(FR)/파트너스(PT)로 분할
// 우선순위: ① 파트너사 정보(fm_AccountPartner__c) 있으면 → PT, ② FR본사(fm_FRHQ__c)/LeadSource '프랜차이즈소개' → FR, ③ 그 외 → PT
function channelSplit(team, leadSource, frHQ, partner) {
  if (team !== 'CHS') return team;
  if (partner) return 'PT';
  return (frHQ || leadSource === '프랜차이즈소개') ? 'FR' : 'PT';
}
// 계약-CW 실적 분류 — 사내 /contracts API 기준: opp 소유부서 → 팀, 채널은 FR/PT 분할(파트너사 정보 우선)
function classifyContract(dept, frHQ, leadSource, partner) {
  const team = DEPT_TEAM[dept] || '기타';
  if (team === 'CHS') return channelSplit('CHS', leadSource, frHQ, partner);
  return team;
}
// 국내(한국) 판별 — 원화(KRW) 기준. 해외 영업기회는 USD/CAD 등으로 통화가 찍힘 (CurrencyIsoCode 는 항상 채워짐).
function isDomestic(o) { return o.currency ? o.currency === 'KRW' : true; }
function lightning(id) { return `https://torder.lightning.force.com/lightning/r/Opportunity/${id}/view`; }

async function main() {
  const month = process.argv[2] && /^\d{4}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : kstToday().substring(0, 7);
  const s3Mode = process.argv.includes('--s3');
  const today = kstToday();
  const { start, next } = monthBounds(month);

  console.log('============================================');
  console.log(`태블릿 페이스 추출 — ${month} (기준일 ${today})`);
  console.log('============================================');
  const { accessToken, instanceUrl } = await getToken();
  console.log('✅ Salesforce 연결 성공');

  const RT_FILTER = "(RecordType.Name = '1. 테이블오더 (신규)' OR RecordType.Name = '3. 테이블오더 (추가설치)')";
  const FIELDS = `Id, Name, Account.Name, Account.BranchName__c, Account.BillingCountry, Account.fm_FRHQ__c, Account.fm_FRBrand__c, CurrencyIsoCode, StageName, IsWon, IsClosed, CloseDate, CreatedDate,
                  TotalNumberofEveryTablet__c, Owner_Department__c, Owner.Name, Owner.Department,
                  FieldUser__r.Name, FieldUser__r.Department, BOUser__r.Name, fm_AccountPartner__c,
                  RecordType.Name, AgeInDays, LastStageChangeInDays, InstallHopeDate__c, AdvancePaymentDate__c, fm_CompanyStatus__c, LeadSource`;

  // 1) 당월 마감(CW) — OpportunityFieldHistory 의 'Closed Won' 단계변경일 기준 (CloseDate 는 예측일이라 부정확)
  const { lastDay } = monthBounds(month);
  const endDateStr = `${month}-${String(lastDay).padStart(2, '0')}`;
  const startUTC = kstToUTC(start, true);
  const endUTC = kstToUTC(endDateStr, false);
  const hist = await soqlAll(instanceUrl, accessToken, `
    SELECT OpportunityId, OldValue, NewValue, CreatedDate FROM OpportunityFieldHistory
    WHERE Field = 'StageName'
      AND CreatedDate >= ${startUTC} AND CreatedDate <= ${endUTC}
    ORDER BY CreatedDate ASC`);
  const wonDateMap = {}; // oppId → 최초 CW 전환 KST 일자 (NewValue 는 서버필터 불가 → JS 필터)
  const clDeathMap = {}; // oppId → CL 직전 단계 (OldValue) = 어느 단계에서 이탈했나
  hist.forEach(r => {
    if (r.NewValue === 'Closed Won' && !wonDateMap[r.OpportunityId]) wonDateMap[r.OpportunityId] = utcToKSTDate(r.CreatedDate);
    if (r.NewValue === 'Closed Lost' && clDeathMap[r.OpportunityId] == null) clDeathMap[r.OpportunityId] = r.OldValue || '(미상)';
  });
  const wonOppIds = Object.keys(wonDateMap);
  const clOppIds = Object.keys(clDeathMap);
  console.log(`  📜 당월 단계변경 — CW: ${wonOppIds.length}건 / CL: ${clOppIds.length}건`);

  const fetchDetails = async (ids) => {
    let out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200).map(id => `'${id}'`).join(',');
      out = out.concat(await soqlAll(instanceUrl, accessToken, `SELECT ${FIELDS} FROM Opportunity WHERE Id IN (${chunk}) AND ${RT_FILTER}`));
    }
    return out;
  };
  const cwOpps = await fetchDetails(wonOppIds);
  const clOpps = await fetchDetails(clOppIds);
  console.log(`  📦 당월 마감 CW: ${cwOpps.length}건 / CL: ${clOpps.length}건 (테이블오더 신규+추가설치)`);

  // 2) 열린(계류) opp — 파이프라인
  const openOpps = await soqlAll(instanceUrl, accessToken, `
    SELECT ${FIELDS} FROM Opportunity
    WHERE IsClosed = false AND ${RT_FILTER}`);
  console.log(`  🗂  열린 영업기회: ${openOpps.length}건`);

  const norm = (o) => ({
    id: o.Id,
    name: o.Name,
    account: o.Account?.Name || o.Name,
    branch: o.Account?.BranchName__c || '',
    country: o.Account?.BillingCountry || null,
    currency: o.CurrencyIsoCode || null,
    frHQ: o.Account?.fm_FRHQ__c || null, // FR본사명 (프랜차이즈 판별)
    stage: o.StageName || '(미상)',
    isWon: o.IsWon, isClosed: o.IsClosed,
    closeDate: o.CloseDate,
    createdDate: o.CreatedDate ? o.CreatedDate.substring(0, 10) : null,
    tablets: o.TotalNumberofEveryTablet__c || 0,
    dept: o.Owner_Department__c || null,
    fieldDept: o.FieldUser__r?.Department || null,
    ownerDept: o.Owner?.Department || null, // 소유자 User 실제 부서 (B+C 보정용)
    owner: o.FieldUser__r?.Name || o.Owner?.Name || '(미상)',
    ownerName: o.Owner?.Name || null, // 소유자
    fieldUser: o.FieldUser__r?.Name || null, // 필드 담당자
    boUser: o.BOUser__r?.Name || null, // BO 담당자
    partner: o.fm_AccountPartner__c || null,
    recordType: o.RecordType?.Name || '',
    age: o.AgeInDays ?? null,
    stageAge: o.LastStageChangeInDays ?? null, // 현재 단계 머무른 일수 (단계 이동 시 초기화)
    installHope: o.InstallHopeDate__c || null,
    advancePayment: o.AdvancePaymentDate__c || null,
    companyStatus: o.fm_CompanyStatus__c || null,
    leadSource: o.LeadSource || null,
    baseTeam: classify(o.Owner_Department__c, o.FieldUser__r?.Department),
    team: channelSplit(applyChannelOverride(classify(o.Owner_Department__c, o.FieldUser__r?.Department), o.LeadSource || null, o.Owner?.Department || null), o.LeadSource || null, o.Account?.fm_FRHQ__c || null, o.fm_AccountPartner__c || null),
    link: lightning(o.Id),
  });

  const cwAll = cwOpps.map(o => ({ ...norm(o), wonDate: wonDateMap[o.Id] || null }));
  const clAll = clOpps.map(o => ({ ...norm(o), deathStage: clDeathMap[o.Id] || '(미상)' }));
  const openAll = openOpps.map(norm);
  // 원화(KRW) 기준 국내 영업기회만 — 해외(USD/CAD 등) 제외
  const cw = cwAll.filter(isDomestic);
  const cl = clAll.filter(isDomestic);
  const open = openAll.filter(isDomestic);
  const overseasCw = cwAll.length - cw.length;
  const overseasOpen = openAll.length - open.length;
  if (overseasCw || overseasOpen) console.log(`  🌏 해외(비-KRW) 제외: CW ${overseasCw}건 / 열린 ${overseasOpen}건`);

  // B+C 보정 집계 (인바운드 → 채널 재분류)
  const isChannel = (tm) => tm === 'FR' || tm === 'PT';
  const reclassCw = cw.filter(o => o.baseTeam === 'IBS' && isChannel(o.team));
  const reclassOpen = open.filter(o => o.baseTeam === 'IBS' && isChannel(o.team));
  if (reclassCw.length || reclassOpen.length) console.log(`  🔀 B+C 보정 (인바운드→채널): CW ${reclassCw.length}건 / 열린 ${reclassOpen.length}건`);

  // ---- 분류 분포 로그 (검증용) ----
  const distLog = (label, arr) => {
    const byTeam = {}; const etcDept = {};
    arr.forEach(o => { byTeam[o.team] = byTeam[o.team] || { c: 0, tab: 0 }; byTeam[o.team].c++; byTeam[o.team].tab += o.tablets; if (o.team === '기타') etcDept[o.dept || '(null)'] = (etcDept[o.dept || '(null)'] || 0) + 1; });
    console.log(`  [분류:${label}]`, JSON.stringify(byTeam));
    if (Object.keys(etcDept).length) console.log(`     기타 부서분포:`, JSON.stringify(etcDept));
  };
  distLog('CW', cw);
  distLog('OPEN', open);

  // ---- CW 단계별 체류기간 (OpportunityFieldHistory 전체 이력 기반) ----
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const dwellByOpp = {}; // oppId → { stage: 누적 체류일 } — CW·CL 둘 다
  const dwellSrc = [...cw, ...cl];
  const dwellIds = [...new Set(dwellSrc.map(o => o.id))];
  const createdMap = {}; dwellSrc.forEach(o => { createdMap[o.id] = o.createdDate; });
  for (let i = 0; i < dwellIds.length; i += 200) {
    const ids = dwellIds.slice(i, i + 200).map(id => `'${id}'`).join(',');
    const rows = await soqlAll(instanceUrl, accessToken, `
      SELECT OpportunityId, OldValue, NewValue, CreatedDate FROM OpportunityFieldHistory
      WHERE Field='StageName' AND OpportunityId IN (${ids}) ORDER BY CreatedDate ASC`);
    const byOpp = {};
    rows.forEach(r => { (byOpp[r.OpportunityId] = byOpp[r.OpportunityId] || []).push(r); });
    for (const oppId in byOpp) {
      const evs = byOpp[oppId];
      const dwell = {};
      let prevDate = createdMap[oppId] ? new Date(createdMap[oppId]) : new Date(evs[0].CreatedDate);
      let prevStage = evs[0].OldValue; // 생성~첫 변경까지 머문 단계
      for (const e of evs) {
        const days = (new Date(e.CreatedDate) - prevDate) / 86400000;
        if (prevStage && days >= 0) dwell[prevStage] = (dwell[prevStage] || 0) + days;
        prevStage = e.NewValue; prevDate = new Date(e.CreatedDate);
      }
      dwellByOpp[oppId] = dwell;
    }
  }
  console.log(`  ⏳ CW·CL 단계 체류기간 계산: ${Object.keys(dwellByOpp).length}건`);

  // ---- 영업일 / 할당 ----
  const bizTotal = bizDaysInMonth(month);
  const bizElapsed = bizDaysElapsed(month, today);
  const weeks = weeklyBuckets(month);

  // ---- 실적: 계약-CW 기준 (사내 /contracts API 정의와 일치) ----
  // 계약시작일(ContractDateStart) 당월 + opp Closed Won + 신규/추가설치 + KRW + 특정 계약RT 제외
  const contractRows = await soqlAll(instanceUrl, accessToken, `
    SELECT Id, ContractDateStart__c, ProductPaymentType__c, Opportunity__r.Id, Opportunity__r.Owner_Department__c,
           Opportunity__r.TotalNumberofEveryTablet__c, Opportunity__r.LeadSource,
           Opportunity__r.fm_AccountPartner__c, Opportunity__r.Account.Name, Account__r.fm_FRHQ__c
    FROM Contract__c
    WHERE Opportunity__c != NULL
      AND ContractDateStart__c >= ${start} AND ContractDateStart__c < ${next}
      AND (ContractStatus__c = '계약서명완료' OR ContractStatus__c = '계약서명대기')
      AND RecordTypeId != '012TJ000002eJu1YAE'
      AND Opportunity__r.StageName = 'Closed Won'
      AND (Opportunity__r.RecordType.Name = '1. 테이블오더 (신규)' OR Opportunity__r.RecordType.Name = '3. 테이블오더 (추가설치)')
      AND CurrencyIsoCode = 'KRW'`);
  const cwByTeam = {};
  let cwEtc = 0;
  const paymentMix = {}; // 결제방법(ProductPaymentType__c)별 CW 비중 — 전체 CW 기준
  contractRows.forEach(r => {
    const o = r.Opportunity__r || {};
    const tab = o.TotalNumberofEveryTablet__c || 0;
    const pt = r.ProductPaymentType__c || '(미입력)';
    (paymentMix[pt] = paymentMix[pt] || { cnt: 0, tablets: 0 }).cnt++;
    paymentMix[pt].tablets += tab;
    const team = classifyContract(o.Owner_Department__c, r.Account__r?.fm_FRHQ__c, o.LeadSource, o.fm_AccountPartner__c);
    if (team === '기타') { cwEtc++; return; }
    (cwByTeam[team] = cwByTeam[team] || []).push({ tablets: tab, date: r.ContractDateStart__c, account: o.Account?.Name || '', oppId: o.Id });
  });
  const paymentMixArr = Object.entries(paymentMix).map(([type, v]) => ({ type, cnt: v.cnt, tablets: v.tablets })).sort((a, b) => b.tablets - a.tablets);
  console.log(`  💳 결제방법 비중(CW ${contractRows.length}건): ` + paymentMixArr.map(p => `${p.type} ${p.tablets}대`).join(' / '));
  console.log(`  📑 계약-CW 실적: ${contractRows.length}건 → ` + TEAMS.map(t => `${t} ${(cwByTeam[t] || []).reduce((s, c) => s + c.tablets, 0)}대`).join(' / ') + (cwEtc ? ` (기타 ${cwEtc}건 제외)` : ' (기타 0)'));

  // ---- 팀별 집계 ----
  const result = { period: month, asOf: today, extractedAt: new Date().toISOString(), bizDaysTotal: bizTotal, bizDaysElapsed: bizElapsed, teams: {} };

  for (const team of TEAMS) {
    const target = TABLET_TARGETS_2026[team]?.[month] ?? 0;
    const dailyQuota = bizTotal > 0 ? +(target / bizTotal).toFixed(1) : 0;
    const cumTargetToday = Math.round(dailyQuota * bizElapsed);

    const cwTeam = cwByTeam[team] || []; // 계약-CW 실적 (계약시작일 기준)
    const actualMTD = cwTeam.reduce((s, o) => s + o.tablets, 0);
    const actualCount = cwTeam.length;

    // 일별 실적 시리즈 (계약시작일 기준)
    const byDay = {};
    cwTeam.forEach(o => { const d = o.date; if (!d) return; byDay[d] = byDay[d] || { date: d, tablets: 0, count: 0 }; byDay[d].tablets += o.tablets; byDay[d].count++; });
    const dailySeries = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    // 주별 할당 + 실적 (주 마지막 영업일까지 포함하도록 주말 경계로 비교)
    const weekly = weeks.map(w => {
      const wEnd = w.days[w.days.length - 1];
      const wActual = cwTeam.filter(o => o.date && o.date >= w.days[0] && o.date <= wEnd);
      return { weekStart: w.weekStart, bizDays: w.bizDays, quota: Math.round(dailyQuota * w.bizDays), actual: wActual.reduce((s, o) => s + o.tablets, 0), count: wActual.length };
    });

    const gap = actualMTD - cumTargetToday;
    const attainment = target > 0 ? +(actualMTD / target * 100).toFixed(1) : 0;
    const paceAttainment = cumTargetToday > 0 ? +(actualMTD / cumTargetToday * 100).toFixed(1) : 0;
    const projected = bizElapsed > 0 ? Math.round(actualMTD / bizElapsed * bizTotal) : 0;
    const remaining = Math.max(0, target - actualMTD);
    const remainingBizDays = Math.max(0, bizTotal - bizElapsed);
    const requiredDaily = remainingBizDays > 0 ? +(remaining / remainingBizDays).toFixed(1) : 0;

    // 파이프라인: 영업단계별
    const openTeam = open.filter(o => o.team === team);
    const stageMap = {};
    openTeam.forEach(o => {
      const st = o.stage;
      stageMap[st] = stageMap[st] || { stage: st, count: 0, tablets: 0, withTablet: 0, opps: [] };
      stageMap[st].count++; stageMap[st].tablets += o.tablets; if (o.tablets > 0) stageMap[st].withTablet++;
      stageMap[st].opps.push({ id: o.id, account: o.account, branch: o.branch, ownerName: o.ownerName, fieldUser: o.fieldUser, boUser: o.boUser, tablets: o.tablets, age: o.age, stageAge: o.stageAge, closeDate: o.closeDate, installHope: o.installHope, companyStatus: o.companyStatus, recordType: o.recordType, partner: o.partner, frHQ: o.frHQ, leadSource: o.leadSource, fromInbound: o.baseTeam === 'IBS' && (o.team === 'FR' || o.team === 'PT'), link: o.link });
    });
    const stages = Object.values(stageMap).sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a.stage), ib = STAGE_ORDER.indexOf(b.stage);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    // 각 단계 opp 는 태블릿 많은 순 정렬
    stages.forEach(s => s.opps.sort((a, b) => b.tablets - a.tablets));
    const pipelineTablets = openTeam.reduce((s, o) => s + o.tablets, 0);
    const pipelineCount = openTeam.length;
    const coverage = remaining > 0 ? +(pipelineTablets / remaining * 100).toFixed(1) : null; // 잔여목표 대비 파이프라인 태블릿 커버리지

    // CW 단계별 체류기간 (중앙값) — 단계변경(Closed Won) 기준 opp 의 단계 체류일 분포 (퍼널 진단용, 실적과 별개 기준)
    const cwStageTeam = cw.filter(o => o.team === team);
    const cwStageDwell = STAGE_ORDER.map(st => {
      const vals = cwStageTeam.map(o => dwellByOpp[o.id]?.[st]).filter(v => v != null && v >= 0);
      return { stage: st, count: vals.length, median: vals.length ? +median(vals).toFixed(1) : 0 };
    }).filter(s => s.count > 0);
    const leadTimeMedian = (() => {
      const totals = cwStageTeam.map(o => { const dw = dwellByOpp[o.id]; if (!dw) return null; return STAGE_ORDER.reduce((s, st) => s + (dw[st] || 0), 0); }).filter(v => v != null && v > 0);
      return totals.length ? +median(totals).toFixed(1) : null;
    })();

    // CL(Closed Lost) 단계별 이탈 분포 — 당월 이탈건이 어느 단계에서 죽었나 (사망 직전 단계)
    const clTeam = cl.filter(o => o.team === team);
    const clOrder = [...STAGE_ORDER, '부재', '방문상담', '(미상)'];
    const clStageDist = (() => {
      const m = {};
      clTeam.forEach(o => { const st = o.deathStage || '(미상)'; m[st] = (m[st] || 0) + 1; });
      return Object.entries(m).map(([stage, count]) => ({ stage, count }))
        .sort((a, b) => { const ia = clOrder.indexOf(a.stage), ib = clOrder.indexOf(b.stage); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    })();

    // 예상실적 = 실적(CW) + 계약진행 이후 단계(계약진행·출고진행·설치진행) 파이프라인 태블릿
    const postContractTablets = stages.filter(s => ['계약진행', '출고진행', '설치진행'].includes(s.stage)).reduce((a, s) => a + (s.tablets || 0), 0);
    const expectedActual = actualMTD + postContractTablets;
    result.teams[team] = {
      team, label: TEAM_LABEL[team], target, dailyQuota,
      cumTargetToday, actualMTD, actualCount, gap, attainment, paceAttainment,
      expectedActual, postContractTablets,
      projected, remaining, remainingBizDays, requiredDaily,
      dailySeries, weekly, cwStageDwell, leadTimeMedian,
      cl: { total: clTeam.length, stageDist: clStageDist },
      // opp별 원본 (페이지에서 기간 필터 재계산용) — created=생성일
      cwDwellOpps: cwStageTeam.map(o => ({ created: o.createdDate, dwell: dwellByOpp[o.id] || {} })),
      clDwellOpps: clTeam.map(o => ({ created: o.createdDate, dwell: dwellByOpp[o.id] || {} })),
      pipeline: { count: pipelineCount, tablets: pipelineTablets, coverage, stages },
    };
    console.log(`  ▸ ${team}: 목표 ${target} / 오늘누적목표 ${cumTargetToday} / 실적 ${actualMTD}(${actualCount}건) / 갭 ${gap >= 0 ? '+' : ''}${gap} / 파이프라인 ${pipelineCount}건 ${pipelineTablets}대 (커버 ${coverage ?? '-'}%)`);
  }

  // 기타(미분류) 요약 — 투명성
  result.unclassified = {
    cw: { count: cw.filter(o => o.team === '기타').length, tablets: cw.filter(o => o.team === '기타').reduce((s, o) => s + o.tablets, 0) },
    open: { count: open.filter(o => o.team === '기타').length },
  };
  result.paymentMix = { total: contractRows.length, totalTablets: paymentMixArr.reduce((s, p) => s + p.tablets, 0), types: paymentMixArr }; // CW 결제방법 비중
  result.overseasExcluded = { cw: overseasCw, open: overseasOpen }; // 원화(KRW) 외 해외 건 제외 수
  result.reclassifiedToChannel = { // B+C 보정: 인바운드 → 채널로 옮긴 건
    rule: "LeadSource='파트너사 소개' OR 소유자 User 부서 ∈ 채널",
    cw: reclassCw.length, open: reclassOpen.length,
    openTablets: reclassOpen.reduce((s, o) => s + o.tablets, 0),
    sample: reclassOpen.sort((a, b) => (a.age ?? 9999) - (b.age ?? 9999)).slice(0, 20).map(o => ({ account: o.account, branch: o.branch, stage: o.stage, leadSource: o.leadSource, ownerDept: o.ownerDept, owner: o.owner, partner: o.partner, tablets: o.tablets, age: o.age, link: o.link })),
  };

  const outDir = 'data';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/tablet-pace-${month}.json`;
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n✅ 저장 완료: ${outPath}`);

  if (s3Mode) {
    try {
      const { uploadJSON } = require('../shared/s3-upload.js');
      await uploadJSON(`tablet-pace/${month}.json`, result);
      console.log(`☁️  S3 업로드: tablet-pace/${month}.json`);
    } catch (e) { console.log('⚠️ S3 업로드 스킵:', e.message); }
  }
}

main().catch(e => { console.error('❌ 오류:', e.response?.data || e.message); process.exit(1); });
