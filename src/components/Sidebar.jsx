import { useMemo, useState } from 'react'
import {
  BookOpen, ChevronDown, ChevronRight, Download, FileUp, FolderPlus, Hash, Home, Library, MoreHorizontal, Moon, Pin, Plus, Search, Settings, Sun, Monitor,
  Trash2, FilePlus2, PanelLeftClose, Inbox, Pencil, Palette, StickyNote,
} from 'lucide-react'
import { useStore, notebookDescendants } from '../store.js'
import { go, useRoute } from '../router.js'
import { cx, modKey, titleOf } from '../lib/util.js'
import { Menu, useContextMenu, NB_COLORS } from './ui.jsx'
import { exportNotebookUrl, triggerDownload } from '../lib/exporters.js'
import { importFiles, pickFiles } from '../actions.js'
import { openNoteId } from '../router.js'

function useExpanded() {
  const [set, setSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('folio.expanded') || '[]')) } catch { return new Set() }
  })
  const toggle = (id, force) => {
    setSet((prev) => {
      const next = new Set(prev)
      const want = force ?? !next.has(id)
      if (want) next.add(id)
      else next.delete(id)
      try { localStorage.setItem('folio.expanded', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }
  return [set, toggle]
}

export default function Sidebar({ mobile }) {
  const notes = useStore((s) => s.notes)
  const notebooks = useStore((s) => s.notebooks)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const createNote = useStore((s) => s.createNote)
  const createNotebook = useStore((s) => s.createNotebook)
  const updateNotebook = useStore((s) => s.updateNotebook)
  const deleteNotebook = useStore((s) => s.deleteNotebook)
  const moveNote = useStore((s) => s.moveNote)
  const renameTag = useStore((s) => s.renameTag)
  const deleteTag = useStore((s) => s.deleteTag)
  const setUI = useStore((s) => s.setUI)
  const toast = useStore((s) => s.toast)
  const { view, noteId } = useRoute()
  const [expanded, toggleExpanded] = useExpanded()
  const [renaming, setRenaming] = useState(null)
  const [allTags, setAllTags] = useState(false)
  const [dropTarget, setDropTarget] = useState(null)
  const [ctxOpen, ctxEl] = useContextMenu()

  const { counts, nbCounts, tags, pinned } = useMemo(() => {
    const live = Object.values(notes).filter((n) => !n.trashed)
    const direct = {}
    const tagMap = {}
    let research = 0
    const pins = []
    for (const n of live) {
      direct[n.notebook] = (direct[n.notebook] || 0) + 1
      if (n.type === 'research') research++
      if (n.pinned) pins.push(n)
      for (const t of n.tags) tagMap[t] = (tagMap[t] || 0) + 1
    }
    const total = {}
    for (const nb of notebooks) {
      let c = 0
      for (const id of notebookDescendants(notebooks, nb.id)) c += direct[id] || 0
      total[nb.id] = c
    }
    pins.sort((a, b) => b.updated - a.updated)
    return {
      counts: { all: live.length, research, pinned: pins.length, trash: Object.values(notes).length - live.length },
      nbCounts: total,
      tags: Object.entries(tagMap).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      pinned: pins,
    }
  }, [notes, notebooks])

  const children = useMemo(() => {
    const m = {}
    for (const nb of notebooks) (m[nb.parent || 'root'] ||= []).push(nb)
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
    return m
  }, [notebooks])

  const close = () => mobile && setUI({ mobileSidebar: false })
  const nav = (v) => {
    go(v)
    close()
  }

  const newNotebook = async (parent = null) => {
    const nb = await createNotebook({ name: 'New notebook', parent })
    if (nb) {
      if (parent) toggleExpanded(parent, true)
      setRenaming(nb.id)
    }
  }

  const notebookMenu = (nb) => [
    { label: 'New note here', icon: FilePlus2, onClick: () => createNote({ notebook: nb.id }) },
    { label: 'New sub-notebook', icon: FolderPlus, onClick: () => newNotebook(nb.id) },
    { divider: true },
    { label: 'Rename', icon: Pencil, onClick: () => setRenaming(nb.id), disabled: !!nb.system },
    { header: 'Colour' },
    ...NB_COLORS.map((c) => ({ label: c[0].toUpperCase() + c.slice(1), swatch: c, checked: nb.color === c, onClick: () => updateNotebook(nb.id, { color: c }) })),
    { divider: true },
    { label: 'Export as Markdown (.zip)', icon: Download, onClick: () => triggerDownload(exportNotebookUrl(nb.id)) },
    { label: 'Delete notebook', icon: Trash2, danger: true, disabled: !!nb.system, onClick: () => {
      if (window.confirm(`Delete “${nb.name}”? Its notes will move up one level — nothing is lost.`)) deleteNotebook(nb.id)
    } },
  ]

  const renderNotebook = (nb, depth) => {
    const kids = children[nb.id] || []
    const open = expanded.has(nb.id)
    const active = view.kind === 'notebook' && view.id === nb.id
    return (
      <div key={nb.id}>
        <div
          className={cx('nav-item', 'nb', active && 'active', dropTarget === nb.id && 'drop')}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => renaming !== nb.id && nav({ kind: 'notebook', id: nb.id })}
          onContextMenu={(e) => ctxOpen(e, notebookMenu(nb))}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('text/x-folio-note')) {
              e.preventDefault()
              setDropTarget(nb.id)
            }
          }}
          onDragLeave={() => setDropTarget((t) => (t === nb.id ? null : t))}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('text/x-folio-note')
            setDropTarget(null)
            if (id) {
              e.preventDefault()
              moveNote(id, nb.id)
              toast(`Moved to ${nb.name}`)
            }
          }}
        >
          <button
            className={cx('chev', kids.length === 0 && 'hidden')}
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation()
              toggleExpanded(nb.id)
            }}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className={cx('dot', 'c-' + (nb.color || 'slate'))} />
          {renaming === nb.id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={nb.name}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== nb.name) updateNotebook(nb.id, { name: v })
                setRenaming(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span className="label">{nb.name}</span>
          )}
          <span className="count">{nbCounts[nb.id] || ''}</span>
          <Menu items={() => notebookMenu(nb)} align="end">
            {({ ref, toggle }) => (
              <button ref={ref} className="more" aria-label="Notebook options" onClick={toggle}>
                <MoreHorizontal size={15} />
              </button>
            )}
          </Menu>
        </div>
        {open && kids.map((k) => renderNotebook(k, depth + 1))}
      </div>
    )
  }

  const shownTags = allTags ? tags : tags.slice(0, 10)
  const themeIcon = settings.theme === 'dark' ? Moon : settings.theme === 'light' ? Sun : Monitor
  const ThemeIcon = themeIcon
  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[settings.theme]

  return (
    <aside className="sidebar">
      <div className="side-top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <BookOpen size={15} strokeWidth={2.4} />
          </span>
          <span className="brand-name">Folio</span>
        </div>
        <div className="grow" />
        <button className="icon-btn" title={`Hide sidebar (${modKey}+\\)`} onClick={() => (mobile ? close() : setUI({ sidebar: false }))}>
          <PanelLeftClose size={17} />
        </button>
      </div>

      <div className="side-actions">
        <button className="search-btn" onClick={() => setUI({ palette: true, paletteQuery: '' })}>
          <Search size={15} />
          <span>Search or jump to…</span>
          <kbd className="kbd">{modKey} K</kbd>
        </button>
        <Menu
          align="end"
          items={[
            { label: 'New note', icon: FilePlus2, shortcut: 'Alt N', onClick: () => createNote({}) },
            { label: 'New research note', icon: Library, shortcut: 'Alt ⇧ N', onClick: () => createNote({ type: 'research' }) },
            { divider: true },
            { label: 'Import PDF…', icon: FileUp, onClick: async () => importFiles(await pickFiles('application/pdf')) },
            { label: 'Import Markdown…', icon: StickyNote, onClick: async () => importFiles(await pickFiles('.md,.markdown,.txt')) },
          ]}
        >
          {({ ref, toggle }) => (
            <div className="split-btn" ref={ref}>
              <button className="btn primary new-btn" onClick={() => createNote({})} title="New note (Alt+N)">
                <Plus size={16} /> New note
              </button>
              <button className="btn primary caret" onClick={toggle} aria-label="More ways to create">
                <ChevronDown size={15} />
              </button>
            </div>
          )}
        </Menu>
      </div>

      <nav className="side-scroll">
        <div className="nav-group">
          <NavItem icon={Home} label="Home" active={view.kind === 'home'} onClick={() => nav({ kind: 'home' })} />
          <NavItem icon={Inbox} label="All notes" count={counts.all} active={view.kind === 'all'} onClick={() => nav({ kind: 'all' })} />
          <NavItem icon={Library} label="Research" count={counts.research} active={view.kind === 'research'} onClick={() => nav({ kind: 'research' })} />
        </div>

        {pinned.length > 0 && (
          <div className="nav-group">
            <SectionHead title="Pinned" onClick={() => nav({ kind: 'pinned' })} />
            {pinned.slice(0, 8).map((n) => (
              <div
                key={n.id}
                className={cx('nav-item', 'pin', noteId === n.id && 'active')}
                onClick={() => {
                  openNoteId(n.id)
                  close()
                }}
                title={titleOf(n)}
              >
                <Pin size={13} className="pin-ico" />
                <span className="label">{titleOf(n)}</span>
              </div>
            ))}
            {pinned.length > 8 && <div className="nav-item more-link" onClick={() => nav({ kind: 'pinned' })}><span className="label">{pinned.length - 8} more…</span></div>}
          </div>
        )}

        <div className="nav-group">
          <SectionHead title="Notebooks" action={<button className="icon-btn sm" title="New notebook" onClick={() => newNotebook(null)}><FolderPlus size={15} /></button>} />
          {(children.root || []).map((nb) => renderNotebook(nb, 0))}
        </div>

        {tags.length > 0 && (
          <div className="nav-group">
            <SectionHead title="Tags" />
            <div className="tag-cloud">
              {shownTags.map(([t, c]) => (
                <button
                  key={t}
                  className={cx('tag', view.kind === 'tag' && view.tag === t && 'active')}
                  onClick={() => nav({ kind: 'tag', tag: t })}
                  onContextMenu={(e) =>
                    ctxOpen(e, [
                      { label: `Rename #${t}…`, icon: Pencil, onClick: () => { const v = window.prompt('Rename tag', t); if (v && v.trim() && v.trim() !== t) renameTag(t, v.trim()) } },
                      { label: `Remove #${t} from all notes`, icon: Trash2, danger: true, onClick: () => { if (window.confirm(`Remove the tag #${t} from ${c} note${c === 1 ? '' : 's'}?`)) deleteTag(t) } },
                    ])
                  }
                >
                  <Hash size={11} />
                  {t}
                  <span className="n">{c}</span>
                </button>
              ))}
            </div>
            {tags.length > 10 && (
              <button className="link-btn" onClick={() => setAllTags((v) => !v)}>
                {allTags ? 'Show fewer' : `Show all ${tags.length} tags`}
              </button>
            )}
          </div>
        )}
      </nav>

      <div className="side-bottom">
        <NavItem icon={Trash2} label="Trash" count={counts.trash} active={view.kind === 'trash'} onClick={() => nav({ kind: 'trash' })} />
        <div className="grow" />
        <button className="icon-btn" title={`Theme: ${settings.theme} (click for ${nextTheme})`} onClick={() => updateSettings({ theme: nextTheme })}>
          <ThemeIcon size={17} />
        </button>
        <button className="icon-btn" title="Settings" onClick={() => setUI({ settings: true })}>
          <Settings size={17} />
        </button>
      </div>
      {ctxEl}
    </aside>
  )
}

function NavItem({ icon: Icon, label, count, active, onClick }) {
  return (
    <div className={cx('nav-item', active && 'active')} onClick={onClick} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <Icon size={16} className="nav-ico" />
      <span className="label">{label}</span>
      {count > 0 && <span className="count">{count}</span>}
    </div>
  )
}

function SectionHead({ title, action, onClick }) {
  return (
    <div className="section-head">
      <span className={cx(onClick && 'clickable')} onClick={onClick}>{title}</span>
      <div className="grow" />
      {action}
    </div>
  )
}
