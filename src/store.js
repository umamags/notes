import { create } from 'zustand'
import { api } from './api.js'
import { extractLinks, plainText, countWords, lsGet, lsSet, uid, norm } from './lib/util.js'
import { go, currentRoute, openNoteId } from './router.js'
import { parseMarkdownFile } from './lib/exporters.js'

export const DEFAULT_SETTINGS = {
  theme: 'system',
  accent: 'indigo',
  editorFont: 'sans',
  fontSize: 16,
  width: 'normal',
  defaultView: 'write',
  spellcheck: true,
  listSort: 'updated',
}

const CONTENT_KEYS = ['title', 'body', 'clips', 'items']

export const TODO_STATUS = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]
export const TODO_PRIORITY = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

/** Mirrors Store::todoSummary() on the server, for live updates before a save round-trip. */
export function todoSummary(items = []) {
  let open = 0
  let high = 0
  for (const it of items) {
    if (it.status !== 'done') {
      open++
      if (it.priority === 'high') high++
    }
  }
  return { open, total: items.length, high }
}

/** Snippet for list rows: the first few open item titles. */
function todoSnippet(items = []) {
  return items
    .filter((it) => it.status !== 'done' && it.text)
    .slice(0, 3)
    .map((it) => it.text)
    .join(' · ')
}

// non-reactive bookkeeping for saving
const mem = {
  dirty: new Map(),     // id -> Set(keys)
  inflight: new Set(),
  timers: new Map(),
  derive: new Map(),
  rev: new Map(),
  retries: new Map(),
}

function clipSummary(clips) {
  for (const c of clips || []) {
    const t = c.text || c.title || c.caption || c.name
    if (t) return t
  }
  return ''
}

function deriveEntry(prev, note, keys) {
  const e = { ...prev }
  if (keys.has('title')) e.title = note.title
  if (keys.has('tags')) e.tags = note.tags
  if (keys.has('pinned')) e.pinned = note.pinned
  if (keys.has('notebook')) e.notebook = note.notebook
  if (keys.has('type')) e.type = note.type
  if (keys.has('status')) e.status = note.status
  if (keys.has('items')) {
    e.todo = todoSummary(note.items)
    if (note.type === 'todo') e.snippet = todoSnippet(note.items).slice(0, 180)
  }
  if (keys.has('body') || keys.has('clips')) {
    const plain = plainText(note.body || '')
    e.snippet = (plain || clipSummary(note.clips)).slice(0, 180)
    e.words = countWords(plain)
    e.links = extractLinks(note.body || '')
    const kinds = {}
    for (const c of note.clips || []) kinds[c.kind] = (kinds[c.kind] || 0) + 1
    e.clips = kinds
  }
  if (['title', 'body', 'clips', 'items', 'tags', 'source', 'type', 'status'].some((k) => keys.has(k))) e.updated = Date.now()
  return e
}

export function applySettings(s) {
  const root = document.documentElement
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.accent = s.accent
  root.style.setProperty('--editor-size', `${s.fontSize}px`)
  root.dataset.font = s.editorFont
  root.dataset.width = s.width
  lsSet('theme', s.theme)
  lsSet('accent', s.accent)
}

export const useStore = create((set, get) => ({
  ready: false,
  loadError: null,
  notes: {},
  notebooks: [],
  settings: DEFAULT_SETTINGS,
  server: {},
  cache: {},
  sync: {},
  conflicts: {},
  epoch: {},
  loadingNote: {},
  missing: {},
  tabs: lsGet('tabs', []),
  recent: lsGet('recent', []),
  toasts: [],
  progress: '',
  ui: {
    sidebar: lsGet('ui.sidebar', true),
    list: lsGet('ui.list', true),
    inspector: lsGet('ui.inspector', false),
    inspectorTab: lsGet('ui.inspectorTab', 'outline'),
    mode: lsGet('ui.mode', null),
    palette: false,
    paletteQuery: '',
    settings: false,
    shortcuts: false,
    history: null,
    pdfViewer: null,
    mobileSidebar: false,
  },

  // ------------------------------------------------------------------ boot
  async init() {
    try {
      const data = await api.bootstrap()
      const notes = {}
      for (const n of data.notes) notes[n.id] = n
      const settings = { ...DEFAULT_SETTINGS, ...data.settings }
      applySettings(settings)
      set({ notes, notebooks: data.notebooks, settings, server: data.server, ready: true, loadError: null })
    } catch (e) {
      set({ loadError: e.message || 'Could not load', ready: false })
    }
  },

  setProgress(progress) {
    set({ progress })
  },

  setUI(patch) {
    set((s) => ({ ui: { ...s.ui, ...patch } }))
    for (const k of ['sidebar', 'list', 'inspector', 'inspectorTab', 'mode']) if (k in patch) lsSet('ui.' + k, patch[k])
  },

  toast(message, opts = {}) {
    const id = uid(6)
    set((s) => ({ toasts: [...s.toasts, { id, message, ...opts }] }))
    setTimeout(() => get().dismissToast(id), opts.duration || 5000)
    return id
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  // ------------------------------------------------------------------ settings
  updateSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    applySettings(settings)
    clearTimeout(mem.settingsTimer)
    mem.settingsTimer = setTimeout(() => api.saveSettings(settings).catch(() => {}), 400)
  },

  // ------------------------------------------------------------------ notes: loading
  async loadNote(id) {
    const { cache, loadingNote } = get()
    if (cache[id]) return cache[id]
    if (loadingNote[id]) return loadingNote[id]
    const p = api
      .getNote(id)
      .then((note) => {
        mem.rev.set(id, note.rev || 0)
        set((s) => {
          const { [id]: _l, ...rest } = s.loadingNote
          return { cache: { ...s.cache, [id]: note }, loadingNote: rest, sync: { ...s.sync, [id]: 'saved' } }
        })
        return note
      })
      .catch((e) => {
        set((s) => {
          const { [id]: _l, ...rest } = s.loadingNote
          return { loadingNote: rest, missing: e.status === 404 ? { ...s.missing, [id]: true } : s.missing }
        })
        return null
      })
    set((s) => ({ loadingNote: { ...s.loadingNote, [id]: p } }))
    return p
  },

  touchRecent(id) {
    const recent = [id, ...get().recent.filter((x) => x !== id)].slice(0, 60)
    set({ recent })
    lsSet('recent', recent)
  },

  openTab(id) {
    let tabs = get().tabs
    if (tabs.includes(id)) return
    tabs = [...tabs, id]
    if (tabs.length > 10) tabs = tabs.slice(tabs.length - 10)
    set({ tabs })
    lsSet('tabs', tabs)
  },
  closeTab(id, { navigate = true } = {}) {
    const { tabs } = get()
    const i = tabs.indexOf(id)
    const next = tabs.filter((t) => t !== id)
    set({ tabs: next })
    lsSet('tabs', next)
    const route = currentRoute()
    if (navigate && route.noteId === id) {
      const target = next[Math.min(i, next.length - 1)]
      go(route.view, target || null)
    }
  },
  pruneTabs() {
    const { tabs, notes } = get()
    const next = tabs.filter((t) => notes[t] && !notes[t].trashed)
    if (next.length !== tabs.length) {
      set({ tabs: next })
      lsSet('tabs', next)
    }
  },

  // ------------------------------------------------------------------ notes: editing (content = debounced)
  patchNote(id, patch) {
    const cur = get().cache[id]
    if (!cur) return
    const keys = new Set(Object.keys(patch))
    const next = { ...cur, ...patch }
    set((s) => ({ cache: { ...s.cache, [id]: next }, sync: { ...s.sync, [id]: 'dirty' } }))
    const d = mem.dirty.get(id) || new Set()
    keys.forEach((k) => d.add(k))
    mem.dirty.set(id, d)

    const heavy = keys.has('body') || keys.has('clips')
    const light = [...keys].some((k) => k !== 'body' && k !== 'clips')
    const apply = (ks) => set((s) => (s.notes[id] ? { notes: { ...s.notes, [id]: deriveEntry(s.notes[id], s.cache[id] || next, ks) } } : {}))
    if (light) apply(new Set([...keys].filter((k) => k !== 'body' && k !== 'clips')))
    if (heavy) {
      clearTimeout(mem.derive.get(id))
      mem.derive.set(id, setTimeout(() => apply(new Set(['body', 'clips'])), 250))
    }

    clearTimeout(mem.timers.get(id))
    mem.timers.set(id, setTimeout(() => get().flush(id), keys.has('title') ? 900 : 700))
  },

  async flush(id) {
    clearTimeout(mem.timers.get(id))
    const note = get().cache[id]
    if (!note || mem.inflight.has(id)) return
    const keys = mem.dirty.get(id)
    if (!keys || !keys.size) return
    mem.dirty.set(id, new Set())
    const payload = {}
    keys.forEach((k) => (payload[k] = note[k]))
    if (CONTENT_KEYS.some((k) => k in payload)) payload.baseRev = mem.rev.get(id) ?? 0
    mem.inflight.add(id)
    set((s) => ({ sync: { ...s.sync, [id]: 'saving' } }))
    try {
      const res = await api.updateNote(id, payload, { keepalive: JSON.stringify(payload).length < 60000 })
      if (res.rev != null && CONTENT_KEYS.some((k) => k in payload)) mem.rev.set(id, res.rev)
      mem.retries.delete(id)
      set((s) => {
        const patch = {}
        if (s.notes[id]) patch.notes = { ...s.notes, [id]: { ...s.notes[id], updated: res.updated ?? s.notes[id].updated } }
        if (res.touched && res.touched.length) {
          patch.notes = patch.notes || { ...s.notes }
          for (const t of res.touched) if (patch.notes[t.id]) patch.notes[t.id] = { ...patch.notes[t.id], ...t }
        }
        return patch
      })
      for (const t of res.touched || []) {
        if (get().cache[t.id] && !(mem.dirty.get(t.id)?.size)) {
          api.getNote(t.id).then((n) => {
            mem.rev.set(t.id, n.rev || 0)
            set((s) => ({ cache: { ...s.cache, [t.id]: n }, epoch: { ...s.epoch, [t.id]: (s.epoch[t.id] || 0) + 1 } }))
          }).catch(() => {})
        }
      }
    } catch (e) {
      const d = mem.dirty.get(id) || new Set()
      keys.forEach((k) => d.add(k))
      mem.dirty.set(id, d)
      mem.inflight.delete(id)
      if (e.status === 409 && e.data?.note) {
        set((s) => ({ conflicts: { ...s.conflicts, [id]: e.data.note }, sync: { ...s.sync, [id]: 'conflict' } }))
        return
      }
      if (e.status === 404) {
        set((s) => ({ sync: { ...s.sync, [id]: 'error' } }))
        return
      }
      set((s) => ({ sync: { ...s.sync, [id]: 'error' } }))
      const n = (mem.retries.get(id) || 0) + 1
      mem.retries.set(id, n)
      mem.timers.set(id, setTimeout(() => get().flush(id), Math.min(30000, 2000 * n)))
      return
    }
    mem.inflight.delete(id)
    if (mem.dirty.get(id)?.size) get().flush(id)
    else set((s) => ({ sync: { ...s.sync, [id]: 'saved' } }))
  },

  flushAll() {
    for (const id of mem.dirty.keys()) if (mem.dirty.get(id)?.size) get().flush(id)
  },
  hasUnsaved() {
    for (const [id, k] of mem.dirty) if (k.size || mem.inflight.has(id)) return true
    return mem.inflight.size > 0
  },

  resolveConflict(id, choice) {
    const theirs = get().conflicts[id]
    if (!theirs) return
    const { [id]: _c, ...rest } = get().conflicts
    if (choice === 'mine') {
      mem.rev.set(id, theirs.rev || 0)
      set({ conflicts: rest, sync: { ...get().sync, [id]: 'dirty' } })
      get().flush(id)
    } else {
      mem.dirty.set(id, new Set())
      mem.rev.set(id, theirs.rev || 0)
      set((s) => ({
        conflicts: rest,
        cache: { ...s.cache, [id]: theirs },
        epoch: { ...s.epoch, [id]: (s.epoch[id] || 0) + 1 },
        sync: { ...s.sync, [id]: 'saved' },
      }))
    }
  },

  // ------------------------------------------------------------------ notes: metadata (immediate)
  async patchMeta(id, patch) {
    const keys = new Set(Object.keys(patch))
    set((s) => ({
      notes: s.notes[id] ? { ...s.notes, [id]: deriveEntry(s.notes[id], { ...s.notes[id], ...patch }, keys) } : s.notes,
      cache: s.cache[id] ? { ...s.cache, [id]: { ...s.cache[id], ...patch } } : s.cache,
    }))
    try {
      const res = await api.updateNote(id, patch)
      if (res.entry) set((s) => ({ notes: { ...s.notes, [id]: { ...s.notes[id], ...res.entry } } }))
    } catch (e) {
      get().toast('Could not save change: ' + e.message)
    }
  },

  togglePin(id) {
    const n = get().notes[id]
    if (n) get().patchMeta(id, { pinned: !n.pinned })
  },
  moveNote(id, notebook) {
    get().patchMeta(id, { notebook })
  },
  setTags(id, tags) {
    get().patchMeta(id, { tags })
  },

  // ------------------------------------------------------------------ notes: create / delete
  async createNote(opts = {}) {
    const { view } = currentRoute()
    const body = {
      title: opts.title ?? '',
      body: opts.body ?? '',
      type: opts.type ?? 'page',
      notebook: opts.notebook ?? (view.kind === 'notebook' ? view.id : 'inbox'),
      tags: opts.tags ?? (view.kind === 'tag' ? [view.tag] : []),
      clips: opts.clips ?? [],
      status: opts.status ?? (opts.type === 'research' ? 'to-read' : ''),
      source: opts.source,
      pinned: opts.pinned ?? false,
    }
    try {
      const res = await api.createNote(body)
      const note = res.note
      mem.rev.set(note.id, res.entry.rev || 1)
      set((s) => ({
        notes: { ...s.notes, [note.id]: res.entry },
        cache: { ...s.cache, [note.id]: { ...note, rev: res.entry.rev } },
        sync: { ...s.sync, [note.id]: 'saved' },
      }))
      if (opts.open !== false) {
        get().openTab(note.id)
        const v = view.kind === 'home' || view.kind === 'search' ? { kind: opts.notebook ? 'notebook' : 'all', id: opts.notebook } : view
        go(v, note.id)
        get().setUI({ focusTitle: note.id })
      }
      return note.id
    } catch (e) {
      get().toast('Could not create note: ' + e.message)
      return null
    }
  },

  async quickCapture(text) {
    const t = text.trim()
    if (!t) return null
    const lines = t.split('\n')
    let title = lines[0].trim().replace(/^#+\s*/, '')
    let body = lines.slice(1).join('\n').trim()
    if (title.length > 90) {
      body = t
      title = title.slice(0, 80).replace(/\s+\S*$/, '') + '…'
    }
    const id = await get().createNote({ title, body, notebook: 'inbox', open: false, tags: [] })
    if (id) get().toast('Captured to Inbox', { label: 'Open', action: () => openNoteId(id) })
    return id
  },

  async duplicateNote(id) {
    try {
      const res = await api.duplicateNote(id)
      mem.rev.set(res.note.id, res.entry.rev || 1)
      set((s) => ({ notes: { ...s.notes, [res.note.id]: res.entry }, cache: { ...s.cache, [res.note.id]: { ...res.note, rev: res.entry.rev } } }))
      get().openTab(res.note.id)
      openNoteId(res.note.id)
    } catch (e) {
      get().toast('Could not duplicate: ' + e.message)
    }
  },

  async trashNote(id) {
    const { view, noteId } = currentRoute()
    await get().flush(id)
    try {
      const res = await api.deleteNote(id)
      set((s) => ({ notes: { ...s.notes, [id]: res.entry } }))
      get().closeTab(id, { navigate: false })
      if (noteId === id) go(view)
      get().toast('Moved to Trash', { label: 'Undo', action: () => get().restoreNote(id) })
    } catch (e) {
      get().toast('Could not delete: ' + e.message)
    }
  },
  async restoreNote(id) {
    try {
      const res = await api.restoreNote(id)
      set((s) => ({ notes: { ...s.notes, [id]: res.entry }, cache: s.cache[id] ? { ...s.cache, [id]: { ...s.cache[id], trashed: false } } : s.cache }))
      get().toast('Note restored', { label: 'Open', action: () => openNoteId(id) })
    } catch (e) {
      get().toast('Could not restore: ' + e.message)
    }
  },
  async deleteForever(id) {
    const { view, noteId } = currentRoute()
    try {
      await api.deleteNote(id, true)
      set((s) => {
        const { [id]: _n, ...notes } = s.notes
        const { [id]: _c, ...cache } = s.cache
        return { notes, cache }
      })
      get().closeTab(id, { navigate: false })
      if (noteId === id) go(view)
    } catch (e) {
      get().toast('Could not delete: ' + e.message)
    }
  },
  async emptyTrash() {
    try {
      await api.emptyTrash()
      set((s) => {
        const notes = {}
        for (const [k, v] of Object.entries(s.notes)) if (!v.trashed) notes[k] = v
        return { notes }
      })
      const { view } = currentRoute()
      go(view)
      get().toast('Trash emptied')
    } catch (e) {
      get().toast('Could not empty trash: ' + e.message)
    }
  },

  // after server-side replacement (e.g. restore a version)
  replaceNote(note, entry) {
    mem.rev.set(note.id, entry.rev ?? note.rev ?? 0)
    mem.dirty.set(note.id, new Set())
    set((s) => ({
      cache: { ...s.cache, [note.id]: { ...note, rev: entry.rev } },
      notes: { ...s.notes, [note.id]: entry },
      epoch: { ...s.epoch, [note.id]: (s.epoch[note.id] || 0) + 1 },
      sync: { ...s.sync, [note.id]: 'saved' },
    }))
  },

  // ------------------------------------------------------------------ notebooks & tags
  async createNotebook(data) {
    try {
      const res = await api.createNotebook(data)
      set({ notebooks: res.notebooks })
      return res.notebook
    } catch (e) {
      get().toast(e.message)
    }
  },
  async updateNotebook(id, data) {
    try {
      const res = await api.updateNotebook(id, data)
      set({ notebooks: res.notebooks })
    } catch (e) {
      get().toast(e.message)
    }
  },
  async deleteNotebook(id) {
    try {
      const res = await api.deleteNotebook(id)
      set((s) => {
        const notes = { ...s.notes }
        for (const e of res.entries || []) if (notes[e.id]) notes[e.id] = { ...notes[e.id], ...e }
        return { notebooks: res.notebooks, notes }
      })
      const { view, noteId } = currentRoute()
      if (view.kind === 'notebook' && view.id === id) go({ kind: 'all' }, noteId)
      get().toast('Notebook deleted — its notes were moved up one level')
    } catch (e) {
      get().toast(e.message)
    }
  },
  async renameTag(from, to) {
    try {
      const res = await api.renameTag(from, to)
      set((s) => {
        const notes = { ...s.notes }
        for (const e of res.entries) if (notes[e.id]) notes[e.id] = { ...notes[e.id], tags: e.tags }
        const cache = { ...s.cache }
        for (const e of res.entries) if (cache[e.id]) cache[e.id] = { ...cache[e.id], tags: e.tags }
        return { notes, cache }
      })
      const { view, noteId } = currentRoute()
      if (view.kind === 'tag' && view.tag === from) go(to ? { kind: 'tag', tag: to } : { kind: 'all' }, noteId)
    } catch (e) {
      get().toast(e.message)
    }
  },
  deleteTag(tag) {
    return get().renameTag(tag, '')
  },

  setNotesFromServer(notes, notebooks) {
    const map = {}
    for (const n of notes) map[n.id] = n
    set({ notes: map, notebooks: notebooks || get().notebooks, cache: {} })
  },

  // ------------------------------------------------------------------ import
  async importMarkdownFiles(files) {
    const notes = []
    const { view } = currentRoute()
    for (const f of files) {
      const text = await f.text()
      const p = parseMarkdownFile(f.name, text)
      notes.push({ ...p, notebook: view.kind === 'notebook' ? view.id : 'inbox' })
    }
    const res = await api.bulkCreate(notes)
    set((s) => {
      const n = { ...s.notes }
      for (const e of res.entries) n[e.id] = e
      return { notes: n }
    })
    get().toast(`Imported ${res.entries.length} note${res.entries.length === 1 ? '' : 's'}`, res.entries.length === 1 ? { label: 'Open', action: () => openNoteId(res.entries[0].id) } : {})
    return res.entries
  },
}))

// ---------------------------------------------------------------------- derived helpers

export function notebookMap(notebooks) {
  const m = {}
  for (const n of notebooks) m[n.id] = n
  return m
}

export function notebookDescendants(notebooks, id) {
  const ids = [id]
  let changed = true
  while (changed) {
    changed = false
    for (const nb of notebooks) {
      if (nb.parent && ids.includes(nb.parent) && !ids.includes(nb.id)) {
        ids.push(nb.id)
        changed = true
      }
    }
  }
  return ids
}

export function notebookPath(notebooks, id) {
  const m = notebookMap(notebooks)
  const out = []
  let cur = m[id]
  let guard = 0
  while (cur && guard++ < 12) {
    out.unshift(cur)
    cur = cur.parent ? m[cur.parent] : null
  }
  return out
}

export function sortNotes(list, sort, { pinnedFirst = false } = {}) {
  const arr = [...list]
  const cmp =
    sort === 'title'
      ? (a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base' })
      : sort === 'created'
        ? (a, b) => b.created - a.created
        : (a, b) => b.updated - a.updated
  arr.sort((a, b) => (pinnedFirst && a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : cmp(a, b)))
  return arr
}

export function notesForView(notes, view, notebooks) {
  const all = Object.values(notes)
  switch (view.kind) {
    case 'trash':
      return all.filter((n) => n.trashed)
    case 'pinned':
      return all.filter((n) => !n.trashed && n.pinned)
    case 'research':
      return all.filter((n) => !n.trashed && n.type === 'research')
    case 'todos':
      return all.filter((n) => !n.trashed && n.type === 'todo')
    case 'notebook': {
      const ids = new Set(notebookDescendants(notebooks, view.id))
      return all.filter((n) => !n.trashed && ids.has(n.notebook))
    }
    case 'tag':
      return all.filter((n) => !n.trashed && n.tags.some((t) => t === view.tag || t.startsWith(view.tag + '/')))
    default:
      return all.filter((n) => !n.trashed)
  }
}

/** title -> entry resolver for [[wiki links]] */
export function makeResolver(notes) {
  const map = new Map()
  for (const n of Object.values(notes)) {
    if (n.trashed || !n.title) continue
    const k = norm(n.title)
    const cur = map.get(k)
    if (!cur || n.updated > cur.updated) map.set(k, n)
  }
  return (title) => map.get(norm(title)) || null
}

export function viewTitle(view, notebooks) {
  switch (view.kind) {
    case 'all': return 'All notes'
    case 'pinned': return 'Pinned'
    case 'research': return 'Research'
    case 'todos': return 'ToDos'
    case 'trash': return 'Trash'
    case 'tag': return `#${view.tag}`
    case 'search': return 'Search'
    case 'notebook': return notebookMap(notebooks)[view.id]?.name || 'Notebook'
    default: return 'Home'
  }
}
