# Logger channels on the dashboard

Goal: every channel in the logger's `config.json` (sundevilmotorsports/logger@9338e3c) can be displayed. The model is MoTeC i2's: every logged channel appears in a grouped channel list, can be dropped onto any chart or gauge, used in math, and is greyed out when it has no data.

## How each kind of channel is displayed

| Kind | Count | Display |
|---|---|---|
| Mapped to a dashboard field (`r_engine`, `%_TPS`, `n-Gear`, `t_eng_coolant`, `t_oil`, `%_fuel_left`) | 6 | Gauges/charts under the dashboard name (Engine RPM, Throttle, …) |
| Other numeric CAN signals | 59 | Channel `raw:<name>`: channel list (grouped), charts, gauges, math (`t_MAT`, or quoted `'%_APS_main'`), Channels table with unit and rate |
| 8-byte tyre temperature arrays (`*_TTA`, `*_TTB`) | 8 | Listed (italic) and shown as hex bytes in the Channels table; not plottable until their layout is defined |
| Logger ADC inputs (dampers, brake pressures, steering) | 7 | Listed (gray) with the reason; chartable as soon as data arrives (see below) |

Code: catalog `src/telemetry/raw/loggerChannels.ts` (generated from the config, so config changes flow through), channel defs `LOGGER_CHANNEL_DEFS` in `src/telemetry/simulation.ts`, values carried per frame in `Frame.raw` (fixed slot per channel, `Float64Array`), list UI in `src/components/TimeSeriesPanel.tsx`, table in `src/views/ChannelTable.tsx`.

Ranges default to the signal's full scale from its width, sign and scale (% → 0–100, °C → −20–150); adjust per trace/gauge in its config. Units come from the channel name only where it states one; the rest show no unit rather than a guess.

## Channels that cannot show live data yet, and the fix

### 1. Logger ADC inputs: `l_FR_damper`, `l_RR_damper`, `l_RL_damper`, `l_FL_damper`, `p_F_brake`, `p_R_brake`, `Steering`

The logger reads these from its own ADS7951 ADC at 500 Hz (`src/adc.rs`) and writes them only to the SD log (`src/logging.rs`). It transmits only its heartbeat, OTA frames and a loopback self-test on CAN (`src/can.rs`), and USB serial is config/OTA only. The cellular transmitter only sees CAN, so these values never reach Supabase.

**Recommended fix (logger firmware):** broadcast the ADC counts on CAN, the way MoTeC loggers and dashes transmit selected channels in CAN output messages.

- Two 8-byte frames at 100 Hz, four channels each, raw 12-bit counts as u16 big-endian:
  - Frame A: ch0 `l_FR_damper` (bytes 0–1), ch1 `l_RR_damper` (2–3), ch2 `p_R_brake` (4–5), ch3 `l_RL_damper` (6–7)
  - Frame B: ch4 `p_F_brake` (0–1), ch5 unused (2–3), ch6 `l_FL_damper` (4–5), ch7 `Steering` (6–7)
- IDs: allocate a message in the SDM CAN ID scheme the heartbeat uses (`sdm::can_id(msg, Node::Logger)`, extended), e.g. a new `Msg::AdcData` with two consecutive IDs. Confirm it does not collide with an existing device.
- Bus load: ~200 extended frames/s ≈ 30 kbit/s (≈3 % of a 1 Mbit/s bus, ≈6 % at 500 kbit/s).
- Do **not** add these frames to the logger's own `config.json` `can_devices`: the logger builds its SD-log columns from every CAN signal plus every ADC channel, so the same names would appear twice.

**Dashboard side (already built):** add the two frames to `src/telemetry/raw/canExtensions.json` using the same signal names, e.g.

```json
{ "can_devices": [
  { "id": 123456, "extended": true, "fd": false, "signals": { "Fixed": [
    { "name": "l_FR_damper", "start": 0, "len": 2, "big_endian": true, "scale": 1.0 },
    { "name": "l_RR_damper", "start": 2, "len": 2, "big_endian": true, "scale": 1.0 },
    { "name": "p_R_brake",   "start": 4, "len": 2, "big_endian": true, "scale": 1.0 },
    { "name": "l_RL_damper", "start": 6, "len": 2, "big_endian": true, "scale": 1.0 }
  ]}}
]}
```

(`id` is a placeholder.) The decoder and channel catalog merge this file with the vendored config; an ADC name that appears as a CAN signal becomes a live numeric channel automatically (tested in `loggerChannels.test.ts`), and the damper auto-zero (`raw:l_*_damper`) starts working. Counts → mm / kPa / degrees needs per-sensor calibration (a `scale`/`offset` per signal); until then the channels read in counts, which auto-zero makes usable as "counts from the pit baseline".

### 2. Tyre temperature arrays: `FLT_TTA/TTB`, `FRT_TTA/TTB`, `RLT_TTA/TTB`, `RRT_TTA/TTB`

Each is 8 bytes with no scale, so the logger stores raw bytes and the dashboard shows them as hex. They look like a 16-zone infrared tyre temperature sensor (two frames per corner, with `*W_OBJ` and `t_*_amb` in the frame before), but the byte layout is not in the config.

**Recommended fix:** get the sensor's datasheet (zone order, bytes per zone, scale/offset) and split each array into per-zone signals in the logger's `config.json` (e.g. `FLT_T1`…`FLT_T16`). Both the logger log and the dashboard then get real numbers with no dashboard code change. MoTeC handles these sensors the same way: per-zone channels, usually summarised as inner/centre/outer, with a tyre-temperature display. A tyre heat-map widget is a natural follow-up once the zones exist.

### 3. Numeric but uncalibrated (display works, units unknown)

Shown with no unit (or the logger's raw value) until a unit/scale is confirmed: IMU `r_Pitch/Roll/Yaw`, `a_Lat/Long/Vert`, `a_*_ecu`; wheel speeds `r_*_wheel` (unit and tyre circumference needed for km/h, which would also give the dashboard a real speed channel); `*W_OBJ`; pressures `p_oil`, `p_Fuel`, `p_MAP`; `v_trans_out`, `Lamb_1`, `d_ign_angle`; pots `MLPOT…BRPOT`, `data`, `DRS`; strain gauges `*_SG`. Each needs its unit (and scale if not already applied) added to the channel name table in `src/telemetry/units.ts` (`rawChannelUnit`) or, better, to the config.

## Full inventory

| Group | Channel | Source | Unit | How it is displayed |
|---|---|---|---|---|
| Fuel Flow | rate_lpm_1 | 0x100 b0–1 | L/min | `raw:rate_lpm_1` — chart, gauge, math, table |
| Fuel Flow | total_volume_l_1 | 0x100 b2–5 | L | `raw:total_volume_l_1` — chart, gauge, math, table |
| Fuel Flow | rate_lpm_2 | 0x101 b0–1 | L/min | `raw:rate_lpm_2` — chart, gauge, math, table |
| Fuel Flow | total_volume_l_2 | 0x101 b2–5 | L | `raw:total_volume_l_2` — chart, gauge, math, table |
| Temperatures | temp_c_1 | 0x102 b0–1 | °C | `raw:temp_c_1` — chart, gauge, math, table |
| Temperatures | temp_c_2 | 0x102 b2–3 | °C | `raw:temp_c_2` — chart, gauge, math, table |
| Temperatures | temp_c_3 | 0x102 b4–5 | °C | `raw:temp_c_3` — chart, gauge, math, table |
| Temperatures | temp_c_4 | 0x102 b6–7 | °C | `raw:temp_c_4` — chart, gauge, math, table |
| Pots (0x3B0) | data | 0x3B0 b0–0 | ? | `raw:data` — chart, gauge, math, table |
| Pots (0x3B0) | MLPOT | 0x3B0 b1–1 | ? | `raw:MLPOT` — chart, gauge, math, table |
| Pots (0x3B0) | MRPOT | 0x3B0 b2–2 | ? | `raw:MRPOT` — chart, gauge, math, table |
| Pots (0x3B0) | BLPOT | 0x3B0 b3–3 | ? | `raw:BLPOT` — chart, gauge, math, table |
| Pots (0x3B0) | BMPOT | 0x3B0 b4–4 | ? | `raw:BMPOT` — chart, gauge, math, table |
| Pots (0x3B0) | BRPOT | 0x3B0 b5–5 | ? | `raw:BRPOT` — chart, gauge, math, table |
| Aero | DRS | 0x35F b0–0 | ? | `raw:DRS` — chart, gauge, math, table |
| IMU | r_Pitch | 0x360 b0–1 | ? | `raw:r_Pitch` — chart, gauge, math, table |
| IMU | r_Roll | 0x360 b2–3 | ? | `raw:r_Roll` — chart, gauge, math, table |
| IMU | r_Yaw | 0x360 b4–5 | ? | `raw:r_Yaw` — chart, gauge, math, table |
| IMU | a_Lat | 0x361 b0–1 | ? | `raw:a_Lat` — chart, gauge, math, table |
| IMU | a_Long | 0x361 b2–3 | ? | `raw:a_Long` — chart, gauge, math, table |
| IMU | a_Vert | 0x361 b4–5 | ? | `raw:a_Vert` — chart, gauge, math, table |
| Wheels & Tyres | r_FL_wheel | 0x370 b0–1 | ? | `raw:r_FL_wheel` — chart, gauge, math, table |
| Wheels & Tyres | FLW_OBJ | 0x370 b2–3 | ? | `raw:FLW_OBJ` — chart, gauge, math, table |
| Wheels & Tyres | t_FL_amb | 0x370 b4–5 | °C | `raw:t_FL_amb` — chart, gauge, math, table |
| Wheels & Tyres | FLT_TTA | 0x371 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | FLT_TTB | 0x372 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | r_FR_wheel | 0x380 b0–1 | ? | `raw:r_FR_wheel` — chart, gauge, math, table |
| Wheels & Tyres | FRW_OBJ | 0x380 b2–3 | ? | `raw:FRW_OBJ` — chart, gauge, math, table |
| Wheels & Tyres | t_FR_amb | 0x380 b4–5 | °C | `raw:t_FR_amb` — chart, gauge, math, table |
| Wheels & Tyres | FRT_TTA | 0x381 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | FRT_TTB | 0x382 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | r_RR_wheel | 0x390 b0–1 | ? | `raw:r_RR_wheel` — chart, gauge, math, table |
| Wheels & Tyres | RRW_OBJ | 0x390 b2–3 | ? | `raw:RRW_OBJ` — chart, gauge, math, table |
| Wheels & Tyres | t_RR_amb | 0x390 b4–5 | °C | `raw:t_RR_amb` — chart, gauge, math, table |
| Wheels & Tyres | RRT_TTA | 0x391 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | RRT_TTB | 0x392 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | r_RL_wheel | 0x3A0 b0–1 | ? | `raw:r_RL_wheel` — chart, gauge, math, table |
| Wheels & Tyres | RLW_OBJ | 0x3A0 b2–3 | ? | `raw:RLW_OBJ` — chart, gauge, math, table |
| Wheels & Tyres | t_RL_amb | 0x3A0 b4–5 | °C | `raw:t_RL_amb` — chart, gauge, math, table |
| Wheels & Tyres | RLT_TTA | 0x3A1 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Wheels & Tyres | RLT_TTB | 0x3A2 b0–7 | ? | Hex only (Channels tab) — needs byte layout |
| Engine (ECU) | r_engine | 0x3E8 mux 0 b1–2 | rpm | Dashboard field **Engine RPM** |
| Engine (ECU) | t_eng_coolant | 0x3E8 mux 0 b3–3 | °C | Dashboard field **Coolant Temp** |
| Engine (ECU) | t_oil | 0x3E8 mux 0 b4–4 | °C | Dashboard field **Oil Temp** |
| Engine (ECU) | p_oil | 0x3E8 mux 0 b5–6 | ? | `raw:p_oil` — chart, gauge, math, table |
| Engine (ECU) | Lamb_1 | 0x3E8 mux 1 b1–1 | ? | `raw:Lamb_1` — chart, gauge, math, table |
| Engine (ECU) | %_TPS | 0x3E8 mux 1 b2–2 | % | Dashboard field **Throttle** |
| Engine (ECU) | n-Gear | 0x3E8 mux 1 b3–3 | ? | Dashboard field **Gear** |
| Engine (ECU) | v_trans_out | 0x3E8 mux 1 b4–5 | ? | `raw:v_trans_out` — chart, gauge, math, table |
| Engine (ECU) | %_APS_main | 0x3E8 mux 2 b1–1 | % | `raw:%_APS_main` — chart, gauge, math, table |
| Engine (ECU) | p_Fuel | 0x3E8 mux 2 b2–3 | ? | `raw:p_Fuel` — chart, gauge, math, table |
| Engine (ECU) | n_knock_count | 0x3E8 mux 3 b1–1 | ? | `raw:n_knock_count` — chart, gauge, math, table |
| Engine (ECU) | d_ign_angle | 0x3E8 mux 3 b2–2 | ? | `raw:d_ign_angle` — chart, gauge, math, table |
| Engine (ECU) | %_ign_cut | 0x3E8 mux 3 b3–3 | % | `raw:%_ign_cut` — chart, gauge, math, table |
| Engine (ECU) | %_fuel_cut | 0x3E8 mux 3 b4–4 | % | `raw:%_fuel_cut` — chart, gauge, math, table |
| Engine (ECU) | r_idle_target | 0x3E8 mux 3 b5–5 | rpm | `raw:r_idle_target` — chart, gauge, math, table |
| Engine (ECU) | %_lambda_corr | 0x3E8 mux 3 b6–6 | % | `raw:%_lambda_corr` — chart, gauge, math, table |
| Engine (ECU) | Lambda_Target_Err | 0x3E8 mux 3 b7–7 | ? | `raw:Lambda_Target_Err` — chart, gauge, math, table |
| Engine (ECU) | in_gear | 0x3E8 mux 4 b1–1 | ? | `raw:in_gear` — chart, gauge, math, table |
| Engine (ECU) | upshift_act | 0x3E8 mux 4 b2–2 | ? | `raw:upshift_act` — chart, gauge, math, table |
| Engine (ECU) | downshift_act | 0x3E8 mux 4 b3–3 | ? | `raw:downshift_act` — chart, gauge, math, table |
| Engine (ECU) | launch_ctrl_stat | 0x3E8 mux 4 b4–4 | ? | `raw:launch_ctrl_stat` — chart, gauge, math, table |
| Engine (ECU) | eng_fan_1 | 0x3E8 mux 4 b5–5 | ? | `raw:eng_fan_1` — chart, gauge, math, table |
| Engine (ECU) | %_fuel_left | 0x3E8 mux 4 b6–6 | % | Dashboard field **Fuel Level** |
| Engine (ECU) | p_MAP | 0x3EA mux 0 b5–6 | ? | `raw:p_MAP` — chart, gauge, math, table |
| Engine (ECU) | t_MAT | 0x3EB mux 0 b5–5 | °C | `raw:t_MAT` — chart, gauge, math, table |
| IMU | a_Lat_ecu | 0x3EC b0–1 | ? | `raw:a_Lat_ecu` — chart, gauge, math, table |
| IMU | a_Long_ecu | 0x3EC b2–3 | ? | `raw:a_Long_ecu` — chart, gauge, math, table |
| IMU | a_Vert_ecu | 0x3EC b4–5 | ? | `raw:a_Vert_ecu` — chart, gauge, math, table |
| Strain Gauges | FL_SG | 0x4E2 b0–1 | ? | `raw:FL_SG` — chart, gauge, math, table |
| Strain Gauges | FR_SG | 0x4E3 b0–1 | ? | `raw:FR_SG` — chart, gauge, math, table |
| Strain Gauges | RR_SG | 0x4E4 b0–1 | ? | `raw:RR_SG` — chart, gauge, math, table |
| Strain Gauges | RL_SG | 0x4E5 b0–1 | ? | `raw:RL_SG` — chart, gauge, math, table |
| Logger ADC | l_FR_damper | ADC ch 0 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
| Logger ADC | l_RR_damper | ADC ch 1 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
| Logger ADC | p_R_brake | ADC ch 2 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
| Logger ADC | l_RL_damper | ADC ch 3 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
| Logger ADC | p_F_brake | ADC ch 4 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
| Logger ADC | l_FL_damper | ADC ch 6 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
| Logger ADC | Steering | ADC ch 7 | counts | Listed (gray) — not on CAN; needs logger ADC broadcast |
