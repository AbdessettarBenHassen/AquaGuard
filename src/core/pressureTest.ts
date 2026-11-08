import type { PressureTest, Settings } from './types';

// Night pressure test (same logic as the team's Guardian/Scout simulation):
//   1. close the valve, wait 2 s for the pipe to settle, note the pressure p0
//   2. in the first seconds, a big fall (> 0.8 bar) means a tap is in use:
//      cancel and re-open
//   3. at the end, a fall > testDropBar with every tap closed means water is
//      escaping in the pipes or walls: hidden leak, keep the valve closed;
//      otherwise the pipe held: re-open.
// Pure function: the node (and the demo node) calls step() once per second.

export const SETTLE_SEC = 2;
export const IN_USE_WINDOW_SEC = 7;
export const IN_USE_DROP_BAR = 0.8;

export function startTest(now: number, auto: boolean): PressureTest {
  return { state: 'running', startedAt: now, elapsed: 0, p0: null, drop: null, auto };
}

export function stepTest(t: PressureTest, pressure: number | null, settings: Pick<Settings, 'testSec' | 'testDropBar'>): PressureTest {
  if (t.state !== 'running') return t;
  const elapsed = t.elapsed + 1;
  if (pressure == null) return { ...t, elapsed, state: 'cancelled' }; // no pressure reading: cannot test
  if (elapsed === SETTLE_SEC) return { ...t, elapsed, p0: pressure, drop: 0 };
  if (t.p0 == null) return { ...t, elapsed };
  const drop = Math.round((t.p0 - pressure) * 100) / 100;
  if (elapsed < IN_USE_WINDOW_SEC && drop > IN_USE_DROP_BAR) return { ...t, elapsed, drop, state: 'cancelled' };
  if (elapsed >= settings.testSec) return { ...t, elapsed, drop, state: drop > settings.testDropBar ? 'failed' : 'passed' };
  return { ...t, elapsed, drop };
}
