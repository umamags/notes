import { useMemo, useRef, useState } from 'react'
import { ArrowRight, FileUp, FilePlus2, Library, PanelLeft, Pin, Search, Zap, Clock, Folder, Hash } from 'lucide-react'
import { useStore, notebookMap, notebookDescendants, notebookPath } from '../store.js'
import { go, openNoteId } from '../router.js'
import { cx, dayGroup, greeting, modKey, relTime, titleOf, todayLabel } from '../lib/util.js'
import { importFiles, pickFiles } from '../actions.js'

function NoteCard({ note, nbName, nbColor, onOpen, compact }) {
  return (
    <button className={cx('card', compact && 'compact')} onClick={() => onOpen(note.id)}>
      <div className="card-top">
        {note.type === 'research' && <Library size={13} className="card-type" />}
        <span className="card-title">{titleOf(note)}</span>
      </div>
      {!compact && <div className="card-snippet">{note.snippet || <span className="faint">No content yet</span>}</div>}
      <div className="card-meta">
        {nbName && (
          <span className="chip nb">
            <span className={cx('dot', 'c-' + (nbColor || 'slate'))} />
            {nbName}
          </span>
        )}
        <span className="faint small">{relTime(note.updated)}</span>
      </div>
    </button>
  )
}

export default function Home() {
  const notes = useStore((s) => s.notes)
  const notebooks = useStore((s) => s.notebooks)
  const recent = useStore((s) => s.recent)
  const createNote = useStore((s) => s.createNote)
  const quickCapture = useStore((s) => s.quickCapture)
  const setUI = useStore((s) => s.setUI)
  const sidebarOpen = useStore((s) => s.ui.sidebar)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const taRef = useRef(null)
  const nbs = useMemo(() => notebookMap(notebooks), [notebooks])

  const data = useMemo(() => {
    const live = Object.values(notes).filter((n) => !n.trashed)
    const byUpdated = [...live].sort((a, b) => b.updated - a.updated)
    const pinned = byUpdated.filter((n) => n.pinned)
    const opened = recent.map((id) => notes[id]).filter((n) => n && !n.trashed).slice(0, 4)
    const groups = []
    for (const n of byUpdated.slice(0, 16)) {
      const g = dayGroup(n.updated)
      const last = groups[groups.length - 1]
      if (last && last.label === g) last.items.push(n)
      else groups.push({ label: g, items: [n] })
    }
    const counts = {}
    for (const n of live) counts[n.notebook] = (counts[n.notebook] || 0) + 1
    const topNotebooks = notebooks
      .map((nb) => ({ nb, count: notebookDescendants(notebooks, nb.id).reduce((a, id) => a + (counts[id] || 0), 0) }))
      .filter((x) => x.count > 0 || !x.nb.system)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
    const tagMap = {}
    for (const n of live) for (const t of n.tags) tagMap[t] = (tagMap[t] || 0) + 1
    const tags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 14)
    const research = live.filter((n) => n.type === 'research' && (n.status === 'to-read' || n.status === 'reading')).sort((a, b) => b.updated - a.updated)
    return { total: live.length, pinned, opened, groups, topNotebooks, tags, research }
  }, [notes, notebooks, recent])

  const capture = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    const id = await quickCapture(text)
    setBusy(false)
    if (id) {
      setText('')
      taRef.current?.focus()
    }
  }

  const open = (id) => openNoteId(id)
  const nameOf = (n) => nbs[n.notebook]?.name
  const colorOf = (n) => nbs[n.notebook]?.color

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          {!sidebarOpen && (
            <button className="icon-btn" title={`Show sidebar (${modKey}+\\)`} onClick={() => setUI({ sidebar: true, mobileSidebar: true })}>
              <PanelLeft size={18} />
            </button>
          )}
          <div>
            <p className="eyebrow">{todayLabel()}</p>
            <h1>{greeting()}</h1>
          </div>
        </header>

        <section className="capture">
          <textarea
            ref={taRef}
            value={text}
            rows={text.includes('\n') ? 4 : 2}
            placeholder="Capture a thought, idea or link…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                capture()
              }
            }}
          />
          <div className="capture-bar">
            <span className="muted small">Saved to your Inbox · first line becomes the title · {modKey}+Enter to save</span>
            <div className="grow" />
            <button className="btn primary sm" disabled={!text.trim() || busy} onClick={capture}>
              <Zap size={14} /> Capture
            </button>
          </div>
        </section>

        <div className="quick-actions">
          <button className="qa" onClick={() => createNote({})}>
            <FilePlus2 size={17} />
            <span>New note</span>
          </button>
          <button className="qa" onClick={() => createNote({ type: 'research' })}>
            <Library size={17} />
            <span>New research note</span>
          </button>
          <button className="qa" onClick={async () => importFiles(await pickFiles('application/pdf'))}>
            <FileUp size={17} />
            <span>Import PDF</span>
          </button>
          <button className="qa" onClick={() => setUI({ palette: true, paletteQuery: '' })}>
            <Search size={17} />
            <span>Search</span>
            <kbd className="kbd">{modKey} K</kbd>
          </button>
        </div>

        {data.total === 0 && (
          <div className="home-empty">
            <h3>A blank page, ready when you are.</h3>
            <p className="muted">Capture something above, or create your first note.</p>
          </div>
        )}

        {data.opened.length > 0 && (
          <section className="home-section">
            <h3><Clock size={15} /> Jump back in</h3>
            <div className="card-grid four">
              {data.opened.map((n) => <NoteCard key={n.id} note={n} compact nbName={nameOf(n)} nbColor={colorOf(n)} onOpen={open} />)}
            </div>
          </section>
        )}

        {data.pinned.length > 0 && (
          <section className="home-section">
            <h3><Pin size={15} /> Pinned</h3>
            <div className="card-grid">
              {data.pinned.slice(0, 6).map((n) => <NoteCard key={n.id} note={n} nbName={nameOf(n)} nbColor={colorOf(n)} onOpen={open} />)}
            </div>
            {data.pinned.length > 6 && <button className="link-btn" onClick={() => go({ kind: 'pinned' })}>See all {data.pinned.length} pinned</button>}
          </section>
        )}

        <div className="home-cols">
          <section className="home-section grow-col">
            <div className="section-title">
              <h3>Recent</h3>
              <button className="link-btn" onClick={() => go({ kind: 'all' })}>All notes <ArrowRight size={13} /></button>
            </div>
            {data.groups.map((g) => (
              <div key={g.label} className="day-group">
                <div className="day-label">{g.label}</div>
                {g.items.map((n) => (
                  <button key={n.id} className="recent-row" onClick={() => open(n.id)}>
                    <span className="recent-ico">{n.type === 'research' ? <Library size={15} /> : <span className="doc-dot" />}</span>
                    <span className="recent-title">{titleOf(n)}</span>
                    <span className="recent-nb">
                      <span className={cx('dot', 'c-' + (colorOf(n) || 'slate'))} />
                      {nameOf(n)}
                    </span>
                    <span className="recent-time">{relTime(n.updated)}</span>
                  </button>
                ))}
              </div>
            ))}
          </section>

          <aside className="home-side">
            {data.research.length > 0 && (
              <section className="home-section">
                <div className="section-title">
                  <h3><Library size={15} /> Reading queue</h3>
                </div>
                {data.research.slice(0, 5).map((n) => (
                  <button key={n.id} className="mini-row" onClick={() => open(n.id)}>
                    <span className={cx('status-dot', n.status)} />
                    <span className="mini-title">{titleOf(n)}</span>
                  </button>
                ))}
                {data.research.length > 5 && <button className="link-btn" onClick={() => go({ kind: 'search', q: 'type:research status:to-read' })}>+{data.research.length - 5} more</button>}
              </section>
            )}

            <section className="home-section">
              <div className="section-title">
                <h3><Folder size={15} /> Notebooks</h3>
              </div>
              {data.topNotebooks.map(({ nb, count }) => (
                <button key={nb.id} className="mini-row" onClick={() => go({ kind: 'notebook', id: nb.id })}>
                  <span className={cx('dot', 'c-' + (nb.color || 'slate'))} />
                  <span className="mini-title">{notebookPath(notebooks, nb.id).map((p) => p.name).join(' / ')}</span>
                  <span className="faint small">{count}</span>
                </button>
              ))}
            </section>

            {data.tags.length > 0 && (
              <section className="home-section">
                <div className="section-title">
                  <h3><Hash size={15} /> Tags</h3>
                </div>
                <div className="tag-cloud">
                  {data.tags.map(([t, c]) => (
                    <button key={t} className="tag" onClick={() => go({ kind: 'tag', tag: t })}>
                      <Hash size={11} />
                      {t}
                      <span className="n">{c}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
