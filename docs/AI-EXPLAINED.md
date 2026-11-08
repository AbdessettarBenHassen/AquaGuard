# AquaGuard: the AI, explained for the jury

Context file for the team (and for any AI assistant helping you prepare). Upload it as is.
Project: **AquaGuard**, IoT Spark 4.0, Property 2 "Water-leak detection". Team NAWARAT, IEEE ESPRIT SBJC.
Mission from the spec: *find water where it should not be, warn people and stop the water.*

---

## 1. The 30-second answer (say this first)

> "Our AI is a small **logistic-regression model** that runs **on the ESP32**. Every second it reads a
> **window of the last 8 readings**, turns it into **6 features**, and outputs a **leak probability**.
> If the probability is above 80 % for 3 windows in a row, the node closes the valve by itself.
> We trained it on 66 simulated scenarios and tested it on 44 others it had never seen:
> **98.8 % accuracy, 99 % precision, 95.9 % recall**. A simple threshold rule only reached 40.6 % recall,
> which is why we need a model. Our key metric is **recall**, because a missed leak floods the house,
> while a false alarm only costs one tap to turn the water back on."

En français :

> « Notre IA est une **régression logistique** qui tourne **sur l'ESP32**. Chaque seconde, elle lit une
> **fenêtre des 8 dernières mesures**, en tire **6 caractéristiques**, et donne une **probabilité de fuite**.
> Au-dessus de 80 % pendant 3 fenêtres de suite, le nœud ferme la vanne tout seul. Entraînée sur 66
> scénarios simulés, testée sur 44 autres jamais vus : **98,8 % d'exactitude, 99 % de précision,
> 95,9 % de rappel**. Une simple règle à seuil n'atteint que 40,6 % de rappel : c'est pour ça qu'il faut
> un modèle. Notre métrique clé est le **rappel**, car une fuite manquée inonde la maison, alors qu'une
> fausse alerte coûte seulement un appui pour rouvrir l'eau. »

---

## 2. Two different "AI" parts (do not mix them up)

| | 1. Leak-detection model (the one the AI standard is about) | 2. Assistant (bonus) |
|---|---|---|
| What | Logistic regression, 6 weights + 1 bias | Large language model GPT-OSS 120B (free, via Groq) |
| Where it runs | On the ESP32 node (and the same code in the app's demo sensor) | On our server (Vercel), only when a user asks |
| Input | Window of 8 sensor readings | The zone's alert history and sensor status, through tools |
| Output | Leak probability 0-1 → valve closes | Answers in plain English/French, advice after each alert |
| Needs Internet? | **No**: detection and shut-off work offline | Yes |
| Safety role | **Yes**, it decides the shut-off | No, it only explains |

The jury's AI score is about part 1. Part 2 is the "explain to a non-expert" layer.

---

## 3. The sensors (where the data comes from)

Wiring on the ESP32 development board:

| Sensor | Pin | What it measures | Used for |
|---|---|---|---|
| Water sensor (**Scout**, on the floor) | GPIO34 | how wet the floor is, 0-100 % | main input of the model |
| DHT22 | GPIO4 | air humidity % and temperature | feature "humidity rise" (and to show humid air is NOT a leak) |
| Ultrasonic HC-SR04 (over a tray) | GPIO5 trig, GPIO19 echo | depth of water in the tray, cm | backup leak detection, catches a blocked floor sensor, measures leak growth |
| Servo (**Guardian** valve) | GPIO18 | (actuator) | closes / opens the water |
| Buzzer | GPIO27 | (actuator) | alarm at home |
| BOOT button | GPIO0 | (input) | "I have seen it", pairing confirmation |
| Pipe pressure, flow | (no sensor) | simulated by a virtual pipe model, settable from the app | feature "pressure drop", night pressure test |

The spec requires at least two sensors of different kinds: we have three (resistive water sensor,
DHT22 humidity, ultrasonic distance).

---

## 4. Step 1 of the AI standard: "Use a window"

- The node reads all sensors **once per second**.
- The model never looks at one value: it reads the **last 8 readings (8 seconds)**.
- From that window it computes **6 features**:

| # | Feature | Meaning | Why it helps |
|---|---|---|---|
| 1 | `wetFrac` | share of the 8 readings where the floor is wet (above 30 %) | a real leak keeps the floor wet; one strange reading does not |
| 2 | `waterNow` | average floor wetness over the last 3 s | how much water there is now |
| 3 | `growth` | how fast the wetness rises over the last 4 s (%/min) | **a leak keeps growing**, a spill stops or dries |
| 4 | `humidityRise` | air humidity above the room's usual level | supporting evidence only (a shower raises it too) |
| 5 | `pressureDrop` | pipe pressure below its usual level | water escaping lowers the pressure |
| 6 | `jump` | biggest rise between two consecutive readings | **a spill is a sudden jump**, a leak climbs steadily |

- "Usual level" (baseline) is **learned by the node** during the first 15 dry readings in that room,
  then adapts slowly.
- The answer changes every second as the window slides: the model runs live in the system.

## 5. The model

```
z = -4.832
    + 4.078 × wetFrac
    + 4.605 × (waterNow / 100)
    + 3.439 × growth (scaled to -1..1)
    + 0.243 × humidityRise (scaled)
    + 1.400 × pressureDrop (scaled)
    - 1.441 × jump (scaled 0..1)
leak probability = 1 / (1 + e^(-z))
```

How to read the weights (good for questions):
- **Biggest positive weights: water level, wet share, growth.** Water that stays and grows = leak.
- **`jump` is negative**: a sudden jump (spill, glass of water) lowers the probability.
- **Humidity has almost no weight (0.24)**: the model learned by itself that humid air does not mean
  a leak. That is exactly the spec's "humid air must not stop the water".
- **Pressure drop helps a little**: it confirms water escaping from the pipe.

Decision: probability ≥ 0.8 → "leak window". **3 leak windows in a row** → leak confirmed → valve closes
immediately (before even sending anything over the network), buzzer sounds, then the server alerts the family.

The same weights are in the phone app (`src/core/model.ts`) and on the ESP32 (`firmware/aquaguard_node/src/model.h`),
both generated by the training script.

## 6. Step 2: "Test it on at least 20 labelled windows"

- Data: the team's Guardian/Scout simulation, rebuilt in code, plays **11 kinds of scenario** with random
  sizes and timings: dry, open tap, hot shower, small spill, big spill, leak under the sink, small leak,
  burst pipe, hidden leak in the wall, shower + spill, leak while a tap is open.
- A window is labelled **"leak"** when water is really escaping onto the floor sensor, otherwise **"normal"**.
- Training: 66 scenarios → 2 046 windows. **Test: 44 other scenarios never seen in training → 924 labelled windows**
  (217 leak, 707 normal). Far more than the 20 required.

## 7. Step 3: "Count the errors": confusion matrix

AI model on the 924 test windows:

| | Predicted leak | Predicted normal |
|---|---|---|
| **Real leak** | 208 ✔ | 9 ✘ (missed) |
| **Normal** | 2 ✘ (false alarm) | 705 ✔ |

- **Accuracy** = (208 + 705) / 924 = **98.8 %**
- **Precision** = 208 / (208 + 2) = **99.0 %** (when it says "leak", it is almost always right)
- **Recall** = 208 / (208 + 9) = **95.9 %** (it finds almost every leak window)

Comparison with a simple rule ("wet for most of the window and still rising"): precision 100 % but
**recall only 40.6 %**: the rule misses most leak windows. That is why a model is needed.

Whole scenarios (what really matters for the house): **0 leaks missed out of 16, 0 false alarms out of 28**
(showers, spills, taps), alert on average **3.8 s after the floor gets wet**. The spec asks for the water
stopped < 10 s after a leak is confirmed: the valve closes at the moment of confirmation.

The 9 "missed windows" are the very first seconds of a leak (the water is just reaching the sensor).
The leak is still caught a moment later, which is why 0 leak scenarios were missed.

## 8. Step 4: "Choose your key metric": **recall**

- **Missed leak** (false negative): water runs for hours, floors and walls are damaged, big cost.
- **False alarm** (false positive): the water is turned off for nothing, and an owner turns it back on with one tap.
- So we favour **recall**, but we keep precision very high so that a shower or a spilled glass
  never cuts the water (the spec's "Reliability" target).

Failure modes and limits (say them honestly, the jury rewards it):
1. **Trained on simulated data**: it must be re-tested on the real sensor over a tray. The script
   (`npm run train`) retrains in seconds with real recordings.
2. **A leak inside a wall never reaches the floor sensor**: the model cannot see it. We cover it with
   the **night pressure test**: the valve closes, all taps are off, the pipe pressure is watched for
   15 s; a drop > 0.2 bar = hidden leak. It also starts by itself if water flows non-stop for 45 s.
3. **A blocked or dirty floor sensor** would hide a leak: the **ultrasonic** sees water in the tray while the
   floor sensor says "dry" → sensor fault, the water is turned off for safety, the family is notified.
4. **Pressure and flow are simulated** on the prototype (no sensor in the Hardware Bank).

## 9. Step 5: "Explain it"

- **In:** 8 seconds of readings → 6 features.
- **Out:** one probability of leak, refreshed every second.
- **When it can be wrong:** at the very start of a leak (a second or two late), with a dirty sensor
  (covered by the ultrasonic check), with leaks that never reach the floor (covered by the pressure test),
  and because it was trained on simulation (to re-test on the real hardware).
- **Why this model fits:** it is tiny (7 numbers, runs on a microcontroller in microseconds, works with no
  Internet), it is explainable (each weight has a meaning), and it beats the simple rule clearly.

---

## 10. The full chain (to answer "what happens when…")

1. Leak under the sink → floor sensor gets wet and keeps rising.
2. 3 windows in a row above 80 % → **valve closed by the ESP32 at once**, buzzer on.
3. Event sent to the server → push notification to every phone of the home.
4. 20 s for someone at home to press the button ("I have seen it"). Otherwise: push to the first contact →
   SMS → next contact. The server runs this countdown, so it works even if phones are off.
5. **Recovery:** only an **owner** can turn the water back on, and the node refuses while the floor is still wet.
6. Everything is written in the history (alert, valve actions, who did what).

Sensor failures: floor sensor blocked → water off + alert; humidity sensor or ultrasonic silent →
notification only; node silent for 30 s (power or Wi-Fi lost) → the server sends "sensor offline".

Security (asked often): passwords hashed (scrypt); each sensor has its own secret key (only its hash is
stored); phones and sensors use different authentication; only owners can re-open the water; traffic is HTTPS;
pairing needs a physical button press on the sensor; the AI assistant never receives names or phone numbers.

---

## 11. Likely jury questions, with short answers

**Why not a neural network?** We need something explainable that runs on an ESP32 with no Internet.
Logistic regression on 6 good features already reaches 98.8 %; a bigger model would be harder to explain
and would not stop the water faster.

**Why a window and not one value?** One strange reading (a splash) must not cut the water. A leak is a
behaviour over time: the water stays and keeps rising. Only a window shows that.

**How does it tell a spill from a leak?** Two features: `jump` (a spill is a sudden step, a leak climbs
steadily) and `growth` (a spill stops or dries, a leak keeps rising). The model learned a negative weight for jump.

**How does it ignore a hot shower?** The floor stays dry; humidity alone has almost no weight (0.24).
We tested shower scenarios: 0 false alarms.

**What is your data?** Simulated scenarios built from our Guardian/Scout simulation, with random sizes and
timings, 66 for training and 44 different ones for testing. We know the limit and can retrain with real recordings.

**What if the model is wrong?** Missed leak: the ultrasonic tray check and the 3-in-a-row confirmation give a
second chance, and the pressure test covers hidden leaks. False alarm: the water is off, an owner re-opens in one tap.

**Where does the AI run?** On the ESP32 itself. If Wi-Fi is down, it still detects and closes the valve.

**Which metric matters most and why?** Recall: missing a leak is far more costly than a false alarm.

**What would change in a real product?** A real pressure and flow sensor on the main pipe, a motorised ball
valve instead of a servo, one sensor per wet room, and a model retrained on real data from many homes.

---

## 12. Where to find things in the code

| File | What |
|---|---|
| `src/core/detection.ts` | the 6 features, the model call, the rule, 3-in-a-row confirmation |
| `src/core/model.ts`, `firmware/aquaguard_node/src/model.h` | the trained weights (same numbers) |
| `scripts/train-model.mts` | data generation, training, testing (`npm run train`) |
| `docs/ai-model.md` | the generated test report with both confusion matrices |
| `src/core/pressureTest.ts` | the night pressure test (hidden leaks) |
| `firmware/aquaguard_node/src/main.cpp` | the ESP32 node: sensors, model, valve, alarm, server, Bluetooth |
| `server/src/assistant.ts`, `server/src/advice.ts` | the assistant (part 2 AI) |
