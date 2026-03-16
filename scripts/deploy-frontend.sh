#!/bin/bash
# ============================================
# 프론트엔드 S3 + CloudFront 배포 스크립트
#
# 사용법:
#   ./scripts/deploy-frontend.sh
# ============================================

set -e

# 설정
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/dashboard/frontend"
S3_BUCKET="torder-salesforce-dashboard"
S3_PREFIX="frontend"
CF_DISTRIBUTION_ID="E1311NVZLY1JN"
CF_DOMAIN="dffqkvzh0w37t.cloudfront.net"
DATA_URL="https://${CF_DOMAIN}/dashboard"

echo "============================================"
echo "🚀 프론트엔드 배포 시작"
echo "============================================"

# 1. Next.js 정적 빌드
echo ""
echo "📦 [1/3] Next.js 빌드..."
cd "$FRONTEND_DIR"
NEXT_PUBLIC_S3_DATA_URL="$DATA_URL" npm run build
echo "   ✅ 빌드 완료 → out/ 디렉토리"

# 2. S3 업로드
echo ""
echo "☁️  [2/3] S3 업로드..."

# HTML 파일: 짧은 캐시 (60초)
aws s3 sync out/ "s3://${S3_BUCKET}/${S3_PREFIX}/" \
  --delete \
  --exclude "_next/*" \
  --cache-control "public, max-age=60, s-maxage=300" \
  --quiet

# _next/static 파일: 긴 캐시 (해시 기반, 1년)
aws s3 sync out/_next/ "s3://${S3_BUCKET}/${S3_PREFIX}/_next/" \
  --cache-control "public, max-age=31536000, immutable" \
  --quiet

echo "   ✅ S3 업로드 완료"

# 3. CloudFront 캐시 무효화
echo ""
echo "🔄 [3/3] CloudFront 캐시 무효화..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)
echo "   ✅ 무효화 ID: $INVALIDATION_ID"

echo ""
echo "============================================"
echo "✅ 배포 완료!"
echo "🌐 https://${CF_DOMAIN}"
echo "============================================"
