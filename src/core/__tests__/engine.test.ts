import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NodeSimulator } from '../../device/simulator';
import { DEFAULT_SETTINGS } from '../defaults';
import { sensorStuck } from '../detection';
import { GuardEngine, type Notifier } from '../engine';
import { startTest, stepTest } from '../pressureTest';
import type { Contact, Reading } from '../types';

// Runs the simulated node through the engine one second at a time, like the
// real node does, and checks the targets of the challenge:
//   Response:    water stopped < 10 s after a leak is confirmed
//   Recovery:    only an owner turns it back on, never on a wet floor
//   Reliability: humid air or a small spill must NOT stop the water

const T0 = 1_800_000_000_000;
const CONTACTS: Contact[] = [
  { id: 'a', name: 'Sami', role: 'family', phone: '1', push: true, sms: true },
  { id: 'b', name: 'Neighbour', role: 'neighbour', phone: '2', push: false, sms: true },
];

function setup(seed = 7) {
  const sent: string[] = [];
  const notifier: Notifier = { send: (c, ch) => sent.push(`${c.name}:${ch}`) };
  const engine = new GuardEngine(notifier, { contacts: CONTACTS });
  engine.setLink({ connected: true });
  const sim = new NodeSimulator(seed);
  let t = T0;
  /** Plays `sec` seconds: physics with the engine's valve, detection, timers. */
  const run = (sec: number) => {
    for (let i = 0; i < sec; i++) {
      t += 1000;
      const r = sim.step(engine.getState().valve === 'open', t);
      if (r) engine.ingest(r);
      engine.tick(t);
    }
  };
  return { engine, sim, sent, run, now: () => t };
}

test('learns the room (usual humidity and pressure) from dry readings', () => {
  const { engine, run } = setup();
  run(20);
  const b = engine.getState().baseline;
  assert.equal(b.calibrated, true);
  assert.ok(Math.abs(b.humidity! - 55) < 3, `humidity ${b.humidity}`);
  assert.ok(Math.abs(b.pressure! - 2) < 0.05, `pressure ${b.pressure}`);
});

test('hot shower: humid air, dry floor: no alert, water stays on', () => {
  const { engine, sim, run } = setup();
  run(20);
  sim.set('shower', true);
  run(60);
  assert.ok(engine.getState().latest!.humidity! > 80);
  assert.equal(engine.getState().stage, 'IDLE');
  assert.equal(engine.getState().valve, 'open');
});

test('small spill that dries: no alert, water stays on', () => {
  const { engine, sim, run } = setup();
  run(20);
  sim.spill(0.5);
  run(40);
  assert.equal(engine.getState().stage, 'IDLE');
  assert.equal(engine.getState().valve, 'open');
});

test('open tap (normal use): pressure dips, no alert', () => {
  const { engine, sim, run } = setup();
  run(20);
  sim.set('tap', true);
  run(30);
  assert.ok(engine.getState().latest!.pressure! < 1.8);
  assert.equal(engine.getState().stage, 'IDLE');
});

test('leak under the sink: water turned off within 10 s of the floor getting wet', () => {
  const { engine, sim, run, now } = setup();
  run(20);
  sim.set('sink', true);
  let wetAt: number | null = null;
  for (let i = 0; i < 40 && engine.getState().stage === 'IDLE'; i++) {
    run(1);
    if (wetAt == null && engine.getState().latest!.water >= DEFAULT_SETTINGS.wetThreshold) wetAt = now();
  }
  const s = engine.getState();
  assert.equal(s.active?.trigger.kind, 'leak');
  assert.equal(s.valve, 'closed');
  assert.ok(wetAt != null);
  assert.ok(now() - wetAt! < 10000, `closed ${(now() - wetAt!) / 1000} s after wet`);
  assert.ok(['ml', 'rule+ml', 'rule'].includes(s.active!.trigger.source));
  assert.ok(s.active!.trigger.snapshot.mlScore! >= DEFAULT_SETTINGS.leakScoreThreshold);
});

test('full chain: alarm at home -> push -> SMS -> next contact', () => {
  const { engine, sim, sent, run } = setup();
  run(20);
  sim.set('sink', true);
  run(10);
  assert.equal(engine.getState().stage, 'LOCAL_ASSISTANCE');
  run(DEFAULT_SETTINGS.gracePeriodSec);
  assert.equal(engine.getState().stage, 'ESCALATE');
  assert.deepEqual(sent, ['Sami:push']);
  run(DEFAULT_SETTINGS.smsFallbackSec);
  assert.deepEqual(sent, ['Sami:push', 'Sami:sms']);
  run(DEFAULT_SETTINGS.nextContactSec);
  assert.deepEqual(sent, ['Sami:push', 'Sami:sms', 'Neighbour:sms']);
});

test('someone at home presses the button: alert closed, nobody else bothered', () => {
  const { engine, sim, sent, run, now } = setup();
  run(20);
  sim.set('sink', true);
  run(10);
  engine.localAcknowledge(now());
  run(60);
  assert.deepEqual(sent, []);
  assert.equal(engine.getState().history[0].resolution, 'local_ack');
  assert.equal(engine.getState().valve, 'closed', 'the water stays off until an owner re-opens it');
});

test('recovery: only an owner re-opens, and never while the floor is wet', () => {
  const { engine, sim, run, now } = setup();
  run(20);
  sim.set('sink', true);
  run(10);
  engine.memberAcknowledge('Leila', now());
  assert.equal(engine.reopenValve('member'), 'not_allowed');
  assert.equal(engine.reopenValve('owner'), 'still_wet');
  sim.fixLeaks();
  run(30); // the floor dries
  assert.equal(engine.reopenValve('owner'), 'ok');
  assert.equal(engine.getState().valve, 'open');
});

test('sensor unplugged: fault alert, water turned off for safety', () => {
  const { engine, sim, run } = setup();
  run(20);
  sim.setFault('unplugged');
  run(DEFAULT_SETTINGS.staleSec + 3);
  assert.equal(engine.getState().active?.trigger.kind, 'sensor_fault');
  assert.equal(engine.getState().valve, 'closed');
});

test('sensor blocked: the same exact value for 30 s is spotted', () => {
  const { sim } = setup();
  sim.setFault('stuck');
  const readings: Reading[] = [];
  for (let i = 0; i < 30; i++) readings.push(sim.step(true, T0 + i * 1000)!);
  assert.equal(sensorStuck(readings), true);
});

test('night pressure test: hidden leak in the wall fails it, a sound pipe passes', () => {
  const settings = DEFAULT_SETTINGS;
  const play = (wall: boolean, tapDuringTest = false) => {
    const sim = new NodeSimulator(3);
    sim.set('wall', wall);
    for (let i = 0; i < 10; i++) sim.step(true);
    let t = startTest(T0, false);
    while (t.state === 'running') {
      if (tapDuringTest && t.elapsed === 3) sim.set('tap', true); // someone uses water during the test
      t = stepTest(t, sim.step(false)!.pressure, settings);
    }
    return t;
  };
  const leak = play(true);
  assert.equal(leak.state, 'failed');
  assert.ok(leak.drop! > settings.testDropBar, `drop ${leak.drop}`);
  assert.equal(play(false).state, 'passed');
  assert.equal(play(false, true).state, 'cancelled', 'a tap in use cancels the test');
});

test('hidden leak alert keeps the water off', () => {
  const { engine, run, now } = setup();
  run(20);
  engine.hiddenLeak(0.45, now());
  assert.equal(engine.getState().active?.trigger.kind, 'hidden_leak');
  assert.equal(engine.getState().valve, 'closed');
});
