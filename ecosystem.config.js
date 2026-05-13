/**
 * PM2 설정 (통합)
 *
 * pm2 start ecosystem.config.js              # 전체 시작
 * pm2 restart sf-s3-extract                  # 추출 cron 수동 실행
 * pm2 restart sf-dashboard-api               # API 서버 재시작
 * pm2 logs sf-s3-extract                     # 추출 로그
 * pm2 logs sf-dashboard-api                  # API 로그
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  apps: [
    {
      name: 'sf-s3-extract',
      script: './server/extractors/s3-extract.js',
      cwd: __dirname,
      cron_restart: '*/30 * * * *',   // 30분마다 실행
      autorestart: false,              // 완료 후 재시작하지 않음
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'sf-dashboard-api',
      script: './server/api/server.js',
      cwd: __dirname,
      env: {
        API_PORT: 4003,
        NODE_ENV: 'development',
        SF_CLIENT_ID: process.env.SF_CLIENT_ID,
        SF_CLIENT_SECRET: process.env.SF_CLIENT_SECRET,
        SF_USERNAME: process.env.SF_USERNAME,
        SF_PASSWORD: process.env.SF_PASSWORD,
        SF_LOGIN_URL: process.env.SF_LOGIN_URL,
      },
      watch: false,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
