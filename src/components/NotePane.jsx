import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bold, BookOpen, CheckSquare, ChevronRight, Code, Columns2, Copy, Download, ExternalLink, FileText, FileType2, Heading2, History, Italic, Library, Link as LinkIcon, List, ListOrdered,
  MoreHorizontal, PanelLeft, PanelRight, Pencil, Pin, PinOff, Plus, Quote, Image as ImageIcon, RefreshCw, RotateCcw, Trash2, X, Braces, Eye, Printer, FileJson, FileCode2, ArrowRightLeft, Brackets, Files, Strikethrough, ListTodo,
} from 'lucide-react'
import { api, fileUrl } from '../api.js'
import { useStore, makeResolver, notebookPath } from '../store.js'
import { closeNote, go, openNoteId, useRoute, currentRoute } from '../router.js'
import { cx, fullDate, modKey, titleOf, uid, domainOf } from '../lib/util.js'
import { toggleTask, clipsToMarkdown } from '../lib/markdown.js'
import { importPdf } from '../lib/pdf.js'
import { exportHtml, exportJson, exportMarkdownUrl, exportPlain, printNote, triggerDownload } from '../lib/exporters.js'
import Editor from './Editor.jsx'
import Preview from './Preview.jsx'
import Sources from './Sources.jsx'
import Inspector from './Inspector.jsx'
import TodoView from './Todos.jsx'
import TagInput from './TagInput.jsx'
import { Empty, Menu, Modal, Segmented } from './ui.jsx'

const STATUS = [
  { value: '', label: 'No status' },
  { value: 'to-read', label: 'To read' },
  { value: 'reading', label: 'Reading' },
  { value: 'done', label: 'Done' },
]

export default function NotePane({ id, isMobile }) {
  const note = useStore((s) => (id ? s.cache[id] : null))
  const missing = useStore((s) => (id ? s.missing[id] : false))
  const entryExists = useStore((s) => (id ? !!s.notes[id] : false))
  const loadNote = useStore((s) => s.loadNote)
  const openTab = useStore((s) => s.openTab)
  const touchRecent = useStore((s) => s.touchRecent)

  useEffect(() => {
    if (id) loadNote(id)
  }, [id, loadNote])

  useEffect(() => {
    if (id && note) {
      openTab(id)
      touchRecent(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!note])

  if (!id) return <main className="notepane"><Tabs activeId={null} isMobile={isMobile} /><EmptyPane /></main>
  if (missing || (!entryExists && !note)) {
    return (
      <main className="notepane">
        <Tabs activeId={id} isMobile={isMobile} />
        <Empty icon={<FileText size={22} />} title="This note can’t be found">
          It may have been deleted. <button className="link-btn" onClick={() => closeNote()}>Back to the list</button>
        </Empty>
      </main>
    )
  }
  if (!note) {
    return (
      <main className="notepane">
        <Tabs activeId={id} isMobile={isMobile} />
        <div className="skeleton-doc">
          <div className="sk sk-title" />
          <div className="sk" />
          <div className="sk" />
          <div className="sk short" />
        </div>
      </main>
    )
  }
  return <NoteView note={note} isMobile={isMobile} />
}

function EmptyPane() {
  const createNote = useStore((s) => s.createNote)
  const setUI = useStore((s) => s.setUI)
  return (
    <div className="pane-empty">
      <div className="pane-empty-inner">
        <div className="pane-empty-ico"><BookOpen size={26} /></div>
        <h3>Select a note</h3>
        <p className="muted">Pick something from the list, or jump anywhere with the quick switcher.</p>
        <div className="pane-empty-actions">
          <button className="btn primary" onClick={() => createNote({})}><Plus size={15} /> New note</button>
          <button className="btn" onClick={() => setUI({ palette: true, paletteQuery: '' })}>Quick switcher <kbd className="kbd">{modKey} K</kbd></button>
        </div>
      </div>
    </div>
  )
}

function Tabs({ activeId, isMobile }) {
  const tabs = useStore((s) => s.tabs)
  const notes = useStore((s) => s.notes)
  const closeTab = useStore((s) => s.closeTab)
  const createNote = useStore((s) => s.createNote)
  const ui = useStore((s) => s.ui)
  const setUI = useStore((s) => s.setUI)
  if (isMobile) return null
  const items = tabs.filter((t) => notes[t] && !notes[t].trashed)
  return (
    <div className="tabbar">
      {!ui.sidebar && (
        <button className="icon-btn" title={`Show sidebar (${modKey}+\\)`} onClick={() => setUI({ sidebar: true })}>
          <PanelLeft size={17} />
        </button>
      )}
      {!ui.list && (
        <button className="icon-btn" title="Show note list" onClick={() => setUI({ list: true })}>
          <Files size={17} />
        </button>
      )}
      <div className="tabs" role="tablist">
        {items.map((t) => {
          const n = notes[t]
          return (
            <div
              key={t}
              role="tab"
              aria-selected={t === activeId}
              className={cx('tab', t === activeId && 'active')}
              onClick={() => openNoteId(t)}
              onAuxClick={(e) => e.button === 1 && closeTab(t)}
              title={titleOf(n)}
            >
              {n.type === 'research' && <Library size={12} className="tab-ico" />}
              {n.type === 'todo' && <ListTodo size={12} className="tab-ico" />}
              <span className="tab-title">{titleOf(n)}</span>
              <button className="tab-x" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t) }}>
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <button className="icon-btn sm" title="New note (Alt+N)" onClick={() => createNote({})}>
        <Plus size={16} />
      </button>
    </div>
  )
}

function TitleInput({ note, readOnly, onEnter }) {
  const patchNote = useStore((s) => s.patchNote)
  const focusTitle = useStore((s) => s.ui.focusTitle)
  const setUI = useStore((s) => s.setUI)
  const ref = useRef(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useLayoutEffect(fit, [note.title, note.id])
  useEffect(() => {
    if (focusTitle === note.id) {
      ref.current?.focus()
      setUI({ focusTitle: null })
    }
  }, [focusTitle, note.id, setUI])
  useEffect(() => {
    const ro = new ResizeObserver(fit)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return (
    <textarea
      ref={ref}
      className="title-input"
      rows={1}
      value={note.title}
      readOnly={readOnly}
      placeholder="Untitled"
      spellCheck
      onChange={(e) => patchNote(note.id, { title: e.target.value.replace(/\n/g, ' ') })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
          e.preventDefault()
          onEnter()
        }
      }}
    />
  )
}

function FormatBar({ editorRef, onImage }) {
  const b = (title, Icon, fn) => (
    <button key={title} className="fmt-btn" title={title} onMouseDown={(e) => e.preventDefault()} onClick={fn}>
      <Icon size={15} />
    </button>
  )
  const ed = () => editorRef.current
  return (
    <div className="formatbar" role="toolbar" aria-label="Formatting">
      {b(`Heading`, Heading2, () => ed()?.prefix('## ', 'heading'))}
      {b(`Bold (${modKey}+B)`, Bold, () => ed()?.wrap('**'))}
      {b(`Italic (${modKey}+I)`, Italic, () => ed()?.wrap('*'))}
      {b('Strikethrough', Strikethrough, () => ed()?.wrap('~~'))}
      {b('Inline code', Code, () => ed()?.wrap('`'))}
      <span className="fmt-sep" />
      {b('Bulleted list', List, () => ed()?.prefix('- ', 'ul'))}
      {b('Numbered list', ListOrdered, () => ed()?.prefix('1. ', 'ol'))}
      {b('Checklist', CheckSquare, () => ed()?.prefix('- [ ] ', 'task'))}
      {b('Quote', Quote, () => ed()?.prefix('> ', 'quote'))}
      <span className="fmt-sep" />
      {b('Link', LinkIcon, () => ed()?.link())}
      {b('Link to note  [[ ]]', Brackets, () => ed()?.insert('[[') )}
      {b('Insert image', ImageIcon, onImage)}
    </div>
  )
}

function NoteView({ note, isMobile }) {
  const id = note.id
  const { view } = useRoute()
  const notes = useStore((s) => s.notes)
  const entry = useStore((s) => s.notes[id])
  const notebooks = useStore((s) => s.notebooks)
  const settings = useStore((s) => s.settings)
  const ui = useStore((s) => s.ui)
  const sync = useStore((s) => s.sync[id])
  const conflict = useStore((s) => s.conflicts[id])
  const epoch = useStore((s) => s.epoch[id] || 0)
  const patchNote = useStore((s) => s.patchNote)
  const patchMeta = useStore((s) => s.patchMeta)
  const setUI = useStore((s) => s.setUI)
  const toast = useStore((s) => s.toast)
  const createNote = useStore((s) => s.createNote)
  const duplicateNote = useStore((s) => s.duplicateNote)
  const trashNote = useStore((s) => s.trashNote)
  const restoreNote = useStore((s) => s.restoreNote)
  const deleteForever = useStore((s) => s.deleteForever)
  const togglePin = useStore((s) => s.togglePin)
  const resolveConflict = useStore((s) => s.resolveConflict)
  const setProgress = useStore((s) => s.setProgress)
  const setTags = useStore((s) => s.setTags)

  const editorRef = useRef(null)
  const previewRef = useRef(null)
  const imgInput = useRef(null)
  const [tick, setTick] = useState(0)
  const [zoom, setZoom] = useState(null)

  const trashed = !!entry?.trashed
  const mode = trashed ? 'read' : ui.mode || settings.defaultView
  const research = note.type === 'research'
  const todo = note.type === 'todo'
  const resolve = useMemo(() => makeResolver(notes), [notes])
  const path = notebookPath(notebooks, note.notebook)

  const getTitles = useCallback(() => {
    return Object.values(useStore.getState().notes)
      .filter((n) => !n.trashed && n.title && n.id !== id)
      .sort((a, b) => b.updated - a.updated)
      .map((n) => ({ id: n.id, title: n.title, type: n.type }))
  }, [id])

  const setMode = (m) => setUI({ mode: m })

  // body edits that don't originate in the editor (task ticks, "insert into notes")
  const changeBody = (body) => {
    patchNote(id, { body })
    setTick((t) => t + 1)
  }
  const insertIntoBody = (text) => {
    if (mode !== 'read' && editorRef.current) editorRef.current.insert(text)
    else changeBody((note.body || '').replace(/\s*$/, '') + '\n\n' + text.trim() + '\n')
    if (mode === 'read') toast('Added to the end of your notes')
  }

  const createLinked = useCallback(
    (title) => createNote({ title, notebook: note.notebook, open: false }),
    [createNote, note.notebook],
  )

  const handleFiles = async (files) => {
    for (const f of files) {
      try {
        if (f.type.startsWith('image/')) {
          setProgress('Uploading image…')
          const up = await api.upload(f, f.name || 'image.png')
          const alt = /^(image|screenshot|unnamed)/i.test(f.name || 'image') ? '' : (f.name || '').replace(/\.[a-z0-9]+$/i, '')
          insertIntoBody(`\n![${alt}](${fileUrl(up.id)})\n`)
        } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          const res = await importPdf(f, setProgress)
          if (research) {
            patchNote(id, { clips: [{ ...res.clip, id: uid(8), createdAt: Date.now() }, ...(useStore.getState().cache[id].clips || [])] })
            toast(`PDF added to Sources${res.text ? ' and indexed for search' : ''}`)
          } else {
            insertIntoBody(`[📄 ${res.title}](${fileUrl(res.clip.file)})`)
            toast(res.text ? `PDF attached — ${res.clip.pages} pages indexed for search` : 'PDF attached')
          }
        } else {
          toast(`“${f.name}” isn’t supported — attach PDFs or images`)
        }
      } catch (e) {
        toast('Upload failed: ' + e.message)
      }
    }
    setProgress('')
  }

  const followTitle = (title) => {
    const t = resolve(title)
    if (t) openNoteId(t.id)
    else createNote({ title, notebook: note.notebook })
  }

  const syncLabel =
    sync === 'saving' ? 'Saving…' : sync === 'dirty' ? 'Editing…' : sync === 'error' ? 'Offline — retrying' : sync === 'conflict' ? 'Conflict' : `Saved`

  const convert = () => {
    if (research) {
      if (note.clips?.length) {
        if (!window.confirm('Converting to a page will append your collected sources to the note as Markdown. Continue?')) return
        const md = clipsToMarkdown(note.clips)
        patchNote(id, { type: 'page', clips: [], body: (note.body || '').replace(/\s*$/, '') + '\n\n' + md })
        setTick((t) => t + 1)
      } else patchMeta(id, { type: 'page' })
    } else patchMeta(id, { type: 'research', status: note.status || 'to-read' })
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(`[[${note.title}]]`)
    toast('Link copied — paste it into any note')
  }

  const exportItems = [
    { header: 'Export this note' },
    { label: 'Markdown (.md)', icon: FileCode2, onClick: () => triggerDownload(exportMarkdownUrl(id)) },
    { label: 'HTML (.html)', icon: FileType2, onClick: () => exportHtml(note, resolve) },
    { label: 'PDF (print…)', icon: Printer, onClick: () => printNote(note, resolve) },
    { label: 'Plain text (.txt)', icon: FileText, onClick: () => exportPlain(note) },
    { label: 'JSON (.json)', icon: FileJson, onClick: () => exportJson(note) },
  ]

  const moreItems = () => [
    { label: 'Duplicate', icon: Copy, onClick: () => duplicateNote(id) },
    { label: 'Copy link  [[title]]', icon: Brackets, onClick: copyLink },
    ...(todo ? [] : [{ label: research ? 'Convert to page' : 'Convert to research note', icon: ArrowRightLeft, onClick: convert }]),
    { label: 'Version history', icon: History, onClick: () => setUI({ history: id }) },
    { divider: true },
    { header: 'Move to notebook' },
    ...notebooks.map((nb) => ({ label: notebookPath(notebooks, nb.id).map((n) => n.name).join(' / '), swatch: nb.color || 'slate', checked: note.notebook === nb.id, onClick: () => patchMeta(id, { notebook: nb.id }) })),
    { divider: true },
    { label: 'Move to Trash', icon: Trash2, danger: true, onClick: () => trashNote(id) },
  ]

  const showEditor = !todo && (mode === 'write' || mode === 'split')
  const showPreview = !todo && (mode === 'read' || mode === 'split')

  return (
    <main className="notepane" data-mode={mode}>
      <Tabs activeId={id} isMobile={isMobile} />
      <div className="note-shell">
        <div className="note-main">
          <div className="toolbar">
            {isMobile && (
              <button className="icon-btn" aria-label="Back to list" onClick={() => closeNote()}>
                <ArrowLeft size={18} />
              </button>
            )}
            <nav className="crumbs" aria-label="Location">
              {path.map((p, i) => (
                <span key={p.id} className="crumb">
                  {i > 0 && <ChevronRight size={12} className="crumb-sep" />}
                  <button onClick={() => go({ kind: 'notebook', id: p.id })}>
                    {i === 0 && <span className={cx('dot', 'c-' + (p.color || 'slate'))} />}
                    {p.name}
                  </button>
                </span>
              ))}
            </nav>
            <div className="grow" />
            <span className={cx('sync', sync)} aria-live="polite">{syncLabel}</span>
            {!trashed && !todo && (
              <Segmented
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'write', icon: <Pencil size={14} />, title: `Write (${modKey}+E)` },
                  { value: 'split', icon: <Columns2 size={14} />, title: 'Split view' },
                  { value: 'read', icon: <Eye size={14} />, title: `Read (${modKey}+E)` },
                ]}
              />
            )}
            {!trashed && (
              <button className={cx('icon-btn', entry?.pinned && 'on')} title={entry?.pinned ? 'Unpin' : 'Pin to top'} onClick={() => togglePin(id)}>
                {entry?.pinned ? <Pin size={17} fill="currentColor" /> : <Pin size={17} />}
              </button>
            )}
            <Menu align="end" items={exportItems}>
              {({ ref, toggle }) => (
                <button ref={ref} className="icon-btn" title="Export" onClick={toggle}>
                  <Download size={17} />
                </button>
              )}
            </Menu>
            <button className="icon-btn" title="Version history" onClick={() => setUI({ history: id })}>
              <History size={17} />
            </button>
            <button className={cx('icon-btn', ui.inspector && 'on')} title="Outline, links & info" onClick={() => setUI({ inspector: !ui.inspector })}>
              <PanelRight size={17} />
            </button>
            {!trashed && (
              <Menu align="end" items={moreItems}>
                {({ ref, toggle }) => (
                  <button ref={ref} className="icon-btn" title="More" onClick={toggle}>
                    <MoreHorizontal size={18} />
                  </button>
                )}
              </Menu>
            )}
          </div>

          {conflict && (
            <div className="banner warn">
              <span>This note was changed somewhere else (another tab or device).</span>
              <div className="grow" />
              <button className="btn sm" onClick={() => resolveConflict(id, 'theirs')}>Load the other version</button>
              <button className="btn sm primary" onClick={() => resolveConflict(id, 'mine')}>Keep mine</button>
            </div>
          )}
          {trashed && (
            <div className="banner">
              <Trash2 size={15} />
              <span>This note is in the Trash.</span>
              <div className="grow" />
              <button className="btn sm" onClick={() => restoreNote(id)}><RotateCcw size={14} /> Restore</button>
              <button className="btn sm danger" onClick={() => window.confirm('Delete permanently?') && deleteForever(id)}>Delete forever</button>
            </div>
          )}

          <div className="note-scroll">
            <div className={cx('note-body', research && 'with-sources')}>
              <div className="doc">
                <TitleInput note={note} readOnly={trashed} onEnter={() => (showEditor ? editorRef.current?.focus() : null)} />

                <div className="meta-row">
                  <Menu
                    items={() => notebooks.map((nb) => ({ label: notebookPath(notebooks, nb.id).map((n) => n.name).join(' / '), swatch: nb.color || 'slate', checked: note.notebook === nb.id, onClick: () => patchMeta(id, { notebook: nb.id }) }))}
                  >
                    {({ ref, toggle }) => (
                      <button ref={ref} className="chip nb pick" onClick={toggle} disabled={trashed} title="Move to notebook">
                        <span className={cx('dot', 'c-' + (path[path.length - 1]?.color || 'slate'))} />
                        {path[path.length - 1]?.name || 'Inbox'}
                      </button>
                    )}
                  </Menu>
                  {!trashed && <TagInput tags={note.tags} onChange={(t) => setTags(id, t)} />}
                  {trashed && note.tags.map((t) => <span key={t} className="tag-chip">#{t}</span>)}
                </div>

                {research && !trashed && <ResearchProps note={note} patchNote={patchNote} patchMeta={patchMeta} />}

                {showEditor && !trashed && <FormatBar editorRef={editorRef} onImage={() => imgInput.current?.click()} />}
                <input ref={imgInput} type="file" accept="image/*" hidden multiple onChange={(e) => { handleFiles([...e.target.files]); e.target.value = '' }} />

                <div className={cx('content', mode)}>
                  {todo && <TodoView note={note} readOnly={trashed} />}
                  <div className="editor-wrap" style={{ display: showEditor ? '' : 'none' }}>
                    <Editor
                      ref={editorRef}
                      noteId={id}
                      epoch={epoch}
                      syncTick={tick}
                      doc={note.body}
                      spellcheck={settings.spellcheck}
                      onChange={(v) => patchNote(id, { body: v })}
                      getTitles={getTitles}
                      onCreateLink={createLinked}
                      onFiles={handleFiles}
                      onFollowLink={followTitle}
                    />
                  </div>
                  {showPreview && (
                    <div className="preview-wrap">
                      {mode === 'split' && <div className="preview-label">Preview</div>}
                      {!note.body?.trim() && mode === 'read' ? (
                        <p className="faint">Nothing written yet. {!trashed && <button className="link-btn" onClick={() => setMode('write')}>Start writing</button>}</p>
                      ) : (
                        <Preview
                          ref={previewRef}
                          markdown={note.body || ''}
                          resolve={resolve}
                          onFollow={openNoteId}
                          onCreate={followTitle}
                          onToggleTask={(i) => !trashed && changeBody(toggleTask(note.body, i))}
                          onImage={(src, alt) => setZoom({ src, alt })}
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="doc-foot">
                  <span>{fullDate(entry?.updated || note.updated)}</span>
                  <span>·</span>
                  {todo ? <span>{entry?.todo?.open ?? 0} open</span> : <span>{(entry?.words ?? 0).toLocaleString()} words</span>}
                </div>
              </div>

              {research && (
                <aside className="sources-col">
                  <Sources
                    key={id}
                    noteId={id}
                    clips={note.clips || []}
                    onChange={(clips) => patchNote(id, { clips })}
                    onInsert={insertIntoBody}
                  />
                </aside>
              )}
            </div>
          </div>
        </div>

        {ui.inspector && !isMobile && (
          <Inspector note={note} entry={entry} editorRef={editorRef} previewRef={previewRef} mode={mode} onCreateLink={createLinked} />
        )}
      </div>
      {zoom && (
        <Modal onClose={() => setZoom(null)} width={1100} className="lightbox">
          <img src={zoom.src} alt={zoom.alt || ''} />
          {zoom.alt && <div className="lightbox-cap">{zoom.alt}</div>}
        </Modal>
      )}
    </main>
  )
}

function ResearchProps({ note, patchNote, patchMeta }) {
  const src = note.source || { url: '', author: '', site: '', published: '' }
  const setSrc = (patch) => patchNote(note.id, { source: { ...src, ...patch } })
  const status = STATUS.find((s) => s.value === (note.status || '')) || STATUS[0]
  return (
    <div className="research-props">
      <Menu items={STATUS.map((s) => ({ label: s.label, checked: s.value === (note.status || ''), onClick: () => patchMeta(note.id, { status: s.value }) }))}>
        {({ ref, toggle }) => (
          <button ref={ref} className={cx('status-pill', note.status)} onClick={toggle}>
            <span className={cx('status-dot', note.status)} />
            {status.label}
          </button>
        )}
      </Menu>
      <div className="prop">
        <span className="prop-label">Source</span>
        <input value={src.url} placeholder="https://…" onChange={(e) => setSrc({ url: e.target.value })} />
        {src.url && /^https?:\/\//i.test(src.url) && (
          <a className="icon-btn xs" href={src.url} target="_blank" rel="noopener noreferrer" title={domainOf(src.url)}><ExternalLink size={13} /></a>
        )}
      </div>
      <div className="prop">
        <span className="prop-label">Author</span>
        <input value={src.author} placeholder="Add author" onChange={(e) => setSrc({ author: e.target.value })} />
      </div>
    </div>
  )
}
