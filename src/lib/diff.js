// Line-based diff (LCS) with common prefix/suffix trimming. Plenty fast for note-sized text.
export function diffLines(aText, bText) {
  const a = aText.split('\n')
  const b = bText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--
    endB--
  }
  const out = []
  for (let i = 0; i < start; i++) out.push({ t: 'eq', text: a[i] })

  const A = a.slice(start, endA + 1)
  const B = b.slice(start, endB + 1)
  const n = A.length
  const m = B.length

  if (n * m > 4_000_000) {
    A.forEach((l) => out.push({ t: 'del', text: l }))
    B.forEach((l) => out.push({ t: 'add', text: l }))
  } else if (n === 0) {
    B.forEach((l) => out.push({ t: 'add', text: l }))
  } else if (m === 0) {
    A.forEach((l) => out.push({ t: 'del', text: l }))
  } else {
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        out.push({ t: 'eq', text: A[i] })
        i++
        j++
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ t: 'del', text: A[i++] })
      } else {
        out.push({ t: 'add', text: B[j++] })
      }
    }
    while (i < n) out.push({ t: 'del', text: A[i++] })
    while (j < m) out.push({ t: 'add', text: B[j++] })
  }
  for (let i = endA + 1; i < a.length; i++) out.push({ t: 'eq', text: a[i] })
  return out
}

export function diffStats(ops) {
  let add = 0
  let del = 0
  for (const o of ops) {
    if (o.t === 'add') add++
    else if (o.t === 'del') del++
  }
  return { add, del }
}

/** Collapse long unchanged runs, keeping `ctx` lines around changes. */
export function collapseDiff(ops, ctx = 3) {
  const keep = new Array(ops.length).fill(false)
  ops.forEach((o, i) => {
    if (o.t !== 'eq') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true
  })
  const out = []
  let skipped = 0
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (skipped) out.push({ t: 'gap', count: skipped })
      skipped = 0
      out.push(o)
    } else skipped++
  })
  if (skipped) out.push({ t: 'gap', count: skipped })
  return out
}
