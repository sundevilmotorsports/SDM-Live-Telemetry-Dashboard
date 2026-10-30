// SDM26-cell-v1 (channel set id 1).
// Copied from the firmware repo docs/channel-set-1.json. Display units come from
// docs/channels.yaml. Wire scale/offset are already applied by telemetry-ingest;
// they are recorded so a later pipeline does not apply them twice.
// Do not invent channels or reorder groups.

export const CHANNEL_SET_ID = 1
export const CHANNEL_SET_NAME = 'SDM26-cell-v1'

export interface LiveChannelDef {
  id: string
  group: 0 | 1 | 2
  rateHz: number
  enc: 'i16fp' | 'f32'
  /** Wire encoding scale. Already applied by the ingest function. */
  wireScale: number
  wireOffset: number
  label: string
  unit: string
}

export const LIVE_CHANNELS: LiveChannelDef[] = [
  { id: 'engine.rpm', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.5, wireOffset: 0, label: 'Engine RPM', unit: 'rpm' },
  { id: 'engine.tps', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Throttle Position', unit: '%' },
  { id: 'engine.aps', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Accelerator Pedal', unit: '%' },
  { id: 'engine.map', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'MAP', unit: 'kPa' },
  { id: 'engine.lambda', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.0001, wireOffset: 0.6, label: 'Lambda', unit: 'lambda' },
  { id: 'engine.gear', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 1, wireOffset: 0, label: 'Gear', unit: '' },
  { id: 'chassis.steering_angle', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Steering Angle', unit: '°' },
  { id: 'imu.lat_g', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.001, wireOffset: 0, label: 'Lateral G', unit: 'g' },
  { id: 'imu.long_g', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.001, wireOffset: 0, label: 'Longitudinal G', unit: 'g' },
  { id: 'imu.vert_g', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.001, wireOffset: 0, label: 'Vertical G', unit: 'g' },
  { id: 'imu.yaw_rate', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.02, wireOffset: 0, label: 'Yaw Rate', unit: 'deg/s' },
  { id: 'brake.front_pressure', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.5, wireOffset: 0, label: 'Front Brake Pressure', unit: 'kPa' },
  { id: 'brake.rear_pressure', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.5, wireOffset: 0, label: 'Rear Brake Pressure', unit: 'kPa' },
  { id: 'suspension.travel_fl', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Suspension Travel FL', unit: 'mm' },
  { id: 'suspension.travel_fr', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Suspension Travel FR', unit: 'mm' },
  { id: 'suspension.travel_rl', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Suspension Travel RL', unit: 'mm' },
  { id: 'suspension.travel_rr', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Suspension Travel RR', unit: 'mm' },
  { id: 'drivetrain.wheel_speed_fl', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.125, wireOffset: 0, label: 'Wheel Speed FL', unit: 'rpm' },
  { id: 'drivetrain.wheel_speed_fr', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.125, wireOffset: 0, label: 'Wheel Speed FR', unit: 'rpm' },
  { id: 'drivetrain.wheel_speed_rl', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.125, wireOffset: 0, label: 'Wheel Speed RL', unit: 'rpm' },
  { id: 'drivetrain.wheel_speed_rr', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.125, wireOffset: 0, label: 'Wheel Speed RR', unit: 'rpm' },
  { id: 'drivetrain.vehicle_speed', group: 0, rateHz: 10, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Vehicle Speed', unit: 'km/h' },
  { id: 'gps.lat_ref', group: 1, rateHz: 10, enc: 'f32', wireScale: 1, wireOffset: 0, label: 'GPS Latitude Reference', unit: '°' },
  { id: 'gps.lat_d', group: 1, rateHz: 10, enc: 'f32', wireScale: 1, wireOffset: 0, label: 'GPS Latitude Delta', unit: '°' },
  { id: 'gps.lon_ref', group: 1, rateHz: 10, enc: 'f32', wireScale: 1, wireOffset: 0, label: 'GPS Longitude Reference', unit: '°' },
  { id: 'gps.lon_d', group: 1, rateHz: 10, enc: 'f32', wireScale: 1, wireOffset: 0, label: 'GPS Longitude Delta', unit: '°' },
  { id: 'gps.speed', group: 1, rateHz: 10, enc: 'f32', wireScale: 1, wireOffset: 0, label: 'GPS Speed', unit: 'm/s' },
  { id: 'engine.water_temp', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Water Temp', unit: '°C' },
  { id: 'engine.oil_temp', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Oil Temp', unit: '°C' },
  { id: 'engine.oil_pressure', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.05, wireOffset: 0, label: 'Oil Pressure', unit: 'kPa' },
  { id: 'engine.fuel_pressure', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.05, wireOffset: 0, label: 'Fuel Pressure', unit: 'kPa' },
  { id: 'engine.battery_voltage', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.001, wireOffset: 0, label: 'Battery Voltage', unit: 'V' },
  { id: 'power.supply_current', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Supply Current', unit: 'A' },
  { id: 'tire.surface_temp_fl', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Tire Surface Temp FL', unit: '°C' },
  { id: 'tire.surface_temp_fr', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Tire Surface Temp FR', unit: '°C' },
  { id: 'tire.surface_temp_rl', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Tire Surface Temp RL', unit: '°C' },
  { id: 'tire.surface_temp_rr', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 0.01, wireOffset: 0, label: 'Tire Surface Temp RR', unit: '°C' },
  { id: 'gps.fix_quality', group: 2, rateHz: 1, enc: 'i16fp', wireScale: 1, wireOffset: 0, label: 'GPS Fix Quality', unit: '' },
]

export const LIVE_CHANNEL_MAP: Record<string, LiveChannelDef> = Object.fromEntries(
  LIVE_CHANNELS.map(channel => [channel.id, channel]),
)

const GROUP_BY_ID = new Map(LIVE_CHANNELS.map(channel => [channel.id, channel.group]))

export function groupForChannel(channelId: string): 0 | 1 | 2 | null {
  return GROUP_BY_ID.get(channelId) ?? null
}

/** Infer which registered group a partial values map belongs to. Unknown-only maps return null. */
export function inferGroup(values: Record<string, number>): 0 | 1 | 2 | null {
  for (const id of Object.keys(values)) {
    const group = GROUP_BY_ID.get(id)
    if (group !== undefined) return group
  }
  return null
}

/**
 * i16fp dropout sentinel from the HTP wire spec: raw INT16_MIN is not a measurement.
 * The current telemetry-ingest decoder does not convert that raw word to null before
 * broadcasting, so this dashboard cannot reliably recognize it in decoded JSON
 * without re-implementing HTP. null / non-finite values (what a corrected ingest
 * emits) are rejected by the parser. No per-channel numeric sentinel is defined
 * in channel-set-1.json, so none is applied here.
 */
export const I16_NULL_NOTE =
  'Wire i16fp dropout is raw INT16_MIN. channel-set-1.json defines no decoded sentinel, and telemetry-ingest currently broadcasts the scaled word rather than null. Non-finite and null broadcast values are rejected; a large negative decoded dropout is not rewritten.'
