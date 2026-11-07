import loggerConfig from './loggerConfig.json'

/**
 * Provenance: sundevilmotorsports/logger@9338e3cfb6c77be5bfc485b3cc75e502d610514e
 * Config: https://github.com/sundevilmotorsports/logger/blob/9338e3cfb6c77be5bfc485b3cc75e502d610514e/config.json
 * Semantics: https://github.com/sundevilmotorsports/logger/blob/9338e3cfb6c77be5bfc485b3cc75e502d610514e/src/can.rs
 * Config Git blob: 550fd023c1d2103e3ef71001f18a5679896db136 (vendored byte-for-byte).

 * ADC channels are separate hardware inputs, not CAN payload calibration.
 */
export interface CanSignal {
  name: string
  start: number
  len: number
  signed?: boolean
  big_endian?: boolean
  scale?: number | null
  offset?: number
}

export interface LoggerConfig {
  can_devices: {
    id: number
    extended: boolean
    fd: boolean
    bus?: string
    signals: { Fixed: CanSignal[] } | {
      Muxed: { byte: number; groups: { type_val: number; signals: CanSignal[] }[] }
    }
  }[]
}

export type DecodedCanFrame = {
  ok: true
  timestampMs: number
  values: Record<string, number>
  rawValues: Record<string, string>
  /** Unconfigured ID/extd, unknown mux, or missing discriminator; not malformed input. */
  unknown: boolean
  /** Signals omitted from values: truncated, unsafe integers, or non-finite scaling. */
  skippedSignals: number
} | { ok: false; reason: string }

const FD_LENGTHS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64])
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

function unsignedInteger(bytes: Uint8Array, bigEndian: boolean): bigint {
  let result = 0n
  for (let i = 0; i < bytes.length; i++) {
    const index = bigEndian ? i : bytes.length - 1 - i
    result = (result << 8n) | BigInt(bytes[index])
  }
  return result
}

/** Match raw_int's 1/2/4/otherwise-8 widths, right padding, and u64 → i64 cast. */
function scaledInteger(bytes: Uint8Array, signal: CanSignal): bigint {
  const width = [1, 2, 4].includes(signal.len) ? signal.len : 8
  const buffer = new Uint8Array(width)
  buffer.set(bytes.subarray(0, width))
  const integer = unsignedInteger(buffer, signal.big_endian === true)
  return signal.signed || width === 8 ? BigInt.asIntN(width * 8, integer) : integer
}

/**
 * dlc is the actual byte length, never a CAN FD DLC code. Match ID + extd only,
 * like firmware (fd is not a selector). Duplicate matches are rejected because
 * Supabase carries no bus and choosing a physical network would invent data.
 * The optional typed config supports focused firmware-semantics tests.
 */
export function decodeCanFrame(raw: unknown, config: LoggerConfig = loggerConfig): DecodedCanFrame {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-object' }
  const input = raw as Record<string, unknown>
  if (typeof input.extd !== 'boolean') return { ok: false, reason: 'extd' }
  if ('fd' in input && typeof input.fd !== 'boolean') return { ok: false, reason: 'fd' }
  if ('brs' in input && typeof input.brs !== 'boolean') return { ok: false, reason: 'brs' }
  if (input.brs === true && input.fd !== true) return { ok: false, reason: 'brs-without-fd' }
  if (typeof input.can_id !== 'number' || !Number.isSafeInteger(input.can_id)
    || input.can_id < 0 || input.can_id > (input.extd ? 0x1fffffff : 0x7ff)) {
    return { ok: false, reason: 'can_id' }
  }
  if (typeof input.dlc !== 'number' || !Number.isInteger(input.dlc) || input.dlc < 0
    || (input.fd === true ? !FD_LENGTHS.has(input.dlc) : input.dlc > 8)) {
    return { ok: false, reason: 'dlc' }
  }
  if (typeof input.data !== 'string' || input.data.length !== input.dlc * 2
    || !/^[0-9a-f]*$/i.test(input.data)) return { ok: false, reason: 'data' }
  if (typeof input.ts_ms !== 'number' || !Number.isSafeInteger(input.ts_ms) || input.ts_ms < 0) {
    return { ok: false, reason: 'ts_ms' }
  }

  const result: Extract<DecodedCanFrame, { ok: true }> = {
    ok: true,
    timestampMs: input.ts_ms,
    values: Object.create(null) as Record<string, number>,
    rawValues: Object.create(null) as Record<string, string>,
    unknown: false,
    skippedSignals: 0,
  }
  const devices = config.can_devices.filter(device => device.id === input.can_id && device.extended === input.extd)
  if (devices.length > 1) return { ok: false, reason: 'ambiguous-id' }
  const device = devices[0]
  if (!device) return { ...result, unknown: true }

  const data = Uint8Array.from({ length: input.dlc }, (_, i) => Number.parseInt((input.data as string).slice(i * 2, i * 2 + 2), 16))
  let signals: CanSignal[]
  if ('Fixed' in device.signals) {
    signals = device.signals.Fixed
  } else {
    const mux = device.signals.Muxed
    // Unlike firmware's discriminator default of zero, missing bytes are not data.
    const group = mux.byte < data.length ? mux.groups.find(group => group.type_val === data[mux.byte]) : undefined
    if (!group) return { ...result, unknown: true }
    signals = group.signals
  }

  for (const signal of signals) {
    if (!Number.isSafeInteger(signal.start) || signal.start < 0 || !Number.isSafeInteger(signal.len)
      || signal.len < 1 || signal.start + signal.len > data.length) {
      result.skippedSignals++
      continue
    }
    const bytes = data.subarray(signal.start, signal.start + signal.len)
    const scaled = signal.scale !== undefined && signal.scale !== null
    // No scale means original bytes, regardless of signed, endian, or offset.
    if (!scaled) result.rawValues[signal.name] = input.data.slice(signal.start * 2, (signal.start + signal.len) * 2)
    const integer = scaled ? scaledInteger(bytes, signal) : unsignedInteger(bytes, false)
    if (integer < -MAX_SAFE || integer > MAX_SAFE) {
      result.skippedSignals++
      continue
    }
    let value = Number(integer)
    if (scaled) {
      // Rust casts the integer to f32 and rounds every subsequent f32 operation.
      value = Math.fround(Math.fround(signal.scale!) * Math.fround(Math.fround(value) - Math.fround(signal.offset ?? 0)))
    }
    if (!Number.isFinite(value)) {
      result.skippedSignals++
      continue
    }
    result.values[signal.name] = value
  }
  return result
}
