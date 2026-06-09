#!/usr/bin/env node
/**
 * S3 마스터 오케스트레이터
 *
 * 모든 추출 스크립트를 순차 실행하고 JSON을 S3에 업로드.
 * PM2 cron으로 30분마다 실행, 완료 후 프로세스 종료.
 *
 * 사용법:
 *   node scripts/s3-extract.js              # 전체 추출
 *   node scripts/s3-extract.js --kpi-only   # KPI만
 *   node scripts/s3-extract.js --channel-only
 *   node scripts/s3-extract.js --inbound-only
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { spawn } = require('child_process');
const { uploadJSON } = require('../shared/s3-upload');

const EXTRACTORS_DIR = __dirname;
const PROJECT_ROOT = path.join(__dirname, '..', '..');

function getCurrentMonth() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * child_process로 스크립트 실행
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      if (code === 0) {
        // 마지막 5줄만 출력
        const lines = stdout.trim().split('\n');
        lines.slice(-3).forEach(l => console.log(`   ${l}`));
        resolve({ success: true, duration: `${duration}s` });
      } else {
        console.error(`   ❌ Exit code ${code}`);
        if (stderr) console.error(`   ${stderr.trim().split('\n').slice(-3).join('\n   ')}`);
        reject(new Error(`Script failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', reject);
  });
}

async function runKPIExtract() {
  const month = getCurrentMonth();
  console.log(`\n📊 [1/4] KPI 추출 (${month}, --daily)...`);
  return runScript(path.join(EXTRACTORS_DIR, 'kpi-extract.js'), [month, '--daily']);
}

async function runInstallTracking() {
  console.log('\n🏗️  [2/4] 설치 트래킹 추출...');
  return runScript(path.join(EXTRACTORS_DIR, 'install-tracking-extract.js'));
}

async function runChannelExtract() {
  console.log('\n📡 [3/4] 채널 세일즈 추출...');
  try {
    const { runChannelExtract: extract } = require('./channel-extract');
    await extract();
    return { success: true };
  } catch (err) {
    console.error(`   ❌ 채널 추출 실패: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function runInboundExtract() {
  console.log('\n📞 [4/5] 인바운드 세일즈 추출...');
  try {
    const { runInboundExtract: extract } = require('./inbound-extract');
    await extract();
    return { success: true };
  } catch (err) {
    console.error(`   ❌ 인바운드 추출 실패: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function runPartnerTracking() {
  const fs = require('fs');
  console.log('\n🤝 [6/6] 파트너 라운드 데이터셋 빌드 + S3 업로드...');
  const t0 = Date.now();
  await runScript(path.join(PROJECT_ROOT, 'scripts/analysis/build-partner-tracking-dataset.js'));
  const trackingPath = path.join(PROJECT_ROOT, 'data/partner-tracking.json');
  if (!fs.existsSync(trackingPath)) throw new Error('partner-tracking.json 미생성');
  await uploadJSON('partners/tracking.json', JSON.parse(fs.readFileSync(trackingPath, 'utf8')));
  return { success: true, duration: `${((Date.now() - t0) / 1000).toFixed(1)}s` };
}

async function runVisitTracking() {
  const fs = require('fs');
  console.log('\n🗺️  [5/5] 방문 트래킹 데이터셋 빌드 + S3 업로드...');
  const t0 = Date.now();
  // 1) 신규 Opp 지오코딩 (증분 — 캐시 히트는 스킵)
  await runScript(path.join(PROJECT_ROOT, 'scripts/analysis/geocode-visit-opps.js'));
  // 2) Visit__c + Task 통합 데이터셋
  await runScript(path.join(PROJECT_ROOT, 'scripts/analysis/build-visit-tracking-dataset.js'));
  // 3) S3 업로드
  const trackingPath = path.join(PROJECT_ROOT, 'data/visit-tracking.json');
  if (!fs.existsSync(trackingPath)) throw new Error('visit-tracking.json 미생성');
  // legacy 통합 파일 (호환용)
  await uploadJSON('visits/tracking.json', JSON.parse(fs.readFileSync(trackingPath, 'utf8')));
  // 팀별 + summary 파일
  const splitDir = path.join(PROJECT_ROOT, 'data/visits');
  if (fs.existsSync(splitDir)) {
    const files = fs.readdirSync(splitDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const content = JSON.parse(fs.readFileSync(path.join(splitDir, f), 'utf8'));
      await uploadJSON(`visits/${f}`, content);
      console.log(`   ☁️  visits/${f} 업로드`);
    }
  }
  return { success: true, duration: `${((Date.now() - t0) / 1000).toFixed(1)}s` };
}

async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const kpiOnly = args.includes('--kpi-only');
  const channelOnly = args.includes('--channel-only');
  const inboundOnly = args.includes('--inbound-only');
  const visitOnly = args.includes('--visit-only');
  const partnerOnly = args.includes('--partner-only');
  const runAll = !kpiOnly && !channelOnly && !inboundOnly && !visitOnly && !partnerOnly;

  console.log('============================================');
  console.log('☁️  S3 데이터 추출 오케스트레이터');
  console.log(`📅 ${getCurrentMonth()} | ${new Date().toISOString()}`);
  console.log('============================================');

  const results = {};

  // 1. KPI Extract (child process — kpi-extract.js가 자체적으로 S3 업로드)
  if (runAll || kpiOnly) {
    try {
      results.kpi = await runKPIExtract();
      console.log(`   ✅ KPI 완료 (${results.kpi.duration})`);
    } catch (err) {
      results.kpi = { success: false, error: err.message };
      console.error(`   ❌ KPI 실패`);
    }
  }

  // 2. Install Tracking (child process — 로컬 파일 생성만, S3는 KPI에서 처리)
  if (runAll || kpiOnly) {
    try {
      results.installTracking = await runInstallTracking();
      console.log(`   ✅ 설치 트래킹 완료 (${results.installTracking.duration})`);
    } catch (err) {
      results.installTracking = { success: false, error: err.message };
      console.error(`   ❌ 설치 트래킹 실패`);
    }
  }

  // 3. Channel Extract
  if (runAll || channelOnly) {
    try {
      results.channel = await runChannelExtract();
      console.log(`   ✅ 채널 완료`);
    } catch (err) {
      results.channel = { success: false, error: err.message };
    }
  }

  // 4. Inbound Extract
  if (runAll || inboundOnly) {
    try {
      results.inbound = await runInboundExtract();
      console.log(`   ✅ 인바운드 완료`);
    } catch (err) {
      results.inbound = { success: false, error: err.message };
    }
  }

  // 5. Visit Tracking (지오코딩 + Visit__c/Task 통합 + S3 업로드)
  if (runAll || visitOnly) {
    try {
      results.visitTracking = await runVisitTracking();
      console.log(`   ✅ 방문 트래킹 완료 (${results.visitTracking.duration})`);
    } catch (err) {
      results.visitTracking = { success: false, error: err.message };
      console.error(`   ❌ 방문 트래킹 실패: ${err.message}`);
    }
  }

  // 6. Partner Tracking (파트너 라운드 + 지오코딩 + S3)
  if (runAll || partnerOnly) {
    try {
      results.partnerTracking = await runPartnerTracking();
      console.log(`   ✅ 파트너 라운드 완료 (${results.partnerTracking.duration})`);
    } catch (err) {
      results.partnerTracking = { success: false, error: err.message };
      console.error(`   ❌ 파트너 라운드 실패: ${err.message}`);
    }
  }

  // 6. last-updated.json 업로드
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  try {
    await uploadJSON('last-updated.json', {
      timestamp: new Date().toISOString(),
      duration: `${totalDuration}s`,
      month: getCurrentMonth(),
      results,
    });
  } catch (err) {
    console.error(`❌ last-updated.json 업로드 실패: ${err.message}`);
  }

  console.log('\n============================================');
  console.log(`✅ S3 추출 완료 — ${totalDuration}초`);
  Object.entries(results).forEach(([k, v]) => {
    console.log(`   ${v.success !== false ? '✅' : '❌'} ${k}: ${v.success !== false ? 'OK' : v.error || 'FAILED'}`);
  });
  console.log('============================================\n');
}

main().catch(err => {
  console.error('❌ 오케스트레이터 오류:', err.message);
  process.exit(1);
});
