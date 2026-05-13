'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchKPIReport, fetchChannelSales } from '@/lib/api';

/* ─────────────────── 타입 ─────────────────── */
interface StoryMessage {
  emoji: string;
  text: string;
  category: 'celebrate' | 'action' | 'cheer';
}

/* ──────────── 마스코트 이미지 매핑 ────────────── */
const MASCOT: Record<string, string[]> = {
  celebrate: ['/did/celebrate1.png', '/did/celebrate2.png', '/did/celebrate3.png'],
  action: ['/did/action1.png', '/did/action2.png'],
  cheer: ['/did/cheer1.png', '/did/cheer2.png'],
};

/* ─────────────── 템플릿 풀 ─────────────────── */
const TPL = {
  frtGood: [
    (o: string) => `[[${o}]]님이 고객님의 문의를 빠르게 응대했어요`,
    (o: string) => `[[${o}]]님 덕분에 고객님이 좋은 첫인상을 받았어요`,
    (o: string) => `[[${o}]]님의 빠른 응대로 고객님이 좋은 상담을 받으셨어요`,
  ],
  meetingToday: [
    (o: string, a: string) => `[[${o}]]님이 오늘 [[${a}]]와 뜻깊은 미팅을 가져요, 응원합니다!`,
    (o: string, a: string) => `[[${a}]] 방문 예정! [[${o}]]님 좋은 만남 되길 바랍니다`,
    (o: string, a: string) => `오늘 [[${o}]]님과 [[${a}]]의 만남이 기다리고 있어요`,
  ],
  meetingDone: [
    (o: string, a: string) => `[[${o}]]님이 [[${a}]]와 좋은 미팅을 마쳤어요, 수고하셨어요!`,
    (o: string, a: string) => `[[${a}]]와의 미팅이 잘 마무리됐어요, [[${o}]]님 수고하셨어요`,
  ],
  newLead: [
    (c: string) => `[[${c}]] 고객님이 관심을 보이고 있어요, 좋은 시작이에요`,
    (c: string) => `새로운 고객 [[${c}]]님이 우리를 찾아왔어요, 좋은 인연이 되길!`,
    (c: string) => `[[${c}]] 고객님과 좋은 이야기가 시작될 수 있어요`,
  ],
  mqlFollowUp: [
    (o: string, c: string) => `[[${c}]] 고객님이 우리에게 관심을 보이고 있어요, [[${o}]]님 응원합니다`,
    (o: string, c: string) => `[[${o}]]님, [[${c}]] 고객님이 우리를 찾아주셨어요`,
    (o: string, c: string) => `[[${c}]] 고객님이 우리를 기다리고 있어요, [[${o}]]님 화이팅!`,
  ],
  sqlFollowUp: [
    (o: string, c: string) => `[[${c}]] 고객님과의 상담이 기다리고 있어요, [[${o}]]님 응원합니다`,
    (o: string, c: string) => `[[${o}]]님, [[${c}]] 고객님과 좋은 결과가 있을 거예요`,
    (o: string, c: string) => `[[${c}]] 고객님이 기대하고 있어요, [[${o}]]님 좋은 소식 기대해요`,
  ],
  partnerSettled: [
    (o: string, p: string) => `[[${o}]]님 담당 [[${p}]]에서 첫 고객이 우리를 찾아왔어요!`,
    (o: string, p: string) => `[[${p}]]에서 첫 리드가 들어왔어요, [[${o}]]님 축하합니다!`,
  ],
  partnerCheer: [
    (o: string, p: string) => `[[${o}]]님, [[${p}]]에 한번 연락해볼까요? 좋은 파트너가 될 수 있어요!`,
    (o: string, p: string) => `[[${o}]]님이 [[${p}]]와 만나보면 좋은 이야기가 시작될 거예요`,
  ],
  taskDone: [
    (o: string) => `[[${o}]]님이 오늘의 과업을 하나 더 완료했어요!`,
    (o: string) => `한 걸음 한 걸음, [[${o}]]님 오늘도 착실하게 진행 중이에요`,
  ],
  visitDone: [
    (o: string, s: string) => `[[${o}]]님이 [[${s}]] 고객님을 직접 만나고 오셨어요, 수고하셨어요!`,
    (o: string, s: string) => `[[${o}]]님이 [[${s}]] 고객님과 좋은 만남을 가졌어요!`,
    (o: string, s: string) => `[[${s}]] 방문 완료! [[${o}]]님 오늘도 멋지게 해내셨어요`,
  ],
  // ── TM 전용 ──
  tmFrtGood: [
    (o: string) => `[[${o}]]님이 채널 고객 문의에 빠르게 응대했어요`,
    (o: string) => `[[${o}]]님의 빠른 전화 응대, 고객님이 좋아하실 거예요`,
    (o: string) => `[[${o}]]님 덕분에 채널 고객님이 좋은 첫인상을 받았어요`,
  ],
  tmMqlFollowUp: [
    (o: string, c: string) => `[[${c}]] 고객님이 전환을 기다리고 있어요, [[${o}]]님 화이팅!`,
    (o: string, c: string) => `[[${o}]]님, [[${c}]] 고객님에게 한 통화만 해볼까요?`,
    (o: string, c: string) => `[[${c}]] 고객님과의 좋은 연결이 시작될 수 있어요, [[${o}]]님 응원합니다`,
  ],
  tmOppCheer: [
    (o: string, c: string) => `[[${o}]]님이 [[${c}]] 건을 진행 중이에요, 좋은 결과 기대해요!`,
    (o: string, c: string) => `[[${c}]] 상담이 진행되고 있어요, [[${o}]]님 끝까지 화이팅!`,
    (o: string, c: string) => `[[${o}]]님의 [[${c}]] 건, 좋은 소식이 올 거예요`,
  ],
};

function pick<T>(arr: T[]): T {
  if (!arr || arr.length === 0) return (() => '') as unknown as T;
  return arr[Math.floor(Math.random() * arr.length)];
}

// 프랜차이즈 본사명 정리: "(주)금탑에프앤비_청담동말자싸롱" → "(주)금탑에프앤비"
function cleanName(name: string): string {
  if (!name) return '';
  return name.split('_')[0].trim();
}

// 영어 이름 판별: 알파벳으로만 이루어진 이름은 스킵
function isEnglishName(name: string): boolean {
  if (!name) return false;
  return /^[A-Za-z\s.\-]+$/.test(name.trim());
}

// [[name]] 마커 제거한 순수 텍스트 길이
function plainLength(text: string): number {
  return text.replace(/\[\[|\]\]/g, '').length;
}

// [[name]] → 강조 스타일 적용된 React 노드로 변환
function renderHighlightedText(text: string, baseFontSize: number) {
  const parts = text.split(/(\[\[.+?\]\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[\[(.+?)\]\]$/);
    if (m) {
      return (
        <span key={i} style={{
          fontSize: `${Math.round(baseFontSize * 1.2)}px`,
          fontWeight: 800,
        }}>
          {m[1]}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─────────────── 메시지 생성 ─────────────────── */
function generateMessages(kpiData: any, channelData: any): StoryMessage[] {
  const msgs: StoryMessage[] = [];
  const today = new Date().toISOString().split('T')[0];

  // ── A. FRT 빠른 응대 (byOwner에서 frtOk > 0인 담당자) ──
  const byOwner = kpiData?.inbound?.insideSales?.byOwner || [];
  byOwner.forEach((o: any) => {
    if (o.frtOk > 0 && o.lead > 0 && !isEnglishName(o.name)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.frtGood)(o.name),
        category: 'celebrate',
      });
    }
  });

  // ── B. 미전환 MQL → 문의 접수 톤 ──
  const unconverted = kpiData?.inbound?.insideSales?.rawData?.unconvertedMQL || [];
  unconverted.forEach((lead: any) => {
    if (lead.company && lead.owner && !isEnglishName(lead.owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.mqlFollowUp)(lead.owner, lead.company || lead.name),
        category: 'action',
      });
    }
  });

  // ── C. 미방문 SQL → 상담 진행 톤 ──
  const noVisit = kpiData?.inbound?.insideSales?.rawData?.noVisitSQL || [];
  noVisit.forEach((lead: any) => {
    if (lead.company && lead.owner && !isEnglishName(lead.owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.sqlFollowUp)(lead.owner, lead.company || lead.name),
        category: 'action',
      });
    }
  });

  // ── D. 오늘 방문 완료 (Field Sales) ──
  const visitCal = kpiData?.inbound?.fieldSales?.visitCalendar || [];
  visitCal.forEach((v: any) => {
    const todayVisits = v.dates?.[today] || [];
    todayVisits.forEach((visit: any) => {
      if (visit.status === '방문완료') {
        const storeName = (visit.oppName || '').split('_')[0];
        msgs.push({
          emoji: '',
          text: pick(TPL.visitDone)(v.name, storeName),
          category: 'celebrate',
        });
      }
    });
  });

  // ── E. 오늘 예정 미팅 (Channel Events) ──
  const accountMap = new Map<string, string>();
  (channelData?.rawData?.partners || []).forEach((a: any) => accountMap.set(a.Id, cleanName(a.Name)));
  (channelData?.rawData?.franchiseHQAccounts || []).forEach((a: any) => accountMap.set(a.Id, cleanName(a.Name)));

  const events = channelData?.rawData?.channelEvents || [];
  const todayEvents = events.filter((e: any) => (e.ActivityDate || '').startsWith(today));
  todayEvents.forEach((ev: any) => {
    const owner = ev.Owner?.Name || '';
    const account = accountMap.get(ev.WhatId) || ev.Subject || '';
    if (owner && account && !isEnglishName(owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.meetingToday)(owner, account),
        category: 'action',
      });
    }
  });

  // ── F. 최근 완료 미팅 (이번 주 내, Description 있는 것) ──
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const recentMeetings = events.filter((e: any) =>
    e.ActivityDate && e.ActivityDate >= weekAgo && e.ActivityDate < today && e.Description
  );
  recentMeetings.slice(0, 5).forEach((ev: any) => {
    const owner = ev.Owner?.Name || '';
    const account = accountMap.get(ev.WhatId) || ev.Subject || '';
    if (owner && !isEnglishName(owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.meetingDone)(owner, account),
        category: 'celebrate',
      });
    }
  });

  // ── G. 파트너 첫 리드 안착 축하 (담당자명 포함) ──
  const partnerOnboard = channelData?.mouStats?.onboarding?.partner?.list || [];
  const hqOnboard = channelData?.mouStats?.onboarding?.franchiseHQ?.list || [];
  [...partnerOnboard, ...hqOnboard].forEach((p: any) => {
    if (p.isSettled || p.settled) {
      const name = cleanName(p.name || p.hqName || '');
      const owner = p.owner || '';
      if (name && owner && !isEnglishName(owner)) {
        msgs.push({
          emoji: '',
          text: pick(TPL.partnerSettled)(owner, name),
          category: 'celebrate',
        });
      }
    }
  });

  // ── H. 미안착 파트너 응원 (담당자명 포함) ──
  [...partnerOnboard, ...hqOnboard]
    .filter((p: any) => !(p.isSettled || p.settled) && (p.eventCount || 0) === 0)
    .slice(0, 5)
    .forEach((p: any) => {
      const name = cleanName(p.name || p.hqName || '');
      const owner = p.owner || '';
      if (name && owner && !isEnglishName(owner)) {
        msgs.push({
          emoji: '',
          text: pick(TPL.partnerCheer)(owner, name),
          category: 'cheer',
        });
      }
    });

  // ── I. 오늘 Task 완료 ──
  const cTasks = channelData?.rawData?.channelTasks || [];
  const completedToday = cTasks.filter((t: any) =>
    t.Status === 'Completed' && (t.ActivityDate || '').startsWith(today)
  );
  completedToday.slice(0, 3).forEach((t: any) => {
    const owner = t.Owner?.Name || '';
    if (owner && !isEnglishName(owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.taskDone)(owner),
        category: 'celebrate',
      });
    }
  });

  // ── J. 새 리드 ──
  const frtOver = kpiData?.inbound?.insideSales?.rawData?.frtOver20 || [];
  frtOver.slice(0, 3).forEach((lead: any) => {
    const c = lead.company || lead.name || '';
    if (c) {
      msgs.push({
        emoji: '',
        text: pick(TPL.newLead)(c),
        category: 'cheer',
      });
    }
  });

  // ── K. TM FRT 빠른 응대 ──
  const tmByOwner = kpiData?.channel?.tm?.byOwner || [];
  tmByOwner.forEach((o: any) => {
    if (o.frtOk > 0 && !isEnglishName(o.name)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.tmFrtGood)(o.name),
        category: 'celebrate',
      });
    }
  });

  // ── L. TM 미전환 MQL 팔로업 ──
  const tmUnconverted = kpiData?.channel?.tm?.rawData?.unconvertedMQL || [];
  tmUnconverted.forEach((lead: any) => {
    const owner = lead.owner || '';
    const company = lead.company || lead.name || '';
    if (owner && company && !isEnglishName(owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.tmMqlFollowUp)(owner, company),
        category: 'action',
      });
    }
  });

  // ── M. TM Open Opp 응원 ──
  const tmOpps = kpiData?.channel?.tm?.rawData?.rawOpenOpps || [];
  tmOpps.slice(0, 5).forEach((opp: any) => {
    const owner = opp.ownerName || '';
    const oppName = cleanName(opp.name || '');
    if (owner && oppName && !isEnglishName(owner)) {
      msgs.push({
        emoji: '',
        text: pick(TPL.tmOppCheer)(owner, oppName),
        category: 'cheer',
      });
    }
  });

  // 최소 메시지 보장
  if (msgs.length === 0) {
    msgs.push(
      { emoji: '', text: '오늘도 좋은 하루가 시작됐어요, 함께 힘내봐요!', category: 'cheer' },
      { emoji: '', text: '작은 한 걸음이 큰 변화를 만들어요, 오늘도 화이팅!', category: 'cheer' },
      { emoji: '', text: '우리 팀이라면 할 수 있어요, 오늘 하루도 응원합니다!', category: 'cheer' },
    );
  }

  return shuffle(msgs);
}

/* ─────────────── 카테고리별 색상 ──────────────── */
const ACCENT: Record<string, { color: string; glow: string }> = {
  celebrate: { color: '#4ADE80', glow: 'rgba(74,222,128,0.15)' },
  action: { color: '#60A5FA', glow: 'rgba(96,165,250,0.15)' },
  cheer: { color: '#FBBF24', glow: 'rgba(251,191,36,0.15)' },
};

/* ─────────────── 날짜 포맷 ─────────────────── */
const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function formatDate(d: Date) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}`;
}
function formatTime(d: Date) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 || 12;
  return `${hh}:${m} ${ampm}`;
}

/* ─────────────── 폭죽 파티클 ──────────────────── */
const CONFETTI_COLORS = ['#FF6B6B', '#4ADE80', '#60A5FA', '#FBBF24', '#F472B6', '#A78BFA', '#34D399', '#FB923C'];

interface Particle {
  id: number;
  x: number;       // 시작 X (vw)
  y: number;       // 시작 Y (vh)
  color: string;
  size: number;
  angle: number;    // 발사 각도 (deg)
  speed: number;    // 이동 거리 (px)
  rotation: number; // 회전 (deg)
  delay: number;    // 딜레이 (s)
  duration: number; // 애니메이션 시간 (s)
  shape: 'circle' | 'square' | 'star';
}

function generateParticles(count: number): Particle[] {
  const particles: Particle[] = [];
  // 2~3개 발사 지점에서 폭죽처럼 퍼짐
  const origins = [
    { x: 20 + Math.random() * 15, y: 50 + Math.random() * 20 },
    { x: 65 + Math.random() * 15, y: 45 + Math.random() * 20 },
    { x: 40 + Math.random() * 20, y: 55 + Math.random() * 15 },
  ];
  const shapes: Array<'circle' | 'square' | 'star'> = ['circle', 'square', 'star'];

  for (let i = 0; i < count; i++) {
    const origin = origins[i % origins.length];
    particles.push({
      id: i,
      x: origin.x + (Math.random() - 0.5) * 5,
      y: origin.y + (Math.random() - 0.5) * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 8,
      angle: Math.random() * 360,
      speed: 80 + Math.random() * 200,
      rotation: Math.random() * 720 - 360,
      delay: Math.random() * 0.6,
      duration: 1.5 + Math.random() * 1.5,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    });
  }
  return particles;
}

function ConfettiEffect({ active, animKey }: { active: boolean; animKey: number }) {
  const particles = useMemo(() => (active ? generateParticles(40) : []), [active, animKey]);

  if (!active || particles.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, overflow: 'hidden' }}>
      <style>{`
        @keyframes confetti-burst {
          0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
          20% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0); opacity: 0; }
        }
        @keyframes confetti-star {
          0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
          20% { opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0); opacity: 0; }
        }
      `}</style>
      {particles.map(p => {
        const rad = (p.angle * Math.PI) / 180;
        const tx = Math.cos(rad) * p.speed;
        const ty = Math.sin(rad) * p.speed - 60; // 위로 더 올라가게

        return (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.x}vw`,
              top: `${p.y}vh`,
              width: p.shape === 'star' ? 0 : `${p.size}px`,
              height: p.shape === 'star' ? 0 : `${p.size}px`,
              borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'square' ? '2px' : '0',
              background: p.shape !== 'star' ? p.color : 'transparent',
              // star shape via borders
              ...(p.shape === 'star' ? {
                borderLeft: `${p.size / 2}px solid transparent`,
                borderRight: `${p.size / 2}px solid transparent`,
                borderBottom: `${p.size}px solid ${p.color}`,
              } : {}),
              // @ts-ignore -- CSS custom properties
              '--tx': `${tx}px`,
              '--ty': `${ty}px`,
              '--rot': `${p.rotation}deg`,
              animation: `confetti-burst ${p.duration}s ease-out ${p.delay}s forwards`,
              opacity: 0,
              willChange: 'transform, opacity',
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ═════════════════ 메인 컴포넌트 ═════════════════ */
export default function DIDPage() {
  const [messages, setMessages] = useState<StoryMessage[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<'in' | 'out' | 'hold'>('in');
  const [clock, setClock] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [mascotSrc, setMascotSrc] = useState('');
  const [confettiKey, setConfettiKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  // ── 데이터 로딩 (오늘 일간 → 어제 일간 → 월간 폴백) ──
  const loadData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      const [kpiToday, kpiYesterday, channelData] = await Promise.allSettled([
        fetchKPIReport(undefined, today),
        fetchKPIReport(undefined, yesterday),
        fetchChannelSales(),
      ]);

      const channel = channelData.status === 'fulfilled' ? channelData.value : null;

      // 오늘 일간 → 어제 일간 → 월간 순으로 폴백
      let kpiFinal = kpiToday.status === 'fulfilled' ? kpiToday.value : null;
      if (!kpiFinal) {
        kpiFinal = kpiYesterday.status === 'fulfilled' ? kpiYesterday.value : null;
      }
      if (!kpiFinal) {
        kpiFinal = await fetchKPIReport().catch(() => null);
      }

      const msgs = generateMessages(kpiFinal, channel);
      setMessages(msgs);
      setCurrentIdx(0);
    } catch (e) {
      console.error('DID data load error:', e);
      setMessages([
        { emoji: '', text: '오늘도 좋은 하루가 시작됐어요, 함께 힘내봐요!', category: 'cheer' },
        { emoji: '', text: '작은 한 걸음이 큰 변화를 만들어요, 오늘도 화이팅!', category: 'cheer' },
        { emoji: '', text: '우리 팀이라면 할 수 있어요, 오늘 하루도 응원합니다!', category: 'cheer' },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 최초 로딩 + 5분 갱신
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── 메시지 순환 ──
  useEffect(() => {
    if (messages.length === 0) return;

    let timer: ReturnType<typeof setTimeout>;

    if (phase === 'in') {
      timer = setTimeout(() => setPhase('hold'), 800);
    } else if (phase === 'hold') {
      timer = setTimeout(() => setPhase('out'), 7000);
    } else if (phase === 'out') {
      timer = setTimeout(() => {
        setCurrentIdx(prev => (prev + 1) % messages.length);
        setPhase('in');
      }, 800);
    }

    return () => clearTimeout(timer);
  }, [phase, messages.length]);

  // ── 마스코트 이미지 + 폭죽 (메시지 전환 시) ──
  useEffect(() => {
    if (messages.length === 0) return;
    const cat = messages[currentIdx]?.category || 'cheer';
    const imgs = MASCOT[cat] || MASCOT.cheer;
    setMascotSrc(pick(imgs));

    // 랜덤하게 폭죽 발사 (~50% 확률)
    if (Math.random() < 0.5) {
      setShowConfetti(true);
      setConfettiKey(prev => prev + 1);
      const t = setTimeout(() => setShowConfetti(false), 3500);
      return () => clearTimeout(t);
    } else {
      setShowConfetti(false);
    }
  }, [currentIdx, messages]);

  // ── 실시간 시계 (클라이언트에서만) ──
  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── 현재 메시지 ──
  const msg = messages[currentIdx] || { emoji: '', text: '로딩 중...', category: 'cheer' as const };
  const accent = ACCENT[msg.category] || ACCENT.cheer;
  const textLen = plainLength(msg.text);
  const baseFontSize = textLen > 45 ? 48 : textLen > 35 ? 56 : 64;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999,
      background: 'linear-gradient(160deg, #0F0C29 0%, #302B63 50%, #24243E 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
      cursor: 'none',
    }}>
      {/* 폭죽 이펙트 (celebrate 카테고리) */}
      <ConfettiEffect active={showConfetti} animKey={confettiKey} />

      {/* 배경 글로우 */}
      <div style={{
        position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '700px', height: '700px', borderRadius: '50%',
        background: `radial-gradient(circle, ${accent.glow} 0%, transparent 70%)`,
        transition: 'background 1s ease',
        pointerEvents: 'none',
      }} />

      {/* 날짜 & 시간 (우측 상단) */}
      <div style={{
        position: 'absolute', top: '3vh', right: '3vw',
        textAlign: 'right', zIndex: 1,
      }}>
        <div style={{
          fontSize: '16px', fontWeight: 300, color: 'rgba(255,255,255,0.4)',
          letterSpacing: '2px',
        }}>
          {clock ? formatDate(clock) : ''}
        </div>
        <div style={{
          fontSize: '36px', fontWeight: 200, color: 'rgba(255,255,255,0.6)',
          letterSpacing: '3px', marginTop: '2px',
        }}>
          {clock ? formatTime(clock) : ''}
        </div>
      </div>

      {/* 메인 메시지 영역 */}
      {!loading && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '24px', maxWidth: '80vw', zIndex: 1,
          opacity: phase === 'out' ? 0 : 1,
          transform: phase === 'out' ? 'translateY(-30px)' : 'translateY(0)',
          transition: 'opacity 0.8s ease, transform 0.8s ease',
        }}>
          {/* 마스코트 이미지 */}
          {mascotSrc && (
            <img
              src={mascotSrc}
              alt="torder mascot"
              style={{
                width: '320px', height: '320px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 10px 30px rgba(0,0,0,0.4))',
              }}
            />
          )}

          {/* 메시지 텍스트 */}
          <div style={{
            textAlign: 'center', maxWidth: '80vw',
            fontSize: `${baseFontSize}px`,
            fontWeight: 600, color: '#FFFFFF',
            lineHeight: 1.5, letterSpacing: '-0.5px',
            textShadow: '0 2px 20px rgba(0,0,0,0.3)',
          }}>
            {renderHighlightedText(msg.text, baseFontSize)}
          </div>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ fontSize: '24px', color: 'rgba(255,255,255,0.5)', zIndex: 1 }}>
          데이터를 불러오고 있어요...
        </div>
      )}

    </div>
  );
}
