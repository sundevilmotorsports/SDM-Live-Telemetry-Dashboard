import type { ChartConfig, GaugeConfig, LayoutFlags } from './ConfigContext'
import type { PanelSizes } from './panelSizes'

/**
 * Profiles are whole-screen layouts, like MoTeC i2 worksheets: which charts exist (traces,
 * ranges, limits, order), the gauges, which widgets are shown and in what order. The
 * time range, math channels, alerts, units, and source settings are shared by all profiles.
 *
 * The live config fields (gauges, layout, widgetOrder, chartOrder, chartCfg) are the working
 * copy of the active profile, so everything that edits them keeps working unchanged. The
 * active profile's stored `data` is refreshed when switching and when saving; every other
 * profile's `data` is always current. Pure functions: no React, no storage.
 */
export interface ProfileData {
  gauges: GaugeConfig[]
  layout: LayoutFlags
  widgetOrder: string[]
  chartOrder: string[]
  chartCfg: Record<string, ChartConfig>
  /** Panel sizes the user dragged (see panelSizes.ts). Empty = defaults. */
  panelSizes: PanelSizes
}

export interface Profile {
  id: string
  name: string
  /** Preset this profile started from; enables "reset to preset". */
  presetId?: string
  data: ProfileData
}

export interface ProfileHost extends ProfileData {
  profiles: Profile[]
  activeProfileId: string
}

export const MAX_PROFILES = 24
export const MAX_NAME = 40
export const EXPORT_FORMAT = 'sdm-dash-profile'

export function snapshotOf(s: ProfileData): ProfileData {
  return structuredClone({ gauges: s.gauges, layout: s.layout, widgetOrder: s.widgetOrder, chartOrder: s.chartOrder, chartCfg: s.chartCfg, panelSizes: s.panelSizes })
}

/** Store the working copy into the active profile (before saving or switching). */
export function syncActive<S extends ProfileHost>(s: S): S {
  return { ...s, profiles: s.profiles.map(p => (p.id === s.activeProfileId ? { ...p, data: snapshotOf(s) } : p)) }
}

function load<S extends ProfileHost>(s: S, p: Profile): S {
  return { ...s, ...structuredClone(p.data), activeProfileId: p.id }
}

export function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
}

/** "Name", then "Name 2", "Name 3", … so tabs are never indistinguishable. */
export function uniqueName(profiles: Profile[], wanted: string): string {
  const base = cleanName(wanted) || 'Profile'
  const taken = new Set(profiles.map(p => p.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_NAME - String(n).length - 1)} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function switchProfile<S extends ProfileHost>(s: S, id: string): S {
  if (id === s.activeProfileId) return s
  const synced = syncActive(s)
  const target = synced.profiles.find(p => p.id === id)
  return target ? load(synced, target) : s
}

/** Adds a profile and switches to it. No-op at the profile cap. */
export function addProfile<S extends ProfileHost>(s: S, spec: { name: string; data: ProfileData; presetId?: string }): S {
  if (s.profiles.length >= MAX_PROFILES) return s
  const synced = syncActive(s)
  const profile: Profile = {
    id: newProfileId(), name: uniqueName(synced.profiles, spec.name), data: structuredClone(spec.data),
    ...(spec.presetId ? { presetId: spec.presetId } : {}),
  }
  return load({ ...synced, profiles: [...synced.profiles, profile] }, profile)
}

/** Copy of the current (working) layout, including unsaved edits. */
export function duplicateProfile<S extends ProfileHost>(s: S): S {
  const active = s.profiles.find(p => p.id === s.activeProfileId)
  return addProfile(s, { name: `${active?.name ?? 'Profile'} copy`, data: snapshotOf(s), presetId: active?.presetId })
}

export function renameProfile<S extends ProfileHost>(s: S, id: string, name: string): S {
  const clean = cleanName(name)
  if (!clean) return s
  const others = s.profiles.filter(p => p.id !== id)
  return { ...s, profiles: s.profiles.map(p => (p.id === id ? { ...p, name: uniqueName(others, clean) } : p)) }
}

/** The last profile cannot be deleted. Deleting the active one switches to its neighbour. */
export function deleteProfile<S extends ProfileHost>(s: S, id: string): S {
  if (s.profiles.length <= 1) return s
  const index = s.profiles.findIndex(p => p.id === id)
  if (index < 0) return s
  const remaining = s.profiles.filter(p => p.id !== id)
  const next = { ...s, profiles: remaining }
  return id === s.activeProfileId ? load(next, remaining[Math.min(index, remaining.length - 1)]) : next
}

/** Replace the active profile's layout (e.g. reset to its preset). */
export function replaceActive<S extends ProfileHost>(s: S, data: ProfileData): S {
  return { ...s, ...structuredClone(data) }
}

export function exportProfile(s: ProfileHost, id: string): string | null {
  const profile = s.profiles.find(p => p.id === id)
  if (!profile) return null
  const data = id === s.activeProfileId ? snapshotOf(s) : profile.data
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, name: profile.name, ...(profile.presetId ? { presetId: profile.presetId } : {}), data }, null, 2)
}

export type ImportResult = { ok: true; name: string; presetId?: string; data: ProfileData } | { ok: false; reason: string }

/** Parse an exported profile. `normalize` repairs/validates the layout data (same rules as saved config). */
export function parseProfileImport(text: string, normalize: (raw: unknown) => ProfileData): ImportResult {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, reason: 'Not valid JSON.' } }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'Not a profile file.' }
  const p = parsed as Record<string, unknown>
  if (p.format !== EXPORT_FORMAT) return { ok: false, reason: 'Not an SDM dashboard profile.' }
  if (p.version !== 1) return { ok: false, reason: `Unsupported profile version ${String(p.version)}.` }
  if (!p.data || typeof p.data !== 'object') return { ok: false, reason: 'Profile has no layout data.' }
  return {
    ok: true,
    name: typeof p.name === 'string' && cleanName(p.name) ? cleanName(p.name) : 'Imported',
    ...(typeof p.presetId === 'string' ? { presetId: p.presetId } : {}),
    data: normalize(p.data),
  }
}
