import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Command, CornerDownLeft, FilePlus2, FileText, FileUp, Folder, Hash, Home as HomeIcon, Inbox, Library, ListTodo, Moon, PanelLeft, PanelRight, Pencil, Pin, Search, Settings as SettingsIcon, Sun,
  Trash2, Eye, Columns2, Keyboard, History, Download, Zap, Monitor, ArrowRight,
} from 'lucide-react'
import { api } from '../api.js'
import { useStore, notebookPath } from '../store.js'
import { go, openNoteId, currentRoute } from '../router.js'
import { cx, debounce, fuzzy, modKey, relTime, titleOf } from '../lib/util.js'
import { Highlight } from './ui.jsx'
import { importFiles, pickFiles } from '../actions.js'
import { exportAllUrl, triggerDownload } from '../lib/exporters.js'

function Title({ text, idx }) {
  if (!idx || !idx.length) return <>{text}</>
  const set = new Set(idx)
  const chars = Array.from(text)
  const out = []
  let run = ''
  let inMark = false
  chars.forEach((c, i) => {
    const m = set.has(i)
    if (m !== inMark && run) {
      out.push(inMark ? <mark key={i}>{run}</mark> : run)
      run = ''
    }
    inMark = m
    run += c
  })
  if (run) out.push(inMark ? <mark key="last">{run}</mark> : run)
  return <>{out}</>
}

export function useCommands() {
  const s = useStore.getState
  return () => {
    const st = s()
    const { noteId, view } = currentRoute()
    const note = noteId ? st.notes[noteId] : null
    const cmds = [
      { id: 'new', label: 'New note', icon: FilePlus2, shortcut: 'Alt N', run: () => st.createNote({}) },
      { id: 'new-research', label: 'New research note', icon: Library, shortcut: 'Alt ⇧ N', run: () => st.createNote({ type: 'research' }) },
      { id: 'new-todo', label: 'New ToDo', icon: ListTodo, run: () => st.createNote({ type: 'todo' }) },
      { id: 'capture', label: 'Quick capture to Inbox', icon: Zap, run: () => go({ kind: 'home' }) },
      { id: 'import-pdf', label: 'Import PDF…', icon: FileUp, run: async () => importFiles(await pickFiles('application/pdf')) },
      { id: 'import-md', label: 'Import Markdown files…', icon: FileText, run: async () => importFiles(await pickFiles('.md,.markdown,.txt')) },
      { id: 'home', label: 'Go to Home', icon: HomeIcon, run: () => go({ kind: 'home' }) },
      { id: 'all', label: 'Go to All notes', icon: Inbox, run: () => go({ kind: 'all' }) },
      { id: 'research', label: 'Go to Research', icon: Library, run: () => go({ kind: 'research' }) },
      { id: 'todos', label: 'Go to ToDos', icon: ListTodo, run: () => go({ kind: 'todos' }) },
      { id: 'pinned', label: 'Go to Pinned', icon: Pin, run: () => go({ kind: 'pinned' }) },
      { id: 'trash', label: 'Go to Trash', icon: Trash2, run: () => go({ kind: 'trash' }) },
      { id: 'search', label: 'Open full search', icon: Search, shortcut: `${modKey} ⇧ F`, run: () => go({ kind: 'search', q: '' }) },
      { id: 'sidebar', label: 'Toggle sidebar', icon: PanelLeft, shortcut: `${modKey} \\`, run: () => st.setUI({ sidebar: !st.ui.sidebar }) },
      { id: 'list', label: 'Toggle note list', icon: PanelLeft, run: () => st.setUI({ list: !st.ui.list }) },
      { id: 'inspector', label: 'Toggle outline & links panel', icon: PanelRight, shortcut: `${modKey} .`, run: () => st.setUI({ inspector: !st.ui.inspector }) },
      { id: 'mode-write', label: 'Editor: write mode', icon: Pencil, run: () => st.setUI({ mode: 'write' }) },
      { id: 'mode-split', label: 'Editor: split view', icon: Columns2, run: () => st.setUI({ mode: 'split' }) },
      { id: 'mode-read', label: 'Editor: read mode', icon: Eye, run: () => st.setUI({ mode: 'read' }) },
      { id: 'theme-light', label: 'Theme: light', icon: Sun, run: () => st.updateSettings({ theme: 'light' }) },
      { id: 'theme-dark', label: 'Theme: dark', icon: Moon, run: () => st.updateSettings({ theme: 'dark' }) },
      { id: 'theme-system', label: 'Theme: match system', icon: Monitor, run: () => st.updateSettings({ theme: 'system' }) },
      { id: 'export', label: 'Export everything as Markdown (.zip)', icon: Download, run: () => triggerDownload(exportAllUrl()) },
      { id: 'settings', label: 'Settings', icon: SettingsIcon, shortcut: `${modKey} ,`, run: () => st.setUI({ settings: true }) },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', run: () => st.setUI({ shortcuts: true }) },
    ]
    if (note && !note.trashed) {
      cmds.unshift(
        { id: 'history', label: `Version history — ${titleOf(note)}`, icon: History, run: () => st.setUI({ history: noteId }) },
        { id: 'pin', label: note.pinned ? 'Unpin this note' : 'Pin this note', icon: Pin, run: () => st.togglePin(noteId) },
        { id: 'trash-note', label: 'Move this note to Trash', icon: Trash2, run: () => st.trashNote(noteId) },
      )
    }
    return cmds
  }
}

export default function Palette({ onClose }) {
  const notes = useStore((s) => s.notes)
  const notebooks = useStore((s) => s.notebooks)
  const recent = useStore((s) => s.recent)
  const initial = useStore((s) => s.ui.paletteQuery)
  const [q, setQ] = useState(initial || '')
  const [active, setActive] = useState(0)
  const [fts, setFts] = useState({ q: '', results: [] })
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const getCommands = useCommands()
  const nbs = useMemo(() => Object.fromEntries(notebooks.map((n) => [n.id, n])), [notebooks])

  useEffect(() => inputRef.current?.focus(), [])

  const commandMode = q.startsWith('>')
  const query = commandMode ? q.slice(1).trim() : q.trim()

  // debounced full-text search against the server
  const runFts = useMemo(
    () =>
      debounce((text) => {
        api.search(text, 8).then((d) => setFts({ q: text, results: d.results })).catch(() => {})
      }, 160),
    [],
  )
  useEffect(() => {
    if (commandMode || query.length < 2) { setFts({ q: '', results: [] }); return }
    runFts(query)
    return () => runFts.cancel()
  }, [query, commandMode, runFts])

  const rows = useMemo(() => {
    const out = []
    const live = Object.values(notes).filter((n) => !n.trashed)
    const commands = getCommands()
    const noteRow = (n, extra = {}) => ({ type: 'note', id: 'n:' + n.id, note: n, ...extra })

    if (commandMode) {
      const items = query ? commands.map((c) => ({ c, f: fuzzy(query, c.label) })).filter((x) => x.f).sort((a, b) => b.f.score - a.f.score) : commands.map((c) => ({ c, f: { idx: [] } }))
      items.forEach(({ c, f }) => out.push({ type: 'command', id: 'c:' + c.id, cmd: c, idx: f.idx }))
      return out
    }

    if (!query) {
      const seen = new Set()
      const rec = []
      for (const id of recent) {
        const n = notes[id]
        if (n && !n.trashed && !seen.has(id)) { rec.push(n); seen.add(id) }
        if (rec.length >= 6) break
      }
      for (const n of [...live].sort((a, b) => b.updated - a.updated)) {
        if (rec.length >= 8) break
        if (!seen.has(n.id)) { rec.push(n); seen.add(n.id) }
      }
      if (rec.length) out.push({ type: 'header', id: 'h:recent', label: 'Recent' })
      rec.forEach((n) => out.push(noteRow(n)))
      out.push({ type: 'header', id: 'h:actions', label: 'Actions' })
      commands.slice(0, 5).forEach((c) => out.push({ type: 'command', id: 'c:' + c.id, cmd: c, idx: [] }))
      return out
    }

    if (query.startsWith('#')) {
      const tq = query.slice(1)
      const tagMap = {}
      for (const n of live) for (const t of n.tags) tagMap[t] = (tagMap[t] || 0) + 1
      Object.entries(tagMap)
        .map(([t, c]) => ({ t, c, f: fuzzy(tq, t) }))
        .filter((x) => x.f)
        .sort((a, b) => b.f.score - a.f.score || b.c - a.c)
        .slice(0, 10)
        .forEach((x) => out.push({ type: 'tag', id: 't:' + x.t, tag: x.t, count: x.c, idx: x.f.idx.map((i) => i + 1) }))
      return out
    }

    // 1) title matches (instant, client-side)
    const titleHits = live
      .map((n) => {
        const f = fuzzy(query, titleOf(n))
        return f ? { n, f } : null
      })
      .filter(Boolean)
      .sort((a, b) => b.f.score - a.f.score || b.n.updated - a.n.updated)
      .slice(0, 8)
    if (titleHits.length) out.push({ type: 'header', id: 'h:notes', label: 'Notes' })
    titleHits.forEach(({ n, f }) => out.push(noteRow(n, { idx: f.idx })))
    const seen = new Set(titleHits.map((x) => x.n.id))

    // 2) notebooks & tags
    const nbHits = notebooks
      .map((nb) => ({ nb, f: fuzzy(query, nb.name) }))
      .filter((x) => x.f)
      .sort((a, b) => b.f.score - a.f.score)
      .slice(0, 3)
    nbHits.forEach(({ nb, f }) => out.push({ type: 'notebook', id: 'nb:' + nb.id, nb, idx: f.idx }))

    // 3) full-text hits from the server (body / sources / PDFs)
    if (fts.q === query) {
      const extra = fts.results.filter((r) => !seen.has(r.id) && notes[r.id])
      if (extra.length) out.push({ type: 'header', id: 'h:fts', label: 'In note text, sources & PDFs' })
      extra.forEach((r) => out.push({ type: 'fts', id: 'f:' + r.id, note: notes[r.id], r }))
    }

    out.push({ type: 'searchAll', id: 'search-all' })

    const cmdHits = commands
      .map((c) => ({ c, f: fuzzy(query, c.label) }))
      .filter((x) => x.f && query.length > 1)
      .sort((a, b) => b.f.score - a.f.score)
      .slice(0, 3)
    if (cmdHits.length) out.push({ type: 'header', id: 'h:cmd', label: 'Commands' })
    cmdHits.forEach(({ c, f }) => out.push({ type: 'command', id: 'c:' + c.id, cmd: c, idx: f.idx }))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, notebooks, recent, query, commandMode, fts])

  const selectable = rows.map((r, i) => (r.type === 'header' ? -1 : i)).filter((i) => i >= 0)
  useEffect(() => setActive(selectable[0] ?? 0), [query, commandMode]) // eslint-disable-line

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, rows])

  const run = (row, e) => {
    if (!row) return
    onClose()
    switch (row.type) {
      case 'note':
      case 'fts':
        openNoteId(row.note.id)
        break
      case 'notebook':
        go({ kind: 'notebook', id: row.nb.id })
        break
      case 'tag':
        go({ kind: 'tag', tag: row.tag })
        break
      case 'searchAll':
        go({ kind: 'search', q: query })
        break
      case 'command':
        setTimeout(() => row.cmd.run(), 0)
        break
      default:
    }
  }

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'n' || e.key === 'p' || e.key === 'j' || e.key === 'k'))) {
      e.preventDefault()
      const down = e.key === 'ArrowDown' || e.key === 'n' || e.key === 'j'
      const cur = selectable.indexOf(active)
      const next = selectable[(cur + (down ? 1 : -1) + selectable.length) % selectable.length]
      setActive(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if ((e.metaKey || e.ctrlKey) && query) {
        onClose()
        go({ kind: 'search', q: query })
      } else run(rows[active], e)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Quick switcher">
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to a note, search everything, or type > for commands"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && <div className="palette-empty">No matches</div>}
          {rows.map((r, i) => {
            if (r.type === 'header') return <div key={r.id} className="palette-header">{r.label}</div>
            const isActive = i === active
            const common = { 'data-active': isActive, onMouseMove: () => setActive(i), onClick: (e) => run(r, e) }
            if (r.type === 'note' || r.type === 'fts') {
              const n = r.note
              const nb = nbs[n.notebook]
              return (
                <div key={r.id} className={cx('palette-row', isActive && 'active')} {...common}>
                  <span className="pr-ico">{n.type === 'research' ? <Library size={16} /> : <FileText size={16} />}</span>
                  <span className="pr-main">
                    <span className="pr-title"><Title text={titleOf(n)} idx={r.idx} /></span>
                    {r.type === 'fts' && <span className="pr-snippet"><Highlight text={r.r.snippet} ranges={r.r.ranges} /></span>}
                  </span>
                  <span className="pr-meta">
                    {nb && <span className="chip nb"><span className={cx('dot', 'c-' + (nb.color || 'slate'))} />{nb.name}</span>}
                    <span className="faint small">{relTime(n.updated)}</span>
                  </span>
                  {isActive && <CornerDownLeft size={14} className="pr-enter" />}
                </div>
              )
            }
            if (r.type === 'notebook') {
              return (
                <div key={r.id} className={cx('palette-row', isActive && 'active')} {...common}>
                  <span className="pr-ico"><Folder size={16} /></span>
                  <span className="pr-main"><span className="pr-title">Notebook: <Title text={r.nb.name} idx={r.idx} /></span></span>
                  <span className="pr-meta faint small">{notebookPath(notebooks, r.nb.id).map((p) => p.name).join(' / ')}</span>
                </div>
              )
            }
            if (r.type === 'tag') {
              return (
                <div key={r.id} className={cx('palette-row', isActive && 'active')} {...common}>
                  <span className="pr-ico"><Hash size={16} /></span>
                  <span className="pr-main"><span className="pr-title"><Title text={'#' + r.tag} idx={r.idx} /></span></span>
                  <span className="pr-meta faint small">{r.count} note{r.count === 1 ? '' : 's'}</span>
                </div>
              )
            }
            if (r.type === 'searchAll') {
              return (
                <div key={r.id} className={cx('palette-row', isActive && 'active')} {...common}>
                  <span className="pr-ico"><Search size={16} /></span>
                  <span className="pr-main"><span className="pr-title">Search everything for “{query}”</span></span>
                  <span className="pr-meta faint small"><kbd className="kbd">{modKey} ↵</kbd></span>
                </div>
              )
            }
            const Icon = r.cmd.icon || Command
            return (
              <div key={r.id} className={cx('palette-row', isActive && 'active')} {...common}>
                <span className="pr-ico"><Icon size={16} /></span>
                <span className="pr-main"><span className="pr-title"><Title text={r.cmd.label} idx={r.idx} /></span></span>
                {r.cmd.shortcut && <span className="pr-meta"><kbd className="kbd">{r.cmd.shortcut}</kbd></span>}
              </div>
            )
          })}
        </div>
        <div className="palette-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          <span><kbd className="kbd">&gt;</kbd> commands</span>
          <span><kbd className="kbd">#</kbd> tags</span>
        </div>
      </div>
    </div>
  )
}
