'use client';

import { PeriodMode } from '@/lib/api';

interface PeriodSelectorProps {
  value: PeriodMode;
  onChange: (mode: PeriodMode) => void;
  loading?: boolean;
}

const periods: { value: PeriodMode; label: string }[] = [
  { value: 'daily', label: '어제' },
  { value: 'weekly', label: '지난주' },
  { value: 'monthly', label: '지난달' },
  { value: 'monthly-current', label: '이번달' },
];

export default function PeriodSelector({ value, onChange, loading }: PeriodSelectorProps) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          disabled={loading}
          style={{
            padding: '10px 20px',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '0.9em',
            fontWeight: 500,
            transition: 'all 0.2s',
            background: value === period.value ? '#0078d4' : '#fff',
            color: value === period.value ? '#fff' : '#333',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
