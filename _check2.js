const d = require('./data/kpi-extract-2026-03.json');
console.log('inbound keys:', Object.keys(d.inbound || {}));
console.log('channel keys:', Object.keys(d.channel || {}));
const ibo = d.inbound?.backOffice;
const cbo = d.channel?.backOffice;
console.log('ibo dailyClose:', JSON.stringify(ibo?.dailyClose, null, 2)?.substring(0, 500));
