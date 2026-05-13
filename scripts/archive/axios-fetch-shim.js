// Drop-in axios adapter using global fetch. Works around ECONNRESET seen
// when axios on Node v23 talks to login.salesforce.com.
const axios = require('axios');

const fetchAdapter = async (config) => {
  let url = (config.baseURL ? config.baseURL.replace(/\/$/, '') + '/' : '') + (config.url || '').replace(/^\//, '');
  if (config.params) {
    const sp = new URLSearchParams(config.params);
    url += (url.includes('?') ? '&' : '?') + sp.toString();
  }
  const headers = { ...(config.headers || {}) };
  // Strip headers axios stores under Common/etc.
  for (const k of Object.keys(headers)) {
    if (typeof headers[k] === 'object') delete headers[k];
  }
  const init = { method: (config.method || 'get').toUpperCase(), headers };
  if (config.data !== undefined && init.method !== 'GET' && init.method !== 'HEAD') {
    if (config.data instanceof URLSearchParams) {
      init.body = config.data.toString();
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (typeof config.data === 'string' || Buffer.isBuffer(config.data)) {
      init.body = config.data;
    } else {
      init.body = JSON.stringify(config.data);
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  const out = {
    data,
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers),
    config,
    request: {}
  };
  if (res.status >= 200 && res.status < 300) return out;
  const err = new Error(`Request failed with status code ${res.status}`);
  err.response = out;
  err.config = config;
  err.code = `ERR_BAD_${res.status >= 500 ? 'RESPONSE' : 'REQUEST'}`;
  throw err;
};

axios.defaults.adapter = fetchAdapter;
