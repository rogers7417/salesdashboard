/**
 * Salesforce 연결 공통 모듈
 */
const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

// Salesforce 인증 (토큰 캐싱)
async function getToken() {
  // 토큰이 있고 만료되지 않았으면 재사용
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const url = `${process.env.SF_LOGIN_URL}/services/oauth2/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));

  const res = await axios.post(url, params);

  cachedToken = {
    accessToken: res.data.access_token,
    instanceUrl: res.data.instance_url
  };
  // 토큰 1시간 캐싱 (SF 토큰은 보통 2시간 유효)
  tokenExpiry = Date.now() + 60 * 60 * 1000;

  return cachedToken;
}

// SOQL 쿼리 실행
async function query(soql) {
  const { accessToken, instanceUrl } = await getToken();
  const url = `${instanceUrl}/services/data/v59.0/query`;
  const res = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    params: { q: soql }
  });
  return res.data;
}

// 대량 쿼리 (페이징 처리)
async function queryAll(soql) {
  const { accessToken, instanceUrl } = await getToken();
  let allRecords = [];
  let result = await query(soql);
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

// 토큰 캐시 초기화 (필요시)
function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = null;
}

module.exports = {
  getToken,
  query,
  queryAll,
  clearTokenCache
};
