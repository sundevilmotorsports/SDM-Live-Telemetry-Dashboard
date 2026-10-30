import { useRef, useState, ReactNode } from 'react'
import { MONO } from '../telemetry/simulation'

export interface StackItem {
  id: string
  title: string
  weight: number
  node: ReactNode
}

interface DragState { id: string; x: number; y: number; targetIdx: number; side: 'before' | 'after'; offX: number; offY: number; w: number; h: number }

// Reusable VS Code-style dockable vertical stack: grab any `.panel-drag`
// surface inside an item to reorder, with a translucent blue drop region + ghost.
export function DraggableStack({ items, onReorder }: { items: StackItem[]; onReorder: (ids: string[]) => void }) {
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const computeTarget = (y: number): { targetIdx: number; side: 'before' | 'after' } => {
    for (let i = 0; i < items.length; i++) {
      const el = itemRefs.current[items[i].id]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (y < r.bottom || i === items.length - 1) {
        return { targetIdx: i, side: y < r.top + r.height / 2 ? 'before' : 'after' }
      }
    }
    return { targetIdx: items.length - 1, side: 'after' }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('button, input, select, a')) return // keep controls clickable
    if (!t.closest('.panel-drag')) return
    const wrap = t.closest('[data-widx]') as HTMLElement | null
    if (!wrap) return
    const id = wrap.dataset.widx!
    const r = wrap.getBoundingClientRect()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const idx = items.findIndex(it => it.id === id)
    const st: DragState = { id, x: e.clientX, y: e.clientY, targetIdx: idx, side: 'before', offX: e.clientX - r.left, offY: e.clientY - r.top, w: r.width, h: r.height }
    dragRef.current = st
    setDrag(st)
    document.body.style.cursor = 'grabbing'
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { targetIdx, side } = computeTarget(e.clientY)
    const st = { ...dragRef.current, x: e.clientX, y: e.clientY, targetIdx, side }
    dragRef.current = st
    setDrag(st)
  }

  const finishDrag = (commit: boolean) => {
    const d = dragRef.current
    dragRef.current = null
    document.body.style.cursor = ''
    setDrag(null)
    if (!commit || !d) return
    const targetId = items[d.targetIdx]?.id
    if (!targetId || targetId === d.id) return
    const next = items.map(it => it.id).filter(x => x !== d.id)
    let to = next.indexOf(targetId)
    if (d.side === 'after') to += 1
    next.splice(to, 0, d.id)
    onReorder(next)
  }

  const ghostTitle = drag ? items.find(it => it.id === drag.id)?.title ?? '' : ''

  return (
    <div className="flex flex-col h-full" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => finishDrag(true)} onPointerCancel={() => finishDrag(false)}>
      {items.map((it, i) => {
        const isTarget = drag && drag.targetIdx === i && drag.id !== it.id
        return (
          <div
            key={it.id}
            data-widx={it.id}
            ref={el => { itemRefs.current[it.id] = el }}
            style={{
              flex: `${it.weight} 1 0`, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative',
              opacity: drag?.id === it.id ? 0.25 : 1,
              filter: drag?.id === it.id ? 'grayscale(0.6)' : 'none',
              transition: 'opacity 0.12s',
            }}>
            {it.node}
            {isTarget && (
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30, backgroundColor: '#4488ff22', border: '2px solid #4488ff' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, height: 4, backgroundColor: '#4488ff', boxShadow: '0 0 12px #4488ff', ...(drag!.side === 'before' ? { top: 0 } : { bottom: 0 }) }} />
              </div>
            )}
          </div>
        )
      })}

      {drag && (
        <div style={{
          position: 'fixed', left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w,
          height: Math.min(drag.h, 150), pointerEvents: 'none', zIndex: 60,
          backgroundColor: '#141414ee', border: '1.5px solid #4488ff', borderRadius: 6,
          boxShadow: '0 12px 40px #000000cc, 0 0 24px #4488ff44', overflow: 'hidden',
          transform: 'rotate(-1deg)',
        }}>
          <div className="flex items-center gap-2 px-3" style={{ height: 24, backgroundColor: '#4488ff18', borderBottom: '1px solid #4488ff33' }}>
            <svg width="8" height="12" viewBox="0 0 8 12">
              {([0, 4, 8] as number[]).flatMap(y => ([0, 3] as number[]).map(x => <circle key={`${x}-${y}`} cx={x + 1.5} cy={y + 2} r="0.9" fill="#4488ff" />))}
            </svg>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#4488ff', letterSpacing: '0.2em', fontWeight: 700 }}>{ghostTitle}</span>
          </div>
          <div className="flex items-center justify-center flex-1" style={{ height: 'calc(100% - 24px)' }}>
            <span style={{ fontFamily: MONO, fontSize: 8, color: '#3a3a3a', letterSpacing: '0.2em' }}>RELEASE TO DROP</span>
          </div>
        </div>
      )}
    </div>
  )
}
