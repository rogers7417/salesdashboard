/**
 * S3 JSON 업로드 유틸리티
 *
 * 환경변수:
 *   AWS_S3_ACCESS_KEY  — AWS Access Key ID
 *   AWS_S3_SECRET_KEY  — AWS Secret Access Key
 *   AWS_REGION         — AWS Region (기본: ap-northeast-2)
 *   S3_BUCKET_NAME     — S3 버킷 이름
 *   S3_PREFIX          — S3 키 접두사 (기본: 'dashboard/')
 */
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

let _client = null;

function getClient() {
  if (!_client) {
    const accessKeyId = process.env.AWS_S3_ACCESS_KEY;
    const secretAccessKey = process.env.AWS_S3_SECRET_KEY;
    const region = process.env.AWS_REGION || 'ap-northeast-2';

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS_S3_ACCESS_KEY / AWS_S3_SECRET_KEY 환경변수가 필요합니다');
    }

    _client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _client;
}

function getBucket() {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) throw new Error('S3_BUCKET_NAME 환경변수가 필요합니다');
  return bucket;
}

function getPrefix() {
  return process.env.S3_PREFIX || 'dashboard/';
}

/**
 * JSON 객체를 S3에 업로드
 * @param {string} key  — S3 키 (prefix 자동 추가). 예: 'kpi/monthly/2026-03.json'
 * @param {object} data — JSON 직렬화할 객체
 * @returns {Promise<{key: string, size: number}>}
 */
async function uploadJSON(key, data) {
  const client = getClient();
  const bucket = getBucket();
  const fullKey = `${getPrefix()}${key}`;
  const body = JSON.stringify(data);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fullKey,
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=300',
  });

  try {
    await client.send(command);
    const sizeMB = (Buffer.byteLength(body) / 1024).toFixed(1);
    console.log(`  ☁️  S3 업로드: ${fullKey} (${sizeMB}KB)`);
    return { key: fullKey, size: Buffer.byteLength(body) };
  } catch (err) {
    // 1회 재시도
    console.warn(`  ⚠️  S3 업로드 재시도: ${fullKey} — ${err.message}`);
    try {
      await new Promise(r => setTimeout(r, 1000));
      await client.send(command);
      const sizeMB = (Buffer.byteLength(body) / 1024).toFixed(1);
      console.log(`  ☁️  S3 업로드 (재시도 성공): ${fullKey} (${sizeMB}KB)`);
      return { key: fullKey, size: Buffer.byteLength(body) };
    } catch (retryErr) {
      console.error(`  ❌ S3 업로드 실패: ${fullKey} — ${retryErr.message}`);
      throw retryErr;
    }
  }
}

/**
 * 여러 JSON 파일을 한꺼번에 업로드
 * @param {Array<{key: string, data: object}>} items
 * @returns {Promise<Array<{key: string, size: number}>>}
 */
async function uploadMany(items) {
  const results = [];
  for (const item of items) {
    const result = await uploadJSON(item.key, item.data);
    results.push(result);
  }
  return results;
}

/**
 * S3 키 목록 조회
 * @param {string} prefix — 키 접두사 (getPrefix() 자동 추가)
 * @returns {Promise<string[]>}
 */
async function listKeys(prefix = '') {
  const client = getClient();
  const bucket = getBucket();
  const fullPrefix = `${getPrefix()}${prefix}`;

  const keys = [];
  let continuationToken = undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: fullPrefix,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);
    const contents = response.Contents || [];
    keys.push(...contents.map(c => c.Key));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * S3 데이터 URL 반환 (프론트엔드 설정용)
 */
function getDataUrl() {
  const cdnUrl = process.env.S3_CDN_URL;
  if (cdnUrl) return cdnUrl;

  const bucket = getBucket();
  const region = process.env.AWS_REGION || 'ap-northeast-2';
  return `https://${bucket}.s3.${region}.amazonaws.com/${getPrefix()}`;
}

module.exports = {
  uploadJSON,
  uploadMany,
  listKeys,
  getDataUrl,
};
