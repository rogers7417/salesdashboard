const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  apps: [
    {
      name: 'sf-dashboard-api',
      script: './backend/server.js',
      cwd: __dirname,
      env: {
        API_PORT: 4003,
        NODE_ENV: 'development',
        SF_CLIENT_ID: process.env.SF_CLIENT_ID,
        SF_CLIENT_SECRET: process.env.SF_CLIENT_SECRET,
        SF_USERNAME: process.env.SF_USERNAME,
        SF_PASSWORD: process.env.SF_PASSWORD,
        SF_LOGIN_URL: process.env.SF_LOGIN_URL
      },
      watch: false,
      instances: 1,
      autorestart: true,
      max_restarts: 10
    }
  ]
};
