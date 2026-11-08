import type { Reading } from '../core/types';

// Simulated AquaGuard node (Guardian valve + Scout floor sensor), ported from the
// team's "water leak guardian scout" simulation to 1 step = 1 second.
// It produces the same readings the ESP32 sends, so the whole app can be shown
// without hardware, and the training script uses it to make labelled windows.
// Pressure and flow have no real sensor on the prototype: here they are
// simulated, and the demo panel can set them by hand.

export type Toggle = 'tap' | 'shower' | 'sink' | 'burst' | 'wall';
export type Fault = 'unplugged' | 'stuck' | null;

export interface SimState {
  tap: boolean; // a tap is open (normal use)
  shower: boolean; // hot shower: humid air, dry floor
  sink: boolean; // leak under the sink, reaches the Scout
  burst: boolean; // burst pipe: big leak on the Scout
  wall: boolean; // hidden leak inside a wall: never reaches the Scout
  fault: Fault;
  /** Size of the sink leak (1 = the simulation's 1.5 L/min). */
  sinkRate: number;
  puddle: number; // 0..1 water on the Scout
  spill: number; // 0..1 one-off spill, dries away
  humidity: number;
  temp: number;
  pressure: number; // bar
  flow: number; // L/min
  lost: number; // litres lost through leaks
}

/** Values set by hand from the demo panel (null = simulated). */
export interface Overrides {
  water: number | null;
  humidity: number | null;
  pressure: number | null;
  flow: number | null;
}

export const NO_OVERRIDES: Overrides = { water: null, humidity: null, pressure: null, flow: null };

const SUPPLY_BAR = 2;
const BASE_HUMIDITY = 55;

/** Small seeded random generator, so training data is reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function freshState(): SimState {
  return { tap: false, shower: false, sink: false, burst: false, wall: false, fault: null, sinkRate: 1, puddle: 0, spill: 0, humidity: BASE_HUMIDITY, temp: 22, pressure: SUPPLY_BAR, flow: 0, lost: 0 };
}

export class NodeSimulator {
  state: SimState = freshState();
  overrides: Overrides = { ...NO_OVERRIDES };
  private rand: () => number;

  constructor(seed = Date.now()) {
    this.rand = rng(seed);
  }

  private noise(amp: number) {
    return (this.rand() * 2 - 1) * amp;
  }

  set(t: Toggle, on: boolean) {
    this.state = { ...this.state, [t]: on };
  }

  /** A glass of water on the floor: wet for a moment, then it dries (or is wiped). */
  spill(size = 0.45) {
    this.state = { ...this.state, spill: size };
  }

  /** The plumber came: every leak is repaired. */
  fixLeaks() {
    this.state = { ...this.state, sink: false, burst: false, wall: false };
  }

  setFault(f: Fault) {
    this.state = { ...this.state, fault: f };
  }

  reset() {
    this.state = freshState();
    this.overrides = { ...NO_OVERRIDES };
  }

  /** One second of physics. Returns the Scout/Guardian readings, or null when the sensor is unplugged. */
  step(valveOpen: boolean, at = Date.now()): Reading | null {
    const s = { ...this.state };
    const leak = (s.sink ? 1.5 * s.sinkRate : 0) + (s.burst ? 6 : 0) + (s.wall ? 0.8 : 0); // L/min escaping
    if (valveOpen) {
      s.flow = (s.tap ? 6 : 0) + (s.shower ? 8 : 0) * 0.6 + leak;
      const target = SUPPLY_BAR - (s.tap ? 0.35 : 0) - (s.shower ? 0.3 : 0) - (s.sink ? 0.06 : 0) - (s.burst ? 0.5 : 0) - (s.wall ? 0.04 : 0);
      s.pressure += (target - s.pressure) * 0.5;
      s.lost += leak / 60;
    } else {
      // Valve closed: the water left in the pipe still escapes, so the pressure falls.
      s.flow = 0;
      const fall = (s.sink ? 0.05 : 0) + (s.burst ? 0.15 : 0) + (s.wall ? 0.035 : 0) + (s.tap ? 0.6 : 0) + (s.shower ? 0.4 : 0);
      s.pressure = Math.max(0, s.pressure - fall);
      if (s.pressure > 0.1) s.lost += leak / 600;
    }
    const escaping = valveOpen || s.pressure > 0.1;
    if (s.burst && escaping) s.puddle = Math.min(1, s.puddle + 0.2);
    else if (s.sink && escaping) s.puddle = Math.min(1, s.puddle + 0.07 * s.sinkRate);
    else if (!s.sink && !s.burst) s.puddle = Math.max(0, s.puddle - 0.03);
    s.spill = Math.max(0, s.spill - 0.02);
    // Humidity: a shower fills the air; standing water raises it slowly.
    const humTarget = BASE_HUMIDITY + (s.shower ? 35 : 0) + s.puddle * 12;
    s.humidity += (humTarget - s.humidity) * 0.08 + this.noise(0.4);
    s.temp += (22 + (s.shower ? 3 : 0) - s.temp) * 0.05 + this.noise(0.05);
    this.state = s;

    if (s.fault === 'unplugged') return null;
    const o = this.overrides;
    const wetness = Math.min(1, s.puddle + s.spill);
    const water = s.fault === 'stuck' ? 37 : Math.max(0, Math.min(100, wetness * 100 + (wetness > 0.02 ? this.noise(1.5) : this.rand() * 1.2)));
    return {
      at,
      water: o.water ?? Math.round(water * 10) / 10,
      humidity: o.humidity ?? Math.round(s.humidity * 10) / 10,
      temp: Math.round(s.temp * 10) / 10,
      pressure: o.pressure ?? Math.round((s.pressure + this.noise(0.005)) * 100) / 100,
      flow: o.flow ?? Math.round(Math.max(0, s.flow + (s.flow > 0 ? this.noise(0.1) : 0)) * 10) / 10,
    };
  }
}
