# Codebase Input Context

This document describes the inputs the current code actually consumes. It is intended as a handoff for anyone connecting vehicle hardware, a telemetry service, or recorded logs to the dashboard.

## 1. Application and data flow

The frontend is a React 19 + TypeScript application built with Vite and Tailwind CSS v4.

It supports three telemetry sources:

- **Simulation** (default): generates frames internally; no external data is needed.
- **WebSocket**: the browser connects to a server that pushes telemetry frames.
- **Supabase Realtime Broadcast**: the browser subscribes to `telemetry:live:<session UUID>` and merges partial decoded channel updates. It does not decode HTP, sign ingest posts, or poll the database. Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable or legacy anon only), and `VITE_TELEMETRY_SESSION_ID`. See `src/telemetry/live/` and `env.example`. Unmapped dashboard fields render as unavailable, not as zeros.

```text
Vehicle sensors / CAN decoder / recorded CSV / mock generator
    -> WebSocket server
    -> JSON text messages
    -> src/telemetry/useTelemetry.ts
    -> normalized Frame objects
    -> dashboard charts, gauges, alerts, and lap views
```

The included Python bridge (`telemetry_server/server.py`) implements mock generation and CSV replay. Direct CAN ingestion is not implemented: despite a reference to CAN in its introductory docstring, the CLI only supports `mock` and `csv`.

## 2. WebSocket input contract

- Default client URL: `ws://localhost:8765`.
- Change the URL and select the WebSocket source through the dashboard's source configuration.
- Source selection and URL are persisted in browser local storage.
- The dashboard is a **client/subscriber**, not a WebSocket server.
- Send **one flat JSON object per WebSocket text message**.
- No HTTP POST endpoint, subscription topic, authentication message, or start command is used by the current client.
- Use exact, case-sensitive field names. `speed` also accepts the alias `spd`; no other aliases are implemented.
- Send finite JSON numbers in the units below. Convert sensor units before sending.
- Recommended rate: **10 Hz**. The client retains the latest **180 frames**, approximately 18 seconds at 10 Hz.
- Send complete snapshots rather than channel deltas: missing values use defaults, not the previous frame's readings.

### Complete example frame

```json
{
  "t": 12.4,
  "speed": 86.2,
  "rpm": 5420,
  "gear": 3,
  "throttle": 74.1,
  "brake": 0.0,
  "steering": 12.4,
  "wFL": 84.1,
  "wFR": 87.6,
  "wRL": 90.3,
  "wRR": 93.1,
  "volt": 13.62,
  "coolant": 91.4,
  "oilTemp": 98.2,
  "oilPress": 4.51,
  "fuel": 96.4,
  "gX": 0.42,
  "gY": 0.81,
  "lapTime": 12.4,
  "lapNum": 1,
  "suspFL": -40.2,
  "suspFR": -55.8,
  "suspRL": 22.1,
  "suspRR": 18.4
}
```

### Field reference

Ranges are the current display/registry scales, **not enforced input validation**.

| Field | Meaning / unit | Display range or expectation | Default when omitted or null |
| --- | --- | --- | --- |
| `t` | Session elapsed time, seconds | Increasing, nonnegative session time recommended | Internal clock advanced by 0.1 s per telemetry message; only a numeric `t` is accepted |
| `speed` | Vehicle speed, km/h | 0–240 | `spd`, otherwise `0` |
| `rpm` | Engine speed, rpm | 0–8000 | `0` |
| `gear` | Gear number | 0–7 display scale; integer recommended | `1` |
| `throttle` | Throttle, percent | 0–100 | `0` |
| `brake` | Brake pressure, kPa | 0–200 | `0` |
| `steering` | Steering angle, degrees | -90–90 | `0` |
| `wFL`, `wFR`, `wRL`, `wRR` | Corner wheel speeds, km/h | 0–240 | Normalized vehicle speed, independently for each missing wheel |
| `volt` | Battery voltage, V | 10–16 | `13.5` |
| `coolant` | Coolant temperature, °C | 40–130 | `85` |
| `oilTemp` | Oil temperature, °C | 50–140 | `92` |
| `oilPress` | Oil pressure, bar | 0–7 | `4.2` |
| `fuel` | Fuel level, percent | 0–100 | `100` |
| `gX` | Lateral acceleration, g | -3–3 | `0` |
| `gY` | Longitudinal acceleration, g | -3–3 | `0` |
| `lapTime` | Elapsed time in the current lap, seconds | Current visuals assume a 90-second lap | `t % 90` |
| `lapNum` | Current lap number | Integer >= 1 recommended | `floor(t / 90) + 1` |
| `suspFL`, `suspFR`, `suspRL`, `suspRR` | Corner damper velocities, mm/s | Nominally -400–400 | `0` |

Corner suffixes: **FL** = front left, **FR** = front right, **RL** = rear left, **RR** = rear right.

The mock source uses positive `gY` for acceleration and negative `gY` for braking. Steering and lateral-g signs should be consistent in your producer; the code does not establish a physical left/right sign convention.

### Small useful frame

All fields have fallbacks, so no channel is strictly required by a schema validator. For useful primary readings, start with:

```json
{
  "t": 1.5,
  "speed": 42,
  "rpm": 3100,
  "gear": 2,
  "throttle": 55,
  "brake": 0,
  "lapTime": 1.5,
  "lapNum": 1
}
```

Omitted sensor values may look plausible because of defaults. They do **not** indicate actual sensor measurements.

## 3. Parsing and connection behavior

- Optional messages with `"type": "handshake"` are ignored as telemetry. A handshake is not required.
- Unknown fields are ignored and are not retained in the normalized frame.
- Most known fields are converted with JavaScript `Number(...)`; `t` is special and must already be a number. Numeric strings may therefore work for other fields, but producers should send actual numbers.
- There is no strict object/schema validation, range checking, or finite-number checking. Invalid numeric strings can become `NaN` and contaminate visualizations.
- JSON parse/ingestion exceptions are silently ignored.
- Do not send arrays, nested channel objects, binary messages, newline-delimited batches, or metadata as telemetry. Some valid JSON with the wrong shape can be interpreted as a frame containing defaults rather than rejected.
- In particular, only `handshake` messages are explicitly skipped. A `pong` or another metadata object can become a default-valued telemetry frame.
- Switching into WebSocket mode clears the frame buffer and lap history.
- Constructor failures retry after 2 seconds; socket closure retries after 2.5 seconds.
- The client sends no application-level messages. The included server supports a JSON ping/pong exchange for custom clients, but the dashboard does not use it.

## 4. Timing and visualization limitations

These are implementation limitations, not additional input requirements:

1. `HZ = 10` and `LAP_LEN = 90` are fixed frontend constants. If `t` is absent, fallback time advances by 0.1 seconds per message regardless of actual arrival rate. The internal fallback clock is not synchronized to supplied timestamps.
2. Supply `t`, `lapTime`, and `lapNum` explicitly for real data. Otherwise, lap values are inferred using a fixed 90-second lap.
3. Any change in `lapNum` finalizes a lap; there is no check that it increments by exactly one. Starting mid-session, timestamp resets, skipped laps, or looping logs can therefore produce misleading lap history.
4. Sector selection uses `lapTime / 90` and fixed track boundary fractions (`17/54` and `34/54`). **Recorded sector durations still come from `noisySector(...)`, including in live mode. Lap totals, best sectors, best laps, and theoretical lap time are therefore not reliable measured live timing.** Sending accurate lap fields does not fix this limitation.
5. The track/GPS visualization uses fixed geometry and lap progress, not incoming latitude/longitude. GPS coordinates are not part of `Frame` and are ignored if supplied as extra fields.
6. All four suspension fields are normalized, but only `suspFL` is currently registered in `CHANNELS`. Registering a new field is necessary to expose it to registry-driven selectors and expression scope.
7. Sending a new custom JSON key alone does not add a channel. Extend `Frame`, `normalizePacket`, and `CHANNELS` as appropriate, plus any specialized UI.

## 5. CSV replay input

The browser does not directly upload/read CSV. The Python bridge reads a file and broadcasts each row as a JSON frame.

From the repository root:

```sh
python3 -m pip install -r telemetry_server/requirements.txt
python3 telemetry_server/server.py --mode csv --file telemetry_server/sample_log.csv --port 8765 --rate 10
```

For mock data instead:

```sh
python3 telemetry_server/server.py --mode mock --port 8765 --rate 10
```

Then select the WebSocket source in the dashboard.

CSV expectations:

- UTF-8 text, comma-separated, with a header row matching the JSON field names above.
- One telemetry snapshot per row, with numeric values in the same units as WebSocket frames.
- Example:

```csv
t,speed,rpm,gear,throttle,brake,lapTime,lapNum
0.0,42.0,3100,2,55.0,0.0,0.0,1
0.1,42.5,3150,2,56.0,0.0,0.1,1
```

- The bridge attempts `float(...)` when the cell contains a decimal point and `int(...)` otherwise; conversion failures are passed through as strings. Prefer ordinary decimal/integer notation, especially for `t`.
- Playback uses the configured fixed rate, not differences between row timestamps.
- The file loops at the end without adjusting timestamps or lap numbers. Account for backward time/lap jumps when interpreting the display.
- The server clamps `--rate` to 1–100 Hz; 10 Hz matches frontend assumptions.
- The default server bind address is `0.0.0.0`. Use an appropriate host/interface for your network. In the browser, `localhost` means the machine running the browser, not necessarily the vehicle or bridge computer.

For HTTPS deployments, use a browser-compatible secure WebSocket (`wss://`) endpoint; the included Python server does not itself configure TLS or authentication. Do not expose the default bridge directly to an untrusted network.

## 6. Source-of-truth files

| File | Responsibility |
| --- | --- |
| `src/telemetry/useTelemetry.ts` | WebSocket ingestion, defaults, reconnects, buffer, lap processing |
| `src/telemetry/simulation.ts` | `Frame` interface, channel units/scales, simulation and track constants |
| `src/state/ConfigContext.tsx` | Default source/URL and persisted dashboard configuration |
| `src/App.tsx` | Wiring telemetry into the dashboard |
| `telemetry_server/server.py` | Python WebSocket server, mock generator, CSV parser/replay |
| `telemetry_server/sample_log.csv` | Existing replay input example |
| `telemetry_server/WEBSOCKET.md` | Additional protocol documentation and sender example |

When documentation and implementation differ, use the ingestion code and channel registry as the authority.
