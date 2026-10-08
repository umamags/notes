export const cx = (...a) => a.filter(Boolean).join(' ')

export const norm = (s) => (s || '').trim().toLowerCase()
export const titleOf = (n) => (n && n.title && n.title.trim()) || 'Untitled'

export function debounce(fn, ms) {
  let t
  const d = (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
  d.cancel = () => clearTimeout(t)
  d.flush = (...args) => {
    clearTimeout(t)
    fn(...args)
  }
  return d
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function relTime(ms) {
  if (!ms) return ''
  const now = Date.now()
  const diff = now - ms
  if (diff < 45e3) return 'Just now'
  if (diff < 3600e3) return `${Math.max(1, Math.round(diff / 60e3))}m ago`
  const d = new Date(ms)
  const today = startOfDay(new Date())
  if (ms >= today) return `${Math.round(diff / 3600e3)}h ago`
  if (ms >= today - 86400e3) return 'Yesterday'
  if (ms >= today - 6 * 86400e3) return DAYS[d.getDay()]
  if (d.getFullYear() === new Date().getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export function fullDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

export function dayGroup(ms) {
  const today = startOfDay(new Date())
  if (ms >= today) return 'Today'
  if (ms >= today - 86400e3) return 'Yesterday'
  if (ms >= today - 6 * 86400e3) return 'Earlier this week'
  if (ms >= today - 30 * 86400e3) return 'Earlier this month'
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function todayLabel() {
  const d = new Date()
  const long = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return `${long[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function fmtBytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export const readingTime = (words) => Math.max(1, Math.round(words / 220))

/** Subsequence fuzzy matcher with word-boundary bonuses. Returns null or {score, idx[]} */
export function fuzzy(query, text) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return { score: 0, idx: [] }
  const exact = t.indexOf(q)
  if (exact >= 0) {
    const idx = Array.from({ length: q.length }, (_, i) => exact + i)
    return { score: 100 - exact * 0.5 + (exact === 0 ? 30 : 0) - t.length * 0.05, idx }
  }
  let ti = 0
  let score = 0
  let last = -2
  const idx = []
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    if (c === ' ') continue
    let found = -1
    while (ti < t.length) {
      if (t[ti] === c) { found = ti; break }
      ti++
    }
    if (found < 0) return null
    idx.push(found)
    score += 1
    if (found === last + 1) score += 3
    if (found === 0 || /[\s\-_/:.]/.test(t[found - 1])) score += 4
    last = found
    ti = found + 1
  }
  return { score: score - t.length * 0.02, idx }
}

// ---- lightweight text helpers mirroring the server so the list updates instantly while typing

export function stripCode(md) {
  return md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '')
}

export function extractLinks(md) {
  const out = new Map()
  const re = /\[\[([^\[\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g
  let m
  const clean = stripCode(md)
  while ((m = re.exec(clean))) {
    const t = m[1].trim()
    if (t) out.set(t.toLowerCase(), t)
  }
  return [...out.values()]
}

export function plainText(md) {
  return md
    .replace(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm, '$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]#]+)(#[^\]]*)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const countWords = (plain) => (plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length

export function isUrl(s) {
  return /^(https?:\/\/)[^\s]+$/i.test((s || '').trim())
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function uid(n = 8) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(n))
  for (let i = 0; i < n; i++) s += a[r[i] % 36]
  return s
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const safeFile = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled'

export function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem('folio.' + key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
export function lsSet(key, value) {
  try {
    localStorage.setItem('folio.' + key, JSON.stringify(value))
  } catch {
    /* ignore quota errors */
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
