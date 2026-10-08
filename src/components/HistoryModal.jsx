import { useEffect, useMemo, useState } from 'react'
import { History, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import { diffLines, diffStats, collapseDiff } from '../lib/diff.js'
import { cx, fullDate, relTime } from '../lib/util.js'
import { Modal, ModalHeader, Segmented, Empty } from './ui.jsx'
import Preview from './Preview.jsx'

export default function HistoryModal({ id, onClose }) {
  const flush = useStore((s) => s.flush)
  const replaceNote = useStore((s) => s.replaceNote)
  const toast = useStore((s) => s.toast)
  const loadNote = useStore((s) => s.loadNote)
  const note = useStore((s) => s.cache[id])
  const entry = useStore((s) => s.notes[id])

  const [versions, setVersions] = useState(null)
  const [sel, setSel] = useState('current')
  const [detail, setDetail] = useState(null)
  const [base, setBase] = useState(null)
  const [mode, setMode] = useState('changes')
  const [compare, setCompare] = useState('current')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    await flush(id)
    const r = await api.versions(id)
    setVersions(r.versions)
    return r.versions
  }

  useEffect(() => {
    loadNote(id)
    refresh().then((v) => {
      if (v.length) setSel(v[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    setDetail(null)
    if (sel === 'current' || !versions) return
    let alive = true
    api.getVersion(id, sel).then((v) => alive && setDetail(v))
    return () => { alive = false }
  }, [sel, id, versions])

  // base for "vs previous"
  useEffect(() => {
    setBase(null)
    if (compare !== 'previous' || sel === 'current' || !versions) return
    const i = versions.findIndex((v) => v.id === sel)
    const prev = versions[i + 1]
    if (!prev) return
    let alive = true
    api.getVersion(id, prev.id).then((v) => alive && setBase(v))
    return () => { alive = false }
  }, [sel, compare, versions, id])

  const current = note ? { title: note.title, body: note.body, clips: note.clips || [] } : null
  const selected = sel === 'current' ? current : detail

  const ops = useMemo(() => {
    if (!selected || !current) return null
    if (compare === 'previous') {
      if (sel === 'current') return null
      const idx = versions?.findIndex((v) => v.id === sel) ?? -1
      const hasPrev = idx >= 0 && versions[idx + 1]
      if (!hasPrev) return diffLines('', selected.body || '')
      if (!base) return null
      return diffLines(base.body || '', selected.body || '')
    }
    return diffLines(selected.body || '', current.body || '')
  }, [selected, current, compare, base, sel, versions])

  const stats = ops ? diffStats(ops) : null
  const shown = ops ? collapseDiff(ops, 2) : null

  const restore = async () => {
    if (sel === 'current' || !detail) return
    setBusy(true)
    try {
      const res = await api.restoreVersion(id, sel)
      replaceNote(res.note, res.entry)
      toast('Version restored — what you had before is saved in the history')
      onClose()
    } catch (e) {
      toast(e.message)
    }
    setBusy(false)
  }

  const saveCheckpoint = async () => {
    setBusy(true)
    try {
      await flush(id)
      await api.saveVersion(id, label.trim() || 'Checkpoint')
      setLabel('')
      const v = await refresh()
      if (v.length) setSel(v[0].id)
    } catch (e) {
      toast(e.message)
    }
    setBusy(false)
  }

  const remove = async (vid) => {
    await api.deleteVersion(id, vid)
    const v = await refresh()
    setSel(v[0]?.id || 'current')
  }

  const rows = [{ id: 'current', at: entry?.updated || note?.updated, label: 'Current version', current: true }, ...(versions || [])]
  const selMeta = rows.find((r) => r.id === sel)
  const titleChanged = selected && current && selected.title !== current.title

  return (
    <Modal onClose={onClose} width={1040} className="history-modal" label="Version history">
      <ModalHeader title={<span className="with-ico"><History size={18} /> Version history{note?.title ? ` — ${note.title}` : ''}</span>} onClose={onClose} />
      <div className="history">
        <aside className="history-list">
          <div className="history-save">
            <input placeholder="Name this version (optional)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCheckpoint()} />
            <button className="btn sm" onClick={saveCheckpoint} disabled={busy}>
              <Save size={14} /> Save
            </button>
          </div>
          <div className="history-items">
            {rows.map((r) => (
              <button key={r.id} className={cx('hv', sel === r.id && 'active')} onClick={() => setSel(r.id)}>
                <span className="hv-top">
                  <span className="hv-when">{r.current ? 'Now' : relTime(r.at)}</span>
                  {r.label && !r.current && <span className="hv-label">{r.label}</span>}
                  {r.current && <span className="hv-label cur">Current</span>}
                </span>
                <span className="hv-sub">
                  {fullDate(r.at)}
                  {!r.current && ` · ${r.words ?? 0} words`}
                </span>
              </button>
            ))}
            {versions && versions.length === 0 && <p className="muted small" style={{ padding: '8px 12px' }}>No earlier versions yet. Folio snapshots a note automatically the first time you edit it after a pause, and whenever you press {`⌘/Ctrl+S`}.</p>}
          </div>
        </aside>

        <section className="history-detail">
          <div className="history-bar">
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'changes', label: 'Changes' }, { value: 'preview', label: 'Preview' }]} />
            {mode === 'changes' && (
              <Segmented size="sm" value={compare} onChange={setCompare} options={[{ value: 'current', label: 'Since this version', title: 'Compare this version with the current note' }, { value: 'previous', label: 'What it changed', title: 'Compare this version with the one before it' }]} />
            )}
            <div className="grow" />
            {stats && mode === 'changes' && (
              <span className="diff-stats"><span className="add">+{stats.add}</span> <span className="del">−{stats.del}</span></span>
            )}
            {sel !== 'current' && (
              <>
                <button className="icon-btn sm" title="Delete this version" onClick={() => remove(sel)}><Trash2 size={15} /></button>
                <button className="btn primary sm" onClick={restore} disabled={busy || !detail}>
                  <RotateCcw size={14} /> Restore this version
                </button>
              </>
            )}
          </div>

          <div className="history-view">
            {sel === 'current' && mode === 'changes' ? (
              <Empty title="This is the current version">Pick an earlier version on the left to see what changed.</Empty>
            ) : !selected ? (
              <p className="muted" style={{ padding: 20 }}>Loading…</p>
            ) : mode === 'preview' ? (
              <div className="history-preview">
                <h1 className="hp-title">{selected.title || 'Untitled'}</h1>
                <Preview markdown={selected.body || ''} />
                {(selected.clips || []).length > 0 && <p className="muted small">{selected.clips.length} collected source{selected.clips.length === 1 ? '' : 's'} in this version.</p>}
              </div>
            ) : (
              <div className="diff">
                {titleChanged && (
                  <div className="diff-title">
                    Title: <span className="del">{compare === 'current' ? selected.title || 'Untitled' : ''}</span>
                    {compare === 'current' && ' → '}
                    <span className="add">{compare === 'current' ? current.title || 'Untitled' : selected.title}</span>
                  </div>
                )}
                {shown && shown.every((o) => o.t === 'eq' || o.t === 'gap') && !titleChanged ? (
                  <Empty title="No text differences">The body is identical{(selected.clips || []).length !== (current.clips || []).length ? ', but the number of collected sources differs.' : '.'}</Empty>
                ) : (
                  shown?.map((o, i) =>
                    o.t === 'gap' ? (
                      <div key={i} className="diff-gap">··· {o.count} unchanged line{o.count === 1 ? '' : 's'} ···</div>
                    ) : (
                      <div key={i} className={cx('diff-line', o.t)}>
                        <span className="diff-sign">{o.t === 'add' ? '+' : o.t === 'del' ? '−' : ' '}</span>
                        <span className="diff-text">{o.text || ' '}</span>
                      </div>
                    ),
                  )
                )}
              </div>
            )}
          </div>
          {selMeta && sel !== 'current' && (
            <div className="history-foot muted small">{fullDate(selMeta.at)}{selMeta.label ? ` · ${selMeta.label}` : ''}</div>
          )}
        </section>
      </div>
    </Modal>
  )
}
