import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResizeHandle, ResizePair, ResizePx } from './ResizeHandle'
import { DraggableStack } from './DraggableStack'

const noop = () => {}
const count = (html: string, needle: string) => html.split(needle).length - 1

// Server render: covers structure and accessibility; the pointer math is covered in panelSizes.test.ts.
describe('resize handles', () => {
  it('is a focusable, labelled separator that takes no layout space', () => {
    const html = renderToString(createElement(ResizeHandle, { axis: 'x', label: 'Resize channel list', onStart: noop, onDelta: noop }))
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-label="Resize channel list"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('cursor:col-resize')
    expect(html).toContain('width:0')
    const row = renderToString(createElement(ResizeHandle, { axis: 'y', label: 'Resize warnings', onStart: noop, onDelta: noop }))
    expect(row).toContain('aria-orientation="horizontal"')
    expect(row).toContain('cursor:row-resize')
    expect(row).toContain('height:0')
  })

  it('pair and pixel variants render the same handle', () => {
    expect(renderToString(createElement(ResizePair, { axis: 'y', label: 'A / B', a: { key: 'a', weight: 1 }, b: { key: 'b', weight: 1 }, onWeights: noop }))).toContain('aria-label="A / B"')
    expect(renderToString(createElement(ResizePx, { axis: 'x', label: 'Px', current: () => 100, min: 50, max: 200, onChange: noop }))).toContain('aria-label="Px"')
  })

  it('a stack gets one handle between each pair of neighbours, and none without onWeights', () => {
    const items = ['a', 'b', 'c'].map(id => ({ id, title: id.toUpperCase(), weight: 1, node: createElement('i', null, id) }))
    const withHandles = renderToString(createElement(DraggableStack, { items, onReorder: noop, onWeights: noop }))
    expect(count(withHandles, 'role="separator"')).toBe(2)
    expect(withHandles).toContain('Resize A / B')
    expect(withHandles).toContain('Resize B / C')
    expect(count(renderToString(createElement(DraggableStack, { items, onReorder: noop })), 'role="separator"')).toBe(0)
  })
})
