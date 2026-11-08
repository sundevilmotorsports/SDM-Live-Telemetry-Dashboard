import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfigProvider } from '../state/ConfigContext'
import { ProfileTabs } from './ProfileTabs'

// Smoke test of the real provider + component (server render; no browser APIs needed).
describe('ProfileTabs', () => {
  it('renders the default profile as the active tab with add/manage controls', () => {
    const html = renderToString(createElement(ConfigProvider, null, createElement(ProfileTabs)))
    expect(html).toContain('MAIN')
    expect(html).toContain('Add a profile')
    expect(html).toContain('Manage this profile')
    expect(html).toContain('WHOLE-SCREEN LAYOUT')
  })
})
