import type { Frame } from '../simulation'

/**
 * Raw channel names/config: sundevilmotorsports/logger@9338e3cfb6c77be5bfc485b3cc75e502d610514e
 * https://github.com/sundevilmotorsports/logger/blob/9338e3cfb6c77be5bfc485b3cc75e502d610514e/config.json

 * Values have already passed through logger scaling. Never apply it again here.
 * Pressure units, IMU axes/units, wheel circumference, suspension units, and ADC
 * steering calibration are insufficiently specified; those fields stay unavailable.
 */
/** Numeric dashboard fields (everything except t's companions like the raw map). */
export type FrameField = Exclude<keyof Frame, 'raw'>

export const RAW_DASHBOARD_MAPPINGS: { field: FrameField; channelId: string; note: string }[] = [
  { field: 'rpm', channelId: 'r_engine', note: 'Engine rpm; already decoded' },
  { field: 'throttle', channelId: '%_TPS', note: 'Throttle plate percent, not accelerator pedal' },
  { field: 'gear', channelId: 'n-Gear', note: 'Dimensionless; display as received' },
  { field: 'coolant', channelId: 't_eng_coolant', note: 'Coolant temperature; preserve firmware offset semantics' },
  { field: 'oilTemp', channelId: 't_oil', note: 'Oil temperature; preserve firmware offset semantics' },
  { field: 'fuel', channelId: '%_fuel_left', note: 'Fuel percent; already decoded' },
]

