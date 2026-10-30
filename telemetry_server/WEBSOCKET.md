# WebSocket Telemetry Contract

How the Dark-Mode Motorsport Telemetry Dashboard connects to a live data source, what the socket is, and which JSON fields a frame must carry.

This is **not** an HTTP endpoint. Nothing is `POST`ed. The dashboard opens a WebSocket, the server pushes JSON text frames, and the client parses them.

## What the WebSocket is

A bidirectional WebSocket between:

- **Client:** the React dashboard (`src/telemetry/useTelemetry.ts`). When the telemetry source is set to `websocket`, it does `new WebSocket(wsUrl)`.
- **Server:** anything that accepts that connection and sends telemetry frames as JSON text. The included bridge is `telemetry_server/server.py` (Python `websockets` library).

Default URL, also the UI placeholder:

```text
ws://localhost:8765
```

The URL is stored as `wsUrl` in `src/state/ConfigContext.tsx` and can be changed in the source config panel. Presets are `ws://localhost:8765` and `ws://127.0.0.1:8765`.

The Python server binds `0.0.0.0:8765` by default and logs:

```text
Telemetry WebSocket Server listening on ws://0.0.0.0:8765
```

There is no path (`/telemetry`, etc.). Connect to the host and port only.

### Start the included server

```bash
cd telemetry_server
python3 server.py --port 8765 --rate 10
```

Useful flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `0.0.0.0` | Interface to bind. Use `0.0.0.0` for a pit-wall laptop, LTE gateway, or Wi-Fi hotspot. |
| `--port` | `8765` | Listen port. Must match the dashboard URL. |
| `--rate` | `10.0` | Frames per second (clamped to 1–100 Hz). Dashboard display rate assumes 10 Hz. |
| `--mode` | `mock` | `mock` (synthetic car) or `csv` (replay). |
| `--file` | — | CSV path, required when `--mode csv`. |

Then in the dashboard, switch the source from simulation to **LIVE WEBSOCKET**.

## Direction of traffic

The dashboard is a **subscriber**. It does not send telemetry. Data flows server → client.

```text
vehicle / CSV / mock generator
        │
        ▼
  WebSocket server          ws://<host>:8765
        │  JSON text frames, one object per message
        ▼
  dashboard client          new WebSocket(wsUrl)
```

On connect the included server immediately sends a handshake, then broadcasts a telemetry frame at `--rate` Hz to every connected client.

The client does not subscribe to a topic and does not send an auth or "start" message. Opening the socket is enough.

### Client connection behavior

From `src/telemetry/useTelemetry.ts`:

1. Source switch to `websocket` clears the frame buffer and lap history.
2. Status becomes `connecting`, then `connected` on `onopen`.
3. On close or constructor failure it retries: 2 s after a failed `new WebSocket`, 2.5 s after `onclose`.
4. While connected and no frames have arrived, the UI shows: `CONNECTED TO WEBSOCKET · AWAITING TELEMETRY FRAMES`.
5. Packet rate is packets received per second, updated about once a second. Target is ~10 Hz.

Until the first telemetry frame arrives, charts and gauges stay empty. The handshake alone does not count as data.

## Messages the server sends

Every message is a single JSON object in a WebSocket **text** frame. Do not send binary, newline-delimited batches, or arrays of frames. One object, one message.

### 1. Handshake (ignored as telemetry)

Sent once when a client connects. The dashboard skips any message whose `type` is `"handshake"`.

```json
{
  "type": "handshake",
  "server": "Formula SAE Telemetry Bridge",
  "rate": 10.0,
  "mode": "mock",
  "timestamp": 1710000000.123
}
```

You may omit the handshake. A third-party sender can start streaming frames immediately.

### 2. Telemetry frame (this is the data we want)

A flat JSON object. Numbers only — no nested objects, no string channel values. Field names are camelCase and must match exactly (`oilTemp`, not `oil_temp`).

```json
{
  "t": 12.40,
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
  "lapTime": 12.40,
  "lapNum": 1,
  "suspFL": -40.2,
  "suspFR": -55.8,
  "suspRL": 22.1,
  "suspRR": 18.4
}
```

`speed` may also be sent as `spd`. Everything else has one accepted name.

## Fields to pick up

`normalizePacket` in `src/telemetry/useTelemetry.ts` reads these keys. Missing keys fall back to `0` (or the noted default), so a partial packet still renders, but gauges for omitted channels will sit on the fallback.

| JSON key | Alias | Unit | Typical range | Fallback if missing | What it drives |
| --- | --- | --- | --- | --- | --- |
| `t` | — | s | monotonic session time | client clock (`1/10` s steps) | Buffer time axis. Send this. |
| `speed` | `spd` | km/h | 0–230 | `0` | Speed trace, wheel-speed fallback |
| `rpm` | — | rpm | 800–8000 | `0` | RPM gauge |
| `gear` | — | — | 1–7 | `1` | Gear indicator |
| `throttle` | — | % | 0–100 | `0` | Throttle trace |
| `brake` | — | kPa | 0–200 | `0` | Brake-pressure trace |
| `steering` | — | ° | about −90–90, + = one direction | `0` | Steering trace |
| `wFL` `wFR` `wRL` `wRR` | — | km/h | 0–240 | `speed` | Corner wheel speeds |
| `volt` | — | V | 10–16 | `13.5` | Battery voltage |
| `coolant` | — | °C | 40–130 | `85.0` | Coolant temp |
| `oilTemp` | — | °C | 50–140 | `92.0` | Oil temp |
| `oilPress` | — | bar | 0–7 | `4.2` | Oil pressure |
| `fuel` | — | % | 0–100 | `100.0` | Fuel level |
| `gX` | — | g | about −3–3 | `0` | Lateral g (steering-signed in the mock) |
| `gY` | — | g | about −3–3 | `0` | Longitudinal g (accel positive, brake negative in the mock) |
| `lapTime` | — | s | 0–`LAP_LEN` | `t % 90` | Position within the current lap |
| `lapNum` | — | — | integer ≥ 1 | `floor(t / 90) + 1` | Lap counter; a change closes the previous lap |
| `suspFL` `suspFR` `suspRL` `suspRR` | — | mm/s | −400–400 | `0` | Damper velocity. Only `suspFL` is a registered chart channel today; send all four anyway. |

`LAP_LEN` is **90 seconds**. Sector splits and lap close are computed on the client from `lapTime / 90` and from `lapNum` changing. They are not separate JSON fields.

Sector bounds used by the client (`SECTOR_BOUNDS` in the simulation module) split that 90 s lap into three sectors. You do not send sector times.

### Minimum useful packet

If you only have a few CAN signals, send at least these so timing and the primary gauges work:

```json
{
  "t": 1.5,
  "speed": 42.0,
  "rpm": 3100,
  "gear": 2,
  "throttle": 55.0,
  "brake": 0.0,
  "lapTime": 1.5,
  "lapNum": 1
}
```

Prefer sending `t`, `lapTime`, and `lapNum` yourself. If you omit `t`, the client invents time at 10 Hz from message arrival, which drifts if your send rate is not 10 Hz. If you omit `lapNum` / `lapTime`, laps are inferred from `t` against a fixed 90 s lap, which will not match a real session.

## What not to send as a telemetry frame

| Message | Result |
| --- | --- |
| `{ "type": "handshake", ... }` | Ignored. Not plotted. |
| `{ "type": "pong", ... }` | Parsed, but all channels fall back to defaults. Do not use this shape for data. |
| Non-JSON or binary | Dropped. `JSON.parse` failure is ignored. |
| A JSON array of frames | Dropped or mis-read. Send one object per message. |
| Nested objects (`{ "channels": { "rpm": 1 } }`) | Not read. Keys must be top-level. |

Extra unknown keys are ignored. They do not break parsing.

## Optional client → server messages

The included Python server accepts one inbound message. The dashboard does **not** send it today. A custom client may:

```json
{ "type": "ping", "time": 1710000000.123 }
```

Server replies:

```json
{ "type": "pong", "clientTime": 1710000000.123 }
```

Telemetry frames are still server-push only. Do not POST JSON to `http://localhost:8765`. That port speaks WebSocket, not HTTP.

## Bringing your own sender

Any language works if it:

1. Listens as a WebSocket **server** on the URL configured in the dashboard (default `ws://localhost:8765`), or you point `wsUrl` at your server.
2. Accepts the connection (no subprotocol, no auth header required).
3. Sends UTF-8 text frames, each a flat JSON object using the keys above.
4. Sends at a steady rate. 10 Hz matches the dashboard (`HZ = 10`, buffer of 180 frames ≈ 18 s of history).

Example with the `websockets` Python library already used by this repo:

```python
import asyncio, json, websockets

async def handler(ws):
    t = 0.0
    while True:
        await ws.send(json.dumps({
            "t": round(t, 2),
            "speed": 40.0,
            "rpm": 3000,
            "gear": 2,
            "throttle": 50.0,
            "brake": 0.0,
            "steering": 0.0,
            "volt": 13.6,
            "coolant": 90.0,
            "oilTemp": 95.0,
            "oilPress": 4.2,
            "fuel": 80.0,
            "gX": 0.0,
            "gY": 0.4,
            "lapTime": round(t % 90.0, 2),
            "lapNum": int(t // 90.0) + 1,
            "wFL": 40.0, "wFR": 40.0, "wRL": 40.0, "wRR": 40.0,
            "suspFL": 0.0, "suspFR": 0.0, "suspRL": 0.0, "suspRR": 0.0,
        }))
        t += 0.1
        await asyncio.sleep(0.1)

async def main():
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()

asyncio.run(main())
```

CSV replay uses the same keys as a header row. See `telemetry_server/sample_log.csv`.

## Source of truth

| Behavior | File |
| --- | --- |
| Client connect, parse, reconnect | `src/telemetry/useTelemetry.ts` (`normalizePacket`, `ws.onmessage`) |
| Frame shape and units | `src/telemetry/simulation.ts` (`Frame`, `CHANNELS`) |
| Default URL | `src/state/ConfigContext.tsx` (`wsUrl: 'ws://localhost:8765'`) |
| Included server and handshake | `telemetry_server/server.py` |
