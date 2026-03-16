require('dotenv').config();
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

  const partnerId = '001IR00001q1h58YAA'; // 퍼스트카드넷

  const query = "SELECT Id, Name, CreatedDate, Status, IsConverted FROM Lead WHERE PartnerName__c = '" + partnerId + "' ORDER BY CreatedDate";

  const res = await axios.get(instanceUrl + '/services/data/v59.0/query', {
    headers: { 'Authorization': 'Bearer ' + accessToken },
    params: { q: query }
  });

  console.log('=== 퍼스트카드넷 전체 Lead ===');
  console.log('총 ' + res.data.totalSize + '건\n');

  res.data.records.forEach(function(lead, i) {
    console.log((i+1) + '. ' + lead.CreatedDate.substring(0, 10) + ' | ' + lead.Name + ' | ' + lead.Status);
  });
}

main().catch(console.error);
