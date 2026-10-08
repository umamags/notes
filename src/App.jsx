import { useEffect, useRef, useState } from 'react'
import { PanelLeft, Menu as MenuIcon, UploadCloud } from 'lucide-react'
import { api } from './api.js'
import { useStore } from './store.js'
import { closeNote, currentRoute, go, openNoteId, useRoute } from './router.js'
import { importFiles } from './actions.js'
import { cx } from './lib/util.js'
import Sidebar from './components/Sidebar.jsx'
import NoteList from './components/NoteList.jsx'
import NotePane from './components/NotePane.jsx'
import Home from './components/Home.jsx'
import Palette from './components/Palette.jsx'
import Settings, { Shortcuts } from './components/Settings.jsx'
import HistoryModal from './components/HistoryModal.jsx'
import { PdfViewer } from './components/Sources.jsx'
import { Toasts, useMedia } from './components/ui.jsx'

const isTyping = (e) => {
  const t = e.target
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest?.('.cm-editor')
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      const st = useStore.getState()
      const code = e.code
      const { noteId, view } = currentRoute()

      if (mod && !e.shiftKey && !e.altKey && code === 'KeyK') {
        e.preventDefault()
        st.setUI({ palette: !st.ui.palette, paletteQuery: '' })
        return
      }
      if (mod && e.shiftKey && !e.altKey && code === 'KeyF') {
        e.preventDefault()
        go({ kind: 'search', q: view.kind === 'search' ? view.q : '' })
        return
      }
      if (mod && !e.shiftKey && !e.altKey && code === 'Backslash') {
        e.preventDefault()
        const both = st.ui.sidebar || st.ui.list
        st.setUI({ sidebar: !both, list: !both })
        return
      }
      if (mod && !e.shiftKey && !e.altKey && code === 'Period') {
        e.preventDefault()
        st.setUI({ inspector: !st.ui.inspector })
        return
      }
      if (mod && !e.shiftKey && !e.altKey && code === 'Comma') {
        e.preventDefault()
        st.setUI({ settings: true })
        return
      }
      if (mod && !e.shiftKey && !e.altKey && code === 'KeyE' && noteId) {
        e.preventDefault()
        const cur = st.ui.mode || st.settings.defaultView
        st.setUI({ mode: cur === 'read' ? 'write' : 'read' })
        return
      }
      if (mod && !e.shiftKey && !e.altKey && code === 'KeyS') {
        e.preventDefault()
        if (noteId && st.cache[noteId]) {
          st.flush(noteId).then(() => api.saveVersion(noteId, 'Checkpoint')).then(() => st.toast('Version saved to history')).catch((err) => st.toast(err.message))
        }
        return
      }
      if (e.altKey && !mod && code === 'KeyN') {
        e.preventDefault()
        st.createNote({ type: e.shiftKey ? 'research' : 'page' })
        return
      }
      if (e.altKey && !mod && code === 'KeyW' && noteId) {
        e.preventDefault()
        st.closeTab(noteId)
        return
      }
      if (e.altKey && !mod && (code === 'BracketLeft' || code === 'BracketRight')) {
        e.preventDefault()
        const tabs = st.tabs.filter((t) => st.notes[t] && !st.notes[t].trashed)
        if (!tabs.length) return
        const i = tabs.indexOf(noteId)
        const next = tabs[(i + (code === 'BracketRight' ? 1 : -1) + tabs.length) % tabs.length]
        openNoteId(next)
        return
      }
      if (!mod && !e.altKey && !isTyping(e)) {
        if (e.key === '?') {
          e.preventDefault()
          st.setUI({ shortcuts: true })
        } else if (e.key === '/') {
          e.preventDefault()
          go({ kind: 'search', q: '' })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useDropImport() {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  useEffect(() => {
    const has = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e) => { if (has(e)) { depth.current++; setDragging(true) } }
    const leave = (e) => { if (has(e)) { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false) } }
    const over = (e) => { if (has(e)) e.preventDefault() }
    const drop = (e) => {
      depth.current = 0
      setDragging(false)
      if (!has(e) || e.defaultPrevented) return
      e.preventDefault()
      importFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return dragging
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const loadError = useStore((s) => s.loadError)
  const init = useStore((s) => s.init)
  const ui = useStore((s) => s.ui)
  const setUI = useStore((s) => s.setUI)
  const progress = useStore((s) => s.progress)
  const settings = useStore((s) => s.settings)
  const { view, noteId } = useRoute()
  const isMobile = useMedia('(max-width: 900px)')
  const dragging = useDropImport()
  useGlobalShortcuts()

  useEffect(() => { init() }, [init])

  // follow the OS theme when set to "system"
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const h = () => settings.theme === 'system' && document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [settings.theme])

  // keep unsaved work safe
  useEffect(() => {
    const flush = () => useStore.getState().flushAll()
    const vis = () => document.visibilityState === 'hidden' && flush()
    const before = (e) => {
      flush()
      if (useStore.getState().hasUnsaved()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', before)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', before)
    }
  }, [])

  // drop tabs for notes that no longer exist
  const notes = useStore((s) => s.notes)
  useEffect(() => { if (ready) useStore.getState().pruneTabs() }, [ready, notes])

  // close the mobile drawer when navigating
  useEffect(() => { if (isMobile) setUI({ mobileSidebar: false }) }, [view, noteId, isMobile]) // eslint-disable-line

  if (loadError) {
    return (
      <div className="boot">
        <div className="boot-card">
          <h2>Can’t reach the Folio server</h2>
          <p className="muted">{loadError}</p>
          <p className="muted small">Start the app with <code>php -S 127.0.0.1:8080 -t public</code> (or run <code>./start.sh</code>) and reload.</p>
          <button className="btn primary" onClick={() => { useStore.setState({ loadError: null }); init() }}>Try again</button>
        </div>
      </div>
    )
  }
  if (!ready) return <div className="boot"><div className="spinner big" aria-label="Loading" /></div>

  const showSidebar = isMobile ? ui.mobileSidebar : ui.sidebar
  const home = view.kind === 'home'
  const showList = !home && (isMobile ? !noteId : ui.list)
  const showPane = !home && (isMobile ? !!noteId : true)

  return (
    <div className={cx('app', isMobile && 'mobile', !ui.sidebar && 'no-sidebar', !ui.list && 'no-list')}>
      {showSidebar && (
        <>
          {isMobile && <div className="scrim" onClick={() => setUI({ mobileSidebar: false })} />}
          <Sidebar mobile={isMobile} />
        </>
      )}
      {isMobile && !noteId && !showSidebar && (
        <button className="mobile-menu icon-btn" aria-label="Open menu" onClick={() => setUI({ mobileSidebar: true })}>
          <MenuIcon size={19} />
        </button>
      )}
      {home && <Home />}
      {showList && <NoteList activeId={noteId} />}
      {showPane && <NotePane id={noteId} isMobile={isMobile} />}

      {ui.palette && <Palette onClose={() => setUI({ palette: false })} />}
      {ui.settings && <Settings onClose={() => setUI({ settings: false })} />}
      {ui.shortcuts && <Shortcuts onClose={() => setUI({ shortcuts: false })} />}
      {ui.history && <HistoryModal id={ui.history} onClose={() => setUI({ history: null })} />}
      {ui.pdfViewer && <PdfViewer file={ui.pdfViewer.file} name={ui.pdfViewer.name} onClose={() => setUI({ pdfViewer: null })} />}
      {progress && (
        <div className="progress-pill"><span className="spinner" /> {progress}</div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <UploadCloud size={30} />
            <strong>Drop to import</strong>
            <span>Markdown, text, PDF or images</span>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  )
}
