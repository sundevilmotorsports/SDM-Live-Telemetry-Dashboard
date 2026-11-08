# Raw Supabase CAN processing

The requirement is **Supabase raw payload → processing in this codebase → dashboard**. This directory implements that path. It is separate from the older decoded HTP Broadcast integration in `../live/`; neither format is autodetected or silently treated as the other.

## Backend (Supabase project "Cellular Telemetry", `telemetry` schema)

Everything lives in the `telemetry` schema; `public.batches` was a dead PoC and is no longer read. Schema source of truth: `helios-telemetry-devkit/supabase/migrations/20261107000000_telemetry_can_batches.sql` (idempotent, self-contained).

| Object | Role |
| --- | --- |
| `telemetry.sessions.device_id` | binds a session to a device; a partial unique index allows at most one `running` session per device |
| `telemetry.sessions.created_by` | audit: `auth.uid()` of the user who started the session (null for older rows) |
| `telemetry.start_session(device_id, name)` | security definer; executable by `authenticated` and `service_role` (not `anon`/public). Where `pm.is_org_member()` exists it must return true, else error 42501. Ends any running session for the device, then opens a new `running` one and returns the row |
| `telemetry.end_session(id)` | same access and org gate as `start_session`. Idempotent |
| `telemetry.can_batches` | `id` (bigint cursor), `session_id`, `device_id`, `seq`, `dropped_frames`, `frames` (jsonb, ≤ 4096), `received_at`; unique on `(session_id, device_id, seq)`; composite FK `(session_id, device_id)` → `sessions(id, device_id)` so a batch cannot belong to a session of another device; SELECT for `authenticated` only (org-gated where `pm.is_org_member()` exists), written by the ingest function with the service role |

Row `frames` entries use the `telemetry_format.h` shape:

```json
{ "can_id": 256, "extd": false, "dlc": 8, "data": "0102030405060708", "ts_ms": 1735500000123 }
```

`data` is an unprefixed hexadecimal string. `dlc` is its **actual byte length**, not the encoded CAN FD DLC nibble. Optional `fd` and `brs` are booleans; FD frames support lengths up to 64. The implementation validates IDs, flags, byte lengths, timestamps, and payloads before decoding. An inconsistent/truncated signal is skipped, never zero-filled.

Ingest (`telemetry-ingest` edge function, content type `application/x-sdm-can-batch+json`): authenticates with the existing HMAC/service-role auth, takes the device from the signed `x-htp-device` header, looks up that device's running session, and inserts the batch. It returns **409** when no session is running and 400 for malformed batches (more than 4096 frames, bad hex, …). A retried `(session, device, seq)` is reported as `dup`, not stored twice.

`telemetry.staging_chunks` holds Arrow IPC from the HTP ingest path, not raw CAN; it is deliberately not fed to this decoder.

## Browser access

The browser needs a Supabase Auth session: the dashboard signs in with email/password through the shared supabase-js client (session persisted in localStorage, tokens auto-refreshed). RLS grants SELECT on `telemetry.can_batches` and `telemetry.sessions` to `authenticated` only. **An unauthenticated read returns an empty list, not an error**, so raw mode refuses to start until signed in and the empty-result diagnostic mentions sign-in. The `telemetry` schema must be an exposed API schema. Never put a service-role key in the browser or a `VITE_*` variable.

Raw mode polls with read-only PostgREST queries (no Realtime publication needed). Empty results surface a diagnostic; errors are sanitized and retried.

## Configuration

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_TELEMETRY_DEVICE_ID` in your local Vite environment, or use dashboard source settings. Select **Supabase → Raw CAN batches**, sign in, enter the device ID, and press **Start session** (or pick a past session). The linked session ID is shared with the legacy Broadcast mode's session field. The old **Legacy decoded Realtime Broadcast** option remains available with its session UUID. New Supabase input configurations default to raw mode; existing source selection remains persisted. Changing the session, mode, URL, credential or signed-in state clears the frame buffer and creates a fresh processing partition.


## Processing flow

```text
telemetry.can_batches (one session_id)
  → whole session oldest-first in pages of 100, then primary-id catch-up pages of 100
  → validate batch and raw CAN frames
  → decode logger-configured fixed/multiplexed signals
  → merge newer per-channel timestamps only
  → explicit dashboard mapping
  → 10 Hz sample-and-hold resampling by ts_ms (resampleFrames.ts)
  → steady playout ~2 s behind the newest sample (playout.ts)
  → existing bounded frame buffer (180 frames = 18 s), charts, gauges, alerts
```

- Polls settle before the next request; a full page schedules immediate catch-up with an event-loop yield. Idle polling waits one second. Each request times out after ten seconds and is aborted on source changes/unmount. Late results cannot contaminate another device's state.
- Bootstrap is a recent bounded snapshot, **not full historical replay**. Cursor IDs are decimal strings/BigInt, not lossy JS bigint numbers. Duplicates do not re-add dropped counts or refresh freshness.
- **Resampling:** one frame is produced per CAN frame, which would shrink the 180-frame chart buffer to a fraction of a second. `FrameResampler` closes each 100 ms bin of device time (`ts_ms`) with the newest merged state in it, so the buffer is a true 18 s window. A bin is emitted when a sample from a later bin arrives, so the newest ≤ 100 ms is pending; bins with no data hold the previous state; a gap longer than the buffer emits only the last 180 bins.
- **Steady playout:** batches arrive in bursts (one per second from the car, picked up by a once-per-second poll, so sometimes two at once). Drawing each burst immediately makes charts jump once per second. `PlayoutBuffer` queues the 10 Hz frames and releases them on the wall clock at the recorded rate, `PLAYOUT_DELAY_MS` (2 s) behind the newest sample, nudging speed by up to ±5% to hold that cushion. On connect, older history is shown at once; if data stops it holds the last frame (no invented samples); if it falls more than 3 s behind the target (hidden tab, outage) it jumps forward.
- Frames within each batch are stably ordered by their timestamps. Older/equal samples cannot overwrite newer channel state. Missing signals keep their previous readings; the source freshness banner warns when the stream stops. Per-channel expiry is not implemented.
- Freshness uses the earlier of local time and accepted batch `received_at`; fetching old records cannot make them fresh. Raw `ts_ms` determines sample ordering and elapsed display time. The schema does not establish device clock synchronization: confirm epoch/boot-relative behavior and clock resets with the transmitter. No HTP `send_timestamp_ms` is invented.
- Polling is per open dashboard, so concurrent viewers multiply database/egress load. At higher rates or audience sizes, use an authorized server fan-out or configured Realtime transport. A maximum of 4096 frames per batch is enforced; oversized/malformed batches stop cursor advancement and report an error rather than silently losing data.
- No synthetic lap timing or position is generated for raw mode. The existing track map needs real lap/GPS logic before it can display measured vehicle position.

## Decoder source of truth

`loggerConfig.json` is copied byte-for-byte from:

- Repository: https://github.com/sundevilmotorsports/logger
- Commit: `9338e3cfb6c77be5bfc485b3cc75e502d610514e`
- Config blob SHA: `550fd023c1d2103e3ef71001f18a5679896db136`
- Semantics: `src/can.rs`, with ADC behavior described in `src/adc.rs`

No runtime GitHub request is required. A config update is an intentional code change; rerun tests when it changes. The backend currently carries no decoder/config revision per batch, so ensure this snapshot matches the producing vehicle setup before trusting readings operationally.

Important firmware semantics:

1. `start` and `len` describe **bytes**, not bits.
2. A configured scale applies **`scale × (integer − offset)`**, reproducing Rust `f32` arithmetic. In particular, the `-50` temperature offset in this config adds 50 before scaling. This is not changed to a conventional offset formula; verify intended calibration on hardware.
3. Signedness and endian selection apply to scaled signals. Without a scale, the logger writes the original bytes; these are retained as hex. Safe unsigned little-endian numeric renderings are also available, matching the logger log renderer. Unsafe integers remain hex only.
4. Select a device by CAN ID and `extended`, matching firmware behavior. The config's `fd` field is not used by firmware to select a signal set. A future duplicate ID across physical buses is rejected as ambiguous because current stored frames have no bus identifier.
5. Unknown IDs/mux groups and skipped signals are counted. Raw ADC counts are not present in CAN batches and are not invented from the ADC channel list.

`sdm-utils` at `68ccff1f53cac390b3ea48cf0ae8ab630805065e` defines schema-prefixed fixed-width log files (`rust/src/logfmt.rs`, `include/sdm/logfmt.h`). Those logs already contain some scaled floats and are **not the format stored in `telemetry.can_batches.frames`**. No `sdm-utils` log decoder or dependency is needed for this CAN input path. A future log-file source should use the actual file schema and avoid applying CAN scaling twice.

## Dashboard mappings and remaining calibration

Only the following mappings are enabled:

| Logger channel | Dashboard field |
| --- | --- |
| `r_engine` | `rpm` |
| `%_TPS` | `throttle` |
| `n-Gear` | `gear` |
| `t_eng_coolant` | `coolant` |
| `t_oil` | `oilTemp` |
| `%_fuel_left` | `fuel` |

Pressure engineering units, wheel circumference/speed conversion, IMU units/axis alignment, and ADC steering/suspension/brake calibration are not sufficiently specified. Those fields remain `NaN`/unavailable instead of showing incorrect units or defaults. Temperature channels follow firmware arithmetic exactly; the app's source inspector explicitly warns that their physical calibration requires verification before operational alerts are trusted. Additional decoded channels remain in the inspector even without a dashboard field.

## Known limitations

- **Batches follow the running session, not the moment they were captured.** Ingest assigns each batch to whichever session is running for the device when it arrives. Batches buffered on the transmitter across an End/Start can therefore land in the new session.
- **A transmitter reboot that resets `seq` inside a running session is treated as duplicates.** The unique key is `(session_id, device_id, seq)`, so early batches after the reboot are acknowledged as `dup` and not stored. The future fix is a boot ID in the unique key. Until then, start a new session after a reboot.
- Display delay: gauges and charts run about 2 s behind the newest received sample (steady playout), plus the transport delay of 1 s batching and 1 s polling. A pushed transport (e.g. a Realtime broadcast per batch) and smaller batches could cut this later; the playout delay can then be lowered.

## Validation

Run `npm test`, `npx tsc --noEmit`, and `npm run build`. Tests cover real stored frame decoding, logger arithmetic, fixed/muxed signals, malformed/truncated inputs, large integers, raw-byte preservation, session boundaries, 10 Hz resampling, auth/session RPC wrappers, cancellation/timeouts, pagination/retries, deduplication, historical freshness, safe field mapping, and read-only query construction. Hosted end-to-end validation uses `helios-telemetry-devkit/scripts/seed_can_batches.sql` as a stand-in for the car; calibrated live vehicle data is still outstanding.

## Channel activity, sample rates, and display units

- **Receiving data** (`src/telemetry/channelActivity.ts`): a channel is "receiving" if a new sample was accepted within `max(staleAfterMs, 3 sample periods)` of wall-clock time. Held values do not count, so a silent sensor or a stored historical session goes gray. The workspace channel list is white when receiving, gray otherwise; a filled swatch means it is on a chart.
- **Sample rate**: exponential average of the interval between consecutive samples of each channel, from device `ts_ms`, measured on every CAN frame before the 10 Hz resampler (which would flatten every rate to 10 Hz). Shown as `—` until two samples have been seen.
- **Channels tab** (`src/views/ChannelTable.tsx`): every channel currently receiving data, including logger channels the dashboard does not map, with value, unit dropdown, and rate.
- **Units** (`src/telemetry/units.ts`): the dropdown choice is stored per channel (`unitPrefs`) and applies to gauges, chart axes/readouts/limits, the channel list, and the table. Data, alert expressions, and math channels stay in the base unit. `loggerConfig.json` has no units, so raw channels get a unit only where the name states one (`%_`, `t_`, `temp_c_`, `_lpm_`, `total_volume_l_`, `r_engine`); others show no dropdown rather than a guess.

## Auto-zero at rest (damper baseline)

`src/telemetry/zeroing.ts`, `src/state/ZeroingContext.tsx`, controls in the Channels tab.

- Channels marked AUTO-ZERO are read as-is until the car is first at rest. When the rest condition (an expression over dashboard channels, default `rpm < 500`, i.e. engine off; use `rpm < 500 || gear == 0` if the engine idles in the pit) has held for the hold time (default 3 s), each such channel's mean reading since the stop began becomes its baseline, and later values are shown relative to it until the next stop.
- Baselines are a timeline: each applies from the start of its stop, so earlier history keeps the baseline that was in effect then. ZERO NOW sets one from the current time; CLEAR returns the channel to raw values. Baselines reset when the stream/session changes and are not persisted.
- Display only: stored data, alerts, and math channels use raw values. A zeroed value is a difference, so unit conversion drops the offset (2 °C → 3.6 °F).
- Defaults: damper/suspension position keys (`suspension.travel_*` from broadcast, `l_*_damper` from the logger). The rest condition uses rpm because raw mode maps engine rpm (`r_engine`) but no vehicle speed. The damper pots are logger ADC inputs not present in CAN batches, so on raw CAN today there is no damper channel to zero yet.

## Every logger channel

Every channel in `loggerConfig.json` is a dashboard channel (`raw:<name>`, or its dashboard field when mapped) and appears grouped in the channel list, charts, gauges, math, and the Channels tab. ADC inputs and the 8-byte tyre arrays cannot show live data yet; see `docs/logger-channels.md` for why and the fix for each. Dashboard-side frames (e.g. a future logger ADC broadcast) go in `canExtensions.json`, merged with the vendored config.

## Profiles (whole-screen layouts)

`src/state/profiles.ts` (pure logic), `profilePresets.ts` (presets), `src/components/ProfileTabs.tsx` (tab bar above the workspace). Modeled on MoTeC i2 worksheets: a profile is the whole workspace screen (charts with their traces/ranges/limits and order, gauges, which widgets are shown and their order). Time range, math channels, alerts, units, auto-zero, and source settings are shared by every profile.

- Tabs switch profiles; edits save into the active profile automatically. `+` adds a blank or preset profile or imports an exported file; `⋯` renames, duplicates, resets to the preset it came from, exports to `.sdm-profile.json`, or deletes (never the last one). Double-click a tab to rename.
- Existing saved settings become a single profile named "Main".
- Presets (Engine Vitals, Speeds, Driver Inputs, Suspension & G, Tyres & Brakes, Fluids & Fuel, Loads & Pots, Blank) are groupings by common motorsport analysis practice, not a copy of a MoTeC list. Channels with no live data show gray/N/A until data arrives. Ranges for `raw:p_oil`, `raw:p_Fuel`, `raw:p_MAP` and wheel rpm are estimates (units not defined in config.json): adjust in the chart config.

## Resizable panels

Every divider in the workspace can be dragged (`src/components/ResizeHandle.tsx`, math in `src/state/panelSizes.ts`): channel list width, charts / right column, each chart's height, each right-column widget's height, gauge widths, steering / fuel, pedal panel width, G-force / GPS, session timing width, and the warnings dock height. Arrow keys on a focused divider nudge it (Shift = bigger steps); double-click resets that one divider; profile menu → "Reset panel sizes" resets all. Neighbouring panels that share space are resized as a pair, so everything else keeps its size. Sizes are stored in the active profile (`panelSizes`), so each profile keeps its own layout. Not resizable: Driver Dash, Lap Analysis, the Channels tab, and the 2×2 suspension histograms.
