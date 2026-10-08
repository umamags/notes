import { api } from '../api.js'

// pdf.js relies on very new Map/WeakMap helpers that many browsers don't have yet
for (const C of [Map, WeakMap]) {
  const P = C.prototype
  if (!P.getOrInsert) P.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k) }
  if (!P.getOrInsertComputed) P.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k) }
}



let pdfjsPromise
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/**
 * Import a PDF: store it, extract its text in the browser (pdf.js — no server tooling needed),
 * render a first-page thumbnail, and return a ready-to-use "pdf" clip.
 */
export async function importPdf(file, onProgress = () => {}) {
  onProgress('Uploading PDF…')
  const uploaded = await api.upload(file)

  let pages = 0
  let text = ''
  let title = ''
  let thumbId = ''
  try {
    const pdfjs = await loadPdfjs()
    const data = new Uint8Array(await file.arrayBuffer())
    const task = pdfjs.getDocument({ data })
    const doc = await task.promise
    pages = doc.numPages
    try {
      const meta = await doc.getMetadata()
      title = (meta?.info?.Title || '').trim()
    } catch { /* metadata is optional */ }

    // thumbnail of page 1
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const scale = 360 / base.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      if (blob) thumbId = (await api.upload(blob, 'thumbnail.png')).id
    } catch (e) { console.warn('PDF thumbnail failed', e) }

    const maxPages = Math.min(pages, 600)
    const parts = []
    let total = 0
    for (let p = 1; p <= maxPages; p++) {
      onProgress(`Extracting text… page ${p} of ${pages}`)
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      let s = ''
      for (const it of content.items) {
        if (typeof it.str !== 'string') continue
        s += it.str
        s += it.hasEOL ? '\n' : ' '
      }
      s = s.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
      parts.push(s)
      total += s.length
      page.cleanup()
      if (total > 2_500_000) break
    }
    text = parts.join('\n\n')
    try { await task.destroy() } catch { /* ignore */ }
    if (text.trim()) {
      onProgress('Indexing for search…')
      await api.saveFileText(uploaded.id, text)
    }
  } catch (e) {
    console.warn('PDF text extraction failed', e)
  }

  const name = (title || uploaded.name.replace(/\.pdf$/i, '')).trim()
  return {
    title: name,
    text,
    clip: {
      kind: 'pdf',
      file: uploaded.id,
      name: uploaded.name,
      thumb: thumbId,
      pages,
      size: uploaded.size,
      comment: '',
    },
  }
}
