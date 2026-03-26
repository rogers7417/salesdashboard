/**
 * Salesforce Report API Server
 */
require('dotenv').config({ path: __dirname + '/../../.env' });

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.API_PORT || 4003;  // 기본값 4003으로 고정

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Routes
const inboundRoutes = require('./routes/inbound');
const channelRoutes = require('./routes/channel');
const kpiRoutes = require('./routes/kpi');
const installTrackingRoutes = require('./routes/install-tracking');
const exceptionRoutes = require('./routes/exception');

// 캐시 프리워밍용
const channelReport = require('./services/channel-report');

app.use('/api/inbound', inboundRoutes);
app.use('/api/channel', channelRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/install-tracking', installTrackingRoutes);
app.use('/api/exception', exceptionRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 목록
app.get('/api', (req, res) => {
  res.json({
    name: 'Salesforce Report API',
    version: '1.0.0',
    endpoints: [
      {
        path: '/api/inbound',
        method: 'GET',
        description: '인바운드 세일즈 리포트',
        params: {
          mode: 'daily | weekly | monthly | monthly-current | custom',
          start: 'YYYY-MM-DD (custom 모드)',
          end: 'YYYY-MM-DD (custom 모드)',
          detail: 'true | false (Lead 상세 데이터 포함)'
        }
      },
      {
        path: '/api/inbound/summary',
        method: 'GET',
        description: '인바운드 세일즈 요약 (빠른 조회)'
      },
      {
        path: '/api/channel',
        method: 'GET',
        description: '채널 세일즈 리포트',
        params: {
          section: 'summary | partner | franchise | mou | all'
        }
      },
      {
        path: '/api/channel/summary',
        method: 'GET',
        description: '채널 세일즈 요약'
      },
      {
        path: '/api/channel/tm',
        method: 'GET',
        description: '채널 TM 파트 현황 (MQL/SQL, FRT)'
      },
      {
        path: '/api/channel/am',
        method: 'GET',
        description: '채널 AM 파트 현황 (일별 캘린더)'
      },
      {
        path: '/api/kpi',
        method: 'GET',
        description: 'KPI 현황',
        params: {
          month: 'YYYY-MM (기본: 현재 월)'
        }
      },
      {
        path: '/api/kpi/months',
        method: 'GET',
        description: 'KPI 사용 가능 월 목록'
      },
      {
        path: '/api/kpi/refresh',
        method: 'POST',
        description: 'KPI 데이터 수동 새로고침 (Salesforce에서 재추출)',
        params: { month: 'YYYY-MM (선택)', daily: 'true|false (일별 포함, 기본: true)' }
      },
      {
        path: '/api/kpi/extract-status',
        method: 'GET',
        description: 'KPI 데이터 추출 상태 확인'
      },
      {
        path: '/api/exception/is-tm',
        method: 'GET',
        description: 'Exception IS TM 리포트 (미전환 리드 분석)',
        params: { month: 'YYYY-MM (기본: 현재 월)' }
      },
      {
        path: '/health',
        method: 'GET',
        description: '헬스 체크'
      }
    ]
  });
});

// ============================================
// KPI 데이터 자동 폴링 (30분 간격)
// ============================================
const KPI_EXTRACT_SCRIPT = __dirname + '/../../kpi-extract.js';
const INSTALL_TRACKING_SCRIPT = __dirname + '/../../install-tracking-extract.js';
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30분

let extractStatus = {
  isRunning: false,
  lastRun: null,
  lastResult: null,   // 'success' | 'error'
  lastError: null,
  lastDuration: null,
  nextRun: null,
};

function getCurrentMonth() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function runKpiExtract(month, daily = true) {
  return new Promise((resolve, reject) => {
    if (extractStatus.isRunning) {
      return reject(new Error('이미 추출 작업이 실행 중입니다'));
    }

    extractStatus.isRunning = true;
    const startTime = Date.now();
    const args = [KPI_EXTRACT_SCRIPT, month || getCurrentMonth()];
    if (daily) args.push('--daily');

    console.log(`\n🔄 [KPI Extract] 시작: node ${args.slice(1).join(' ')}`);

    const child = spawn('node', args, {
      cwd: __dirname + '/../../',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      extractStatus.isRunning = false;
      extractStatus.lastRun = new Date().toISOString();
      extractStatus.lastDuration = `${duration}s`;

      if (code === 0) {
        extractStatus.lastResult = 'success';
        extractStatus.lastError = null;
        console.log(`✅ [KPI Extract] 완료 (${duration}s)`);
        // 마지막 몇 줄만 출력
        const lines = stdout.trim().split('\n');
        lines.slice(-5).forEach(l => console.log(`   ${l}`));

        // KPI 추출 완료 후 설치 트래킹 추출도 실행
        runInstallTrackingExtract().catch(err => {
          console.error(`⚠️  [Scheduler] 설치 트래킹 추출 실패: ${err.message}`);
        });

        resolve({ success: true, duration, month: month || getCurrentMonth() });
      } else {
        extractStatus.lastResult = 'error';
        extractStatus.lastError = stderr || `Exit code: ${code}`;
        console.error(`❌ [KPI Extract] 실패 (code=${code}, ${duration}s)`);
        if (stderr) console.error(`   ${stderr.slice(0, 500)}`);
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      extractStatus.isRunning = false;
      extractStatus.lastResult = 'error';
      extractStatus.lastError = err.message;
      console.error(`❌ [KPI Extract] 프로세스 오류: ${err.message}`);
      reject(err);
    });
  });
}

// 설치 트래킹 추출 (별도 프로세스)
function runInstallTrackingExtract() {
  return new Promise((resolve, reject) => {
    console.log(`\n🔄 [Install Tracking Extract] 시작`);
    const startTime = Date.now();

    const child = spawn('node', [INSTALL_TRACKING_SCRIPT], {
      cwd: __dirname + '/../../',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`✅ [Install Tracking Extract] 완료 (${duration}s)`);
        const lines = stdout.trim().split('\n');
        lines.slice(-3).forEach(l => console.log(`   ${l}`));
        resolve({ success: true, duration });
      } else {
        console.error(`❌ [Install Tracking Extract] 실패 (code=${code}, ${duration}s)`);
        if (stderr) console.error(`   ${stderr.slice(0, 500)}`);
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      console.error(`❌ [Install Tracking Extract] 프로세스 오류: ${err.message}`);
      reject(err);
    });
  });
}

let pollTimer = null;

function startPolling() {
  // 서버 시작 시 즉시 1회 실행
  console.log(`\n📡 [Scheduler] KPI 데이터 자동 폴링 시작 (${POLL_INTERVAL_MS / 60000}분 간격)`);

  runKpiExtract().catch(err => {
    console.error(`⚠️  [Scheduler] 초기 추출 실패: ${err.message}`);
  });

  // 30분 간격 반복
  pollTimer = setInterval(() => {
    extractStatus.nextRun = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
    runKpiExtract().catch(err => {
      console.error(`⚠️  [Scheduler] 폴링 추출 실패: ${err.message}`);
    });
  }, POLL_INTERVAL_MS);

  extractStatus.nextRun = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
}

// 수동 새로고침 API
app.post('/api/kpi/refresh', async (req, res) => {
  const { month, daily } = req.query;
  try {
    const result = await runKpiExtract(month || undefined, daily !== 'false');
    res.json({ ...result, status: extractStatus });
  } catch (err) {
    res.status(err.message.includes('이미') ? 409 : 500).json({
      error: err.message,
      status: extractStatus,
    });
  }
});

// 추출 상태 확인 API
app.get('/api/kpi/extract-status', (req, res) => {
  res.json(extractStatus);
});

// 설치 트래킹 수동 새로고침 API
app.post('/api/install-tracking/refresh', async (req, res) => {
  try {
    const result = await runInstallTrackingExtract();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ============================================
// Uncaught exception / unhandled rejection 방어
// ============================================
process.on('uncaughtException', (err) => {
  console.error(`🛑 [FATAL] Uncaught Exception: ${err.message}`);
  console.error(err.stack);
  // 서버를 죽이지 않고 로깅만 (child process 에러 등)
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`⚠️  [WARN] Unhandled Rejection:`, reason);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║         Salesforce Report API Server                  ║
╠═══════════════════════════════════════════════════════╣
║  Port: ${PORT}                                          ║
║  Polling: ${POLL_INTERVAL_MS / 60000}분 간격 자동 추출                      ║
╚═══════════════════════════════════════════════════════╝
  `);

  // 자동 폴링 시작
  startPolling();

  // 채널 세일즈 캐시 프리워밍 (서버 시작 시 바로 캐시 채움)
  channelReport.warmCache().catch(err => {
    console.error(`⚠️  채널 캐시 프리워밍 실패: ${err.message}`);
  });
});

// 포트 충돌 시 graceful 처리
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ 포트 ${PORT} 이미 사용 중! 기존 프로세스를 종료해주세요.`);
    console.error(`   실행: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('Server error:', err);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔻 SIGTERM 수신, 서버 종료 중...');
  if (pollTimer) clearInterval(pollTimer);
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('🔻 SIGINT 수신, 서버 종료 중...');
  if (pollTimer) clearInterval(pollTimer);
  server.close(() => process.exit(0));
});
