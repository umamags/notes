import { api } from './api.js'
import { importPdf } from './lib/pdf.js'
import { currentRoute } from './router.js'
import { useStore } from './store.js'
import { uid } from './lib/util.js'

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isMd = (f) => /\.(md|markdown|txt)$/i.test(f.name) || f.type === 'text/markdown' || f.type === 'text/plain'
const isImage = (f) => f.type.startsWith('image/')

export async function importPdfAsNote(file) {
  const { setProgress, createNote, toast } = useStore.getState()
  const { view } = currentRoute()
  setProgress('Importing PDF…')
  try {
    const res = await importPdf(file, setProgress)
    const id = await createNote({
      title: res.title,
      type: 'research',
      notebook: view.kind === 'notebook' ? view.id : 'inbox',
      clips: [{ ...res.clip, id: uid(8), createdAt: Date.now() }],
      status: 'to-read',
    })
    toast(res.text ? `Imported “${res.title}” — ${res.clip.pages} pages indexed for search` : `Imported “${res.title}” (no extractable text found)`)
    return id
  } catch (e) {
    toast('PDF import failed: ' + e.message)
  } finally {
    setProgress('')
  }
}

export async function importImageAsNote(file) {
  const { createNote, toast } = useStore.getState()
  try {
    const up = await api.upload(file, file.name || 'image.png')
    return createNote({
      title: (file.name || 'Screenshot').replace(/\.[a-z0-9]+$/i, ''),
      type: 'research',
      clips: [{ id: uid(8), kind: 'image', file: up.id, caption: '', createdAt: Date.now() }],
    })
  } catch (e) {
    toast('Image upload failed: ' + e.message)
  }
}

/** Route any dropped / picked files to the right importer. */
export async function importFiles(fileList) {
  const files = [...fileList]
  const { toast, importMarkdownFiles } = useStore.getState()
  const md = files.filter(isMd)
  const pdfs = files.filter(isPdf)
  const imgs = files.filter(isImage)
  const other = files.length - md.length - pdfs.length - imgs.length
  if (md.length) await importMarkdownFiles(md)
  for (const f of pdfs) await importPdfAsNote(f)
  for (const f of imgs) await importImageAsNote(f)
  if (other > 0) toast(`${other} file${other === 1 ? ' was' : 's were'} skipped — Folio imports Markdown, text, PDF and images`)
}

export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve([...input.files])
    input.click()
  })
}
