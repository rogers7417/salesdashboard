'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchInboundSummary, fetchChannelSummary } from '@/lib/api';
import StatsCard from '@/components/StatsCard';

export default function Home() {
  const [inboundData, setInboundData] = useState<any>(null);
  const [channelData, setChannelData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [inbound, channel] = await Promise.all([
          fetchInboundSummary('monthly-current'),
          fetchChannelSummary(),
        ]);
        setInboundData(inbound);
        setChannelData(channel);
      } catch (err) {
        setError('API 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (error) {
    return (
      <div className="metro-card red" style={{ borderLeftWidth: '4px' }}>
        <h3 style={{ color: '#e81123', marginBottom: '10px' }}>연결 오류</h3>
        <p>{error}</p>
        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '10px' }}>
          API 서버: {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '30px 40px' }}>
      {/* 헤더 */}
      <h1>Sales Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '40px', fontSize: '1.1em' }}>
        인바운드 & 채널 세일즈 현황 | 생성일: {new Date().toLocaleDateString('ko-KR')}
      </p>

      {/* 인바운드 세일즈 섹션 */}
      <div className="metro-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, border: 'none', paddingBottom: 0 }}>인바운드 세일즈</h2>
          <Link href="/inbound" style={{ color: '#0078d4', textDecoration: 'none', fontSize: '0.9em' }}>
            상세 보기 →
          </Link>
        </div>

        {loading ? (
          <div className="metro-grid metro-grid-4">
            {[...Array(4)].map((_, i) => (
              <StatsCard key={i} title="" value="" loading />
            ))}
          </div>
        ) : inboundData ? (
          <>
            <p style={{ color: '#666', marginBottom: '20px' }}>{inboundData.periodLabel}</p>
            <div className="metro-grid metro-grid-4">
              <StatsCard
                title="총 Lead"
                value={inboundData.summary?.total || 0}
                subtitle={`MQL율 ${inboundData.summary?.mqlRate || 0}%`}
                color="blue"
              />
              <StatsCard
                title="MQL"
                value={inboundData.summary?.mql || 0}
                subtitle={`SQL 전환 ${inboundData.summary?.sqlRate || 0}%`}
                color="teal"
              />
              <StatsCard
                title="방문전환"
                value={inboundData.summary?.visit || 0}
                subtitle={`전환율 ${inboundData.summary?.visitRate || 0}%`}
                color="orange"
              />
              <StatsCard
                title="CW (계약)"
                value={inboundData.summary?.cw || 0}
                subtitle={`CW율 ${inboundData.summary?.cwRate || 0}%`}
                color="green"
              />
            </div>
          </>
        ) : null}
      </div>

      {/* 채널 세일즈 섹션 */}
      <div className="metro-card orange">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, border: 'none', paddingBottom: 0, borderBottomColor: '#ff8c00' }}>채널 세일즈</h2>
          <Link href="/channel" style={{ color: '#ff8c00', textDecoration: 'none', fontSize: '0.9em' }}>
            상세 보기 →
          </Link>
        </div>

        {loading ? (
          <div className="metro-grid metro-grid-4">
            {[...Array(4)].map((_, i) => (
              <StatsCard key={i} title="" value="" loading />
            ))}
          </div>
        ) : channelData ? (
          <>
            <p style={{ color: '#666', marginBottom: '20px' }}>{channelData.period?.label}</p>
            <div className="metro-grid metro-grid-4">
              <StatsCard
                title="파트너사"
                value={channelData.summary?.totalPartners || 0}
                subtitle={`소개매장 ${(channelData.summary?.totalPartnerStores || 0).toLocaleString()}개`}
                color="blue"
              />
              <StatsCard
                title="프랜차이즈 본사"
                value={channelData.summary?.totalFranchiseHQ || 0}
                subtitle={`브랜드 ${channelData.summary?.totalFranchiseBrands || 0}개`}
                color="orange"
              />
              <StatsCard
                title="가맹점"
                value={(channelData.summary?.totalFranchiseStores || 0).toLocaleString()}
                color="teal"
              />
              <StatsCard
                title="채널 Opportunity"
                value={`${channelData.summary?.totalOpportunities || 0}건`}
                subtitle={`Won ${channelData.summary?.wonOpportunities || 0}건`}
                color="green"
              />
            </div>
          </>
        ) : null}
      </div>

      {/* 업데이트 시간 */}
      {(inboundData || channelData) && (
        <p style={{ textAlign: 'center', color: '#999', fontSize: '0.85em', marginTop: '30px' }}>
          마지막 업데이트: {new Date().toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  );
}
