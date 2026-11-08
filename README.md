# GlucoGuard: Parent Companion App

React Native (Expo) companion app for **GlucoGuard**, a discreet safety wearable for children with Type 1 diabetes.
Team NAWARAT, IEEE Esprit Student Branch, SymbioMed Challenge (IEEE TRSYP 3.0).

It implements the parent-facing layer of the Checkpoint 2 Technical Architecture Report:
live status, alert escalation, alert history with explanations, and device and contact settings.

## Run it

```bash
npm install
npx expo start        # scan the QR code with Expo Go (Android / iOS)
```

The app starts in **demo mode** with a simulated ESP32-C3 wearable, so no hardware is needed.
On the **Live** tab, wait about 20 s for baseline calibration, then use the simulator:

| Scenario | What you should see |
|---|---|
| **Hypo episode** | HR and sweat rise at rest. Alert opens, the wearable prompts the child, and after the grace period: push → SMS → next contact |
| **Playing sport** | HR and sweat high, but the child is *active*, so detection is suppressed (no false alarm) |
| **Sensor fault** | Data stops. A sensor-fault alert opens after 10 s instead of staying silent |
| **Missed check-in** | Watchdog alert |
| **Child presses button** | Child acknowledges. Resolved without bothering caregivers |
| **Disconnect wearable** | "Wearable offline" warning |

Timers are in seconds for demonstration and can be changed in **Settings**.

## Online

- **API:** https://glucoguard-api.vercel.app (Vercel, auto-deploys from `main`, root `server/`)
- **Database:** Neon Postgres (`DATABASE_URL` stored as a Vercel secret)
- **Android app:** `npx eas-cli build -p android --profile preview` produces an installable APK

## Shared family database (Postgres on Neon)

```
Phones  ⇄  GlucoGuard API (server/, holds DATABASE_URL)  ⇄  Neon Postgres
```

- The **wristband phone** detects alerts and pushes them; **family phones** join with a 6-letter code,
  mirror live status, alerts and history, hear the alarm, and can acknowledge from anywhere.
- Only alerts, acknowledgements and one overwritten live snapshot are stored, never sensor history.

```bash
cd server && npm install
# server/.env  ->  DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
npm run migrate          # creates tables (idempotent)
npm run dev              # API on :3000
```

Set the app's server address in `.env` (`EXPO_PUBLIC_API_URL=http://<PC Wi-Fi IP>:3000`), or type it
in Settings → Family sharing. End-to-end check: `npm run test:sync` (needs the API running).

## How it maps to the report

| Report | Code |
|---|---|
| Escalation state machine (Fig. 2): IDLE → EVENT_DETECTED → LOCAL_ASSISTANCE → ESCALATE → RESOLVED | [src/core/engine.ts](src/core/engine.ts) |
| Rule-based fallback: HR **and** GSR over personal baseline, only at rest or asleep, sustained | [src/core/detection.ts](src/core/detection.ts) |
| TinyML classifier refines but never acts alone | `shouldAlert()` in detection.ts; simulated score in [src/device/simulator.ts](src/device/simulator.ts) |
| BLE GATT custom service (Section 4) | [src/device/protocol.ts](src/device/protocol.ts) |
| Human override: acknowledge / snooze / stop, from child button or app | Alert screen [src/app/alert.tsx](src/app/alert.tsx) |
| Explainability: every alert logged with the readings that triggered it | History + [src/app/event/[id].tsx](src/app/event/[id].tsx) |
| Configurable escalation chain (parent → caregiver → teacher) | Contacts tab |
| Firebase backend owns timers, FCM push, Twilio SMS | [firebase/functions/src/index.ts](firebase/functions/src/index.ts) |
| Data minimization, authenticated access | [firebase/firestore.rules](firebase/firestore.rules) |
| Non-medical-device framing | Onboarding + Settings → About |

## Project layout

```
src/
  app/            Expo Router screens (tabs: Live, History, Contacts, Settings; alert modal; event detail)
  core/           Pure TypeScript engine (state machine, detection), unit-tested
  device/         BLE protocol + wearable simulator
  state/          React provider: engine + persistence (AsyncStorage)
  ui/             Theme and shared components
firebase/         Cloud Functions (escalation, FCM, Twilio) and Firestore rules
```

## Checks

```bash
npm test              # engine unit tests (state machine, detection, escalation)
npm run typecheck
npx expo lint
```

## Next steps toward the real device

1. **BLE:** add `react-native-ble-plx` (needs a development build: `npx expo run:android`). Subscribe to
   `GG_CHAR.sample`, decode with `decodeSample()`, and call `engine.ingest()`, replacing `WearableSimulator`.
2. **Firebase:** add `@react-native-firebase/app`, `/firestore`, `/messaging`. Write alert docs to
   `families/{id}/alerts` and swap `localNotifier` for the cloud function.
3. Tune thresholds with clinician input during the supervised pilot.

> GlucoGuard is not a medical device and does not measure blood glucose. It complements, and never replaces,
> glucose monitoring and clinical care.
