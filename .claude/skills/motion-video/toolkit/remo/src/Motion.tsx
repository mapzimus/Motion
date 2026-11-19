import React from 'react';
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame, interpolate, spring, Easing } from 'remotion';
import { Audio } from '@remotion/media';
export type Card = { f0: number; f1: number; kick: string; big?: string; bigValue?: number; decimals?: number; text: string };
export type TL = { total: number; fps: number; clock: number[]; date: string; title: string; kicker: string; sub: string;
  counter: { label: string; values: (number | null)[] }[]; cards: Card[]; pins: Record<string, { label: string; x: number; y: number; a: number }[]>;
  credit: string; outroFrom: number; frameDir: string; chapters?: { f: number; text: string }[]; cuts?: number[]; dayStart?: number; hook?: { place: string; line: string; cta?: string }; outroLine?: string; legend?: { kind: 'train' | 'bus' | 'plane'; label: string; color?: string }[];
  labels?: { defs: { t: 'hood' | 'boro' | 'wp'; label: string }[]; proj: number[][][] } };
const fonts = `
@font-face{font-family:PlexMono;src:url(${staticFile('fonts/IBMPlexMono-Regular.ttf')})}
@font-face{font-family:PlexMono;font-weight:500;src:url(${staticFile('fonts/IBMPlexMono-Medium.ttf')})}
@font-face{font-family:PlexSerif;font-weight:500;src:url(${staticFile('fonts/IBMPlexSerif-Medium.ttf')})}`;
const fmt = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).toLowerCase();
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const shadow = '0 2px 18px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.9)';

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const CUT = (tl: TL) => (tl.cuts && tl.cuts[0]) || 180;

// hook: a live number over the morning rush, then a flash cut back to midnight
const Hook: React.FC<{ tl: TL; f: number; fps: number }> = ({ tl, f, fps }) => {
  const cut = CUT(tl); if (f >= cut) return null;
  const v = tl.counter[0].values[f] ?? 0;
  const inA = spring({ frame: f, fps, config: { damping: 16, mass: 0.6 } });
  const out = interpolate(f, [cut - 10, cut], [1, 0], clamp);
  return <div style={{ position: 'absolute', left: 80, right: 80, top: 250, opacity: Math.min(inA, out), color: '#fff', textShadow: shadow }}>
    <div style={{ fontFamily: 'PlexMono', fontWeight: 500, fontSize: 30, color: '#ffd27a', letterSpacing: '.06em' }}>{(tl.hook?.place ?? '').toUpperCase()}, {fmt(tl.clock[f]).toUpperCase()}</div>
    <div style={{ fontFamily: 'PlexSerif', fontWeight: 500, fontSize: 220, lineHeight: 1, letterSpacing: '-.03em', marginTop: 8, scale: String(0.9 + 0.1 * inA) as any, transformOrigin: 'left center' }}>{Math.round(v).toLocaleString('en-US')}</div>
    <div style={{ fontFamily: 'PlexSerif', fontWeight: 500, fontSize: 54, lineHeight: 1.1, marginTop: 6 }}>{tl.hook?.line ?? ''}</div>
    <div style={{ fontFamily: 'PlexMono', fontSize: 30, color: '#d9dee8', marginTop: 26, opacity: interpolate(f, [fps * 1.6, fps * 2.0], [0, 1], clamp) }}>{tl.hook?.cta ?? 'now watch the whole day →'}</div>
  </div>;
};

const Title: React.FC<{ tl: TL; f: number; fps: number }> = ({ tl, f, fps }) => {
  const cut = CUT(tl);
  const inA = spring({ frame: f - cut - 4, fps, config: { damping: 18, mass: 0.6 } });
  const out = interpolate(f, [cut + fps * 2.4, cut + fps * 2.9], [1, 0], clamp);
  const back = interpolate(f, [tl.outroFrom, tl.outroFrom + fps * 0.6], [0, 1], clamp);
  const a = f < cut ? 0 : Math.max(Math.min(inA, out), back), y = (1 - Math.max(Math.min(inA, 1), back)) * 40;
  if (a <= 0.001) return null;
  return <div style={{ position: 'absolute', left: 96, top: 300, opacity: a, translate: `0px ${y}px`, color: '#fff', textShadow: shadow }}>
    <div style={{ fontFamily: 'PlexMono', fontWeight: 500, fontSize: 30, color: '#cfd8e6', letterSpacing: '.02em' }}>{f < tl.outroFrom ? 'BACK TO MIDNIGHT' : tl.kicker}</div>
    <div style={{ fontFamily: 'PlexSerif', fontWeight: 500, fontSize: 104, lineHeight: 1.0, letterSpacing: '-.015em', marginTop: 14, maxWidth: 900 }}>{tl.title}</div>
    <div style={{ fontFamily: 'PlexMono', fontSize: 32, color: '#d9dee8', marginTop: 22 }}>{f < tl.outroFrom ? tl.sub : (tl.outroLine ?? '')}</div>
  </div>;
};

// 24-hour progress track: where we are in the day
const DayBar: React.FC<{ tl: TL; f: number }> = ({ tl, f }) => {
  const D0 = tl.dayStart ?? tl.clock[CUT(tl)], u = Math.max(0, Math.min(1, (tl.clock[f] - D0) / 86400000)), W = 560;
  const hrs = [[0, '12a'], [6, '6a'], [12, '12p'], [18, '6p'], [24, '12a']] as const;
  return <div style={{ position: 'relative', width: W, height: 44, marginTop: 22 }}>
    <div style={{ position: 'absolute', top: 8, left: 0, width: W, height: 4, borderRadius: 2, background: 'linear-gradient(90deg,#1b2a4a 0%,#1b2a4a 22%,#f2b86b 30%,#fff3d6 50%,#f2b86b 70%,#1b2a4a 78%,#1b2a4a 100%)', opacity: 0.55 }} />
    <div style={{ position: 'absolute', top: 8, left: 0, width: W * u, height: 4, borderRadius: 2, background: '#fff' }} />
    {tl.cards.map((c, i) => { const cu = (tl.clock[c.f0] - D0) / 86400000; return <div key={i} style={{ position: 'absolute', top: 4, left: W * cu - 1, width: 2, height: 12, background: f >= c.f0 ? '#ffd27a' : 'rgba(255,255,255,.35)' }} />; })}
    <div style={{ position: 'absolute', top: 2, left: W * u - 8, width: 16, height: 16, borderRadius: 8, background: '#fff', boxShadow: '0 0 14px rgba(255,255,255,.9)' }} />
    {hrs.map(([h, t]) => <div key={h} style={{ position: 'absolute', top: 20, left: W * h / 24, translate: '-50% 0px', fontFamily: 'PlexMono', fontSize: 17, color: 'rgba(255,255,255,.55)' }}>{t}</div>)}
  </div>;
};

const Hud: React.FC<{ tl: TL; f: number; fps: number }> = ({ tl, f, fps }) => {
  const cut = CUT(tl);
  const a = interpolate(f, [cut + fps * 2.7, cut + fps * 3.2], [0, 1], clamp) * interpolate(f, [tl.outroFrom - fps * 0.6, tl.outroFrom], [1, 0], clamp);
  if (a <= 0.001) return null;
  const c = tl.counter.map((s) => ({ label: s.label, v: s.values[f] })).find((s) => s.v != null);
  return <div style={{ position: 'absolute', left: 96, top: 250, opacity: a, color: '#fff', textShadow: shadow }}>
    <div style={{ fontFamily: 'PlexMono', fontWeight: 500, fontSize: 66, lineHeight: 1 }}>{fmt(tl.clock[f])}</div>
    <div style={{ fontFamily: 'PlexMono', fontSize: 26, color: 'rgba(255,255,255,.72)', marginTop: 12 }}>{tl.date}</div>
    {c ? <div style={{ fontFamily: 'PlexMono', fontSize: 27, color: 'rgba(255,255,255,.92)', marginTop: 6 }}>{Math.round(c.v as number).toLocaleString('en-US')} {c.label}</div> : null}
    <DayBar tl={tl} f={f} />
  </div>;
};

const Chapter: React.FC<{ ch: { f: number; text: string }; f: number; fps: number }> = ({ ch, f, fps }) => {
  const t = f - ch.f; if (t < 0 || t > fps * 2.2) return null;
  const a = interpolate(t, [0, fps * 0.35, fps * 1.7, fps * 2.2], [0, 1, 1, 0], clamp);
  return <div style={{ position: 'absolute', left: 0, right: 0, top: 760, textAlign: 'center', opacity: a, color: '#fff', textShadow: shadow,
    fontFamily: 'PlexSerif', fontWeight: 500, fontSize: 112, letterSpacing: `${interpolate(t, [0, fps * 2.2], [0.02, 0.09])}em`,
    filter: `blur(${interpolate(t, [0, fps * 0.35], [12, 0], { ...clamp, easing: ease })}px)` }}>{ch.text}</div>;
};

const CardView: React.FC<{ c: Card; f: number; fps: number }> = ({ c, f, fps }) => {
  if (f < c.f0 || f > c.f1) return null;
  const inA = spring({ frame: f - c.f0, fps, config: { damping: 20, mass: 0.7 } });
  const outA = interpolate(f, [c.f1 - fps * 0.35, c.f1], [1, 0], clamp);
  const a = Math.min(inA, outA);
  const dec = c.decimals ?? 0, n = c.bigValue != null ? c.bigValue * interpolate(f - c.f0, [0, fps * 0.9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) : null;
  return <div style={{ position: 'absolute', left: 96, right: 96, bottom: 360, opacity: a, transform: `translateY(${(1 - inA) * 50}px)` }}>
    <div style={{ display: 'inline-block', background: 'rgba(7,9,14,.80)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 14, padding: '22px 26px 24px', maxWidth: 800 }}>
      <div style={{ fontFamily: 'PlexMono', fontWeight: 500, fontSize: 25, color: '#bcd3f2' }}>{c.kick}</div>
      {n != null ? <div style={{ fontFamily: 'PlexSerif', fontWeight: 500, fontSize: 92, lineHeight: 1.05, color: '#fff', marginTop: 6 }}>{n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}{c.big ?? ''}</div> : null}
      <div style={{ height: 5, borderRadius: 3, background: '#ffd27a', marginTop: 4, width: `${interpolate(f - c.f0, [fps * 0.2, fps * 1.0], [0, 100], { ...clamp, easing: ease })}%` }} />
      <div style={{ fontFamily: 'PlexSerif', fontWeight: 500, fontSize: 38, lineHeight: 1.22, color: '#f2f2f2', marginTop: 8 }}>{c.text}</div>
    </div></div>;
};


// basemap labels: neighborhoods, boroughs, waypoints. Screen positions come from the map's own camera (labels-proj.json).
const ORDER = { wp: 0, hood: 1, boro: 2 } as const;
const ss = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const Labels: React.FC<{ tl: TL; f: number; fps: number; pins: { x: number; y: number }[] }> = ({ tl, f, fps, pins }) => {
  if (!tl.labels) return null;
  const g = interpolate(f, [fps * 2.7, fps * 3.4], [0, 1], clamp) * interpolate(f, [tl.outroFrom - fps * 0.6, tl.outroFrom], [1, 0], clamp);
  const chA = Math.max(0, ...(tl.chapters || []).map((c) => interpolate(f - c.f, [-8, 4, fps * 1.8, fps * 2.3], [0, 1, 1, 0], clamp)));
  const gg = g * (1 - chA); if (gg <= 0.001) return null;
  const card = tl.cards.some((c) => f >= c.f0 - 10 && f <= c.f1 + 10), yMax = card ? 1180 : 1500;
  const taken: number[][] = pins.map((p) => [p.x - 140, p.y - 50, p.x + 140, p.y + 10]);
  const out: React.JSX.Element[] = [];
  const idx = tl.labels.defs.map((d, i) => i).sort((a, b) => ORDER[tl.labels!.defs[a].t] - ORDER[tl.labels!.defs[b].t]);
  for (const i of idx) {
    const d = tl.labels.defs[i], [x, y, on] = tl.labels.proj[f][i]; if (!on) continue;
    const fs = d.t === 'boro' ? 28 : d.t === 'wp' ? 24 : 22, txt = d.t === 'wp' ? d.label : d.label.toUpperCase();
    const w = txt.length * fs * (d.t === 'wp' ? 0.6 : 0.72) + (d.t === 'wp' ? 22 : 0), h = fs + 10;
    const box = d.t === 'wp' ? [x - 8, y - h / 2, x + w, y + h / 2] : [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    const a = g * (box[0] > 700 ? ss(box[1], 230, 300) : ss(box[1], 440, 520)) * (1 - ss(box[3], yMax - 80, yMax)) * ss(box[0], 30, 70) * (1 - ss(box[2], 1010, 1050));
    if (a <= 0.02 || taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
    taken.push(box);
    const base = { position: 'absolute' as const, top: y, whiteSpace: 'nowrap' as const, textShadow: shadow, opacity: a };
    out.push(d.t === 'wp'
      ? <div key={i} style={{ ...base, left: x, transform: 'translate(-5px,-50%)', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'PlexMono', fontWeight: 500, fontSize: fs, color: 'rgba(255,255,255,.92)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: '#fff', boxShadow: '0 0 0 2px rgba(5,6,10,.85)' }} />{txt}</div>
      : <div key={i} style={{ ...base, left: x, transform: 'translate(-50%,-50%)', fontFamily: 'PlexMono', fontWeight: 500, fontSize: fs, letterSpacing: d.t === 'boro' ? '.32em' : '.14em', color: d.t === 'boro' ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.66)' }}>{txt}</div>);
  }
  return <>{out}</>;
};

// legend: what each mark is, from the cut to the outro
const Sw: React.FC<{ k: string; c?: string }> = ({ k, c }) => k === 'train'
  ? <span style={{ width: 14, height: 14, borderRadius: 7, background: '#fff', boxShadow: `0 0 0 4px ${c || '#BF0D3E'}, 0 0 10px 4px ${c || '#BF0D3E'}` }} />
  : k === 'bus' ? <span style={{ width: 9, height: 9, borderRadius: 5, background: c || '#ffb347' }} />
  : <svg width="26" height="22" viewBox="-13 -11 26 22"><path d="M12 0 L-3 -1.5 L-6 -10 L-8.5 -10 L-7 -1.5 L-11 -1.2 L-12.5 -4.5 L-13 -4.5 L-12.5 0 L-13 4.5 L-12.5 4.5 L-11 1.2 L-7 1.5 L-8.5 10 L-6 10 L-3 1.5 Z" fill={c || '#bfe3ff'} /></svg>;
const Legend: React.FC<{ tl: TL; f: number; fps: number }> = ({ tl, f, fps }) => {
  if (!tl.legend) return null;
  const a = interpolate(f, [CUT(tl) + fps * 0.5, CUT(tl) + fps * 1.5, tl.outroFrom - 10, tl.outroFrom], [0, 1, 1, 0], clamp);
  return <div style={{ position: 'absolute', left: 96, right: 96, bottom: 92, opacity: a, display: 'flex', gap: 38, alignItems: 'center', fontFamily: 'PlexMono', fontWeight: 500, fontSize: 24, color: 'rgba(255,255,255,.88)', textShadow: shadow }}>
    {tl.legend.map((l, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Sw k={l.kind} c={l.color} />{l.label}</div>)}</div>;
};

const Sfx: React.FC<{ tl: TL; fps: number }> = ({ tl, fps }) => <>
  <Sequence from={CUT(tl) - 14} durationInFrames={fps * 2}><Audio src={staticFile('sfx/whoosh.wav')} volume={0.55} /></Sequence>
  {tl.cards.map((c, i) => <Sequence key={'c' + i} from={c.f0} durationInFrames={fps}><Audio src={staticFile('sfx/mouse-click.wav')} volume={0.4} /></Sequence>)}
  {(tl.chapters || []).map((c, i) => <Sequence key={'h' + i} from={Math.max(0, c.f - 6)} durationInFrames={fps * 2}><Audio src={staticFile('sfx/whoosh.wav')} volume={0.22} /></Sequence>)}
  <Sequence from={tl.outroFrom} durationInFrames={fps * 3}><Audio src={staticFile('sfx/ding.wav')} volume={0.35} /></Sequence>
</>;

export const Motion: React.FC<{ tl: TL }> = ({ tl }) => {
  const f = useCurrentFrame(), fps = tl.fps;
  const pins = tl.pins[String(f)] || [];
  const z = 1 + tl.cards.reduce((m, c) => Math.max(m, interpolate(f, [c.f0 - 10, c.f0 + fps * 1.2, c.f1, c.f1 + fps * 0.8], [0, 0.07, 0.08, 0], { ...clamp, easing: ease })), 0);
  const flash = interpolate(f - CUT(tl), [-2, 0, 10], [0, 0.85, 0], clamp);
  return <AbsoluteFill style={{ backgroundColor: '#05060a' }}>
    <style>{fonts}</style>
    <AbsoluteFill style={{ scale: String(z) as any, transformOrigin: '50% 48%' }}>
      <Img src={tl.frameDir.startsWith('http') ? `${tl.frameDir}/f${String(f).padStart(4, '0')}.jpg` : staticFile(`${tl.frameDir}/f${String(f).padStart(4, '0')}.jpg`)} style={{ width: 1080, height: 1920 }} />
      <Labels tl={tl} f={f} fps={fps} pins={pins} />
      {pins.map((p, i) => <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, opacity: p.a, transform: 'translate(-50%,-100%)', fontFamily: 'PlexMono', fontWeight: 500, fontSize: 24, color: '#fff', textShadow: shadow, paddingBottom: 8, borderBottom: '1.5px solid rgba(255,255,255,.6)', whiteSpace: 'nowrap' }}>{p.label}</div>)}
    </AbsoluteFill>
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(5,6,10,.55) 0%, rgba(5,6,10,0) 22%, rgba(5,6,10,0) 80%, rgba(5,6,10,.7) 100%)' }} />
    <Hook tl={tl} f={f} fps={fps} />
    {(tl.chapters || []).map((ch, i) => <Chapter key={i} ch={ch} f={f} fps={fps} />)}
    <Sfx tl={tl} fps={fps} />
    <Title tl={tl} f={f} fps={fps} />
    <Hud tl={tl} f={f} fps={fps} />
    <Legend tl={tl} f={f} fps={fps} />
    {tl.cards.map((c, i) => <CardView key={i} c={c} f={f} fps={fps} />)}
    <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flash, pointerEvents: 'none' }} />
    <div style={{ position: 'absolute', left: 40, right: 40, bottom: 26, textAlign: 'center', fontFamily: 'PlexMono', fontSize: 15, lineHeight: 1.45, color: 'rgba(255,255,255,.42)' }}>{tl.credit.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
  </AbsoluteFill>;
};
