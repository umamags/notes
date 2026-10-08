import { useEffect, useState } from 'react'
import { Check, Download, FileUp, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import { cx, fmtBytes, modKey } from '../lib/util.js'
import { Modal, ModalHeader, Segmented } from './ui.jsx'
import { exportAllUrl, triggerDownload } from '../lib/exporters.js'
import { importFiles, pickFiles } from '../actions.js'

const ACCENTS = [
  ['indigo', '#4f46e5'],
  ['teal', '#0d9488'],
  ['rose', '#e11d48'],
  ['amber', '#d97706'],
  ['slate', '#475569'],
]

function Row({ label, hint, children }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

export default function Settings({ onClose }) {
  const settings = useStore((s) => s.settings)
  const server = useStore((s) => s.server)
  const update = useStore((s) => s.updateSettings)
  const notes = useStore((s) => s.notes)
  const setNotesFromServer = useStore((s) => s.setNotesFromServer)
  const toast = useStore((s) => s.toast)
  const [stats, setStats] = useState(null)
  const [busy, setBusy] = useState('')
  const sampleCount = Object.values(notes).filter((n) => n.sample).length

  const loadStats = () => api.stats().then(setStats).catch(() => {})
  useEffect(() => { loadStats() }, [])

  return (
    <Modal onClose={onClose} width={640} className="settings-modal" label="Settings">
      <ModalHeader title="Settings" onClose={onClose} />
      <div className="settings-body">
        <section>
          <h3>Appearance</h3>
          <Row label="Theme">
            <Segmented value={settings.theme} onChange={(v) => update({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </Row>
          <Row label="Accent colour">
            <div className="swatches">
              {ACCENTS.map(([name, hex]) => (
                <button key={name} className={cx('sw', settings.accent === name && 'on')} style={{ background: hex }} onClick={() => update({ accent: name })} aria-label={name} title={name}>
                  {settings.accent === name && <Check size={14} color="#fff" />}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Writing font">
            <Segmented value={settings.editorFont} onChange={(v) => update({ editorFont: v })} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} />
          </Row>
          <Row label="Text size" hint={`${settings.fontSize}px`}>
            <input type="range" min={13} max={22} step={1} value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
          </Row>
          <Row label="Page width">
            <Segmented value={settings.width} onChange={(v) => update({ width: v })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Comfortable' }, { value: 'wide', label: 'Wide' }]} />
          </Row>
        </section>

        <section>
          <h3>Editor</h3>
          <Row label="Open notes in" hint="Your last choice is remembered while you work.">
            <Segmented value={settings.defaultView} onChange={(v) => { update({ defaultView: v }); useStore.getState().setUI({ mode: v }) }} options={[{ value: 'write', label: 'Write' }, { value: 'split', label: 'Split' }, { value: 'read', label: 'Read' }]} />
          </Row>
          <Row label="Spell check">
            <button className={cx('switch', settings.spellcheck && 'on')} role="switch" aria-checked={settings.spellcheck} onClick={() => update({ spellcheck: !settings.spellcheck })}>
              <span />
            </button>
          </Row>
        </section>

        <section>
          <h3>Your data</h3>
          <p className="muted small data-note">
            Everything lives in plain files on your server — notes as JSON, uploads as ordinary PDFs and images. There is no database and no cloud service.
          </p>
          {stats && (
            <div className="stat-grid">
              <div><strong>{stats.notes}</strong><span>notes</span></div>
              <div><strong>{stats.trashed}</strong><span>in trash</span></div>
              <div><strong>{fmtBytes(stats.bytes)}</strong><span>on disk</span></div>
              <div><strong>{server.maxUpload ? fmtBytes(server.maxUpload) : '—'}</strong><span>max upload</span></div>
            </div>
          )}
          {stats && <p className="muted small mono-path"><FolderOpen size={13} /> {stats.storage}</p>}
          <div className="btn-row">
            <button className="btn" onClick={() => triggerDownload(exportAllUrl())}><Download size={15} /> Export everything (.zip)</button>
            <button className="btn" onClick={async () => importFiles(await pickFiles('.md,.markdown,.txt'))}><FileUp size={15} /> Import Markdown</button>
            <button className="btn" onClick={async () => importFiles(await pickFiles('application/pdf'))}><FileUp size={15} /> Import PDF</button>
          </div>
          <p className="muted small">The export contains one Markdown file per note (organised by notebook), every attachment, and a full JSON backup.</p>
          <div className="btn-row">
            <button className="btn" disabled={busy === 'idx'} onClick={async () => {
              setBusy('idx')
              try { await api.reindex(); const b = await api.bootstrap(); setNotesFromServer(b.notes, b.notebooks); toast('Index rebuilt'); loadStats() } catch (e) { toast(e.message) }
              setBusy('')
            }}><RefreshCw size={15} /> Rebuild index</button>
            {sampleCount > 0 && (
              <button className="btn danger" disabled={busy === 'sample'} onClick={async () => {
                if (!window.confirm(`Delete the ${sampleCount} sample notes? Your own notes are not touched.`)) return
                setBusy('sample')
                try { const r = await api.removeSamples(); setNotesFromServer(r.notes, r.notebooks); toast('Sample notes removed'); loadStats() } catch (e) { toast(e.message) }
                setBusy('')
              }}><Trash2 size={15} /> Remove sample notes</button>
            )}
          </div>
        </section>

        <section>
          <h3>About</h3>
          <p className="muted small">
            Folio is a private, file-based notebook. It contains no AI features of any kind — no assistants, summaries, auto-organisation or language-model integrations. Search is plain text matching, and links are the ones you write yourself.
          </p>
          <p className="muted small">Press <kbd className="kbd">?</kbd> for keyboard shortcuts · <kbd className="kbd">{modKey} K</kbd> for the quick switcher.</p>
        </section>
      </div>
    </Modal>
  )
}

const GROUPS = [
  ['Navigate', [
    [`${modKey} K`, 'Quick switcher — jump to a note or search everything'],
    [`${modKey} ⇧ F  or  /`, 'Open full search'],
    ['Alt ← / →', 'Back / forward'],
    ['Alt [  /  ]', 'Previous / next open tab'],
    ['↑ ↓', 'Move through the note list'],
    [`${modKey} \\`, 'Show or hide the side panels (focus mode)'],
    [`${modKey} .`, 'Toggle outline & links panel'],
  ]],
  ['Create', [
    ['Alt N', 'New note'],
    ['Alt ⇧ N', 'New research note'],
    [`${modKey} Enter`, 'Save a quick capture on Home'],
    ['[[', 'Link to another note while writing'],
  ]],
  ['Edit', [
    [`${modKey} E`, 'Switch between writing and reading'],
    [`${modKey} B / I`, 'Bold / italic'],
    [`${modKey} ⇧ K`, 'Insert link'],
    [`${modKey} ⇧ C`, 'Inline code'],
    [`${modKey} ⇧ 7 / 8 / 9`, 'Numbered / bulleted / task list'],
    [`${modKey} Z`, 'Undo (kept for each open note)'],
    [`${modKey} click`, 'Follow a [[link]] while editing'],
    [`${modKey} S`, 'Save a named checkpoint in version history'],
    ['Alt W', 'Close the current tab'],
  ]],
]

export function Shortcuts({ onClose }) {
  return (
    <Modal onClose={onClose} width={640} label="Keyboard shortcuts">
      <ModalHeader title="Keyboard shortcuts" onClose={onClose} />
      <div className="shortcuts">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h4>{title}</h4>
            {rows.map(([k, d]) => (
              <div key={k} className="sc-row">
                <span>{d}</span>
                <span className="sc-keys">{k.split('  or  ').map((part, i) => <span key={i}>{i > 0 && <em>or</em>}<kbd className="kbd">{part}</kbd></span>)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}
