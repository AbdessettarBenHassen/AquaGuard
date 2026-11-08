// Trains and tests the AquaGuard leak model (AI standard of the challenge).
//   npm run train
//
// 1. Labelled windows: the node simulator plays scenarios (dry, tap, shower,
//    small spill, leak under the sink, burst pipe, hidden wall leak, mixes) with
//    random sizes and timings. A window is labelled "leak" when water is
//    escaping onto the floor sensor and the floor is wet; everything else is
//    "normal" (humid air and small spills must NOT stop the water).
// 2. Logistic regression on the 5 window features (src/core/detection.ts),
//    trained with gradient descent on one set of episodes, tested on other,
//    unseen episodes (different random seeds).
// 3. Writes the weights to src/core/model.ts (same weights go in the firmware)
//    and a report with the confusion matrix, accuracy, precision and recall,
//    compared with the simple rule, to docs/ai-model.md.

import { writeFileSync, mkdirSync } from 'node:fs';

import { DEFAULT_SETTINGS } from '../src/core/defaults';
import { assess, emptyBaseline, features, leakScore, ruleSaysLeak, shouldAlert, updateBaseline, vectorize } from '../src/core/detection';
import type { Baseline, Features, Reading } from '../src/core/types';
import { NodeSimulator, rng } from '../src/device/simulator';

const S = DEFAULT_SETTINGS;
const W = S.windowSamples;
const EPISODE_SEC = 70;

type Kind = 'dry' | 'tap' | 'shower' | 'spill' | 'bigSpill' | 'sink' | 'smallSink' | 'burst' | 'wall' | 'showerSpill' | 'sinkTap';
const KINDS: Kind[] = ['dry', 'tap', 'shower', 'spill', 'bigSpill', 'sink', 'smallSink', 'burst', 'wall', 'showerSpill', 'sinkTap'];
const LEAK_KINDS = new Set<Kind>(['sink', 'smallSink', 'burst', 'sinkTap']);

interface Sample {
  f: Features;
  x: number[];
  y: 0 | 1;
  kind: Kind;
  ruleHit: boolean;
}

interface Episode {
  kind: Kind;
  readings: Reading[];
  /** second at which water starts escaping onto the floor (leak kinds) */
  leakAt: number | null;
}

function play(kind: Kind, seed: number): Episode {
  const r = rng(seed * 7919 + 13);
  const sim = new NodeSimulator(seed);
  const start = 20 + Math.floor(r() * 15); // after the room baseline is learned
  const readings: Reading[] = [];
  let leakAt: number | null = null;
  for (let t = 0; t < EPISODE_SEC; t++) {
    if (t === start) {
      if (kind === 'tap' || kind === 'sinkTap') sim.set('tap', true);
      if (kind === 'shower' || kind === 'showerSpill') sim.set('shower', true);
      if (kind === 'spill' || kind === 'showerSpill') sim.spill(0.25 + r() * 0.3);
      if (kind === 'bigSpill') sim.spill(0.55 + r() * 0.25);
      if (kind === 'sink' || kind === 'sinkTap') sim.state.sinkRate = 0.7 + r() * 0.8;
      if (kind === 'smallSink') sim.state.sinkRate = 0.35 + r() * 0.25;
      if (kind === 'sink' || kind === 'smallSink' || kind === 'sinkTap') sim.set('sink', true);
      if (kind === 'burst') sim.set('burst', true);
      if (kind === 'wall') sim.set('wall', true);
      if (LEAK_KINDS.has(kind)) leakAt = t;
    }
    readings.push(sim.step(true, 1_700_000_000_000 + (seed * 1000 + t) * 1000)!);
  }
  return { kind, readings, leakAt };
}

function windowsOf(ep: Episode, every = 2): Sample[] {
  const out: Sample[] = [];
  let b: Baseline = emptyBaseline();
  ep.readings.forEach((r, i) => {
    b = updateBaseline(b, r, S);
    if (i < W - 1 || i % every) return;
    const win = ep.readings.slice(i - W + 1, i + 1);
    const f = features(win, b, S);
    const wetNow = win[win.length - 1].water >= S.wetThreshold;
    const y = ep.leakAt != null && i >= ep.leakAt && wetNow ? 1 : 0;
    out.push({ f, x: vectorize(f), y, kind: ep.kind, ruleHit: ruleSaysLeak(f, S) });
  });
  return out;
}

function episodes(seeds: number[]) {
  return seeds.flatMap((seed) => KINDS.map((k, i) => play(k, seed * 100 + i)));
}

// ---- training: logistic regression, class-balanced, gradient descent ----
function train(data: Sample[]) {
  const d = data[0].x.length;
  let w = new Array(d).fill(0);
  let b = 0;
  const pos = data.filter((s) => s.y === 1).length;
  const wPos = data.length / (2 * pos);
  const wNeg = data.length / (2 * (data.length - pos));
  const lr = 0.5;
  const l2 = 0.001;
  for (let epoch = 0; epoch < 4000; epoch++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (const s of data) {
      const z = b + s.x.reduce((acc, xi, i) => acc + xi * w[i], 0);
      const p = 1 / (1 + Math.exp(-z));
      const err = (p - s.y) * (s.y ? wPos : wNeg);
      s.x.forEach((xi, i) => (gw[i] += err * xi));
      gb += err;
    }
    w = w.map((wi, i) => wi - lr * (gw[i] / data.length + l2 * wi));
    b -= lr * (gb / data.length);
  }
  return { weights: w.map((x) => Math.round(x * 1000) / 1000), bias: Math.round(b * 1000) / 1000 };
}

function confusion(pred: boolean[], truth: (0 | 1)[]) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  pred.forEach((p, i) => {
    if (p && truth[i]) tp++;
    else if (p) fp++;
    else if (truth[i]) fn++;
    else tn++;
  });
  const acc = (tp + tn) / pred.length;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  return { tp, fp, tn, fn, acc, precision, recall };
}

/** Whole detector on whole episodes: does it alert, and how fast after the water starts? */
function episodeTest(eps: Episode[], model: { weights: number[]; bias: number }) {
  const rows = eps.map((ep) => {
    let b: Baseline = emptyBaseline();
    let streak = 0;
    let alertAt: number | null = null;
    ep.readings.forEach((r, i) => {
      b = updateBaseline(b, r, S);
      if (alertAt != null || i < 2) return;
      const win = ep.readings.slice(Math.max(0, i - W + 1), i + 1);
      const a = assess(win, b, streak, S);
      // use the freshly trained model
      if (a.features) {
        a.mlScore = leakScore(a.features, model);
        a.mlHit = a.mlScore >= S.leakScoreThreshold;
        a.streak = a.ruleHit || a.mlHit ? streak + 1 : 0;
      }
      streak = a.streak;
      if (shouldAlert(a, S)) alertAt = i;
    });
    const firstWet = ep.leakAt != null ? ep.readings.findIndex((r, i) => i >= ep.leakAt! && r.water >= S.wetThreshold) : -1;
    return { kind: ep.kind, leak: ep.leakAt != null, alerted: alertAt != null, delay: alertAt != null && firstWet >= 0 ? alertAt - firstWet : null };
  });
  return rows;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

const trainEps = episodes([1, 2, 3, 4, 5, 6]);
const testEps = episodes([101, 102, 103, 104]);
const trainSet = trainEps.flatMap((e) => windowsOf(e));
const testSet = testEps.flatMap((e) => windowsOf(e, 3));

const model = train(trainSet);
const truth = testSet.map((s) => s.y);
const mlPred = testSet.map((s) => leakScore(s.f, model) >= S.leakScoreThreshold);
const ml = confusion(mlPred, truth);
const rule = confusion(testSet.map((s) => s.ruleHit), truth);
const eps = episodeTest(testEps, model);
const leakEps = eps.filter((e) => e.leak);
const normalEps = eps.filter((e) => !e.leak);
const missed = leakEps.filter((e) => !e.alerted);
const falseAlarms = normalEps.filter((e) => e.alerted);
const delays = leakEps.map((e) => e.delay).filter((d): d is number => d != null);
const avgDelay = delays.length ? Math.round((delays.reduce((s, d) => s + d, 0) / delays.length) * 10) / 10 : null;

const names = ['wetFrac', 'waterNow', 'growth', 'humidityRise', 'pressureDrop', 'jump'];
writeFileSync(
  new URL('../src/core/model.ts', import.meta.url),
  `// AquaGuard leak model: logistic regression over a window of readings.
// GENERATED by scripts/train-model.mts (npm run train): do not edit by hand.
// The firmware uses the same weights (copy them into the node's model header).

export const MODEL = {
  version: 'leak-logreg-1',
  features: ${JSON.stringify(names)} as const,
  // x = [wetFrac, waterNow/100, clamp(growthPerMin/100), clamp(humidityRise/20), clamp(pressureDrop/0.5), clamp(jump/50, 0, 1)]
  weights: ${JSON.stringify(model.weights)},
  bias: ${model.bias},
};
`,
);

// Same weights for the ESP32 firmware.
writeFileSync(
  new URL('../firmware/aquaguard_node/src/model.h', import.meta.url),
  `// AquaGuard leak model for the ESP32 node.
// GENERATED by scripts/train-model.mts (npm run train): do not edit by hand.
// Same weights as src/core/model.ts. Inputs, in this order:
//   ${names.join(', ')}
// scaled as: wetFrac, waterNow/100, clamp(growthPerMin/100,-1,1), clamp(humidityRise/20,-1,1),
//            clamp(pressureDrop/0.5,-1,1), clamp(jump/50,0,1)
#pragma once
#define MODEL_VERSION "leak-logreg-1"
#define MODEL_FEATURES ${names.length}
static const float MODEL_WEIGHTS[MODEL_FEATURES] = {${model.weights.map((w) => `${w}f`).join(', ')}};
static const float MODEL_BIAS = ${model.bias}f;
`,
);

const table = (c: ReturnType<typeof confusion>) => `|  | Predicted leak | Predicted normal |
|---|---|---|
| **Real leak** | ${c.tp} (true positive) | ${c.fn} (missed) |
| **Normal** | ${c.fp} (false alarm) | ${c.tn} (true negative) |

Accuracy **${pct(c.acc)}** · Precision **${pct(c.precision)}** · Recall **${pct(c.recall)}**`;

const byKind = KINDS.map((k) => {
  const rows = eps.filter((e) => e.kind === k);
  return `| ${k} | ${LEAK_KINDS.has(k) ? 'leak' : 'normal'} | ${rows.filter((e) => e.alerted).length}/${rows.length} |`;
}).join('\n');

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../docs/ai-model.md', import.meta.url),
  `# AquaGuard leak model: test report

Generated by \`npm run train\` (scripts/train-model.mts).

## What goes in, what comes out

- **Input:** a window of the last ${W} readings (1 per second) from the node, turned into 6 features:
  share of the window where the floor is wet, current water level, how fast it grows over the last
  4 s (%/min), humidity above the room's usual level, pipe pressure below its usual level, and the
  biggest one-second jump (a spill jumps, a leak climbs steadily).
- **Model:** logistic regression (6 weights + 1 bias), small enough to run on the ESP32.
- **Output:** a leak probability 0-1. A window counts as a leak above ${S.leakScoreThreshold};
  an alert needs ${S.sustainSamples} leak windows in a row (one strange reading never stops the water).

Weights: ${names.map((n, i) => `${n} ${model.weights[i]}`).join(', ')}, bias ${model.bias}.

## Data

Simulated episodes of ${EPISODE_SEC} s, with random sizes and timings: ${KINDS.join(', ')}.
Training: ${trainEps.length} episodes (${trainSet.length} windows). Test: ${testEps.length} other episodes,
never seen in training (${testSet.length} labelled windows, ${truth.filter((y) => y).length} leak, ${truth.filter((y) => !y).length} normal).

## Confusion matrix: AI model (test windows)

${table(ml)}

## Same windows: simple rule ("wet for most of the window, still climbing, no sudden jump")

${table(rule)}

## Whole detector on whole episodes (test)

| Episode | Truth | Alerts |
|---|---|---|
${byKind}

- Leaks missed: **${missed.length} of ${leakEps.length}**
- False alarms (shower, spills, tap, hidden wall leak on a dry floor): **${falseAlarms.length} of ${normalEps.length}**
- Average time from wet floor to alert: **${avgDelay ?? '–'} s** (then the valve closes at once)

## Key metric: recall

A missed leak costs a flooded floor and damaged walls; a false alarm costs a closed valve that an
owner re-opens in one tap. So recall (no missed leak) comes first, while precision stays high
enough that a small spill or a shower never stops the water (spec "Reliability").

## Limits

- Trained on simulated data shaped on the team's Guardian/Scout simulation; it must be re-tested on the
  real sensor over a tray before trusting the numbers.
- A leak that never reaches the floor sensor (inside a wall) is invisible to this model: the night
  pressure test (src/core/pressureTest.ts) covers it.
- Pressure and flow are simulated on the prototype (no sensor fitted).
`,
);

console.log('weights', model.weights, 'bias', model.bias);
console.log('AI   ', ml);
console.log('rule ', rule);
console.log('episodes: missed', missed.length, '/', leakEps.length, ' false alarms', falseAlarms.length, '/', normalEps.length, ' avg delay', avgDelay, 's');
console.log(falseAlarms.map((e) => e.kind).join(', ') || 'no false alarm episode');
