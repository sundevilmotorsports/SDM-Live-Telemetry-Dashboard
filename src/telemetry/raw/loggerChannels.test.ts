import { describe, expect, it } from 'vitest'
import loggerConfig from './loggerConfig.json'
import { LOGGER_CHANNELS, LOGGER_CHANNEL_BY_NAME, LOGGER_INDEX, LOGGER_SLOT_COUNT, buildLoggerChannels, rawValues } from './loggerChannels'
import { CHANNEL_MAP, LOGGER_CHANNEL_DEFS } from '../simulation'
import { emptyFrame } from '../live/mapToFrame'

function configNames(): string[] {
  const names: string[] = []
  for (const d of loggerConfig.can_devices) {
    const s = d.signals as { Fixed?: { name: string }[]; Muxed?: { groups: { signals: { name: string }[] }[] } }
    for (const sig of s.Fixed ?? s.Muxed!.groups.flatMap(g => g.signals)) names.push(sig.name)
  }
  return [...names, ...loggerConfig.adc_channels.map(a => a.name)]
}

describe('logger channel catalog', () => {
  it('covers every channel in config.json exactly once', () => {
    expect(LOGGER_CHANNELS.map(c => c.name).sort()).toEqual([...new Set(configNames())].sort())
    expect(LOGGER_CHANNELS).toHaveLength(80)
  })

  it('every channel is displayable: chartable, shown by a dashboard field, or listed with a reason', () => {
    for (const c of LOGGER_CHANNELS) {
      if (c.mappedField) expect(CHANNEL_MAP[c.mappedField]).toBeDefined()
      else if (c.kind === 'opaque') expect(c.note).toMatch(/hex/)
      else expect(CHANNEL_MAP[c.id]).toBeDefined()
      if (c.kind === 'not-transmitted') expect(c.note).toMatch(/never sends it on CAN/)
    }
  })

  it('classifies the known cases', () => {
    expect(LOGGER_CHANNEL_BY_NAME.r_engine).toMatchObject({ id: 'rpm', mappedField: 'rpm', kind: 'numeric', group: 'Engine (ECU)' })
    expect(LOGGER_CHANNEL_BY_NAME.t_MAT).toMatchObject({ id: 'raw:t_MAT', kind: 'numeric', unit: '°C', source: 'CAN 0x3EB mux 0, bytes 5–5' })
    expect(LOGGER_CHANNEL_BY_NAME.FLT_TTA).toMatchObject({ kind: 'opaque', group: 'Wheels & Tyres' })
    expect(LOGGER_CHANNEL_BY_NAME.l_FL_damper).toMatchObject({ id: 'raw:l_FL_damper', kind: 'not-transmitted', group: 'Logger ADC', min: 0, max: 4095 })
    expect(LOGGER_CHANNEL_BY_NAME.FL_SG).toMatchObject({ group: 'Strain Gauges', min: -32768, max: 32767 })
    expect(LOGGER_CHANNEL_BY_NAME.rate_lpm_1).toMatchObject({ unit: 'L/min', min: 0 })
    expect(LOGGER_CHANNEL_BY_NAME.rate_lpm_1.max).toBeCloseTo(655.35, 6)
    expect(LOGGER_CHANNEL_BY_NAME['%_TPS']).toMatchObject({ mappedField: 'throttle', min: 0, max: 100 })
  })

  it('an ADC input that the logger starts broadcasting on CAN becomes a live CAN channel automatically', () => {
    const config = {
      can_devices: [{ id: 0x500, extended: false, fd: false, signals: { Fixed: [{ name: 'l_FL_damper', start: 0, len: 2, big_endian: true }] } }],
      adc_channels: [{ name: 'l_FL_damper', channel: 6 }, { name: 'Steering', channel: 7 }],
    }
    const channels = buildLoggerChannels(config)
    expect(channels.find(c => c.name === 'l_FL_damper')).toMatchObject({ kind: 'numeric', source: 'CAN 0x500, bytes 0–1' })
    expect(channels.find(c => c.name === 'Steering')).toMatchObject({ kind: 'not-transmitted' })
  })

  it('chart getters read the raw map and are NaN without data', () => {
    const def = LOGGER_CHANNEL_DEFS.find(d => d.id === 'raw:t_MAT')!
    const raw = new Float64Array(LOGGER_SLOT_COUNT).fill(NaN)
    raw[LOGGER_INDEX.t_MAT] = 41
    expect(def.get({ ...emptyFrame(), raw })).toBe(41)
    expect(rawValues(raw)).toEqual({ t_MAT: 41 })
    expect(def.get(emptyFrame())).toBeNaN()
    expect(LOGGER_CHANNEL_DEFS.some(d => d.id === 'raw:r_engine')).toBe(false) // shown as rpm instead
  })
})
