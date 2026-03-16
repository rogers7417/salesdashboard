require('dotenv').config();
const axios = require('axios');

async function getSalesforceToken() {
  const url = process.env.SF_LOGIN_URL + '/services/oauth2/token';
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', process.env.SF_CLIENT_ID);
  params.append('client_secret', process.env.SF_CLIENT_SECRET);
  params.append('username', process.env.SF_USERNAME);
  params.append('password', decodeURIComponent(process.env.SF_PASSWORD));
  const res = await axios.post(url, params);
  return { accessToken: res.data.access_token, instanceUrl: res.data.instance_url };
}

async function main() {
  const { accessToken, instanceUrl } = await getSalesforceToken();
  console.log('Connected\n');

  // Test simple query
  const partnerId = '001IR00001q1h1NYAQ';
  const query = 'SELECT Id, IsConverted, Status FROM Lead WHERE PartnerName__c = \'' + partnerId + '\'';
  console.log('Query:', query);

  try {
    const url = instanceUrl + '/services/data/v59.0/query?q=' + encodeURIComponent(query);
    const res = await axios.get(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    console.log('Success:', res.data.totalSize, 'records');
    console.log('Sample:', res.data.records.slice(0, 3));
  } catch (e) {
    console.log('Error:', e.response?.data || e.message);
  }
}
main();
