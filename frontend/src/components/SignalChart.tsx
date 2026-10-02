import { useMemo } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { PARAMS } from '@shared/adc.js';

const SERIES = '#2a78d6';
const SERIES2 = '#eb6834';
const REF = '#52514e';

type PP = ReturnType<typeof import('@shared/adc.js').preprocess>;

// The paper's Figs. 7–9 as four stacked charts: the five features the phone
// computes, with the Table II thresholds as dashed lines. t = 0 is the trigger.
export function SignalChart({ pp, tTrig, tDec }: { pp: PP; tTrig: number; tDec?: number }) {
  const data = useMemo(() => {
    const step = 2; // 100 Hz → 50 Hz for display, keeping the peak in each bucket
    const out = [];
    let g = 0;
    for (let k = 0; k < pp.m; k += step) {
      let a = 0, h = 0;
      for (let j = k; j < Math.min(pp.m, k + step); j++) { a = Math.max(a, pp.ala[j]); h = Math.max(h, pp.dAlt[j]); }
      const t = k / pp.hz;
      while (g < pp.gps.length - 1 && pp.gps[g + 1].t <= t) g++;
      const wrap = (x: number) => Math.abs(((((x + 180) % 360) + 360) % 360) - 180);
      out.push({
        t: +(t - tTrig).toFixed(2),
        v: +pp.gps[g].v.toFixed(1),
        ala: +a.toFixed(2),
        dAlt: +h.toFixed(1),
        roll: +wrap(pp.roll[k]).toFixed(1),
        pitch: +wrap(pp.pitch[k]).toFixed(1),
      });
    }
    return out;
  }, [pp, tTrig]);
  const t0 = data[0]?.t ?? -3, t1 = data[data.length - 1]?.t ?? 5;
  const dec = tDec != null ? +(tDec - tTrig).toFixed(2) : undefined;

  return (
    <div className="space-y-1">
      <Mini data={data} keys={['v']} domain={[t0, t1]} dec={dec} title={`Speed from GPS (km/h) · dashed: ${PARAMS.thrSpeed} km/h`} unit="km/h" refY={PARAMS.thrSpeed} />
      <Mini data={data} keys={['ala']} domain={[t0, t1]} dec={dec} title={`ALA, 10 ms moving max (g) · dashed: ${PARAMS.thrALA} g`} unit="g" refY={PARAMS.thrALA} />
      <Mini data={data} keys={['dAlt']} domain={[t0, t1]} dec={dec} title={`Change in altitude over 1 s (ft) · dashed: ${PARAMS.thrAlt} ft`} unit="ft" refY={PARAMS.thrAlt} />
      <Mini data={data} keys={['roll', 'pitch']} domain={[t0, t1]} dec={dec} title={`Roll (blue) and pitch (orange), complementary filter (°) · dashed: ${PARAMS.thrAngle}°`} unit="°" refY={PARAMS.thrAngle} />
      <div className="text-[10px] text-muted-foreground">Solid vertical line: trigger (t = 0). Dotted: classification after {PARAMS.tObs} s of observation.</div>
    </div>
  );
}

function Mini({ data, keys, domain, dec, title, unit, refY }: { data: any[]; keys: string[]; domain: [number, number]; dec?: number; title: string; unit: string; refY: number }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="h-[72px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" type="number" domain={domain} tickCount={8} tick={{ fontSize: 9 }} unit="s" allowDecimals={false} />
            <YAxis tick={{ fontSize: 9 }} width={44} />
            <Tooltip formatter={(v: number, n: string) => [`${v} ${unit}`, n]} labelFormatter={(t) => `t = ${t} s from trigger`} contentStyle={{ fontSize: 11 }} />
            <ReferenceLine y={refY} stroke={REF} strokeDasharray="6 3" ifOverflow="extendDomain" />
            <ReferenceLine x={0} stroke={REF} strokeOpacity={0.5} />
            {dec != null && <ReferenceLine x={dec} stroke={REF} strokeDasharray="1 3" />}
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} name={k} stroke={i ? SERIES2 : SERIES} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
