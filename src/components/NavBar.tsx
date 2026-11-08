import { ReactNode } from 'react'
import { MONO } from '../telemetry/simulation'

export type NavId = 'workspace' | 'dash' | 'lap' | 'channels'

const NAV_ITEMS: { id: NavId; label: string; icon: ReactNode }[] = [
  {
    id: 'workspace', label: 'Workspace',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="10" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    id: 'dash', label: 'Driver Dash',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M 9 14 L 9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 9 14 L 13 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
        <path d="M 3.5 13 A 6.5 6.5 0 0 1 14.5 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="9" cy="14" r="1.2" fill="currentColor" />
        {[0, 30, 60, 90, 120, 150].map(deg => {
          const r = ((deg - 150) * Math.PI) / 180
          return <line key={deg} x1={9 + 5.5 * Math.cos(r)} y1={14 + 5.5 * Math.sin(r)} x2={9 + 6.5 * Math.cos(r)} y2={14 + 6.5 * Math.sin(r)} stroke="currentColor" strokeWidth="0.8" />
        })}
      </svg>
    ),
  },
  {
    id: 'lap', label: 'Lap Analysis',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <polyline points="2,13 5,8 8,10 11,5 14,9 16,6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="2" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
      </svg>
    ),
  },
  {
    id: 'channels', label: 'Channels',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="3" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <line x1="2" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1" />
        <line x1="2" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
        <line x1="8" y1="7" x2="8" y2="15" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      </svg>
    ),
  },
]

const SettingsIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.2" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
      const r = (deg * Math.PI) / 180
      return <line key={deg} x1={9 + 3.8 * Math.cos(r)} y1={9 + 3.8 * Math.sin(r)} x2={9 + 5.5 * Math.cos(r)} y2={9 + 5.5 * Math.sin(r)} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    })}
    <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1.2" />
  </svg>
)

function NavTab({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} className="flex items-center gap-1.5 transition-colors"
      style={{
        height: '100%', padding: '0 12px', cursor: 'pointer', background: active ? '#4488ff12' : 'transparent',
        color: active ? '#4488ff' : '#989898', border: 'none', borderBottom: `2px solid ${active ? '#4488ff' : 'transparent'}`,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#b6b6b6' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#989898' }}>
      <span className="flex items-center" style={{ transform: 'scale(0.8)' }}>{children}</span>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.18em', whiteSpace: 'nowrap' }}>{label.toUpperCase()}</span>
    </button>
  )
}

/** Top navigation bar (views on the left, settings on the right), like a desktop analysis app's toolbar. */
export function NavBar({ active, onSelect, settingsOpen, onSettings }: {
  active: NavId; onSelect: (id: NavId) => void; settingsOpen: boolean; onSettings: () => void
}) {
  return (
    <nav className="flex items-stretch border-b border-[#1e1e1e] bg-[#111111]" style={{ height: 28, flexShrink: 0 }}>
      {NAV_ITEMS.map(item => (
        <NavTab key={item.id} active={active === item.id} label={item.label} onClick={() => onSelect(item.id)}>{item.icon}</NavTab>
      ))}
      <div className="flex-1" />
      <NavTab active={settingsOpen} label="Settings" onClick={onSettings}>{SettingsIcon}</NavTab>
    </nav>
  )
}
