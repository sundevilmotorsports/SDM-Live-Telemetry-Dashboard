import { useRef, useState } from 'react'
import { MONO } from '../telemetry/simulation'
import { useConfig } from '../state/ConfigContext'
import { PRESETS } from '../state/profilePresets'
import { MAX_NAME, MAX_PROFILES } from '../state/profiles'

const tabBase = { fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', whiteSpace: 'nowrap' as const, cursor: 'pointer' }
const menuStyle = { position: 'absolute' as const, zIndex: 50, background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 4, boxShadow: '0 12px 40px #000000ee', minWidth: 230, padding: '3px 0' }
const itemStyle = { display: 'flex', flexDirection: 'column' as const, width: '100%', textAlign: 'left' as const, background: 'none', border: 'none', padding: '4px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: 9, color: '#cccccc' }

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w-]+/g, '_') || 'profile'}.sdm-profile.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Whole-screen profiles as tabs, like MoTeC i2 worksheets. The active tab's ⋯ menu manages
 * it; + adds a blank or preset profile, or imports an exported one.
 */
export function ProfileTabs() {
  const cfg = useConfig()
  const [menu, setMenu] = useState<'add' | 'manage' | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const active = cfg.profiles.find(p => p.id === cfg.activeProfileId)
  const canAdd = cfg.profiles.length < MAX_PROFILES
  const close = () => setMenu(null)

  const commitRename = () => {
    if (renaming) cfg.renameProfile(renaming.id, renaming.text)
    setRenaming(null)
  }

  return (
    <div className="relative flex items-stretch border-b border-[#1e1e1e] bg-[#0f0f0f]" style={{ height: 24, flexShrink: 0 }}>
      <div className="flex items-stretch overflow-x-auto" style={{ minWidth: 0 }}>
        {cfg.profiles.map(p => {
          const on = p.id === cfg.activeProfileId
          return renaming?.id === p.id ? (
            <input key={p.id} autoFocus value={renaming.text} maxLength={MAX_NAME} aria-label="Profile name"
              onChange={e => setRenaming({ id: p.id, text: e.target.value })} onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
              style={{ ...tabBase, cursor: 'text', width: 140, margin: '2px 4px', background: '#101010', color: '#fff', border: '1px solid #4488ff', borderRadius: 3, padding: '0 6px' }} />
          ) : (
            <button key={p.id} onClick={() => cfg.switchProfile(p.id)} onDoubleClick={() => setRenaming({ id: p.id, text: p.name })}
              title={on ? 'Active profile (double-click to rename)' : `Switch to ${p.name}`}
              style={{ ...tabBase, padding: '0 12px', background: on ? '#4488ff12' : 'transparent', color: on ? '#4488ff' : '#9f9f9f', border: 'none', borderBottom: `2px solid ${on ? '#4488ff' : 'transparent'}` }}>
              {p.name.toUpperCase()}
            </button>
          )
        })}
      </div>
      <button onClick={() => setMenu(menu === 'manage' ? null : 'manage')} title="Manage this profile" aria-label="Manage this profile"
        style={{ ...tabBase, background: 'none', border: 'none', color: '#989898', padding: '0 8px' }}>⋯</button>
      <button onClick={() => setMenu(menu === 'add' ? null : 'add')} disabled={!canAdd} title={canAdd ? 'Add a profile' : `At most ${MAX_PROFILES} profiles`} aria-label="Add a profile"
        style={{ ...tabBase, background: 'none', border: 'none', color: canAdd ? '#00ff41' : '#898989', padding: '0 8px', cursor: canAdd ? 'pointer' : 'not-allowed' }}>+</button>
      <span className="flex-1" />
      {message && <span style={{ ...tabBase, color: '#ffaa00', alignSelf: 'center', paddingRight: 10 }}>{message}</span>}
      <span style={{ ...tabBase, cursor: 'default', color: '#898989', alignSelf: 'center', paddingRight: 10, fontSize: 7.5 }}>PROFILE = WHOLE-SCREEN LAYOUT · TIME RANGE, MATH, ALERTS AND UNITS ARE SHARED</span>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          const error = cfg.importProfile(await file.text())
          setMessage(error ? `IMPORT FAILED: ${error}` : null)
        }} />

      {menu && <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={close} />}
      {menu === 'add' && (
        <div style={{ ...menuStyle, top: 24, left: 8, maxHeight: 360, overflowY: 'auto' }}>
          <button style={itemStyle} onClick={() => { cfg.addProfile(); close() }}>
            <span>New blank profile</span><span style={{ color: '#989898', fontSize: 8 }}>Empty charts: drag channels in</span>
          </button>
          <div style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '0.2em', color: '#989898', padding: '6px 10px 2px' }}>PRESETS</div>
          {PRESETS.filter(p => p.id !== 'blank').map(p => (
            <button key={p.id} style={itemStyle} className="hover:bg-[#1a1a1a]" onClick={() => { cfg.addProfile(p.id); close() }}>
              <span>{p.name}</span><span style={{ color: '#989898', fontSize: 8, whiteSpace: 'normal' }}>{p.description}</span>
            </button>
          ))}
          <div style={{ borderTop: '1px solid #1e1e1e', marginTop: 3 }} />
          <button style={itemStyle} className="hover:bg-[#1a1a1a]" onClick={() => { close(); fileRef.current?.click() }}>
            <span>Import profile file…</span><span style={{ color: '#989898', fontSize: 8 }}>.sdm-profile.json exported from this dashboard</span>
          </button>
        </div>
      )}
      {menu === 'manage' && active && (
        <div style={{ ...menuStyle, top: 24, left: 8 }}>
          <div style={{ fontFamily: MONO, fontSize: 7, letterSpacing: '0.2em', color: '#989898', padding: '4px 10px 2px' }}>{active.name.toUpperCase()}</div>
          <button style={itemStyle} className="hover:bg-[#1a1a1a]" onClick={() => { setRenaming({ id: active.id, text: active.name }); close() }}>Rename</button>
          <button style={itemStyle} className="hover:bg-[#1a1a1a]" disabled={!canAdd} onClick={() => { cfg.duplicateProfile(); close() }}>Duplicate</button>
          {active.presetId && (
            <button style={itemStyle} className="hover:bg-[#1a1a1a]" onClick={() => { cfg.resetProfileToPreset(); close() }}>
              <span>Reset to preset</span><span style={{ color: '#989898', fontSize: 8 }}>Discards your changes to this profile's layout</span>
            </button>
          )}
          <button style={itemStyle} className="hover:bg-[#1a1a1a]" onClick={() => { cfg.resetPanelSizes(); close() }}>
            <span>Reset panel sizes</span><span style={{ color: '#989898', fontSize: 8 }}>Undo all divider drags in this profile (double-click a divider to reset just one)</span>
          </button>
          <button style={itemStyle} className="hover:bg-[#1a1a1a]" onClick={() => { const text = cfg.exportProfile(active.id); if (text) download(active.name, text); close() }}>Export to file</button>
          <button style={{ ...itemStyle, color: cfg.profiles.length > 1 ? '#ff6644' : '#919191' }} className="hover:bg-[#1a1a1a]" disabled={cfg.profiles.length <= 1}
            onClick={() => { if (window.confirm(`Delete profile "${active.name}"?`)) cfg.deleteProfile(active.id); close() }}>
            <span>Delete</span>{cfg.profiles.length <= 1 && <span style={{ color: '#989898', fontSize: 8 }}>The last profile can't be deleted</span>}
          </button>
        </div>
      )}
    </div>
  )
}
