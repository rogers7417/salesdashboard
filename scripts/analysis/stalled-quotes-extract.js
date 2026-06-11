// 방치 견적 추출 — 인바운드/아웃바운드(FieldUser 부서 기준) 견적·재견적·영업중·후속과업 없음·7일+ 방치
// Task 전체 이력 포함. 산출: data/stalled-quotes.json
require('dotenv').config();
const axios = require('axios'); axios.defaults.adapter = 'fetch';
const fs = require('fs');
const INB = ['인바운드세일즈', '인사이드세일즈', '필드세일즈1', '필드세일즈2', '필드세일즈3', '필드세일즈1팀', '필드세일즈2팀', '필드세일즈3팀', '영업지원1팀', '영업지원2팀', '온보딩팀'];
const OBS = ['아웃바운드세일즈'];
const teamOf = (dept) => INB.includes(dept) ? '인바운드' : (OBS.includes(dept) ? '아웃바운드' : '기타');

(async () => {
  const pr = new URLSearchParams(); pr.append('grant_type', 'password'); pr.append('client_id', process.env.SF_CLIENT_ID); pr.append('client_secret', process.env.SF_CLIENT_SECRET); pr.append('username', process.env.SF_USERNAME); pr.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const t = (await axios.post(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, pr)).data;
  const inst = t.instance_url, tok = t.access_token;
  const q = async (s) => { let all = []; let r = (await axios.get(`${inst}/services/data/v59.0/query`, { headers: { Authorization: `Bearer ${tok}` }, params: { q: s.replace(/\s+/g, ' ').trim() } })).data; all.push(...r.records); while (r.nextRecordsUrl) { r = (await axios.get(`${inst}${r.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${tok}` } })).data; all.push(...r.records); } return all; };
  const deptList = [...INB, ...OBS].map(d => `'${d}'`).join(',');
  const opps = await q(`
    SELECT Id, Name, Account.Name, Account.BranchName__c, StageName, fm_CompanyStatus__c,
           TotalNumberofEveryTablet__c, LastStageChangeInDays, AgeInDays,
           FieldUser__r.Name, FieldUser__r.Department, BOUser__r.Name
    FROM Opportunity
    WHERE IsClosed=false AND CurrencyIsoCode='KRW'
      AND (RecordType.Name='1. 테이블오더 (신규)' OR RecordType.Name='3. 테이블오더 (추가설치)')
      AND FieldUser__r.Department IN (${deptList})
      AND StageName IN ('견적','재견적') AND fm_CompanyStatus__c='영업중'`);

  const ids = opps.map(o => o.Id);
  const tasksByOpp = {}, openByOpp = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map(x => `'${x}'`).join(',');
    const tasks = await q(`SELECT WhatId, Status, Subject, Description, ActivityDate, CreatedDate, Owner.Name FROM Task WHERE WhatId IN (${chunk}) ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC`);
    tasks.forEach(tk => {
      (tasksByOpp[tk.WhatId] = tasksByOpp[tk.WhatId] || []).push(tk);
      if (tk.Status !== 'Completed' && tk.Status !== 'Closed') openByOpp[tk.WhatId] = (openByOpp[tk.WhatId] || 0) + 1;
    });
  }
  const today = new Date(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) + 'T00:00:00+09:00');
  const out = [];
  for (const o of opps) {
    if (/TEST/i.test(o.Account?.Name || o.Name)) continue;
    if ((o.AgeInDays ?? 999) > 90) continue;
    if (openByOpp[o.Id]) continue; // 후속 과업 있음 → 제외
    const tlist = (tasksByOpp[o.Id] || []);
    const last = tlist[0];
    const lastDate = last ? (last.ActivityDate || (last.CreatedDate || '').slice(0, 10)) : null;
    const dst = lastDate ? Math.round((today - new Date(lastDate + 'T00:00:00+09:00')) / 86400000) : ((o.AgeInDays ?? 0));
    if (dst < 7) continue; // 7일+ 방치만
    out.push({
      team: teamOf(o.FieldUser__r?.Department), store: o.Account?.Name || o.Name, branch: o.Account?.BranchName__c || '',
      stage: o.StageName, tablets: o.TotalNumberofEveryTablet__c || 0, stageAge: o.LastStageChangeInDays, age: o.AgeInDays,
      field: o.FieldUser__r?.Name || '-', fieldDept: o.FieldUser__r?.Department || '-', bo: o.BOUser__r?.Name || '-',
      daysSinceTask: dst, link: `https://torder.lightning.force.com/lightning/r/Opportunity/${o.Id}/view`,
      tasks: tlist.slice(0, 8).map(tk => ({ date: tk.ActivityDate || (tk.CreatedDate || '').slice(0, 10), subject: tk.Subject, owner: tk.Owner?.Name, desc: (tk.Description || '').replace(/\s+/g, ' ').trim().slice(0, 240) })),
    });
  }
  out.sort((a, b) => (b.daysSinceTask - a.daysSinceTask) || (b.tablets - a.tablets));
  const byTeam = (tm) => out.filter(o => o.team === tm);
  fs.writeFileSync('data/stalled-quotes.json', JSON.stringify({ generatedAt: new Date().toISOString(), criteria: '견적/재견적·영업중·후속과업없음·7일+방치·최근90일·TEST제외 (FieldUser 부서 기준)', inbound: byTeam('인바운드'), outbound: byTeam('아웃바운드') }, null, 2));
  console.log(`방치 견적 — 인바운드 ${byTeam('인바운드').length}건 / 아웃바운드 ${byTeam('아웃바운드').length}건`);
  console.log('저장: data/stalled-quotes.json');
})().catch(e => { console.error('ERR', e.response?.data || e.message); process.exit(1); });
