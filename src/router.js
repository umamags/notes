import { useSyncExternalStore } from 'react'

// Hash routes:  #/home   #/all/n/<id>   #/notebook/<nid>/n/<id>   #/tag/<tag>   #/pinned   #/research   #/trash   #/search/<q>
export function parseHash(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return p
    }
  })
  let view = { kind: 'home' }
  let i = 1
  switch (parts[0]) {
    case 'all':
    case 'pinned':
    case 'research':
    case 'trash':
      view = { kind: parts[0] }
      break
    case 'notebook':
      view = { kind: 'notebook', id: parts[1] || '' }
      i = 2
      break
    case 'tag':
      view = { kind: 'tag', tag: parts[1] || '' }
      i = 2
      break
    case 'search':
      view = { kind: 'search', q: parts[1] || '' }
      i = 2
      break
    default:
      view = { kind: 'home' }
  }
  const noteId = parts[i] === 'n' && parts[i + 1] ? parts[i + 1] : null
  return { view, noteId }
}

export function hashFor(view, noteId) {
  let h = '#/'
  switch (view.kind) {
    case 'home': h += 'home'; break
    case 'notebook': h += `notebook/${encodeURIComponent(view.id)}`; break
    case 'tag': h += `tag/${encodeURIComponent(view.tag)}`; break
    case 'search': h += `search/${encodeURIComponent(view.q || '')}`; break
    default: h += view.kind
  }
  if (noteId) h += `/n/${noteId}`
  return h
}

let cached = { hash: null, value: null }
function snapshot() {
  const hash = window.location.hash
  if (cached.hash !== hash) cached = { hash, value: parseHash(hash) }
  return cached.value
}
function subscribe(cb) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function currentRoute() {
  return snapshot()
}

export function go(view, noteId = null, { replace = false } = {}) {
  const h = hashFor(view, noteId)
  if (replace) window.history.replaceState(null, '', h) || window.dispatchEvent(new HashChangeEvent('hashchange'))
  else window.location.hash = h
}

/** Open a note while keeping the current list context (or falling back to "all"). */
export function openNoteId(id, opts) {
  const { view } = currentRoute()
  go(view.kind === 'home' ? { kind: 'all' } : view, id, opts)
}

export function closeNote() {
  const { view } = currentRoute()
  go(view)
}
