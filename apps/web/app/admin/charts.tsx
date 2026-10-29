'use client';
import { useEffect, useRef, useState } from 'react';
import { usd } from '@vs/catalog';

const H = 240, PAD = { l: 52, r: 12, t: 16, b: 30 };

/** Renders at the container's real pixel width so 12px text stays 12px on every screen. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}
const shortUsd = (c: number) => (c >= 100_000 ? `$${(c / 100_000).toFixed(c % 100_000 ? 1 : 0)}k` : usd(c));
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Money over time with a dashed target reference line; crosshair + tooltip on hover. */
export function LineChart({ points, target, targetLabel }: { points: { x: string; y: number }[]; target?: number; targetLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const [wrap, W] = useWidth();
  const ticks = niceTicks(Math.max(target ?? 0, ...points.map((p) => p.y), 1));
  const ymax = ticks.at(-1)!;
  const X = (i: number) => PAD.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const Y = (v: number) => PAD.t + (1 - v / ymax) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.y)}`).join('');
  const labelIdx = points.length > 1 ? (W < 420 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1]) : [0];
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  if (points.length === 0) return <p className="sub">No data yet — the first daily snapshot appears after midnight.</p>;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="chart-wrap" ref={wrap}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly recurring revenue over time against target" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" />
            <text x={PAD.l - 8} y={Y(t) + 4} textAnchor="end" fontSize="12" fill="var(--text-muted)">{shortUsd(t)}</text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize="12" fill="var(--text-muted)">{dayLabel(points[i].x)}</text>
        ))}
        {target !== undefined && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(target)} y2={Y(target)} stroke="var(--text-secondary)" strokeDasharray="5 5" strokeWidth="1.5" />
            <text x={W - PAD.r} y={Y(target) - 6} textAnchor="end" fontSize="12" fill="var(--text-secondary)">{targetLabel ?? 'Target'} {shortUsd(target)}</text>
          </g>
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
        {h && hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-muted)" strokeWidth="1" />
            <circle cx={X(hover)} cy={Y(h.y)} r="5" fill="var(--series-1)" stroke="var(--surface-2)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="tooltip" style={{ left: `${(X(hover) / W) * 100}%`, top: 0, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}>
          {dayLabel(h.x)} · <b>{usd(h.y)}</b> MRR
        </div>
      )}
    </div>
  );
}

/** Weekly cash collected: thin bars with 4px rounded tops, 2px gaps, per-bar tooltip. */
export function BarChart({ bars }: { bars: { x: string; y: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrap, W] = useWidth();
  if (bars.length === 0) return <p className="sub">No payments yet.</p>;
  const ticks = niceTicks(Math.max(...bars.map((b) => b.y), 1));
  const ymax = ticks.at(-1)!;
  const Y = (v: number) => PAD.t + (1 - v / ymax) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / bars.length;
  const bw = Math.min(36, slot - 2);
  const base = Y(0);
  return (
    <div className="chart-wrap" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cash collected per week" style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" />
            <text x={PAD.l - 8} y={Y(t) + 4} textAnchor="end" fontSize="12" fill="var(--text-muted)">{shortUsd(t)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2;
          const top = Y(b.y);
          const r = Math.min(4, (base - top) / 2, bw / 2);
          const d = b.y > 0 ? `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z` : '';
          return (
            <g key={b.x} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {d && <path d={d} fill="var(--series-1)" opacity={hover === null || hover === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {[0, bars.length - 1].map((i) => (
          <text key={i} x={PAD.l + i * slot + slot / 2} y={H - 8} textAnchor={i === 0 ? 'start' : 'end'} fontSize="12" fill="var(--text-muted)">w/c {dayLabel(bars[i].x)}</text>
        ))}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${((PAD.l + hover * slot + slot / 2) / W) * 100}%`, top: 0, transform: `translateX(${hover > bars.length / 2 ? '-105%' : '5%'})` }}>
          w/c {dayLabel(bars[hover].x)} · <b>{usd(bars[hover].y)}</b>
        </div>
      )}
    </div>
  );
}
