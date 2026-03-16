interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  target?: string | number;
  color?: 'blue' | 'green' | 'orange' | 'teal' | 'purple' | 'red' | 'dark';
  loading?: boolean;
}

export default function StatsCard({ title, value, subtitle, target, color = 'blue', loading }: StatsCardProps) {
  if (loading) {
    return (
      <div className="metro-tile metro-loading" style={{ minHeight: '120px' }}></div>
    );
  }

  return (
    <div className={`metro-tile ${color}`}>
      <div className="stat-label">{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <div className="stat-number">{value}</div>
        {target && <div style={{ fontSize: '1.2em', opacity: 0.7 }}>/ {target}</div>}
      </div>
      {subtitle && <div className="stat-sub">{subtitle}</div>}
    </div>
  );
}
