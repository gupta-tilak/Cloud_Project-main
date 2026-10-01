import { useMemo } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { dynMag, PARAMS } from '@shared/ecad.js';

const SERIES = '#2a78d6';
const REF = '#52514e';

type Ev = ReturnType<typeof import('@shared/ecad.js').generateEvent>;

// Three stacked single-series charts of the sensor window the edge analysed.
export function SignalChart({ ev }: { ev: Ev }) {
  const data = useMemo(() => {
    const step = 2; // 100 Hz -> 50 Hz for display
    const out = [];
    for (let i = 0; i < ev.ax.length; i += step) {
      // keep the true peak inside each display bucket
      let a = 0;
      for (let k = i; k < Math.min(ev.ax.length, i + step); k++) a = Math.max(a, dynMag(ev, k));
      out.push({ t: +(i / ev.fs - ev.t0).toFixed(2), a: +a.toFixed(2), tilt: +Math.abs(ev.tilt[i]).toFixed(1), v: +ev.speed[i].toFixed(1) });
    }
    return out;
  }, [ev]);

  return (
    <div className="space-y-1">
      <Mini data={data} k="a" title={`Dynamic acceleration |a| (g) — dashed: paper threshold ${PARAMS.baselineG} g · dotted: edge trigger ${PARAMS.gTrig} g`} unit="g" refs={[{ y: PARAMS.baselineG, dash: '6 3' }, { y: PARAMS.gTrig, dash: '1 3' }]} />
      <Mini data={data} k="tilt" title={`Tilt |θ| (°) — dotted: tilt trigger ${PARAMS.tiltTrig}°`} unit="°" refs={[{ y: PARAMS.tiltTrig, dash: '1 3' }]} />
      <Mini data={data} k="v" title="Speed (km/h)" unit="km/h" refs={[]} />
    </div>
  );
}

function Mini({ data, k, title, unit, refs }: { data: any[]; k: string; title: string; unit: string; refs: { y: number; dash: string }[] }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="h-[78px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[-2, 10]} ticks={[-2, 0, 2, 4, 6, 8, 10]} tick={{ fontSize: 9 }} unit="s" />
            <YAxis tick={{ fontSize: 9 }} width={44} />
            <Tooltip
              formatter={(v: number) => [`${v} ${unit}`, title.split(' (')[0]]}
              labelFormatter={(t) => `t = ${t} s from event`}
              contentStyle={{ fontSize: 11 }}
            />
            {refs.map((r) => (
              <ReferenceLine key={r.y} y={r.y} stroke={REF} strokeDasharray={r.dash} ifOverflow="extendDomain" />
            ))}
            <ReferenceLine x={0} stroke={REF} strokeOpacity={0.4} />
            <Line type="monotone" dataKey={k} stroke={SERIES} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
