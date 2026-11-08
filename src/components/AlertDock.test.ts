import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfigProvider } from '../state/ConfigContext'
import TelemetryAlerts, { AlertCard, AlertDock } from './TelemetryAlerts'
import { DENSITIES, DENSITY_SPEC } from '../telemetry/alertLayout'

// Server render: effects do not run, so this covers the idle dock (the live event flow is covered in alerts.test.ts).
describe('AlertDock', () => {
  it('takes no space when there are no warnings', () => {
    expect(renderToString(createElement(ConfigProvider, null, createElement(TelemetryAlerts, { alerts: [], sessionTime: 0 }, createElement(AlertDock))))).toBe('')
  })
})

describe('AlertCard formats', () => {
  const event = { id: 'a', severity: 'danger' as const, message: 'COOLANT TEMP CRITICAL', channels: [], startedAt: 1000, sessionTime: 75 }
  // React's server renderer separates adjacent text nodes with <!-- -->; strip it to match visible text.
  const card = (density: (typeof DENSITIES)[number]) => renderToString(createElement(AlertCard, { event, density, now: 6000, dismiss: () => {} })).replace(/<!-- -->/g, '')

  it('every format still shows the message, a dismiss button, and the full text in the tooltip', () => {
    for (const density of DENSITIES) {
      const html = card(density)
      expect(html, density).toContain('COOLANT TEMP CRITICAL')
      expect(html, density).toContain('aria-label="Dismiss COOLANT TEMP CRITICAL"')
      expect(html, density).toContain('title="⚠ CRITICAL · COOLANT TEMP CRITICAL · at 01:15 · elapsed 00:05"')
      expect(html, density).toContain(`height:${DENSITY_SPEC[density].cardH}px`)
      expect(html, density).toContain('text-overflow:ellipsis') // text shortens instead of being cut off mid-row
    }
  })

  // Visible text only (tags and tooltip attributes removed).
  const visible = (density: (typeof DENSITIES)[number]) => card(density).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

  it('elapsed time is visible in every format', () => {
    for (const density of DENSITIES) expect(visible(density), density).toContain('00:05')
  })

  it('drops other detail as the format gets denser', () => {
    expect(visible('full')).toContain('ELAPSED 00:05')
    expect(visible('full')).toContain('AT 01:15')
    expect(visible('compact')).toContain('ELAPSED 00:05')
    expect(visible('line')).not.toContain('ELAPSED')
    expect(visible('line')).toContain('00:05') // elapsed time kept
    expect(visible('chip')).not.toContain('ELAPSED') // no label, but the time itself stays
    expect(visible('chip')).toContain('00:05')
    expect(visible('chip')).toContain('COOLANT TEMP CRITICAL')
  })

  it('marks cleared warnings and pulses only critical live ones', () => {
    const cleared = renderToString(createElement(AlertCard, { event: { ...event, clearedAt: 3000 }, density: 'full', now: 6000, dismiss: () => {} }))
    expect(cleared).toContain('✓ CLEARED')
    expect(cleared).not.toContain('alert-pulse')
    expect(card('full')).toContain('alert-pulse')
    expect(renderToString(createElement(AlertCard, { event: { ...event, severity: 'warn' as const }, density: 'full', now: 6000, dismiss: () => {} }))).not.toContain('alert-pulse')
  })
})
