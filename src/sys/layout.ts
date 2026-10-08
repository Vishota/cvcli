/** Weighted pane tree produced by the layout DSL. */
export type LayoutNode = { kind: 'leaf' } | { kind: 'group'; dir: 'v' | 'h'; children: LayoutChild[] }
export type LayoutChild = { weight: number; node: LayoutNode }

const LEAF: LayoutNode = { kind: 'leaf' }

/**
 * Grammar:
 *   layout := node
 *   node   := ('v'|'h') weights? ('(' layout ')' | node)*
 *   weights:= number (':' number)*     // an empty slot before ':' counts as 1
 *
 * The weights define the panes; a parenthesised child occupies the last
 * slot, plain leaves fill the rest.
 *
 *   v3:1        two panes, 3:1
 *   v1:(h1:2)   left pane, right side split into two rows
 */
export function parseLayout(spec: string): LayoutNode {
  const tokens = tokenizeLayout(spec)
  let pos = 0

  const peek = (): string => tokens[pos] ?? ''

  const node = (): LayoutNode => {
    const head = peek()
    const dir = /^([vh])(.*)$/.exec(head)
    if (!dir) {
      if (!head || head === ')') throw new Error(`layout "${spec}" has no panes`)
      throw new Error(`unexpected token "${head}" in layout "${spec}"`)
    }
    pos++
    const weights = readWeights(dir[2], spec)

    const explicit: LayoutNode[] = []
    while (pos < tokens.length) {
      const token = peek()
      if (token === ')') break
      if (token === '(') {
        pos++
        const inner = node()
        const close = tokens[pos++]
        if (close !== ')') throw new Error(`expected ")" in layout "${spec}"`)
        explicit.push(inner)
      } else if (/^[vh]/.test(token)) {
        explicit.push(node())
      } else {
        throw new Error(`unexpected token "${token}" in layout "${spec}"`)
      }
    }

    const implicit = Math.max(0, weights.length - explicit.length)
    const children: LayoutChild[] = []
    for (let i = 0; i < implicit; i++) children.push({ weight: weights[i] ?? 1, node: LEAF })
    explicit.forEach((child, i) => children.push({ weight: weights[implicit + i] ?? 1, node: child }))
    if (children.length === 0) throw new Error(`layout "${spec}" has no panes`)
    return { kind: 'group', dir: dir[1] as 'v' | 'h', children }
  }

  const result = node()
  if (pos !== tokens.length) throw new Error(`trailing tokens in layout "${spec}"`)
  return result
}

function readWeights(rest: string, spec: string): number[] {
  if (!rest) return []
  return rest.split(':').map((value) => {
    const weight = value === '' ? 1 : Number(value)
    if (!Number.isFinite(weight) || weight <= 0) throw new Error(`bad weight "${value}" in layout "${spec}"`)
    return weight
  })
}

function tokenizeLayout(spec: string): string[] {
  const tokens: string[] = []
  let current = ''
  for (const ch of spec) {
    if (ch === '(' || ch === ')') {
      if (current) {
        tokens.push(current)
        current = ''
      }
      tokens.push(ch)
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

export function countLeaves(node: LayoutNode): number {
  if (node.kind === 'leaf') return 1
  return node.children.reduce((sum, child) => sum + countLeaves(child.node), 0)
}
