require('dotenv').config({ path: __dirname + '/.env' });
const axios = require('axios');

async function main() {
  const url = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const auth = await axios.post(url, params);
  const accessToken = auth.data.access_token;
  const instanceUrl = auth.data.instance_url;
  console.log('Salesforce 연결 성공\n');

  // Negotiation 상태 파트너사
  console.log('=== Negotiation 상태 파트너사 (61건) ===\n');

  var partnerNegoQuery = "SELECT Id, Name, Owner.Name, MOUstartdate__c, LastModifiedDate, CreatedDate FROM Account WHERE fm_AccountType__c = '파트너사' AND Progress__c = 'Negotiation' ORDER BY LastModifiedDate DESC";
  var partnerRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: partnerNegoQuery }
  });

  // 이번달 수정된 것 체크
  var thisMonth = new Date().toISOString().substring(0, 7);
  var thisMonthCount = 0;

  partnerRes.data.records.slice(0, 15).forEach(function(a) {
    var ownerName = a.Owner && a.Owner.Name ? a.Owner.Name : '-';
    var lastMod = a.LastModifiedDate ? a.LastModifiedDate.substring(0, 10) : '-';
    var created = a.CreatedDate ? a.CreatedDate.substring(0, 10) : '-';
    var isThisMonth = lastMod.substring(0, 7) === thisMonth ? ' <-- 이번달' : '';
    if (lastMod.substring(0, 7) === thisMonth) thisMonthCount++;
    console.log('  ' + a.Name.substring(0, 30).padEnd(32) + ' ' + ownerName.padEnd(10) + ' 수정:' + lastMod + isThisMonth);
  });

  // 전체 이번달 수정 건수
  var thisMonthModified = partnerRes.data.records.filter(function(a) {
    return a.LastModifiedDate && a.LastModifiedDate.substring(0, 7) === thisMonth;
  }).length;
  console.log('\n이번달 수정된 파트너사 네고: ' + thisMonthModified + '건');

  // Negotiation 상태 프랜차이즈본사
  console.log('\n=== Negotiation 상태 프랜차이즈본사 (54건) ===\n');

  var hqNegoQuery = "SELECT Id, Name, Owner.Name, MOUstartdate__c, LastModifiedDate, CreatedDate FROM Account WHERE fm_AccountType__c = '프랜차이즈본사' AND Progress__c = 'Negotiation' ORDER BY LastModifiedDate DESC";
  var hqRes = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: hqNegoQuery }
  });

  hqRes.data.records.slice(0, 15).forEach(function(a) {
    var ownerName = a.Owner && a.Owner.Name ? a.Owner.Name : '-';
    var lastMod = a.LastModifiedDate ? a.LastModifiedDate.substring(0, 10) : '-';
    var isThisMonth = lastMod.substring(0, 7) === thisMonth ? ' <-- 이번달' : '';
    console.log('  ' + a.Name.substring(0, 30).padEnd(32) + ' ' + ownerName.padEnd(10) + ' 수정:' + lastMod + isThisMonth);
  });

  var thisMonthHQ = hqRes.data.records.filter(function(a) {
    return a.LastModifiedDate && a.LastModifiedDate.substring(0, 7) === thisMonth;
  }).length;
  console.log('\n이번달 수정된 본사 네고: ' + thisMonthHQ + '건');

  // 요약
  console.log('\n=== 요약 ===');
  console.log('현재 네고 중: ' + (partnerRes.data.totalSize + hqRes.data.totalSize) + '건');
  console.log('  - 파트너사: ' + partnerRes.data.totalSize + '건');
  console.log('  - 프랜차이즈본사: ' + hqRes.data.totalSize + '건');
  console.log('이번달(' + thisMonth + ') 네고 활동: ' + (thisMonthModified + thisMonthHQ) + '건');
}

main().catch(function(err) {
  console.error('오류:', err.message);
});
