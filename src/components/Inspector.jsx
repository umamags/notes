import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, FileText, History, Link2, ListTree, Info, Plus, RefreshCw, X } from 'lucide-react'
import { api } from '../api.js'
import { outline } from '../lib/markdown.js'
import { useStore, notebookPath } from '../store.js'
import { openNoteId } from '../router.js'
import { cx, fullDate, readingTime, titleOf, norm, plainText } from '../lib/util.js'
import { Empty, Segmented } from './ui.jsx'
import TagInput from './TagInput.jsx'

export default function Inspector({ note, entry, editorRef, previewRef, mode, onCreateLink }) {
  const tab = useStore((s) => s.ui.inspectorTab)
  const setUI = useStore((s) => s.setUI)
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <Segmented
          size="sm"
          value={tab}
          onChange={(v) => setUI({ inspectorTab: v })}
          options={[
            { value: 'outline', label: 'Outline', icon: <ListTree size={14} /> },
            { value: 'links', label: 'Links', icon: <Link2 size={14} /> },
            { value: 'info', label: 'Info', icon: <Info size={14} /> },
          ]}
        />
        <div className="grow" />
        <button className="icon-btn sm" title="Close panel" onClick={() => setUI({ inspector: false })}>
          <X size={16} />
        </button>
      </div>
      <div className="inspector-body">
        {tab === 'outline' && <OutlineTab note={note} editorRef={editorRef} previewRef={previewRef} mode={mode} />}
        {tab === 'links' && <LinksTab note={note} onCreateLink={onCreateLink} />}
        {tab === 'info' && <InfoTab note={note} entry={entry} />}
      </div>
    </aside>
  )
}

function OutlineTab({ note, editorRef, previewRef, mode }) {
  const items = useMemo(() => outline(note.body), [note.body])
  if (!items.length) return <Empty title="No headings yet">Start a line with <code>#</code> to build an outline you can jump around.</Empty>
  const min = Math.min(...items.map((i) => i.level))
  return (
    <ul className="outline">
      {items.map((h, i) => (
        <li key={i} style={{ paddingLeft: (h.level - min) * 14 }}>
          <button
            className={cx('lvl' + h.level)}
            onClick={() => (mode === 'read' ? previewRef.current?.scrollToHeading(h.text, h.occ) : editorRef.current?.scrollToLine(h.line))}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  )
}

function LinksTab({ note, onCreateLink }) {
  const notes = useStore((s) => s.notes)
  const [data, setData] = useState(null)
  const [mentions, setMentions] = useState(null)
  const [loading, setLoading] = useState(false)

  const key = useMemo(() => {
    const t = norm(note.title)
    if (!t) return ''
    return Object.values(notes)
      .filter((n) => !n.trashed && n.id !== note.id && n.links.some((l) => norm(l) === t))
      .map((n) => n.id)
      .sort()
      .join(',')
  }, [notes, note.title, note.id])

  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setMentions(null)
    setLoading(true)
    const t = setTimeout(() => {
      api.links(note.id).then((d) => alive && setData(d)).catch(() => alive && setData(null)).finally(() => alive && setLoading(false))
    }, 120)
    return () => { alive = false; clearTimeout(t) }
  }, [note.id, key, nonce])

  // outgoing links from the live body (instant), resolved against the index
  const outgoing = useMemo(() => {
    const re = /\[\[([^\[\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g
    const seen = new Map()
    let m
    while ((m = re.exec(note.body || ''))) {
      const t = m[1].trim()
      if (t && !seen.has(norm(t))) seen.set(norm(t), t)
    }
    const byTitle = new Map()
    for (const n of Object.values(notes)) if (!n.trashed && n.title) byTitle.set(norm(n.title), n)
    return [...seen.values()].map((t) => ({ title: t, id: byTitle.get(norm(t))?.id || null }))
  }, [note.body, notes])

  const findMentions = async () => {
    setLoading(true)
    try {
      const d = await api.links(note.id, true)
      setMentions(d.mentions || [])
    } finally {
      setLoading(false)
    }
  }

  const back = data?.backlinks || []
  return (
    <div className="links-tab">
      <section>
        <h4>
          Backlinks <span className="count">{back.length}</span>
          <button className="icon-btn xs" title="Refresh" onClick={() => setNonce((n) => n + 1)}><RefreshCw size={12} className={loading ? 'spin' : ''} /></button>
        </h4>
        {back.length === 0 ? (
          <p className="muted small">No other note links here yet. Type <code>[[{titleOf(note)}]]</code> in another note to connect them.</p>
        ) : (
          back.map((b) => (
            <button key={b.id} className="link-card" onClick={() => openNoteId(b.id)}>
              <span className="lc-title">{b.title || 'Untitled'}</span>
              {b.excerpt && <span className="lc-excerpt">{b.excerpt}</span>}
            </button>
          ))
        )}
      </section>

      <section>
        <h4>Links in this note <span className="count">{outgoing.length}</span></h4>
        {outgoing.length === 0 && <p className="muted small">Type <code>[[</code> to link to another note.</p>}
        {outgoing.map((o) =>
          o.id ? (
            <button key={o.title} className="out-row" onClick={() => openNoteId(o.id)}>
              <ArrowUpRight size={13} /> {o.title}
            </button>
          ) : (
            <div key={o.title} className="out-row ghost">
              <span>{o.title}</span>
              <button className="btn xs" onClick={() => onCreateLink(o.title)}><Plus size={12} /> Create</button>
            </div>
          ),
        )}
      </section>

      <section>
        <h4>Unlinked mentions</h4>
        {mentions == null ? (
          <button className="btn sm" onClick={findMentions} disabled={!note.title.trim()}>Find mentions of this title</button>
        ) : mentions.length === 0 ? (
          <p className="muted small">No other notes mention this title in plain text.</p>
        ) : (
          mentions.map((b) => (
            <button key={b.id} className="link-card" onClick={() => openNoteId(b.id)}>
              <span className="lc-title">{b.title || 'Untitled'}</span>
              {b.excerpt && <span className="lc-excerpt">{b.excerpt}</span>}
            </button>
          ))
        )}
      </section>
    </div>
  )
}

function InfoTab({ note, entry }) {
  const notebooks = useStore((s) => s.notebooks)
  const patchMeta = useStore((s) => s.patchMeta)
  const setUI = useStore((s) => s.setUI)
  const setTags = useStore((s) => s.setTags)
  const words = entry?.words ?? 0
  const chars = useMemo(() => plainText(note.body || '').length, [note.body])
  const clipCounts = note.clips || []
  const path = notebookPath(notebooks, note.notebook).map((n) => n.name).join(' / ')
  return (
    <div className="info-tab">
      <dl>
        <dt>Notebook</dt>
        <dd>
          <select value={note.notebook} onChange={(e) => patchMeta(note.id, { notebook: e.target.value })}>
            {notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>{notebookPath(notebooks, nb.id).map((n) => n.name).join(' / ')}</option>
            ))}
          </select>
        </dd>
        <dt>Tags</dt>
        <dd><TagInput compact tags={note.tags} onChange={(t) => setTags(note.id, t)} /></dd>
        <dt>Type</dt>
        <dd>{note.type === 'research' ? 'Research note' : 'Page'}</dd>
        <dt>Words</dt>
        <dd>{words.toLocaleString()} · {readingTime(words)} min read</dd>
        <dt>Characters</dt>
        <dd>{chars.toLocaleString()}</dd>
        {note.type === 'research' && (
          <>
            <dt>Sources</dt>
            <dd>{clipCounts.length} collected</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{fullDate(note.created)}</dd>
        <dt>Modified</dt>
        <dd>{fullDate(entry?.updated || note.updated)}</dd>
        <dt>Location</dt>
        <dd className="muted">{path}</dd>
      </dl>
      <button className="btn" onClick={() => setUI({ history: note.id })}>
        <History size={15} /> Version history
      </button>
    </div>
  )
}
