interface StatBarProps {
  label: string;
  value: number;
  max?: number;
  tone?: 'gold' | 'red' | 'green' | 'blue';
}

export function StatBar({ label, value, max = 120, tone = 'gold' }: StatBarProps) {
  const width = Math.max(4, Math.min(100, (value / max) * 100));
  return (
    <div className="stat-bar">
      <div className="stat-bar__label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="stat-bar__track">
        <div className={`stat-bar__fill stat-bar__fill--${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

