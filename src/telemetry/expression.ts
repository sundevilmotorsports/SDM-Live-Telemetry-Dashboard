// ── Safe expression evaluator (shunting-yard, no eval) ──────────────────────
// Supports: numbers, channel identifiers, + - * / %, comparisons < > <= >= == !=,
// logical && ||, unary minus, parentheses, and functions abs/min/max/sqrt/round.

type Assoc = 'L' | 'R'
interface Op { prec: number; assoc: Assoc; fn: (a: number, b: number) => number }

const OPS: Record<string, Op> = {
  '||': { prec: 1, assoc: 'L', fn: (a, b) => (a || b ? 1 : 0) },
  '&&': { prec: 2, assoc: 'L', fn: (a, b) => (a && b ? 1 : 0) },
  '==': { prec: 3, assoc: 'L', fn: (a, b) => (a === b ? 1 : 0) },
  '!=': { prec: 3, assoc: 'L', fn: (a, b) => (a !== b ? 1 : 0) },
  '<=': { prec: 4, assoc: 'L', fn: (a, b) => (a <= b ? 1 : 0) },
  '>=': { prec: 4, assoc: 'L', fn: (a, b) => (a >= b ? 1 : 0) },
  '<': { prec: 4, assoc: 'L', fn: (a, b) => (a < b ? 1 : 0) },
  '>': { prec: 4, assoc: 'L', fn: (a, b) => (a > b ? 1 : 0) },
  '+': { prec: 5, assoc: 'L', fn: (a, b) => a + b },
  '-': { prec: 5, assoc: 'L', fn: (a, b) => a - b },
  '*': { prec: 6, assoc: 'L', fn: (a, b) => a * b },
  '/': { prec: 6, assoc: 'L', fn: (a, b) => a / b },
  '%': { prec: 6, assoc: 'L', fn: (a, b) => a % b },
  'u-': { prec: 7, assoc: 'R', fn: (_a, b) => -b },
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, round: Math.round,
}

type Tok = { type: 'num'; v: number } | { type: 'id'; v: string } | { type: 'op'; v: string }
  | { type: 'lp' } | { type: 'rp' } | { type: 'comma' } | { type: 'func'; v: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  const re = /\s*(\d*\.?\d+|[A-Za-z_]\w*|<=|>=|==|!=|&&|\|\||[-+*/%<>()])/g
  let m: RegExpExecArray | null
  let prev: Tok | undefined
  while ((m = re.exec(src)) !== null) {
    const s = m[1]
    if (/^\d|^\./.test(s)) toks.push(prev = { type: 'num', v: parseFloat(s) })
    else if (/^[A-Za-z_]/.test(s)) {
      if (s in FUNCS) toks.push(prev = { type: 'func', v: s })
      else toks.push(prev = { type: 'id', v: s })
    } else if (s === '(') toks.push(prev = { type: 'lp' })
    else if (s === ')') toks.push(prev = { type: 'rp' })
    else if (s === ',') toks.push(prev = { type: 'comma' })
    else {
      // unary minus detection
      if (s === '-' && (!prev || prev.type === 'op' || prev.type === 'lp' || prev.type === 'comma')) {
        toks.push(prev = { type: 'op', v: 'u-' })
      } else {
        toks.push(prev = { type: 'op', v: s })
      }
    }
  }
  return toks
}

type RPN = Tok[]
const cache = new Map<string, RPN | null>()

function compile(src: string): RPN | null {
  const out: RPN = []
  const stack: Tok[] = []
  let toks: Tok[]
  try { toks = tokenize(src) } catch { return null }
  for (const tk of toks) {
    if (tk.type === 'num' || tk.type === 'id') out.push(tk)
    else if (tk.type === 'func') stack.push(tk)
    else if (tk.type === 'comma') {
      while (stack.length && stack[stack.length - 1].type !== 'lp') out.push(stack.pop()!)
    } else if (tk.type === 'op') {
      const o1 = OPS[tk.v]
      if (!o1) return null
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.type === 'op' && OPS[top.v] &&
          (OPS[top.v].prec > o1.prec || (OPS[top.v].prec === o1.prec && o1.assoc === 'L'))) {
          out.push(stack.pop()!)
        } else break
      }
      stack.push(tk)
    } else if (tk.type === 'lp') stack.push(tk)
    else if (tk.type === 'rp') {
      while (stack.length && stack[stack.length - 1].type !== 'lp') out.push(stack.pop()!)
      if (!stack.length) return null
      stack.pop() // remove '('
      if (stack.length && stack[stack.length - 1].type === 'func') out.push(stack.pop()!)
    }
  }
  while (stack.length) {
    const t = stack.pop()!
    if (t.type === 'lp' || t.type === 'rp') return null
    out.push(t)
  }
  return out
}

export function isValidExpr(src: string): boolean {
  if (!src.trim()) return false
  if (!cache.has(src)) cache.set(src, compile(src))
  return cache.get(src) !== null
}

export function evalExpr(src: string, scope: Record<string, number>): number {
  if (!cache.has(src)) cache.set(src, compile(src))
  const rpn = cache.get(src)
  if (!rpn) return NaN
  const st: number[] = []
  for (const tk of rpn) {
    if (tk.type === 'num') st.push(tk.v)
    else if (tk.type === 'id') st.push(tk.v in scope ? scope[tk.v] : NaN)
    else if (tk.type === 'func') {
      const fn = FUNCS[tk.v]
      // funcs here are 1-arg by default; min/max may take 2 — grab up to 2 if available
      if (tk.v === 'min' || tk.v === 'max') {
        const b = st.pop() ?? NaN, a = st.pop() ?? NaN
        st.push(fn(a, b))
      } else {
        const a = st.pop() ?? NaN
        st.push(fn(a))
      }
    } else if (tk.type === 'op') {
      const op = OPS[tk.v]
      if (tk.v === 'u-') { const b = st.pop() ?? NaN; st.push(-b) }
      else { const b = st.pop() ?? NaN, a = st.pop() ?? NaN; st.push(op.fn(a, b)) }
    }
  }
  return st.length ? st[st.length - 1] : NaN
}
