require('dotenv').config();
const axios = require('axios'); axios.defaults.adapter = 'fetch';
const fs = require('fs');
(async () => {
  const pr = new URLSearchParams(); pr.append('grant_type', 'password'); pr.append('client_id', process.env.SF_CLIENT_ID); pr.append('client_secret', process.env.SF_CLIENT_SECRET); pr.append('username', process.env.SF_USERNAME); pr.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const t = (await axios.post(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, pr)).data;
  const inst = t.instance_url, tok = t.access_token;
  const q = async (s) => { let all = []; let r = (await axios.get(`${inst}/services/data/v59.0/query`, { headers: { Authorization: `Bearer ${tok}` }, params: { q: s.replace(/\s+/g, ' ').trim() } })).data; all.push(...r.records); while (r.nextRecordsUrl) { r = (await axios.get(`${inst}${r.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${tok}` } })).data; all.push(...r.records); } return all; };
  // 인바운드 판정 = 실제 담당(FieldUser) 부서 기준 — 아웃바운드 담당자가 든 건 제외
  const INB = "FieldUser__r.Department IN ('인바운드세일즈','인사이드세일즈','필드세일즈1','필드세일즈2','필드세일즈3','필드세일즈1팀','필드세일즈2팀','필드세일즈3팀','영업지원1팀','영업지원2팀','온보딩팀')";
  // 인바운드 견적/재견적 · 영업중(오픈전 제외)
  const opps = await q(`
    SELECT Id, Name, Account.Name, Account.BranchName__c, StageName, fm_CompanyStatus__c,
           TotalNumberofEveryTablet__c, LastStageChangeInDays, AgeInDays, CreatedDate,
           FieldUser__r.Name, BOUser__r.Name, LeadSource, AdvancePaymentDate__c
    FROM Opportunity
    WHERE IsClosed=false AND CurrencyIsoCode='KRW'
      AND (RecordType.Name='1. 테이블오더 (신규)' OR RecordType.Name='3. 테이블오더 (추가설치)')
      AND ${INB}
      AND StageName IN ('견적','재견적')
      AND fm_CompanyStatus__c='영업중'`);
  console.log(`인바운드 견적/재견적 · 영업중: ${opps.length}건 — 후속과업/리터치 점검 중...`);

  // Task 조회 (열린 과업 + 마지막 활동)
  const ids = opps.map(o => o.Id);
  const openByOpp = {}, lastByOpp = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(x => `'${x}'`).join(',');
    const tasks = await q(`SELECT WhatId, Status, Subject, ActivityDate, CreatedDate FROM Task WHERE WhatId IN (${chunk}) ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC`);
    tasks.forEach(tk => {
      if (tk.Status !== 'Completed' && tk.Status !== 'Closed') openByOpp[tk.WhatId] = (openByOpp[tk.WhatId] || 0) + 1;
      if (!lastByOpp[tk.WhatId]) lastByOpp[tk.WhatId] = tk;
    });
  }
  const today = new Date(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) + 'T00:00:00+09:00');
  const rows = opps.map(o => {
    const lt = lastByOpp[o.Id];
    const ltDate = lt ? (lt.ActivityDate || (lt.CreatedDate || '').slice(0, 10)) : null;
    return {
      id: o.Id, store: o.Account?.Name || o.Name, branch: o.Account?.BranchName__c || '',
      stage: o.StageName, tablets: o.TotalNumberofEveryTablet__c || 0,
      stageAge: o.LastStageChangeInDays, age: o.AgeInDays,
      field: o.FieldUser__r?.Name || '-', bo: o.BOUser__r?.Name || '-',
      openTasks: openByOpp[o.Id] || 0,
      lastTask: lt ? lt.Subject : null, lastTaskDate: ltDate,
      daysSinceTask: ltDate ? Math.round((today - new Date(ltDate + 'T00:00:00+09:00')) / 86400000) : null,
      advancePaid: !!o.AdvancePaymentDate__c,
      link: `https://torder.lightning.force.com/lightning/r/Opportunity/${o.Id}/view`,
    };
  });
  // 놓치고 있는 것 = 후속 과업 없음(openTasks=0) — 견적 받고 리터치 안 잡힌 건
  const missed = rows.filter(r => r.openTasks === 0);
  // 위험순: 단계경과 + Task 방치 + 태블릿 가중
  missed.forEach(r => { r.risk = (r.stageAge || 0) + (r.daysSinceTask != null ? r.daysSinceTask : 30) + Math.min(r.tablets, 30) * 0.5; });
  missed.sort((a, b) => b.risk - a.risk);
  console.log(`\n★ 견적 후 후속 과업(리터치) 없는 영업중 매장: ${missed.length}건 / 태블릿 ${missed.reduce((s, r) => s + r.tablets, 0)}대\n`);
  missed.slice(0, 25).forEach(r => console.log(`  ${r.store}${r.branch ? ' ' + r.branch : ''} | ${r.stage} | ${r.tablets}대 | 단계 ${r.stageAge}일 | 마지막Task ${r.daysSinceTask != null ? r.daysSinceTask + '일전(' + r.lastTask + ')' : '없음'} | 담당 ${r.field}\n      ${r.link}`));
  fs.writeFileSync('data/ibbo-missed.json', JSON.stringify({ generatedAt: new Date().toISOString(), criteria: '인바운드 견적/재견적 · 영업중 · 후속과업 없음', total: missed.length, tablets: missed.reduce((s, r) => s + r.tablets, 0), opps: missed }, null, 2));
  console.log('\n저장: data/ibbo-missed.json');
})().catch(e => { console.error('ERR', e.response?.data || e.message); process.exit(1); });
