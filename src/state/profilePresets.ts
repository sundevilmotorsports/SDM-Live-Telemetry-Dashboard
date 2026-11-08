import type { GaugeStyle, LayoutFlags, TraceConfig } from './ConfigContext'
import type { ProfileData } from './profiles'

/**
 * Preset profiles: ready-made whole-screen layouts, the way vendors ship ready-made MoTeC
 * workspaces. Groupings follow common motorsport data analysis (engine health, speeds,
 * driver inputs, chassis, tyres/brakes). Channels that have no live data on the current
 * source simply show gray/N/A, and light up when the data arrives (e.g. logger ADC channels
 * once the logger broadcasts them on CAN). Ranges default to each channel's registry range;
 * `ranges` overrides it where full scale would flatten the trace. Presets are plain data:
 * they build traces through the caller's makeTrace, so this module has no dependencies.
 */
export interface PresetSpec {
  id: string
  name: string
  description: string
  charts: { title: string; channels: string[]; ranges?: Record<string, [number, number]> }[]
  gauges: { channel: string; style?: GaugeStyle; warnAt?: number; dangerAt?: number }[]
  layout?: Partial<LayoutFlags>
}

const WHEELS = ['wFL', 'wFR', 'wRL', 'wRR']

export const PRESETS: PresetSpec[] = [
  {
    id: 'engine-vitals', name: 'Engine Vitals',
    description: 'RPM, throttle, temperatures, pressures, fueling, cuts and knock',
    charts: [
      { title: 'RPM · THROTTLE', channels: ['rpm', 'throttle'] },
      { title: 'TEMPERATURES', channels: ['coolant', 'oilTemp', 'raw:t_MAT'] },
      { title: 'PRESSURES', channels: ['raw:p_oil', 'raw:p_Fuel', 'raw:p_MAP'], ranges: { 'raw:p_oil': [0, 800], 'raw:p_Fuel': [0, 600], 'raw:p_MAP': [0, 300] } },
      { title: 'FUELING', channels: ['raw:Lamb_1', 'raw:%_lambda_corr', 'raw:Lambda_Target_Err'] },
      { title: 'CUTS · KNOCK', channels: ['raw:%_ign_cut', 'raw:%_fuel_cut', 'raw:n_knock_count'] },
    ],
    gauges: [{ channel: 'rpm', style: 'dial', warnAt: 6800, dangerAt: 7400 }, { channel: 'coolant', style: 'hbar' }, { channel: 'oilTemp', style: 'hbar' }],
    layout: { steering: false, suspension: false },
  },
  {
    id: 'speeds', name: 'Speeds',
    description: 'Wheel speeds with the reference, wheel rpm, vehicle speed, transmission output',
    charts: [
      { title: 'WHEEL SPEEDS', channels: [...WHEELS, 'wheelRef'] },
      { title: 'WHEEL RPM', channels: ['raw:r_FL_wheel', 'raw:r_FR_wheel', 'raw:r_RL_wheel', 'raw:r_RR_wheel'], ranges: Object.fromEntries(['FL', 'FR', 'RL', 'RR'].map(c => [`raw:r_${c}_wheel`, [0, 3000]])) },
      { title: 'SPEED · RPM', channels: ['speed', 'rpm'] },
      { title: 'TRANSMISSION OUT', channels: ['raw:v_trans_out'], ranges: { 'raw:v_trans_out': [0, 300] } },
    ],
    gauges: [{ channel: 'speed', style: 'dial' }, { channel: 'rpm', style: 'dial', warnAt: 6800, dangerAt: 7400 }, { channel: 'gear', style: 'vbar' }],
    layout: { steering: false, suspension: false },
  },
  {
    id: 'driver-inputs', name: 'Driver Inputs',
    description: 'Throttle and pedal, brake, steering, gear, shifts and launch',
    charts: [
      { title: 'PEDALS', channels: ['throttle', 'raw:%_APS_main'] },
      { title: 'BRAKE', channels: ['brake', 'raw:p_F_brake', 'raw:p_R_brake'] },
      { title: 'STEERING', channels: ['steering', 'raw:Steering'] },
      { title: 'GEAR', channels: ['gear', 'raw:in_gear'] },
      { title: 'SHIFT · LAUNCH', channels: ['raw:upshift_act', 'raw:downshift_act', 'raw:launch_ctrl_stat'] },
    ],
    gauges: [{ channel: 'throttle', style: 'vbar' }, { channel: 'brake', style: 'vbar' }, { channel: 'gear', style: 'vbar' }],
    layout: { steering: true, suspension: false },
  },
  {
    id: 'suspension-g', name: 'Suspension & G',
    description: 'G-force, IMU acceleration and rates, damper positions',
    charts: [
      { title: 'G-FORCE', channels: ['gX', 'gY'] },
      { title: 'IMU ACCELERATION', channels: ['raw:a_Lat', 'raw:a_Long', 'raw:a_Vert'] },
      { title: 'IMU RATES', channels: ['raw:r_Pitch', 'raw:r_Roll', 'raw:r_Yaw'] },
      { title: 'DAMPERS', channels: ['raw:l_FL_damper', 'raw:l_FR_damper', 'raw:l_RL_damper', 'raw:l_RR_damper'] },
    ],
    gauges: [{ channel: 'gX', style: 'hbar' }, { channel: 'gY', style: 'hbar' }],
    layout: { steering: false, suspension: true },
  },
  {
    id: 'tyres-brakes', name: 'Tyres & Brakes',
    description: 'Tyre ambient and object temperatures, brake pressures',
    charts: [
      { title: 'TYRE AMBIENT TEMP', channels: ['raw:t_FL_amb', 'raw:t_FR_amb', 'raw:t_RL_amb', 'raw:t_RR_amb'] },
      { title: 'WHEEL OBJECT TEMP', channels: ['raw:FLW_OBJ', 'raw:FRW_OBJ', 'raw:RLW_OBJ', 'raw:RRW_OBJ'] },
      { title: 'BRAKE PRESSURE', channels: ['raw:p_F_brake', 'raw:p_R_brake'] },
    ],
    gauges: [{ channel: 'raw:p_F_brake', style: 'hbar' }, { channel: 'raw:p_R_brake', style: 'hbar' }],
    layout: { steering: false, suspension: false },
  },
  {
    id: 'fluids-fuel', name: 'Fluids & Fuel',
    description: 'Fuel level, flow meters, totals, temperature probes',
    charts: [
      { title: 'FUEL LEVEL', channels: ['fuel'] },
      { title: 'FLOW RATE', channels: ['raw:rate_lpm_1', 'raw:rate_lpm_2'] },
      { title: 'TOTAL VOLUME', channels: ['raw:total_volume_l_1', 'raw:total_volume_l_2'] },
      { title: 'TEMPERATURE PROBES', channels: ['raw:temp_c_1', 'raw:temp_c_2', 'raw:temp_c_3', 'raw:temp_c_4'] },
    ],
    gauges: [{ channel: 'fuel', style: 'dial' }, { channel: 'raw:rate_lpm_1', style: 'hbar' }],
    layout: { steering: false, suspension: false },
  },
  {
    id: 'loads', name: 'Loads & Pots',
    description: 'Strain gauges and the 0x3B0 pots',
    charts: [
      { title: 'STRAIN GAUGES', channels: ['raw:FL_SG', 'raw:FR_SG', 'raw:RL_SG', 'raw:RR_SG'] },
      { title: 'POTS', channels: ['raw:MLPOT', 'raw:MRPOT', 'raw:BLPOT', 'raw:BMPOT', 'raw:BRPOT'] },
    ],
    gauges: [{ channel: 'raw:FL_SG', style: 'hbar' }, { channel: 'raw:FR_SG', style: 'hbar' }],
    layout: { steering: false, suspension: false },
  },
  {
    id: 'blank', name: 'Blank',
    description: 'Empty: build your own by dragging channels onto the chart area',
    charts: [],
    gauges: [{ channel: 'rpm', style: 'dial', warnAt: 6800, dangerAt: 7400 }],
    layout: { steering: false, suspension: false },
  },
]

export const PRESET_BY_ID: Record<string, PresetSpec> = Object.fromEntries(PRESETS.map(p => [p.id, p]))

const FALLBACK_COLORS = ['#00ff41', '#ff3333', '#ffff00', '#00ffff', '#4488ff', '#c88bff', '#ff8800', '#33ff99', '#ff6644', '#00ffaa']

/** Chart/gauge layout for a preset. `baseLayout` supplies the flags a preset does not override. */
export function buildPresetData(
  spec: PresetSpec,
  makeTrace: (channel: string) => TraceConfig,
  baseLayout: LayoutFlags,
  widgetOrder: string[],
): ProfileData {
  // Unique per build, so the same preset can be added twice without chart-id clashes.
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const chartOrder: string[] = []
  const chartCfg: ProfileData['chartCfg'] = {}
  spec.charts.forEach((chart, i) => {
    const id = `chart-${spec.id}-${i}-${stamp}`
    const used = new Set<string>()
    const traces = chart.channels.map(channel => {
      const trace = makeTrace(channel)
      if (used.has(trace.color.toLowerCase())) trace.color = FALLBACK_COLORS.find(c => !used.has(c)) ?? trace.color
      used.add(trace.color.toLowerCase())
      const range = chart.ranges?.[channel]
      return range ? { ...trace, min: range[0], max: range[1] } : trace
    })
    chartOrder.push(id)
    chartCfg[id] = { title: chart.title, traces }
  })
  const gauges = spec.gauges.map((g, i) => {
    const base = makeTrace(g.channel)
    return {
      id: `g${i + 1}`, channel: g.channel, style: g.style ?? 'dial', min: base.min, max: base.max,
      warnAt: g.warnAt ?? null, dangerAt: g.dangerAt ?? null,
    }
  })
  return { gauges, layout: { ...baseLayout, ...spec.layout }, widgetOrder: [...widgetOrder], chartOrder, chartCfg, panelSizes: {} }
}
