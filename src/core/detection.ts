import { MODEL } from './model';
import type { Assessment, Baseline, Features, Reading, Settings } from './types';

// Leak detection on a WINDOW of readings (AI standard of the challenge: never one
// single value).
//
// Two detectors read the same window:
//  - the AI model (model.ts, logistic regression trained by scripts/train-model.mts)
//    gives a leak probability from 5 features;
//  - an explainable rule, the safety net and the baseline we compare the model with.
//
// What must NOT stop the water (spec "Reliability"):
//  - humid air (a shower): the floor stays dry, humidity alone never fires;
//  - a small spill: wet for a moment, then flat or drying, never growing.
// What MUST stop it: water that stays on the floor and keeps growing.
// An alert needs `sustainSamples` leak windows in a row (one strange reading is ignored).

export function emptyBaseline(): Baseline {
  return { humidity: null, pressure: null, samples: 0, calibrated: false };
}

/** Learns the room's usual humidity and pipe pressure from dry, calm readings. */
export function updateBaseline(b: Baseline, r: Reading, settings: Settings): Baseline {
  if (r.water >= settings.wetThreshold / 2) return b; // never learn while wet
  if ((r.flow ?? 0) > 0.5) return b; // pressure dips while water runs
  if (b.calibrated) {
    // Once learned, adapt slowly.
    const a = 0.02;
    return {
      ...b,
      humidity: r.humidity != null && b.humidity != null ? b.humidity + a * (r.humidity - b.humidity) : b.humidity ?? r.humidity,
      pressure: r.pressure != null && b.pressure != null ? b.pressure + a * (r.pressure - b.pressure) : b.pressure ?? r.pressure,
    };
  }
  const n = b.samples + 1;
  const mean = (old: number | null, x: number | null) => (x == null ? old : old == null ? x : old + (x - old) / n);
  return { humidity: mean(b.humidity, r.humidity), pressure: mean(b.pressure, r.pressure), samples: n, calibrated: n >= settings.calibrationSamples };
}

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

/** Least-squares slope of the Scout reading, in % per sample. */
function slope(ys: number[]) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => {
    num += (i - mx) * (y - my);
    den += (i - mx) ** 2;
  });
  return num / den;
}

/** The 5 features the model reads from a window (oldest first). */
export function features(window: Reading[], b: Baseline, settings: Settings): Features {
  const water = window.map((r) => r.water);
  const last = window[window.length - 1];
  const tail = water.slice(-3);
  const dt = window.length > 1 ? (last.at - window[0].at) / (window.length - 1) / 1000 : 1; // s per sample
  const pressures = window.map((r) => r.pressure).filter((p): p is number => p != null);
  const meanP = pressures.length ? pressures.reduce((s, p) => s + p, 0) / pressures.length : null;
  // A tap in use lowers the pressure too: only count a drop when nothing is flowing on purpose
  // is impossible to know here, so the model weighs it lightly and the night test confirms.
  let jump = 0;
  for (let i = 1; i < water.length; i++) jump = Math.max(jump, water[i] - water[i - 1]);
  return {
    wetFrac: water.filter((w) => w >= settings.wetThreshold).length / water.length,
    waterNow: tail.reduce((s, w) => s + w, 0) / tail.length,
    growthPerMin: (slope(water.slice(-4)) / Math.max(0.2, dt)) * 60,
    jump,
    humidityRise: last.humidity != null && b.humidity != null ? last.humidity - b.humidity : 0,
    pressureDrop: meanP != null && b.pressure != null ? b.pressure - meanP : 0,
  };
}

/** Model input vector, scaled to about -1..1. Same scaling in the training script and the firmware. */
export function vectorize(f: Features): number[] {
  return [f.wetFrac, f.waterNow / 100, clamp(f.growthPerMin / 100), clamp(f.humidityRise / 20), clamp(f.pressureDrop / 0.5), clamp(f.jump / 50, 0, 1)];
}

export function leakScore(f: Features, model: { weights: number[]; bias: number } = MODEL) {
  const x = vectorize(f);
  const z = model.bias + x.reduce((s, xi, i) => s + xi * model.weights[i], 0);
  return 1 / (1 + Math.exp(-z));
}

/** The explainable rule: floor wet for most of the window AND still climbing steadily (not a sudden spill). */
export function ruleSaysLeak(f: Features, settings: Settings) {
  return f.wetFrac >= 0.75 && f.waterNow >= settings.wetThreshold && f.growthPerMin > 5 && f.jump < 25;
}

export function assess(window: Reading[], b: Baseline, prevStreak: number, settings: Settings): Assessment {
  if (window.length < Math.min(3, settings.windowSamples)) {
    return { features: null, mlScore: null, ruleHit: false, mlHit: false, streak: 0, suppressed: 'Collecting readings' };
  }
  const f = features(window.slice(-settings.windowSamples), b, settings);
  const mlScore = leakScore(f);
  const ruleHit = ruleSaysLeak(f, settings);
  const mlHit = mlScore >= settings.leakScoreThreshold;
  return { features: f, mlScore, ruleHit, mlHit, streak: ruleHit || mlHit ? prevStreak + 1 : 0, suppressed: null };
}

/** Opens an alert after `sustainSamples` leak windows in a row, and says which detector saw it. */
export function shouldAlert(a: Assessment, settings: Settings): 'rule' | 'ml' | 'rule+ml' | null {
  if (a.streak < settings.sustainSamples) return null;
  if (a.ruleHit && a.mlHit) return 'rule+ml';
  if (a.mlHit) return 'ml';
  if (a.ruleHit) return 'rule';
  return null;
}

/** "Stuck" Scout: exactly the same reading for a long time (a real sensor always has some noise). */
export function sensorStuck(recent: Reading[], samples = 30) {
  if (recent.length < samples) return false;
  const tail = recent.slice(-samples).map((r) => r.water);
  return tail.every((w) => w === tail[0]) && tail[0] > 0;
}
