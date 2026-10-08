import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, GripVertical, Image as ImageIcon, Link2, Pencil, Plus, Quote, StickyNote, Trash2, CornerDownLeft, Download, Maximize2, Check } from 'lucide-react'
import { api, fileUrl } from '../api.js'
import { importPdf } from '../lib/pdf.js'
import { cx, domainOf, fmtBytes, isUrl, uid } from '../lib/util.js'
import { Menu, Modal, ModalHeader } from './ui.jsx'
import { useStore } from '../store.js'

const newClip = (kind, data = {}) => ({ id: uid(8), kind, createdAt: Date.now(), ...data })

function AutoText({ value, onChange, placeholder, className, rows = 1, onBlur }) {
  const ref = useRef(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(fit, [value])
  return <textarea ref={ref} className={className} rows={rows} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function ClipCard({ clip, onChange, onRemove, onInsert, onZoom, onOpenPdf, onQuoteFromPdf, dragProps }) {
  const [editing, setEditing] = useState(clip.fresh === true)
  const [showText, setShowText] = useState(false)
  const [pdfText, setPdfText] = useState(null)

  useEffect(() => {
    if (showText && pdfText == null && clip.kind === 'pdf') api.fileText(clip.file).then((r) => setPdfText(r.text || '')).catch(() => setPdfText(''))
  }, [showText, pdfText, clip.kind, clip.file])

  const set = (patch) => onChange({ ...clip, ...patch })

  const actions = (
    <div className="clip-actions">
      <button className="icon-btn sm" title="Insert into notes" onClick={onInsert}>
        <CornerDownLeft size={14} />
      </button>
      {clip.kind !== 'pdf' && clip.kind !== 'image' && (
        <button className={cx('icon-btn sm', editing && 'on')} title="Edit" onClick={() => setEditing((v) => !v)}>
          {editing ? <Check size={14} /> : <Pencil size={14} />}
        </button>
      )}
      <button className="icon-btn sm" title="Remove" onClick={onRemove}>
        <Trash2 size={14} />
      </button>
    </div>
  )

  return (
    <div className={cx('clip', 'clip-' + clip.kind)} {...dragProps}>
      <div className="clip-grip" title="Drag to reorder">
        <GripVertical size={14} />
      </div>
      {actions}

      {clip.kind === 'link' && (
        <>
          <div className="clip-kicker">
            <Link2 size={12} /> {clip.site || domainOf(clip.url)}
          </div>
          {editing ? (
            <div className="clip-form">
              <Field label="Title">
                <input value={clip.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="URL">
                <input value={clip.url} onChange={(e) => set({ url: e.target.value })} />
              </Field>
              <Field label="Description">
                <AutoText value={clip.description} onChange={(v) => set({ description: v })} />
              </Field>
            </div>
          ) : (
            <>
              <a className="clip-title" href={clip.url} target="_blank" rel="noopener noreferrer">
                {clip.title || clip.url}
                <ExternalLink size={12} />
              </a>
              {clip.description && <p className="clip-desc">{clip.description}</p>}
              {clip.loading && <p className="clip-desc muted">Fetching details…</p>}
            </>
          )}
        </>
      )}

      {clip.kind === 'quote' && (
        <>
          {editing ? (
            <div className="clip-form">
              <Field label="Quote">
                <AutoText value={clip.text} onChange={(v) => set({ text: v })} rows={3} />
              </Field>
              <div className="field-row">
                <Field label="Source">
                  <input value={clip.source} onChange={(e) => set({ source: e.target.value })} placeholder="Author or title" />
                </Field>
                <Field label="Page">
                  <input value={clip.page} onChange={(e) => set({ page: e.target.value })} placeholder="12" />
                </Field>
              </div>
              <Field label="URL">
                <input value={clip.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
              </Field>
            </div>
          ) : (
            <>
              <blockquote className="clip-quote">{clip.text}</blockquote>
              {(clip.source || clip.page || clip.url) && (
                <div className="clip-attr">
                  — {clip.source}
                  {clip.page ? `, p. ${clip.page}` : ''}
                  {clip.url && (
                    <a href={clip.url} target="_blank" rel="noopener noreferrer" title={clip.url}>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {clip.kind === 'image' && (
        <>
          <button className="clip-img" onClick={() => onZoom(fileUrl(clip.file), clip.caption)} title="View full size">
            <img src={fileUrl(clip.file)} alt={clip.caption || 'Screenshot'} loading="lazy" />
            <span className="zoom">
              <Maximize2 size={14} />
            </span>
          </button>
        </>
      )}

      {clip.kind === 'pdf' && (
        <>
          <div className="clip-pdf">
            <button className="pdf-thumb" onClick={() => onOpenPdf(clip)} title="Open PDF">
              {clip.thumb ? <img src={fileUrl(clip.thumb)} alt="" loading="lazy" /> : <FileText size={28} />}
            </button>
            <div className="pdf-meta">
              <div className="clip-title" onClick={() => onOpenPdf(clip)} style={{ cursor: 'pointer' }}>
                {clip.name || 'PDF document'}
              </div>
              <div className="muted small">
                {clip.pages ? `${clip.pages} page${clip.pages === 1 ? '' : 's'} · ` : ''}
                {fmtBytes(clip.size)}
              </div>
              <div className="pdf-btns">
                <button className="btn sm" onClick={() => onOpenPdf(clip)}>
                  Open
                </button>
                <a className="btn sm" href={fileUrl(clip.file, true)}>
                  <Download size={13} /> Download
                </a>
                <button className={cx('btn sm', showText && 'on')} onClick={() => setShowText((v) => !v)}>
                  Text
                </button>
              </div>
            </div>
          </div>
          {showText && (
            <div className="pdf-text">
              {pdfText == null ? (
                <span className="muted">Loading…</span>
              ) : pdfText ? (
                <>
                  <div className="pdf-text-body">{pdfText.slice(0, 20000)}{pdfText.length > 20000 ? '\n\n… (truncated — open the PDF for the rest)' : ''}</div>
                  <div className="pdf-text-bar">
                    <span className="muted small">Select text above, then</span>
                    <button
                      className="btn sm"
                      onClick={() => {
                        const s = window.getSelection()?.toString().trim()
                        if (s) onQuoteFromPdf(clip, s)
                      }}
                    >
                      <Quote size={13} /> Save as quote
                    </button>
                  </div>
                </>
              ) : (
                <span className="muted">No extractable text (this may be a scanned document).</span>
              )}
            </div>
          )}
        </>
      )}

      {clip.kind === 'text' && (
        <>
          {editing ? (
            <AutoText className="clip-textarea" value={clip.text} onChange={(v) => set({ text: v })} rows={3} />
          ) : (
            <div className="clip-note">{clip.text}</div>
          )}
        </>
      )}

      {(clip.kind === 'link' || clip.kind === 'quote' || clip.kind === 'pdf') && (
        <AutoText className="clip-comment" value={clip.comment} placeholder="Add your note…" onChange={(v) => set({ comment: v })} />
      )}
      {clip.kind === 'image' && <AutoText className="clip-comment" value={clip.caption} placeholder="Add a caption…" onChange={(v) => set({ caption: v })} />}
    </div>
  )
}

export default function Sources({ noteId, clips, onChange, onInsert }) {
  const toast = useStore((s) => s.toast)
  const setUI = useStore((s) => s.setUI)
  const [adding, setAdding] = useState(null) // 'link' | 'quote' | 'text'
  const [draft, setDraft] = useState({ url: '', text: '', source: '', page: '' })
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [busy, setBusy] = useState('')
  const imgInput = useRef(null)
  const pdfInput = useRef(null)
  const clipsRef = useRef(clips)
  clipsRef.current = clips

  const apply = (next) => onChange(next)
  const add = (clip, top = true) => apply(top ? [clip, ...clipsRef.current] : [...clipsRef.current, clip])
  const update = (id, next) => apply(clipsRef.current.map((c) => (c.id === id ? next : c)))
  const patchClip = (id, patch) => apply(useStore.getState().cache[noteId].clips.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const remove = (id) => apply(clipsRef.current.filter((c) => c.id !== id))

  async function addLink(rawUrl) {
    let url = rawUrl.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    const clip = newClip('link', { url, title: '', description: '', site: domainOf(url), image: '', comment: '', loading: true })
    add(clip)
    try {
      const meta = await api.unfurl(url)
      patchClip(clip.id, { title: meta.title || '', description: meta.description || '', site: meta.site || domainOf(url), url: meta.url || url, loading: false })
    } catch {
      patchClip(clip.id, { loading: false })
    }
  }

  async function addImage(file) {
    setBusy('Uploading image…')
    try {
      const up = await api.upload(file, file.name || 'screenshot.png')
      add(newClip('image', { file: up.id, caption: '' }))
    } catch (e) {
      toast(e.message)
    }
    setBusy('')
  }

  async function addPdf(file) {
    setBusy('Importing PDF…')
    try {
      const res = await importPdf(file, setBusy)
      add(newClip('pdf', res.clip))
      toast(res.text ? `PDF added — ${res.clip.pages} pages indexed for search` : 'PDF added (no extractable text found)')
    } catch (e) {
      toast(e.message)
    }
    setBusy('')
  }

  async function handleFiles(files) {
    for (const f of files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) await addPdf(f)
      else if (f.type.startsWith('image/')) await addImage(f)
      else toast(`“${f.name}” isn’t a supported file (PDF or image only)`)
    }
  }

  function submitDraft() {
    if (adding === 'link') {
      addLink(draft.url)
    } else if (adding === 'quote') {
      if (!draft.text.trim()) return
      add(newClip('quote', { text: draft.text.trim(), source: draft.source, url: draft.url, page: draft.page, comment: '' }))
    } else if (adding === 'text') {
      if (!draft.text.trim()) return
      add(newClip('text', { text: draft.text.trim() }))
    }
    setDraft({ url: '', text: '', source: '', page: '' })
    setAdding(null)
  }

  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) {
      e.preventDefault()
      handleFiles(files)
      return
    }
    const text = (e.clipboardData?.getData('text/plain') || '').trim()
    if (!text) return
    if (adding) return
    e.preventDefault()
    if (isUrl(text)) addLink(text)
    else add(newClip('quote', { text, source: '', url: '', page: '', comment: '', fresh: true }))
  }

  const insertText = (c) => {
    if (c.kind === 'quote') return `> ${c.text.replace(/\n/g, '\n> ')}${c.source || c.url ? `\n> — ${c.url ? `[${c.source || c.url}](${c.url})` : c.source}${c.page ? `, p. ${c.page}` : ''}` : ''}\n\n`
    if (c.kind === 'link') return `[${c.title || c.url}](${c.url})`
    if (c.kind === 'image') return `\n![${c.caption || ''}](${fileUrl(c.file)})\n`
    if (c.kind === 'pdf') return `[${c.name || 'PDF'}](${fileUrl(c.file)})`
    return c.text
  }

  return (
    <section
      className={cx('sources', dragId && 'dragging')}
      tabIndex={-1}
      onPaste={onPaste}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          e.stopPropagation()
          handleFiles([...e.dataTransfer.files])
        }
      }}
    >
      <div className="sources-head">
        <h3>
          Sources <span className="count">{clips.length}</span>
        </h3>
        <Menu
          align="end"
          items={[
            { label: 'Link', icon: Link2, onClick: () => setAdding('link') },
            { label: 'Quote', icon: Quote, onClick: () => setAdding('quote') },
            { label: 'Screenshot / image', icon: ImageIcon, onClick: () => imgInput.current?.click() },
            { label: 'PDF', icon: FileText, onClick: () => pdfInput.current?.click() },
            { label: 'Note', icon: StickyNote, onClick: () => setAdding('text') },
          ]}
        >
          {({ ref, toggle }) => (
            <button ref={ref} className="btn sm" onClick={toggle}>
              <Plus size={14} /> Add
            </button>
          )}
        </Menu>
        <input ref={imgInput} type="file" accept="image/*" hidden multiple onChange={(e) => { handleFiles([...e.target.files]); e.target.value = '' }} />
        <input ref={pdfInput} type="file" accept="application/pdf" hidden multiple onChange={(e) => { handleFiles([...e.target.files]); e.target.value = '' }} />
      </div>

      {adding && (
        <div className="clip-add">
          {adding === 'link' && (
            <input autoFocus placeholder="Paste a link…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submitDraft()} />
          )}
          {(adding === 'quote' || adding === 'text') && (
            <textarea autoFocus rows={3} placeholder={adding === 'quote' ? 'Paste or type the quote…' : 'Write a note…'} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          )}
          {adding === 'quote' && (
            <div className="field-row">
              <input placeholder="Source (author, title)" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
              <input placeholder="Page" style={{ maxWidth: 80 }} value={draft.page} onChange={(e) => setDraft({ ...draft, page: e.target.value })} />
            </div>
          )}
          {adding === 'quote' && <input placeholder="URL (optional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />}
          <div className="clip-add-bar">
            <button className="btn primary sm" onClick={submitDraft}>
              Add
            </button>
            <button className="btn sm ghost" onClick={() => { setAdding(null); setDraft({ url: '', text: '', source: '', page: '' }) }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {busy && <div className="clip-busy">{busy}</div>}

      {clips.length === 0 && !adding && (
        <div className="sources-empty">
          <p>Collect what you’re reading here.</p>
          <p className="muted small">Paste a link, quote or screenshot, or drop a PDF anywhere on this panel.</p>
          <div className="sources-empty-btns">
            <button className="btn sm" onClick={() => setAdding('link')}><Link2 size={14} /> Link</button>
            <button className="btn sm" onClick={() => setAdding('quote')}><Quote size={14} /> Quote</button>
            <button className="btn sm" onClick={() => imgInput.current?.click()}><ImageIcon size={14} /> Image</button>
            <button className="btn sm" onClick={() => pdfInput.current?.click()}><FileText size={14} /> PDF</button>
          </div>
        </div>
      )}

      <div className="clip-list">
        {clips.map((c) => (
          <ClipCard
            key={c.id}
            clip={c}
            onChange={(next) => update(c.id, next)}
            onRemove={() => remove(c.id)}
            onInsert={() => onInsert(insertText(c))}
            onZoom={(src, alt) => setZoom({ src, alt })}
            onOpenPdf={(clip) => setUI({ pdfViewer: { file: clip.file, name: clip.name } })}
            onQuoteFromPdf={(clip, text) => add(newClip('quote', { text, source: clip.name?.replace(/\.pdf$/i, '') || '', url: '', page: '', comment: '' }))}
            dragProps={{
              draggable: true,
              onDragStart: (e) => {
                setDragId(c.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/x-folio-clip', c.id)
              },
              onDragEnd: () => { setDragId(null); setOverId(null) },
              onDragOver: (e) => {
                if (dragId && dragId !== c.id) { e.preventDefault(); setOverId(c.id) }
              },
              onDrop: (e) => {
                if (!dragId || dragId === c.id) return
                e.preventDefault()
                e.stopPropagation()
                const list = clipsRef.current
                const from = list.findIndex((x) => x.id === dragId)
                const to = list.findIndex((x) => x.id === c.id)
                const next = [...list]
                const [m] = next.splice(from, 1)
                next.splice(to, 0, m)
                apply(next)
                setDragId(null)
                setOverId(null)
              },
              'data-over': overId === c.id ? 'true' : undefined,
              'data-dragging': dragId === c.id ? 'true' : undefined,
            }}
          />
        ))}
      </div>

      {zoom && (
        <Modal onClose={() => setZoom(null)} width={1100} className="lightbox">
          <img src={zoom.src} alt={zoom.alt || ''} />
          {zoom.alt && <div className="lightbox-cap">{zoom.alt}</div>}
        </Modal>
      )}
    </section>
  )
}

export function PdfViewer({ file, name, onClose }) {
  return (
    <Modal onClose={onClose} width={1100} className="pdf-modal" label="PDF viewer">
      <ModalHeader title={name || 'PDF'} onClose={onClose}>
        <a className="btn sm" href={fileUrl(file, true)}>
          <Download size={14} /> Download
        </a>
        <a className="btn sm" href={fileUrl(file)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> New tab
        </a>
      </ModalHeader>
      <iframe title={name || 'PDF'} src={fileUrl(file)} className="pdf-frame" />
    </Modal>
  )
}
