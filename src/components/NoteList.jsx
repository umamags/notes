import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Check, Copy, Download, FilePlus2, Library, ListTodo, PanelLeftClose, Pin, PinOff, Plus, RotateCcw, Search, Trash2, X, FileText, Image as ImageIcon, Link2, Folder, Quote, ArrowLeft } from 'lucide-react'
import { api } from '../api.js'
import { useStore, notesForView, sortNotes, viewTitle, notebookMap } from '../store.js'
import { go, openNoteId, useRoute } from '../router.js'
import { cx, debounce, fuzzy, relTime, titleOf, modKey } from '../lib/util.js'
import { Empty, Highlight, Menu, useContextMenu } from './ui.jsx'
import { exportMarkdownUrl, triggerDownload } from '../lib/exporters.js'

const ROW_H = 88

function VirtualList({ count, rowHeight, renderRow, scrollToIndex, className, onKeyDown, innerRef }) {
  const ref = useRef(null)
  const [scroll, setScroll] = useState(0)
  const [h, setH] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setH(el.clientHeight)
    const ro = new ResizeObserver(() => setH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return
    const el = ref.current
    if (!el) return
    const top = scrollToIndex * rowHeight
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight
  }, [scrollToIndex, rowHeight])
  const overscan = 6
  const start = Math.max(0, Math.floor(scroll / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scroll + h) / rowHeight) + overscan)
  const rows = []
  for (let i = start; i < end; i++) rows.push(renderRow(i, { position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }))
  return (
    <div
      ref={(el) => {
        ref.current = el
        if (innerRef) innerRef.current = el
      }}
      className={cx('vlist', className)}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: count * rowHeight, position: 'relative' }}>{rows}</div>
    </div>
  )
}

export const NoteRow = memo(function NoteRow({ note, active, nbName, nbColor, showNotebook, style, onOpen, onContext, snippet, ranges, where, trash }) {
  const kinds = note.clips || {}
  return (
    <div
      className={cx('row', active && 'active')}
      style={style}
      draggable={!trash}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-folio-note', note.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onOpen(note.id)}
      onContextMenu={(e) => onContext(e, note)}
      role="option"
      aria-selected={active}
    >
      <div className="row-top">
        {note.pinned && <Pin size={12} className="row-pin" />}
        <span className="row-title">{titleOf(note)}</span>
        <span className="row-time">{relTime(trash ? note.updated : note.updated)}</span>
      </div>
      <div className="row-snippet">
        {where && where !== 'body' && where !== 'meta' && <span className="where">{where}</span>}
        {ranges ? <Highlight text={snippet} ranges={ranges} /> : snippet || <span className="faint">No content yet</span>}
      </div>
      <div className="row-meta">
        {note.type === 'research' && (
          <span className="chip research" title="Research note">
            <Library size={11} /> Research
          </span>
        )}
        {note.type === 'todo' && (
          <span className="chip todo" title="ToDo list">
            <ListTodo size={11} /> {note.todo?.open ?? 0} open
          </span>
        )}
        {showNotebook && nbName && (
          <span className="chip nb">
            <span className={cx('dot', 'c-' + (nbColor || 'slate'))} />
            {nbName}
          </span>
        )}
        {kinds.pdf > 0 && <span className="meta-ico" title={`${kinds.pdf} PDF`}><FileText size={12} />{kinds.pdf}</span>}
        {kinds.image > 0 && <span className="meta-ico" title={`${kinds.image} image`}><ImageIcon size={12} />{kinds.image}</span>}
        {kinds.link > 0 && <span className="meta-ico" title={`${kinds.link} link`}><Link2 size={12} />{kinds.link}</span>}
        {kinds.quote > 0 && <span className="meta-ico" title={`${kinds.quote} quote`}><Quote size={12} />{kinds.quote}</span>}
        {note.tags.slice(0, 3).map((t) => (
          <span key={t} className="chip tag">#{t}</span>
        ))}
        {note.tags.length > 3 && <span className="faint small">+{note.tags.length - 3}</span>}
      </div>
    </div>
  )
})

function useRowActions() {
  const notebooks = useStore((s) => s.notebooks)
  const togglePin = useStore((s) => s.togglePin)
  const moveNote = useStore((s) => s.moveNote)
  const duplicateNote = useStore((s) => s.duplicateNote)
  const trashNote = useStore((s) => s.trashNote)
  const restoreNote = useStore((s) => s.restoreNote)
  const deleteForever = useStore((s) => s.deleteForever)
  const [open, el] = useContextMenu()
  const onContext = useCallback(
    (e, n) => {
      if (n.trashed) {
        open(e, [
          { label: 'Restore', icon: RotateCcw, onClick: () => restoreNote(n.id) },
          { label: 'Delete permanently', icon: Trash2, danger: true, onClick: () => window.confirm('Delete this note permanently? This cannot be undone.') && deleteForever(n.id) },
        ])
        return
      }
      open(e, [
        { label: n.pinned ? 'Unpin' : 'Pin to top', icon: n.pinned ? PinOff : Pin, onClick: () => togglePin(n.id) },
        { label: 'Duplicate', icon: Copy, onClick: () => duplicateNote(n.id) },
        { label: 'Export as Markdown', icon: Download, onClick: () => triggerDownload(exportMarkdownUrl(n.id)) },
        { header: 'Move to notebook' },
        ...notebooks.map((nb) => ({ label: nb.name, swatch: nb.color || 'slate', checked: n.notebook === nb.id, onClick: () => moveNote(n.id, nb.id) })),
        { divider: true },
        { label: 'Move to Trash', icon: Trash2, danger: true, onClick: () => trashNote(n.id) },
      ])
    },
    [notebooks, open, togglePin, moveNote, duplicateNote, trashNote, restoreNote, deleteForever],
  )
  return [onContext, el]
}

const newType = (view) => (view.kind === 'research' ? 'research' : view.kind === 'todos' ? 'todo' : 'page')
const newLabel = (view) => ({ research: 'New research note', todos: 'New ToDo' })[view.kind] || 'New note'

function EmptyFor({ view, filtered }) {
  const createNote = useStore((s) => s.createNote)
  if (filtered) return <Empty icon={<Search size={22} />} title="Nothing matches">Try a different filter.</Empty>
  const map = {
    trash: ['Trash is empty', 'Deleted notes stay here until you empty the trash.'],
    pinned: ['Nothing pinned yet', 'Pin the notes you reach for daily and they will appear here and in the sidebar.'],
    research: ['No research notes yet', 'Research notes collect links, quotes, screenshots and PDFs next to your own writing.'],
    todos: ['No ToDos yet', 'A ToDo is a checklist. Each item has notes, a status and a priority.'],
    tag: ['No notes with this tag', ''],
    notebook: ['This notebook is empty', 'Create a note here, or drag notes onto it from the list.'],
  }
  const [title, text] = map[view.kind] || ['No notes yet', 'Create your first note to get started.']
  return (
    <Empty icon={<FilePlus2 size={22} />} title={title}>
      {text}
      {view.kind !== 'trash' && (
        <div style={{ marginTop: 14 }}>
          <button className="btn primary sm" onClick={() => createNote({ type: newType(view) })}>
            <Plus size={14} /> {newLabel(view)}
          </button>
        </div>
      )}
    </Empty>
  )
}

export default function NoteList({ activeId }) {
  const { view } = useRoute()
  if (view.kind === 'search') return <SearchPane q={view.q} activeId={activeId} />
  return <PlainList view={view} activeId={activeId} />
}

function PlainList({ view, activeId }) {
  const notes = useStore((s) => s.notes)
  const notebooks = useStore((s) => s.notebooks)
  const sort = useStore((s) => s.settings.listSort)
  const updateSettings = useStore((s) => s.updateSettings)
  const createNote = useStore((s) => s.createNote)
  const emptyTrash = useStore((s) => s.emptyTrash)
  const setUI = useStore((s) => s.setUI)
  const [filter, setFilter] = useState('')
  const [onContext, ctxEl] = useRowActions()
  const listRef = useRef(null)
  const nbs = useMemo(() => notebookMap(notebooks), [notebooks])

  useEffect(() => setFilter(''), [view.kind, view.id, view.tag])

  const all = useMemo(() => sortNotes(notesForView(notes, view, notebooks), sort, { pinnedFirst: view.kind !== 'trash' && view.kind !== 'pinned' }), [notes, view, notebooks, sort])
  const items = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return all
    return all
      .map((n) => {
        const f = fuzzy(q, titleOf(n))
        const hit = f ? f.score : n.snippet.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)) ? 0 : null
        return hit == null ? null : { n, s: hit }
      })
      .filter(Boolean)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.n)
  }, [all, filter])

  const idx = items.findIndex((n) => n.id === activeId)
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      const d = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1
      const next = items[Math.max(0, Math.min(items.length - 1, (idx < 0 ? (d > 0 ? -1 : items.length) : idx) + d))]
      if (next) openNoteId(next.id)
    }
  }

  const title = viewTitle(view, notebooks)
  const showNotebook = view.kind !== 'notebook' || notebooks.some((nb) => nb.parent === view.id)
  const sorts = [
    { value: 'updated', label: 'Last edited' },
    { value: 'created', label: 'Date created' },
    { value: 'title', label: 'Title A–Z' },
  ]

  return (
    <section className="listpane">
      <header className="list-head">
        <div className="list-title">
          <button className="icon-btn sm hide-list" title="Hide list" onClick={() => setUI({ list: false })}>
            <PanelLeftClose size={16} />
          </button>
          <h2>{title}</h2>
          <span className="count">{all.length}</span>
          <div className="grow" />
          <Menu align="end" items={sorts.map((s) => ({ label: s.label, checked: sort === s.value, onClick: () => updateSettings({ listSort: s.value }) }))}>
            {({ ref, toggle }) => (
              <button ref={ref} className="icon-btn sm" title="Sort" onClick={toggle}>
                <ArrowDownUp size={15} />
              </button>
            )}
          </Menu>
          {view.kind === 'trash' ? (
            <button className="btn sm" disabled={!all.length} onClick={() => window.confirm('Permanently delete everything in the trash?') && emptyTrash()}>
              Empty
            </button>
          ) : (
            <button className="icon-btn sm accent" title={view.kind === 'todos' ? 'New ToDo' : 'New note (Alt+N)'} onClick={() => createNote({ type: newType(view) })}>
              <Plus size={17} />
            </button>
          )}
        </div>
        <div className="list-filter">
          <Search size={14} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this list…" onKeyDown={(e) => e.key === 'Escape' && setFilter('')} />
          {filter && <button className="icon-btn xs" onClick={() => setFilter('')}><X size={13} /></button>}
        </div>
      </header>
      {items.length === 0 ? (
        <EmptyFor view={view} filtered={!!filter} />
      ) : (
        <VirtualList
          innerRef={listRef}
          count={items.length}
          rowHeight={ROW_H}
          scrollToIndex={idx}
          onKeyDown={onKey}
          renderRow={(i, style) => {
            const n = items[i]
            const nb = nbs[n.notebook]
            return (
              <NoteRow
                key={n.id}
                note={n}
                style={style}
                active={n.id === activeId}
                nbName={nb?.name}
                nbColor={nb?.color}
                showNotebook={showNotebook}
                snippet={n.snippet}
                trash={view.kind === 'trash'}
                onOpen={(id) => {
                  openNoteId(id)
                  listRef.current?.focus({ preventScroll: true })
                }}
                onContext={onContext}
              />
            )
          }}
        />
      )}
      {ctxEl}
    </section>
  )
}

const SEARCH_CHIPS = [
  { label: 'Research', token: 'type:research' },
  { label: 'Pages', token: 'type:page' },
  { label: 'Pinned', token: 'is:pinned' },
  { label: 'Has PDF', token: 'has:pdf' },
  { label: 'Has image', token: 'has:image' },
  { label: 'Has link', token: 'has:link' },
]

function SearchPane({ q, activeId }) {
  const notes = useStore((s) => s.notes)
  const notebooks = useStore((s) => s.notebooks)
  const setUI = useStore((s) => s.setUI)
  const { noteId } = useRoute()
  const [text, setText] = useState(q)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [onContext, ctxEl] = useRowActions()
  const inputRef = useRef(null)
  const nbs = useMemo(() => notebookMap(notebooks), [notebooks])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => setText((t) => (t === q ? t : q)), [q])

  const pushQuery = useMemo(() => debounce((v, nid) => go({ kind: 'search', q: v }, nid, { replace: true }), 220), [])
  useEffect(() => () => pushQuery.cancel(), [pushQuery])

  useEffect(() => {
    const query = q.trim()
    if (!query) { setData(null); setError(''); return }
    const ctl = new AbortController()
    setLoading(true)
    api
      .search(query, 80, ctl.signal)
      .then((d) => { setData(d); setError('') })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => setLoading(false))
    return () => ctl.abort()
  }, [q])

  const toggleToken = (token) => {
    const parts = text.split(/\s+/).filter(Boolean)
    const next = parts.includes(token) ? parts.filter((p) => p !== token) : [...parts, token]
    const v = next.join(' ') + (next.length ? ' ' : '')
    setText(v)
    pushQuery.flush(v.trim(), noteId)
    inputRef.current?.focus()
  }

  const results = (data?.results || []).map((r) => ({ ...r, note: notes[r.id] })).filter((r) => r.note)

  const onKey = (e) => {
    if (!results.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = results.findIndex((r) => r.id === activeId)
      const d = e.key === 'ArrowDown' ? 1 : -1
      const next = results[Math.max(0, Math.min(results.length - 1, (cur < 0 ? (d > 0 ? -1 : results.length) : cur) + d))]
      if (next) openNoteId(next.id)
    }
  }

  return (
    <section className="listpane search">
      <header className="list-head">
        <div className="list-title">
          <button className="icon-btn sm hide-list" title="Hide list" onClick={() => setUI({ list: false })}>
            <PanelLeftClose size={16} />
          </button>
          <h2>Search</h2>
          {data && <span className="count">{data.total}</span>}
          <div className="grow" />
          {loading && <span className="spinner" aria-label="Searching" />}
        </div>
        <div className="list-filter big">
          <Search size={15} />
          <input
            ref={inputRef}
            value={text}
            placeholder="Search notes, sources and PDFs…"
            onChange={(e) => {
              setText(e.target.value)
              pushQuery(e.target.value.trim(), noteId)
            }}
            onKeyDown={onKey}
          />
          {text && <button className="icon-btn xs" onClick={() => { setText(''); pushQuery.flush('', noteId); inputRef.current?.focus() }}><X size={13} /></button>}
        </div>
        <div className="chips-row">
          {SEARCH_CHIPS.map((c) => (
            <button key={c.token} className={cx('chip-btn', text.split(/\s+/).includes(c.token) && 'on')} onClick={() => toggleToken(c.token)}>
              {c.label}
            </button>
          ))}
        </div>
      </header>

      {!q.trim() ? (
        <div className="search-help">
          <h4>Search everything</h4>
          <p className="muted">Titles, note text, tags, collected sources and the full text of imported PDFs.</p>
          <ul>
            <li><code>tag:adr</code> notes with a tag</li>
            <li><code>in:Research</code> inside a notebook</li>
            <li><code>"exact phrase"</code> match words together</li>
            <li><code>-draft</code> exclude a word</li>
            <li><code>is:pinned</code> <code>type:research</code> <code>has:pdf</code></li>
            <li><code>before:2026-01-01</code> <code>after:2026-06-01</code></li>
          </ul>
          <p className="muted small">Tip: <kbd className="kbd">{modKey} K</kbd> opens the quick switcher from anywhere.</p>
        </div>
      ) : error ? (
        <Empty title="Search failed">{error}</Empty>
      ) : data && results.length === 0 ? (
        <Empty icon={<Search size={22} />} title="No results">Nothing matched “{q}”. Check the spelling or loosen a filter.</Empty>
      ) : (
        <div className="results" tabIndex={0} onKeyDown={onKey}>
          {results.map((r) => {
            const nb = nbs[r.note.notebook]
            return (
              <NoteRow
                key={r.id}
                note={r.note}
                active={r.id === activeId}
                nbName={nb?.name}
                nbColor={nb?.color}
                showNotebook
                snippet={r.snippet}
                ranges={r.ranges}
                where={r.where === 'pdf' ? 'PDF' : r.where === 'sources' ? 'Sources' : r.where === 'tags' ? 'Tag' : r.where === 'title' ? '' : ''}
                trash={r.note.trashed}
                onOpen={openNoteId}
                onContext={onContext}
              />
            )
          })}
        </div>
      )}
      {ctxEl}
    </section>
  )
}
