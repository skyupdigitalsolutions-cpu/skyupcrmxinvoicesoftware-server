// Lightweight, dependency-free SVG charts styled to match the dashboard.
// Swap these for recharts later if desired — the props shape is intentionally
// simple (arrays of {label, ...values}).

// ── Line chart: new leads vs converted over time ────────────────────────────
export function LineChart({ data = [], series = [], height = 200 }) {
  const W = 560, H = height, padX = 32, padY = 18;
  const innerW = W - padX * 2, innerH = H - padY * 2;
  const n = data.length;
  const maxVal = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const x = (i) => padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => padY + innerH - (v / maxVal) * innerH;

  const path = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key] || 0).toFixed(1)}`).join(' ');
  const area = (key) => `${path(key)} L ${x(n - 1)} ${padY + innerH} L ${x(0)} ${padY + innerH} Z`;

  const ticks = 4;
  return (
    <div className="w-full overflow-hidden">
      <div className="mb-2 flex gap-4 text-[11px]">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 font-bold text-ink-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const gy = padY + (i / ticks) * innerH;
          return <line key={i} x1={padX} y1={gy} x2={W - padX} y2={gy} stroke="#EEF0F5" strokeWidth="1" />;
        })}
        {series.map((s) => (
          <g key={s.key}>
            {s.fill && <path d={area(s.key)} fill={s.color} opacity="0.08" />}
            <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dashed ? '5 5' : undefined} />
            {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d[s.key] || 0)} r="3" fill={s.color} />)}
          </g>
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 2} textAnchor="middle" fontSize="10" fill="#8B92A9">{d.label}</text>
        ))}
      </svg>
    </div>
  );
}

// ── Donut chart with center total ───────────────────────────────────────────
export function DonutChart({ data = [], total, label = 'total', size = 150, thickness = 22 }) {
  const sum = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF0F5" strokeWidth={thickness} />
          {sum > 0 && data.map((d, i) => {
            if (!d.value) return null;
            const len = (d.value / sum) * circ;
            const seg = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-xl font-black leading-none text-navy">{total ?? sum}</div>
          <div className="text-[9px] text-ink-3">{label}</div>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-ink-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />{d.label}
            </span>
            <span className="font-bold text-navy">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Back-compat alias used by the dashboard.
export function DonutWithCenter({ data, total, label = 'total' }) {
  return <DonutChart data={data} total={total} label={label} />;
}