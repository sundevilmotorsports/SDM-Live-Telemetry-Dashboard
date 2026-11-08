import { useRef, useState, type KeyboardEvent } from 'react'
import { pairWeights, clamp } from '../state/panelSizes'

/**
 * A draggable divider between two panels. It takes no layout space (a zero-size flex item whose
 * hit area straddles the border), so adding one never shifts anything. Drag, use the arrow keys
 * (Shift = bigger steps), or double-click to reset.
 *   axis 'x': a vertical bar that changes widths.   axis 'y': a horizontal bar that changes heights.
 */
interface HandleProps {
  axis: 'x' | 'y'
  label: string
  /** Called at the start of every drag/key step, with the handle's wrapper (to measure neighbours). */
  onStart: (wrapper: HTMLElement) => void
  /** Total movement since onStart, in px (positive = right/down). */
  onDelta: (deltaPx: number) => void
  onReset?: () => void
  /** Draw a faint divider line even when idle (omit where the neighbours already have borders). */
  line?: boolean
}

export function ResizeHandle({ axis, label, onStart, onDelta, onReset, line = false }: HandleProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ start: number; pending: number; raf: number | null } | null>(null)
  const [hot, setHot] = useState(false)
  const [active, setActive] = useState(false)
  const x = axis === 'x'
  const pos = (e: { clientX: number; clientY: number }) => (x ? e.clientX : e.clientY)

  const flush = () => {
    const d = drag.current
    if (!d) return
    if (d.raf !== null) cancelAnimationFrame(d.raf)
    d.raf = null
    onDelta(d.pending)
  }
  const end = () => {
    if (!drag.current) return
    flush()
    drag.current = null
    setActive(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const keys = x ? { dec: 'ArrowLeft', inc: 'ArrowRight' } : { dec: 'ArrowUp', inc: 'ArrowDown' }
    if (e.key !== keys.dec && e.key !== keys.inc) return
    e.preventDefault()
    const step = e.shiftKey ? 40 : 10
    onStart(wrapRef.current!)
    onDelta(e.key === keys.inc ? step : -step)
  }

  const lit = hot || active
  const thickness = lit ? 2 : 1
  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 0', zIndex: 25, alignSelf: 'stretch', ...(x ? { width: 0 } : { height: 0 }) }}>
      <div role="separator" aria-orientation={x ? 'vertical' : 'horizontal'} aria-label={label} title={`${label} (drag, arrow keys, or double-click to reset)`} tabIndex={0}
        style={{ position: 'absolute', touchAction: 'none', outline: 'none', cursor: x ? 'col-resize' : 'row-resize', ...(x ? { left: -4, width: 8, top: 0, bottom: 0 } : { top: -4, height: 8, left: 0, right: 0 }) }}
        onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)} onFocus={() => setHot(true)} onBlur={() => setHot(false)}
        onKeyDown={onKeyDown}
        onDoubleClick={e => { e.stopPropagation(); onReset?.() }}
        onPointerDown={e => {
          // Chart areas listen for pointer drags (zoom bands, reorder): this one is ours.
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          onStart(wrapRef.current!)
          drag.current = { start: pos(e), pending: 0, raf: null }
          setActive(true)
          document.body.style.cursor = x ? 'col-resize' : 'row-resize'
          document.body.style.userSelect = 'none'
        }}
        onPointerMove={e => {
          const d = drag.current
          if (!d) return
          d.pending = pos(e) - d.start
          if (d.raf === null) d.raf = requestAnimationFrame(() => { d.raf = null; onDelta(d.pending) })
        }}
        onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        <div style={{
          position: 'absolute', pointerEvents: 'none', transition: 'background 0.1s',
          background: lit ? '#4488ff' : line ? '#1e1e1e' : 'transparent',
          ...(x ? { left: 4 - thickness / 2, width: thickness, top: 0, bottom: 0 } : { top: 4 - thickness / 2, height: thickness, left: 0, right: 0 }),
        }} />
      </div>
    </div>
  )
}

/**
 * Divider between two panels that share space by flex weight (the neighbours are the wrapper's
 * previous and next siblings). Moves the boundary and keeps every other panel's size.
 */
export function ResizePair({ axis, label, a, b, onWeights, min = 48, line }: {
  axis: 'x' | 'y'
  label: string
  a: { key: string; weight: number }
  b: { key: string; weight: number }
  /** Number sets a weight, null clears it back to the default. */
  onWeights: (patch: Record<string, number | null>) => void
  min?: number
  line?: boolean
}) {
  const base = useRef<{ aPx: number; bPx: number; wa: number; wb: number } | null>(null)
  const size = (el: Element | null) => {
    const r = el?.getBoundingClientRect()
    return r ? (axis === 'x' ? r.width : r.height) : 0
  }
  return (
    <ResizeHandle axis={axis} label={label} line={line}
      onStart={wrapper => { base.current = { aPx: size(wrapper.previousElementSibling), bPx: size(wrapper.nextElementSibling), wa: a.weight, wb: b.weight } }}
      onDelta={delta => {
        const s = base.current
        if (!s) return
        const [wa, wb] = pairWeights(s.wa, s.wb, s.aPx, s.bPx, delta, min)
        onWeights({ [a.key]: wa, [b.key]: wb })
      }}
      onReset={() => onWeights({ [a.key]: null, [b.key]: null })} />
  )
}

/** Divider that sets one panel's size in px. `direction` -1 when the panel is after the handle (dragging left/up grows it). */
export function ResizePx({ axis, label, current, min, max, direction = 1, onChange, line }: {
  axis: 'x' | 'y'
  label: string
  /** The panel's current size in px (measured on demand when it has no stored size). */
  current: () => number
  min: number
  max: number
  direction?: 1 | -1
  /** A number sets the size, null resets to the default. */
  onChange: (px: number | null) => void
  line?: boolean
}) {
  const start = useRef(0)
  return (
    <ResizeHandle axis={axis} label={label} line={line}
      onStart={() => { start.current = current() }}
      onDelta={delta => onChange(Math.round(clamp(start.current + direction * delta, min, max)))}
      onReset={() => onChange(null)} />
  )
}
