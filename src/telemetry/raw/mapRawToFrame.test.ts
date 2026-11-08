import { rawValues } from './loggerChannels'
import { describe, expect, it } from 'vitest'
import type { ChannelState } from '../live/types'
import { decodeCanFrame } from './decodeCanFrame'
import { RAW_DASHBOARD_MAPPINGS, rawChannelsToFrame } from './mapRawToFrame'

function channels(values: Record<string, number>, tUs = 2_000_000): ChannelState {
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, tUs, receivedAtMs: 1 }]))
}

describe('rawChannelsToFrame', () => {
  it('leaves every field NaN when no data has arrived, even with a session origin', () => {
    for (const start of [null, 1_000_000]) {
      const result = rawChannelsToFrame({}, start)
      const { raw, ...fields } = result.frame
      expect(Object.values(fields).every(Number.isNaN)).toBe(true)
      expect(rawValues(raw)).toEqual({})
      expect(result.unavailableFields.sort()).toEqual(Object.keys(fields).sort())
      expect(result.unmappedChannels).toEqual([])
    }
  })

  it('maps exactly the six agreed channels without scaling again', () => {
    expect(RAW_DASHBOARD_MAPPINGS.map(({ field, channelId }) => [field, channelId])).toEqual([
      ['rpm', 'r_engine'], ['throttle', '%_TPS'], ['gear', 'n-Gear'],
      ['coolant', 't_eng_coolant'], ['oilTemp', 't_oil'], ['fuel', '%_fuel_left'],
    ])
    expect(RAW_DASHBOARD_MAPPINGS.every(mapping => mapping.note.length > 0)).toBe(true)
    const result = rawChannelsToFrame(channels({ r_engine: 6000, '%_TPS': 80, 'n-Gear': 3, t_eng_coolant: 90, t_oil: 100, '%_fuel_left': 65 }), 1_000_000)
    expect(result.frame).toMatchObject({ rpm: 6000, throttle: 80, gear: 3, coolant: 90, oilTemp: 100, fuel: 65, t: 1 })
    expect(result.unmappedChannels).toEqual([])
    expect(result.unavailableFields).not.toContain('rpm')
    expect(result.unavailableFields).not.toContain('t')
  })

  it('keeps pressure, steering/ADC, IMU, wheels, suspension, and unrelated channels inspectable but unmapped', () => {
    const values = {
      p_oil: 450, p_Fuel: 300, p_F_brake: 80, p_R_brake: 70, Steering: 1000,
      a_Lat: 100, a_Long: 120, a_Vert: 130, a_Lat_ecu: 80, r_Yaw: 30,
      r_FL_wheel: 1000, r_FR_wheel: 1001, r_RL_wheel: 1002, r_RR_wheel: 1003,
      v_trans_out: 100, l_FR_damper: 2000, rate_lpm_1: 2.58, MLPOT: 42,
      'engine.rpm': 5000, 'drivetrain.vehicle_speed': 90,
    }
    const state = channels(values)
    const snapshot = structuredClone(state)
    const result = rawChannelsToFrame(state, null)
    const { raw, ...fields } = result.frame
    expect(Object.values(fields).every(Number.isNaN)).toBe(true)
    // Unmapped dashboard fields stay NaN, but every logger channel is still available for raw:<name> charts and math.
    // ('engine.rpm' etc. are not logger channels and have no slot.)
    const loggerOnly = Object.fromEntries(Object.entries(values).filter(([k]) => !k.includes('.')))
    expect(rawValues(raw)).toEqual(loggerOnly)
    expect(result.unmappedChannels.sort()).toEqual(Object.keys(values).sort())
    expect(state).toEqual(snapshot)
    for (const field of ['brake', 'steering', 'oilPress', 'gX', 'gY', 'wFL', 'speed', 'suspFR', 'lapTime', 'lapNum', 'volt']) {
      expect(result.unavailableFields).toContain(field)
    }
  })

  it('does not default missing mapped channels, but preserves measured zero and neutral gear', () => {
    const result = rawChannelsToFrame(channels({ r_engine: 0, 'n-Gear': 0, '%_fuel_left': 0 }), null)
    expect(result.frame.rpm).toBe(0)
    expect(result.frame.gear).toBe(0)
    expect(result.frame.fuel).toBe(0)
    expect(result.frame.throttle).toBeNaN()
    expect(result.frame.coolant).toBeNaN()
    expect(result.unavailableFields).toContain('throttle')
  })

  it.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('does not expose non-finite or unsafe numeric values %s', value => {
    const result = rawChannelsToFrame(channels({ r_engine: value }), null)
    expect(result.frame.rpm).toBeNaN()
    expect(result.unavailableFields).toContain('rpm')
  })

  it('uses a fixed device session start rather than the oldest remaining channel', () => {
    const start = 1_000_000
    const first = rawChannelsToFrame(channels({ r_engine: 1000 }, 3_000_000), start)
    const next = rawChannelsToFrame(channels({ r_engine: 2000 }, 5_000_000), start)
    expect(first.frame.t).toBe(2)
    expect(next.frame.t).toBe(4)
    expect(rawChannelsToFrame(channels({ other: 1 }, start), start).frame.t).toBe(0)
  })

  it('uses the newest safe channel timestamp including unmapped channels', () => {
    const state = { ...channels({ r_engine: 1000 }, 2_000_000), ...channels({ opaque: 1 }, 4_500_000) }
    expect(rawChannelsToFrame(state, 1_000_000).frame.t).toBe(3.5)
    expect(rawChannelsToFrame(channels({ r_engine: 1000 }, 1735500000123000), 1735500000000000).frame.t).toBe(0.123)
  })

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('ignores unsafe timestamps/origins %s instead of fabricating elapsed time', time => {
    expect(rawChannelsToFrame(channels({ r_engine: 1000 }, time), 0).frame.t).toBeNaN()
    expect(rawChannelsToFrame(channels({ r_engine: 1000 }), time).frame.t).toBeNaN()
  })

  it('does not create negative time or use a null origin', () => {
    expect(rawChannelsToFrame(channels({ r_engine: 1000 }, 1), 2).frame.t).toBeNaN()
    expect(rawChannelsToFrame(channels({ r_engine: 1000 }), null).frame.t).toBeNaN()
  })

  it('advances elapsed time for opaque-only acceptance without fabricating measurements', () => {
    const first = rawChannelsToFrame({}, 1_000_000, 1_000_000)
    const next = rawChannelsToFrame({}, 1_000_000, 2_000_000)
    expect(first.frame.t).toBe(0)
    expect(next.frame.t).toBe(1)
    expect(next.frame.rpm).toBeNaN()
    expect(next.unavailableFields).not.toContain('t')
    expect(next.unavailableFields).toContain('rpm')
    expect(rawChannelsToFrame(channels({ r_engine: 6000 }, 1_000_000), 1_000_000, 2_000_000).frame).toMatchObject({ t: 1, rpm: 6000 })
    expect(rawChannelsToFrame({}, 1_000_000, Number.MAX_SAFE_INTEGER + 1).frame.t).toBeNaN()
    expect(rawChannelsToFrame({}, 1_000_000, 0).frame.t).toBeNaN()
  })

  it('maps decoded CAN temperatures as-is, retaining the firmware offset semantics', () => {
    const decoded = decodeCanFrame({ can_id: 1000, extd: false, dlc: 8, data: '001770283201c200', ts_ms: 1735500000123 })
    if (!decoded.ok) throw new Error(decoded.reason)
    const result = rawChannelsToFrame(channels(decoded.values), null)
    expect(result.frame.rpm).toBe(6000)
    expect(result.frame.coolant).toBe(90)
    expect(result.frame.oilTemp).toBe(100)
    expect(result.frame.oilPress).toBeNaN()
    expect(result.unmappedChannels).toContain('p_oil')
  })
})
