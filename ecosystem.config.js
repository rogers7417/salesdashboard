/**
 * PM2 설정
 *
 * pm2 start ecosystem.config.js
 * pm2 restart sf-s3-extract    # 수동 즉시 실행
 * pm2 logs sf-s3-extract       # 로그 확인
 */
module.exports = {
  apps: [
    {
      name: 'sf-s3-extract',
      script: './scripts/s3-extract.js',
      cwd: __dirname,
      cron_restart: '*/30 * * * *',   // 30분마다 실행
      autorestart: false,              // 완료 후 재시작하지 않음
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
