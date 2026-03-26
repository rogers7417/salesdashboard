/**
 * 데이터 API 레이어
 *
 * S3_DATA_URL이 설정되면 S3에서 직접 정적 JSON을 fetch.
 * 설정되지 않으면 기존 Express 백엔드 API로 폴백.
 */
const S3_DATA_URL = process.env.NEXT_PUBLIC_S3_DATA_URL || '';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4003';
const USE_S3 = !!S3_DATA_URL;

// custom 모드 제거
export type PeriodMode = 'daily' | 'weekly' | 'monthly' | 'monthly-current';

function getCurrentMonth(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function fetchS3<T>(path: string): Promise<T> {
  const res = await fetch(`${S3_DATA_URL}/${path}`, { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) return null as T;
    throw new Error(`S3 fetch failed: ${path} (${res.status})`);
  }
  return res.json();
}

// ============================================
// 인바운드 세일즈 API
// ============================================
export async function fetchInboundReport(mode: PeriodMode, start?: string, end?: string) {
  if (USE_S3) {
    return fetchS3(`inbound/${mode}.json`);
  }
  const params = new URLSearchParams({ mode });
  const res = await fetch(`${API_URL}/api/inbound?${params}`);
  if (!res.ok) throw new Error('Failed to fetch inbound report');
  return res.json();
}

export async function fetchInboundSummary(mode: PeriodMode) {
  if (USE_S3) {
    return fetchS3(`inbound/summary/${mode}.json`);
  }
  const res = await fetch(`${API_URL}/api/inbound/summary?mode=${mode}`);
  if (!res.ok) throw new Error('Failed to fetch inbound summary');
  return res.json();
}

// ============================================
// 채널 세일즈 API
// ============================================
export async function fetchChannelReport(section: string = 'all', month?: string) {
  if (USE_S3) {
    const m = month || getCurrentMonth();
    const data = await fetchS3<any>(`channel/${m}.json`);
    if (!data) return null;
    if (section === 'summary') {
      return { period: data.period, summary: data.summary, generatedAt: data.generatedAt };
    }
    return data;
  }
  const params = new URLSearchParams({ section });
  if (month) params.append('month', month);
  const res = await fetch(`${API_URL}/api/channel?${params}`);
  if (!res.ok) throw new Error('Failed to fetch channel report');
  return res.json();
}

export async function fetchChannelSummary(month?: string) {
  if (USE_S3) {
    const m = month || getCurrentMonth();
    return fetchS3(`channel/summary/${m}.json`);
  }
  const params = month ? `?month=${month}` : '';
  const res = await fetch(`${API_URL}/api/channel/summary${params}`);
  if (!res.ok) throw new Error('Failed to fetch channel summary');
  return res.json();
}

export async function fetchChannelTM(month?: string) {
  if (USE_S3) {
    const m = month || getCurrentMonth();
    const data = await fetchS3<any>(`channel/${m}.json`);
    return data ? {
      period: data.period,
      channelLeadsByOwner: data.channelLeadsByOwner || data.summary?.channelLeadsByOwner,
      generatedAt: data.generatedAt,
    } : null;
  }
  const params = month ? `?month=${month}` : '';
  const res = await fetch(`${API_URL}/api/channel/tm${params}`);
  if (!res.ok) throw new Error('Failed to fetch channel TM');
  return res.json();
}

export async function fetchChannelAM(month?: string) {
  if (USE_S3) {
    const m = month || getCurrentMonth();
    const data = await fetchS3<any>(`channel/${m}.json`);
    return data ? {
      period: data.period,
      amHeatmap: data.amHeatmap || data.summary?.amHeatmap,
      onboarding: data.onboarding || null,
      generatedAt: data.generatedAt,
    } : null;
  }
  const params = month ? `?month=${month}` : '';
  const res = await fetch(`${API_URL}/api/channel/am${params}`);
  if (!res.ok) throw new Error('Failed to fetch channel AM');
  return res.json();
}

// 채널 세일즈 KPI v2 전용 데이터
// S3: channel/kpi-v2/{month}.json (~3MB, 서버에서 미리 슬림 생성)
// API 폴백: section=kpi-v2로 서버 필터링 (~2MB)
export async function fetchChannelSales(month?: string) {
  if (USE_S3) {
    const m = month || getCurrentMonth();
    // KPI v2 전용 slim JSON 우선 시도 → 없으면 full JSON 폴백
    const slim = await fetchS3<any>(`channel/kpi-v2/${m}.json`);
    if (slim) return slim;
    // 폴백: full JSON에서 필요한 필드만 추출
    const data = await fetchS3<any>(`channel/${m}.json`);
    if (!data) return null;
    const rawDataSlim = data.rawData ? {
      channelEvents: (data.rawData.channelEvents || []).map((e: any) => ({
        Id: e.Id, WhatId: e.WhatId, Subject: e.Subject, Description: e.Description,
        CreatedDate: e.CreatedDate, ActivityDate: e.ActivityDate,
        Owner: e.Owner ? { Name: e.Owner.Name } : null,
      })),
      partners: (data.rawData.partners || []).map((a: any) => ({
        Id: a.Id, Name: a.Name, Progress__c: a.Progress__c, MOUstartdate__c: a.MOUstartdate__c,
        Owner: a.Owner ? { Name: a.Owner.Name } : null,
        fm_AccountType__c: a.fm_AccountType__c, CreatedDate: a.CreatedDate,
      })),
      franchiseHQAccounts: (data.rawData.franchiseHQAccounts || []).map((a: any) => ({
        Id: a.Id, Name: a.Name, Progress__c: a.Progress__c, MOUstartdate__c: a.MOUstartdate__c,
        Owner: a.Owner ? { Name: a.Owner.Name } : null,
        fm_AccountType__c: a.fm_AccountType__c, CreatedDate: a.CreatedDate,
      })),
      channelTasks: (data.rawData.channelTasks || []).map((t: any) => ({
        WhatId: t.WhatId, CreatedDate: t.CreatedDate, Subject: t.Subject,
      })),
    } : null;
    return {
      period: data.period, kpi: data.kpi,
      summary: data.summary ? {
        channelLeadsByOwner: data.summary.channelLeadsByOwner,
      } : null,
      mouStats: data.mouStats, partnerStats: data.partnerStats,
      franchiseHQList: data.franchiseHQList,
      rawData: rawDataSlim, generatedAt: data.generatedAt,
    };
  }
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  params.set('section', 'kpi-v2');
  const res = await fetch(`${API_URL}/api/channel?${params}`);
  if (!res.ok) throw new Error('Failed to fetch channel sales data');
  return res.json();
}

// ============================================
// KPI API
// ============================================
export async function fetchKPIReport(month?: string, date?: string, weekStart?: string, weekEnd?: string) {
  if (USE_S3) {
    if (weekStart && weekEnd) {
      return fetchS3(`kpi/weekly/${weekStart}_${weekEnd}.json`);
    }
    if (date) {
      return fetchS3(`kpi/daily/${date}.json`);
    }
    const m = month || getCurrentMonth();
    return fetchS3(`kpi/monthly/${m}.json`);
  }
  const params = new URLSearchParams();
  if (weekStart && weekEnd) {
    params.set('weekStart', weekStart);
    params.set('weekEnd', weekEnd);
  } else if (date) {
    params.set('date', date);
  } else if (month) {
    params.set('month', month);
  }
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/kpi${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch KPI report');
  return res.json();
}

export interface Week {
  weekNum: number;
  start: string;
  end: string;
  dates: string[];
}

export async function fetchKPIWeeks(month: string): Promise<{ month: string; weeks: Week[] }> {
  if (USE_S3) {
    return fetchS3(`kpi/weeks/${month}.json`);
  }
  const res = await fetch(`${API_URL}/api/kpi/weeks?month=${month}`);
  if (!res.ok) throw new Error('Failed to fetch KPI weeks');
  return res.json();
}

export async function fetchKPIMonths(): Promise<{ months: string[] }> {
  if (USE_S3) {
    return fetchS3('kpi/months.json');
  }
  const res = await fetch(`${API_URL}/api/kpi/months`);
  if (!res.ok) throw new Error('Failed to fetch KPI months');
  return res.json();
}

export async function fetchKPIDates(month: string): Promise<{ month: string; dates: string[] }> {
  if (USE_S3) {
    return fetchS3(`kpi/dates/${month}.json`);
  }
  const res = await fetch(`${API_URL}/api/kpi/dates?month=${month}`);
  if (!res.ok) throw new Error('Failed to fetch KPI dates');
  return res.json();
}

// ============================================
// 설치 트래킹 API
// ============================================
export async function fetchInstallTracking() {
  if (USE_S3) {
    return fetchS3('install-tracking.json');
  }
  const res = await fetch(`${API_URL}/api/install-tracking`);
  if (!res.ok) throw new Error('Failed to fetch install tracking data');
  return res.json();
}

// ============================================
// Exception TM API
// ============================================
export async function fetchExceptionTM(month?: string) {
  if (USE_S3) {
    const m = month || getCurrentMonth();
    return fetchS3(`exception/is-tm/${m}.json`);
  }
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  const res = await fetch(`${API_URL}/api/exception/is-tm?${params}`);
  if (!res.ok) throw new Error('Failed to fetch exception TM data');
  return res.json();
}

// ============================================
// 헬스 체크 / 최종 업데이트 확인
// ============================================
export async function checkHealth() {
  if (USE_S3) {
    return fetchS3('last-updated.json');
  }
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error('API server not responding');
  return res.json();
}
