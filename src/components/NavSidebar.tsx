import { ReactNode } from 'react'
import { MONO } from '../telemetry/simulation'

export type NavId = 'workspace' | 'dash' | 'lap'

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

function NavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} className="flex items-center justify-center rounded transition-all"
      style={{
        width: 36, height: 36, color: active ? '#4488ff' : '#444',
        backgroundColor: active ? '#4488ff18' : 'transparent',
        border: active ? '1px solid #4488ff33' : '1px solid transparent', cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#888' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#444' }}>
      {children}
    </button>
  )
}

export function NavSidebar({ active, onSelect, settingsOpen, onSettings }: {
  active: NavId; onSelect: (id: NavId) => void; settingsOpen: boolean; onSettings: () => void
}) {
  return (
    <div className="flex flex-col items-center border-r border-[#1e1e1e] bg-[#111111]" style={{ width: 48, flexShrink: 0 }}>
      <div className="flex items-center justify-center border-b border-[#1e1e1e]" style={{ height: 28, width: '100%' }}>
        <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #4488ff, #0044cc)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#fff', fontWeight: 700 }}>T</span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 pt-2 w-full px-1">
        {NAV_ITEMS.map(item => (
          <NavButton key={item.id} active={active === item.id} label={item.label} onClick={() => onSelect(item.id)}>{item.icon}</NavButton>
        ))}
        <div style={{ width: 24, height: 1, backgroundColor: '#1e1e1e', margin: '4px 0' }} />
        <NavButton active={settingsOpen} label="Settings" onClick={onSettings}>{SettingsIcon}</NavButton>
      </div>
      <div className="flex-1" />
      <div className="pb-3 flex flex-col items-center gap-0.5">
        <div style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: '#00ff41', boxShadow: '0 0 6px #00ff41' }} />
        <span style={{ fontFamily: MONO, fontSize: 6, color: '#2a2a2a', writingMode: 'vertical-lr', letterSpacing: '0.2em' }}>LIVE</span>
      </div>
    </div>
  )
}
