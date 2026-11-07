import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeCanFrame, type CanSignal, type DecodedCanFrame, type LoggerConfig } from './decodeCanFrame'

const realFrame = { can_id: 256, extd: false, dlc: 8, data: '0102030405060708', ts_ms: 1735500000123 }

function decoded(raw: unknown, config?: LoggerConfig) {
  const result = decodeCanFrame(raw, config)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result
}

function fixed(signals: CanSignal[]): LoggerConfig {
  return { can_devices: [{ id: 256, extended: false, fd: false, signals: { Fixed: signals } }] }
}

function invalid(raw: unknown, reason?: string) {
  const result: DecodedCanFrame = decodeCanFrame(raw)
  expect(result.ok).toBe(false)
  if (!result.ok && reason) expect(result.reason).toBe(reason)
}

describe('decodeCanFrame', () => {
  it('vendors the exact pinned config blob, not a reserialized approximation', () => {
    const bytes = readFileSync(new URL('./loggerConfig.json', import.meta.url))
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    expect(sha).toBe('550fd023c1d2103e3ef71001f18a5679896db136')
  })

  it('decodes the known real Supabase row using firmware f32 arithmetic', () => {
    const result = decoded(realFrame)
    expect(result.timestampMs).toBe(1735500000123)
    expect(result.values.rate_lpm_1).toBeCloseTo(2.58, 6)
    // Integer conversion and the config's 0.001 both round to f32 in firmware.
    expect(result.values.total_volume_l_1).toBeCloseTo(50595.078, 2)
    expect(result.values.total_volume_l_1).toBe(50595.08203125)
    expect(result.rawValues).toEqual({})
    expect(result.unknown).toBe(false)
    expect(result.skippedSignals).toBe(0)
  })

  it('honors signed and endian flags only for scaled signals', () => {
    const result = decoded({ ...realFrame, data: 'fffe010200000000' }, fixed([
      { name: 'signedBE', start: 0, len: 2, signed: true, big_endian: true, scale: 0.5 },
      { name: 'unsignedBE', start: 0, len: 2, big_endian: true, scale: 1 },
      { name: 'signedLE', start: 0, len: 2, signed: true, scale: 1 },
      { name: 'unsignedLE', start: 2, len: 2, scale: 1 },
      { name: 'raw', start: 0, len: 2, signed: true, big_endian: true, offset: 100 },
    ]))
    expect(result.values).toEqual({ signedBE: -1, unsignedBE: 65534, signedLE: -257, unsignedLE: 513, raw: 65279 })
    expect(result.rawValues).toEqual({ raw: 'fffe' })
  })

  it('subtracts offset before multiplying, rounding each operation to f32', () => {
    const result = decoded(realFrame, fixed([
      { name: 'positiveOffset', start: 0, len: 1, scale: 2, offset: 3 },
      { name: 'negativeOffset', start: 0, len: 1, scale: 2, offset: -3 },
      { name: 'zeroScale', start: 0, len: 1, scale: 0, offset: 99 },
    ]))
    expect(result.values).toEqual({ positiveOffset: -4, negativeOffset: 8, zeroScale: -0 })
  })

  it('selects only the active mux and preserves the firmware negative temperature offsets', () => {
    const result = decoded({ ...realFrame, can_id: 1000, data: '001770283201c200' })
    expect(result.values).toEqual({ r_engine: 6000, t_eng_coolant: 90, t_oil: 100, p_oil: 450 })
    expect(result.values['%_TPS']).toBeUndefined()
    const other = decoded({ ...realFrame, can_id: 1000, data: '0164500301020000' })
    expect(other.values['%_TPS']).toBe(80)
    expect(other.values['n-Gear']).toBe(3)
    expect(other.rawValues['%_TPS']).toBe('50')
    expect(other.values.r_engine).toBeUndefined()
  })

  it('skips truncated signals without padding or default zeros', () => {
    const result = decoded({ ...realFrame, dlc: 3, data: '010203' })
    expect(result.values.rate_lpm_1).toBeCloseTo(2.58, 6)
    expect(result.values.total_volume_l_1).toBeUndefined()
    expect(result.skippedSignals).toBe(1)
    const empty = decoded({ ...realFrame, dlc: 0, data: '' })
    expect(empty.values).toEqual({})
    expect(empty.skippedSignals).toBe(2)
  })

  it('identifies unknown IDs, extd mismatches, and unknown/missing mux without fabricating group zero', () => {
    for (const frame of [
      { ...realFrame, can_id: 42 },
      { ...realFrame, extd: true },
      { ...realFrame, can_id: 1000, data: 'ff00000000000000' },
      { ...realFrame, can_id: 1000, dlc: 0, data: '' },
    ]) {
      const result = decoded(frame)
      expect(result.unknown).toBe(true)
      expect(result.values).toEqual({})
      expect(result.rawValues).toEqual({})
    }
  })

  it('matches extended devices and rejects ambiguous bus/config matches', () => {
    const config = fixed([{ name: 'value', start: 0, len: 1 }])
    config.can_devices[0].extended = true
    config.can_devices[0].id = 0x1fffffff
    expect(decoded({ ...realFrame, extd: true, can_id: 0x1fffffff }, config).values.value).toBe(1)
    config.can_devices.push({ ...config.can_devices[0], bus: 'Engine', fd: true })
    expect(decodeCanFrame({ ...realFrame, extd: true, can_id: 0x1fffffff }, config)).toEqual({ ok: false, reason: 'ambiguous-id' })
  })

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64])('accepts actual CAN FD byte length %i and ignores config fd when matching', length => {
    const config = fixed([{ name: 'last', start: Math.max(0, length - 1), len: 1 }])
    const result = decoded({ ...realFrame, fd: true, brs: true, dlc: length, data: '01'.repeat(length) }, config)
    expect(result.unknown).toBe(false)
    expect(result.values.last).toBe(length ? 1 : undefined)
  })

  it.each([9, 10, 11, 13, 15, 17, 25, 33, 49, 65])('rejects unsupported FD length %i (not DLC codes)', dlc => {
    invalid({ ...realFrame, fd: true, dlc, data: '00'.repeat(dlc) }, 'dlc')
  })

  it('preserves original hex case and exposes only safe unsigned LE raw integers', () => {
    const opaque = decoded({ ...realFrame, can_id: 881, data: 'FFffFFffFFffFFff' })
    expect(opaque.rawValues.FLT_TTA).toBe('FFffFFffFFffFFff')
    expect(opaque.values.FLT_TTA).toBeUndefined()
    expect(opaque.skippedSignals).toBe(1)
    const safe = decoded({ ...realFrame, can_id: 881, data: 'ffffffffffff1f00' })
    expect(safe.values.FLT_TTA).toBe(Number.MAX_SAFE_INTEGER)
    expect(safe.rawValues.FLT_TTA).toBe('ffffffffffff1f00')
    const six = decoded(realFrame, fixed([{ name: 'six', start: 0, len: 6 }]))
    expect(six.values.six).toBe(0x060504030201)
  })

  it('uses raw_int otherwise-eight widths, padding/truncation, and the u64-to-i64 cast', () => {
    const result = decoded({ ...realFrame, data: '000001ffffffffff' }, fixed([
      { name: 'threeBE', start: 0, len: 3, big_endian: true, scale: 1 },
      { name: 'threeLE', start: 0, len: 3, scale: 1 },
      { name: 'fourBE', start: 3, len: 4, signed: true, big_endian: true, scale: 1 },
    ]))
    expect(result.values).toEqual({ threeBE: 1099511627776, threeLE: 65536, fourBE: -1 })
    const wrap = decoded({ ...realFrame, data: 'ffffffffffffffff' }, fixed([{ name: 'wrap', start: 0, len: 8, scale: 1 }]))
    expect(wrap.values.wrap).toBe(-1)
    const wide = decoded({ ...realFrame, fd: true, dlc: 12, data: '0100000000000000ffffffff' }, fixed([{ name: 'wide', start: 0, len: 12, scale: 1 }]))
    expect(wide.values.wide).toBe(1)
  })

  it('counts unsafe scaled integers and non-finite f32 results instead of coercing them', () => {
    const result = decoded({ ...realFrame, data: 'ffffffffffffff7f' }, fixed([
      { name: 'unsafe', start: 0, len: 8, scale: 0.001 },
      { name: 'overflow', start: 0, len: 1, scale: 3.4e38 },
      { name: 'nan', start: 0, len: 1, scale: NaN },
      { name: 'badOffset', start: 0, len: 1, scale: 1, offset: Infinity },
    ]))
    expect(result.values).toEqual({})
    expect(result.skippedSignals).toBe(4)
  })

  it.each([null, [], 'frame', 42, undefined])('rejects non-object input %s', input => invalid(input, 'not-object'))

  it.each([
    ['extd', undefined], ['extd', 0], ['fd', 'false'], ['fd', undefined], ['brs', 1], ['brs', undefined],
    ['can_id', -1], ['can_id', 2048], ['can_id', 1.5], ['can_id', '256'], ['can_id', NaN],
    ['dlc', -1], ['dlc', 9], ['dlc', 1.5], ['dlc', '8'],
    ['data', '0x01020304050607'], ['data', '010203040506070g'], ['data', '0102 30405060708'],
    ['data', '01020304050607'], ['data', '010203040506070800'], ['data', 123],
    ['ts_ms', -1], ['ts_ms', 1.5], ['ts_ms', Infinity], ['ts_ms', Number.MAX_SAFE_INTEGER + 1], ['ts_ms', '1735500000123'],
  ])('rejects malformed %s = %s', (field, value) => invalid({ ...realFrame, [field]: value }, field))

  it('validates even unknown frames and enforces BRS and extended ID range', () => {
    invalid({ ...realFrame, can_id: 42, data: 'not-hex' }, 'data')
    invalid({ ...realFrame, brs: true }, 'brs-without-fd')
    invalid({ ...realFrame, brs: true, fd: false }, 'brs-without-fd')
    invalid({ ...realFrame, extd: true, can_id: 0x20000000 }, 'can_id')
    expect(decoded({ ...realFrame, brs: false, fd: false }).unknown).toBe(false)
  })

  it('requires every mandatory frame property', () => {
    for (const field of ['can_id', 'extd', 'dlc', 'data', 'ts_ms']) {
      const input: Record<string, unknown> = { ...realFrame }
      delete input[field]
      invalid(input, field)
    }
  })
})
