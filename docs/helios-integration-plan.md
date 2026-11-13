# Plan: raw CAN live telemetry in Helios

Date: 2026-11-08. Status: proposal, nothing built yet.

## Goal

Bring this dashboard's raw CAN live pipeline into Helios (github.com/NIXELFi/helios)
as a **live source for the existing Logs module**, so a running car session shows up
next to CSV logs and every Helios widget (strip chart, gauges, GPS, math channels,
alarms, lap tools) works on it.

Everything is built and tested in this repo against a pinned copy of Helios. The
handoff is:

1. **Files that are copied in unchanged** (new package, new desktop files, one new Rust
   command).
2. **One patch file** for the few lines that must change in existing Helios files
   (registering a button, a dependency, a Tauri command, channel aliases). It is
   applied with `git apply` and is tested against the pinned commit.
3. **A backend note for Nick**: one migration and one edge-function redeploy, which he
   applies himself.

The car side is unchanged: the transmitter posts raw CAN batches
(`application/x-sdm-can-batch+json`, HMAC-signed) to `telemetry-ingest`.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Data | Raw CAN, decoded client-side with the logger `config.json` | Team lead's preference. Every logger channel is available, and the decoder already matches the logger firmware exactly. |
| Where it shows in Helios | A live `LoadedSession` (`id: live:<session_id>`, label `LIVE · <name>`) in Logs | This is what Nick's own live-path plan (tasks 9–11) does. No new module, no UI duplication. |
| Sessions | Users press Start/End (`telemetry.start_session` / `end_session`). Status stays `'running'`. The car never needs to know a session id. | Already built and verified. Fits the existing status rules, so no status migration is needed. |
| Channel names | Resolved by Helios's existing Rust resolver (`crates/helios-csv` `ChannelRegistry`), exposed as one new Tauri command. A generated TypeScript table is the fallback in a browser and in tests. | Helios resolves CSV headers to canonical ids in Rust from `docs/channels.yaml`. Using the same resolver means live data and SD-card logs get the **same channel ids**, so they overlay, and aliases stay editable in YAML with no code change. This is the only Rust in the plan. |
| Decoding | TypeScript | Nick's live-path plan also decodes live data in TypeScript (task 10). The decoder is already TypeScript and tested. |
| Delivery (v1) | Read new `can_batches` rows every second, as today | Works now. Push via Realtime broadcast is phase 2. |
| Rate | One 10 Hz rate group, sample-and-hold, configurable | Matches the current dashboard. Per-CAN-ID rate groups can come later if 10 Hz hides detail. |

## What gets handed over

The staging folder in this repo, `helios/`, mirrors the Helios layout exactly, so the
copy step is a plain overlay:

```
helios/
  HELIOS_BASE                      pinned commits: main (app) and feat/telemetry-live-path (infra)
  README.md                        how to apply: copy, git apply, pnpm install, test
  packages/can-live/               NEW workspace package @helios/can-live (React-free)
    package.json, tsconfig.json
    src/decode/                    decodeCanFrame, loggerConfig.json, canExtensions.json
    src/catalog/                   loggerChannels (80 channels: 73 CAN + 7 ADC) -> ChannelMeta
    src/session/                   RawBatchSession (fetch, dedupe, decode), resampler
    src/supabase/                  sessionsApi, batchesApi; take a SupabaseClient as a parameter
    src/live-buffer.ts             ring buffer -> fresh ChannelStore (Nick's task 9 design)
    src/to-store.ts                decoded signals -> RateGroup + ChannelMeta
    src/resolve.ts                 calls the Tauri command, falls back to the generated table
    src/generated/aliases.ts       generated from docs/channels.yaml (fallback only)
    tests/
  apps/desktop/src/modules/telemetry/live-can-session.ts          NEW controller: connect, requestAnimationFrame-gated commits, stop
  apps/desktop/src/modules/telemetry/ConnectLiveDialog.tsx NEW: device id, Start/End, list of running sessions
  apps/desktop/src-tauri/src/commands/resolve_channels.rs  NEW (~40 lines, wraps ChannelRegistry::resolve)
  patches/
    0001-logs-live-can.patch       edits to existing files (listed below)
  NICK.md                          apply and deploy steps, questions
                                   (backend = the updated helios-telemetry-devkit folder, see "Alignment")
```

The patch touches only these existing files, a few lines each:

- `apps/desktop/package.json`: add `"@helios/can-live": "workspace:*"`
- `apps/desktop/src/components/SessionPanel.tsx`: a "Connect live" button next to "Add session"
- `apps/desktop/src/App.tsx`: a handler that adds or removes the live session through
  the existing `setSessions` path
- `apps/desktop/src-tauri/src/commands/mod.rs` and the command registration in the
  Tauri builder: register `resolve_channels`
- `docs/channels.yaml`: aliases mapping logger names to canonical ids (for example
  `RPM` to `engine.rpm`)
- Boot guard (only if needed, see phase 6): skip the Tauri-only sample loading when not
  running inside Tauri, so Logs opens empty in a browser instead of failing

The patch contains nothing else. Any change needed beyond this list goes in this table
before it goes in the patch.

## Rules for code in `helios/` (this is what makes it drop-in)

- It compiles under Helios's own `tsconfig.base.json` (`strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`). The bench script (phase 1)
  typechecks it inside a real Helios checkout, not just here.
- `@helios/can-live` has **no React, no Tailwind, and no imports from this dashboard**.
  Dependencies: `@helios/store` (workspace) and `@supabase/supabase-js` types only, as
  a peer dependency. The Supabase client is always passed in. In Helios that is
  `@helios/auth`'s client with `.schema("telemetry")`.
- The two desktop files target React 18 and Tailwind 3 and use Helios's `@helios/ui`
  primitives and theme, matching `LapConfigDialog.tsx` and `ChannelsModal.tsx`.
- Tests use Vitest 2 APIs only (Helios is on Vitest 2, this repo on Vitest 3).
- Formatting and style follow Helios (double quotes, semicolons), not this repo's.
- This dashboard imports `helios/packages/can-live` through a path alias, so there is
  **one copy** of the decoder and session code. The duplicates under `src/telemetry/raw`
  and `src/telemetry/sessions` are deleted once the dashboard is switched over.

## Phases

### Phase 0: Confirm with Nick (before writing code)

Send the questions in `helios/NICK.md` (also see "Alignment with the devkit" below):

- Which branch to target. The telemetry infra exists only on `feat/telemetry-live-path`,
  not on `main` (v6.6.2).
- OK to add a workspace package and one Tauri command?
- Retention: the migration deletes `can_batches` older than 7 days through pg_cron, and
  hosted has pg_cron enabled. Keep that, or keep the data longer?
- User-started sessions for the raw path, rather than the car-opened sessions in his
  September spec.
- Phase 2 push: public or private Realtime channel?

### Phase 1: Local bench (about ½ day; the first Rust compile is most of it)

- Install the Helios toolchain: pnpm 9 and Rust via `rustup`. Xcode command-line tools
  are probably already installed.
- `scripts/helios-bench.sh` (new, in this repo):
  1. Clone Helios to `../helios-dev` at the commits in `helios/HELIOS_BASE`. This is a
     separate developer checkout, not the installed app.
  2. Copy `helios/` over it and `git apply` the patches. Fail loudly if a patch no longer
     applies.
  3. Run `pnpm install`, `pnpm --filter @helios/can-live test`, `pnpm typecheck`, and
     `cargo test -p helios-desktop` (or the shell crate's real name) for the new command.
- `npm run helios:check` in this repo runs the script. It must pass before the handoff.

### Phase 2: `@helios/can-live` package (about 1 day)

- Move the decoder, catalog, `RawBatchSession`, sessions API and batches API into
  `helios/packages/can-live`, keeping their tests.
- Remove ties to this dashboard: the `Frame` type, `getSupabaseClient`, and the helpers in
  `live/broadcastClient`. The Supabase client is a parameter everywhere.
- Point the dashboard at the package. All of this repo's tests stay green.

### Phase 3: ChannelStore adapter and LiveBuffer (about 1 day)

- `to-store.ts`: catalog entry to `ChannelMeta`, using the resolved canonical id when
  there is one and `raw.<logger name>` otherwise. Units come from the catalog. `group`
  comes from the CAN device, `source: "live-can"`.
- `live-buffer.ts`: per-channel ring buffer (default 10 minutes at 10 Hz).
  `push(tUs, values)` and `toStore()`, which builds a fresh `ChannelStore` with one
  `RateGroup` (BigInt64 µs time plus a Float64Array per channel).
- Tests run against Helios's real `ChannelStore` (in the bench), not a mock.

### Phase 4: Channel resolution (½–1 day)

- `resolve_channels.rs`: load the bundled `channels.yaml` the way `load_csv.rs` does and
  return `resolve_or_default` for each logger name.
- `resolve.ts`: `invoke("resolve_channels")` inside Tauri. Otherwise use
  `generated/aliases.ts`, produced from `docs/channels.yaml` by a small generator script,
  so browser development and tests still get canonical ids.
- Add the logger-name aliases to `docs/channels.yaml` (in the patch).

### Phase 5: Desktop wiring (1–1½ days)

- `live-can-session.ts`: start `RawBatchSession` for a session id, push decoded frames
  into the `LiveBuffer`, and commit a new `LoadedSession` at most once per animation
  frame. `lapConfig` mode is `none`. Removing the session disconnects.
- `ConnectLiveDialog.tsx`: device id, Start/End, and the list of running sessions to
  connect to. Signed-out and not-a-member states use the existing Helios auth prompts.
- Patch `SessionPanel.tsx` and `App.tsx` as listed above.

### Phase 6: End-to-end check (½–1 day)

1. **Browser:** in `../helios-dev`, run `pnpm --filter @helios/desktop vite:dev` with
   `.env` pointing at a test backend. Run `npm run can-sim -- --device raw-can-sim` and
   check that the default workspaces show live values. If the Tauri-only sample loading
   breaks the browser view, add the boot guard to the patch.
2. **Full app:** run `pnpm dev`, the real Tauri window. Check the Rust resolver gives the
   same ids as the fallback.
3. **Test backend:** use the devkit's local Docker stack (`npm run up`). It has the
   `pm.is_org_member()` stand-in and test logins, which Helios's auth flow probably
   expects. The "Cellular Telemetry" project has no `pm` schema, so Helios's login and
   Org & Access checks may not work against it.
4. Run `npm run helios:check`, then produce the final patch with `git format-patch`
   from `../helios-dev`.

### Phase 7: Handoff (½ day)

- Hand over the updated devkit folder (migration and ingest changes) and write `NICK.md`: file
  locations (`infra/telemetry-supabase/...`, copied to `infra/pdm-supabase/...` per
  Helios's process), apply order, the verification SQL already used on our project, the
  deploy command, and the open questions.
- Open a PR, or give Nick the overlay plus patch, whichever he prefers.

**Total: about 5–6 working days**, plus Nick's turnaround on the backend. This is a
little more than the earlier 3–5 day estimate because of the bench script and the Rust
resolver, which are what make the handoff a copy-and-apply job.

## Alignment with the devkit (`helios-telemetry-devkit/CONTEXT.md`)

Checked 2026-11-08. The devkit (Oct 17) is Nick's latest written guidance and comes
first where it disagrees with his September live-path spec.

Already aligned: Supabase calls in small movable modules; signed-in clients only (no anon
reads, no service key in a client); human session changes go through an RPC instead of a
service key; device HMAC auth; migrations kept to the `telemetry` schema, idempotent,
dated after `20260714010000`, copied into `infra/pdm-supabase` and never shipping the
`pm` stand-in; function deployed from `infra/telemetry-supabase` with `verify_jwt = false`.

Changes to make in this plan:

1. **Location.** The devkit says the client lands in `apps/desktop/src/modules/telemetry`.
   Put the two desktop files there instead of `lib/` and `components/`. The folder does
   not exist on `main` yet, so this plan creates it.
2. **Backend deliverable.** The devkit says it is "merged back into Helios once your work
   settles". Hand over the updated devkit folder (= `infra/telemetry-supabase`) rather than
   a separate `backend/` folder. Run `npm run test:function` (needs Deno) first:
   `can_batch_test.ts` has never run under Deno.
3. **409 vs the retry rule.** `docs/wire-protocol.md` says "4xx => drop". Ingest returns
   409 when no session is running, so firmware that follows the spec would throw data away
   until someone presses Start. `can-sim` already holds batches on 409. Document 409 as
   "hold and retry" in the protocol doc.
4. **Live delivery.** The devkit's live view subscribes to `telemetry:live:{session_id}`.
   v1 reads every second instead. Either move the broadcast into v1 (about +1 day) or
   tell Nick it comes in phase 2.
5. **Session controls.** The devkit asks for "an RPC with a capability check".
   `start_session` checks org membership only. Ask Nick whether a specific Org & Access
   capability should be required.
6. **Channel aliases.** The devkit's `docs/channels.yaml` is an older copy than Helios
   `main`'s (1183 vs 1807 lines). Add aliases to Helios's copy and sync the devkit copy.

Departures from the devkit design that need Nick's sign-off (they come with raw CAN):

7. **Not Arrow, not a channel set.** The devkit design is "Arrow from the function inward"
   and versioned channel sets ("register, never edit"). Raw CAN stores JSON frames in
   `can_batches` and decodes with the logger config shipped in the client, so the
   compactor, `downsampled_1hz` and the parquet bucket don't cover it. Proposed: record
   the logger config version or hash on each session so old data stays decodable after
   the config changes.
8. **History.** The devkit wants a session list and a history view. This plan is live
   only, and the 7-day retention deletes raw history (the devkit design keeps everything
   in parquet). Options: longer retention, an ended-session view reading `can_batches`,
   or a later compactor path for raw CAN.

## Later (not in v1)

- Push: have the ingest raw branch broadcast each batch on `telemetry:live:{session_id}`
  and drop the 1-second reads.
- Port features Logs lacks: live channel activity in `ChannelsModal`, auto-zero at rest,
  alert rules mapped onto Helios warn/alarm and the alarm panel, fuel and steering
  widgets, unit preferences.
- Per-CAN-ID rate groups instead of a single 10 Hz group.
- Ask the logger author about the coolant/oil offset sign before real data is trusted.

## Risks

- Logs rebuilding a `ChannelStore` many times per second is untested. Nick's plan
  estimates about 1 MB of copying per rebuild. If it is slow, commit at 2–5 Hz.
- Helios's sign-in flow against a non-Helios backend is unknown. Use the devkit stack.
- If Helios `main` moves before handoff, re-pin `HELIOS_BASE` and rerun
  `helios:check`. A patch that no longer applies shows up there, not in Nick's hands.

## The installed Helios app (/Applications/Helios.app, v6.6.2)

Leave it untouched. It is a signed, auto-updating release build: code can't be added to
it, and an update would overwrite any change anyway. It also signs in to the **hosted
production project** with real team data.

What it is useful for:

- **Reference.** It is the same version as Helios `main` (6.6.2), so it shows exactly the
  Logs UI the integration plugs into.
- **Final acceptance.** Once Nick ships a release with this work, the installed app
  auto-updates, and connecting to a live session from it is the real end-to-end test.

One caution: the developer build in `../helios-dev` uses the same app identifier
(`edu.asu.sdm.helios`). It will probably share the installed app's local data (saved
workspaces, recent sessions, sign-in) and may compete for the Vault's localhost bridge.
**Quit the installed app before running `pnpm dev`**, or change the identifier in
`../helios-dev` only. Never put that change in the patch.
