import { renderMarkdown, clipsToMarkdown } from './markdown.js'
import { download, escapeHtml, safeFile, plainText, fullDate } from './util.js'

const PRINT_CSS = `
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:#1f2430;max-width:760px;margin:48px auto;padding:0 24px}
  h1.title{font-size:34px;line-height:1.2;letter-spacing:-.02em;margin:0 0 6px}
  .meta{color:#6b7280;font-size:13px;margin-bottom:32px}
  h1,h2,h3,h4{line-height:1.3;letter-spacing:-.01em;margin:1.8em 0 .5em}
  h2{font-size:24px}h3{font-size:19px}
  a{color:#4f46e5}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:#f3f4f6;padding:.15em .35em;border-radius:5px}
  pre{background:#f6f7f9;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;overflow:auto;line-height:1.5}
  pre code{background:none;padding:0}
  pre .copy-code,pre .code-lang{display:none}
  blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid #c7d2fe;color:#4b5563}
  table{border-collapse:collapse;width:100%;font-size:15px}
  th,td{border:1px solid #e5e7eb;padding:8px 12px;text-align:left}
  th{background:#f9fafb}
  img{max-width:100%;border-radius:8px}
  .callout{border:1px solid #e5e7eb;border-left:4px solid #6366f1;border-radius:8px;padding:10px 16px;margin:1em 0;background:#f8f9ff}
  .callout-title{font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#4f46e5}
  .wikilink{text-decoration:none;border-bottom:1px dotted #6366f1}
  input[type=checkbox]{margin-right:6px}
  .hljs-comment,.hljs-quote{color:#6b7280}.hljs-keyword,.hljs-selector-tag{color:#7c3aed}.hljs-string,.hljs-attr{color:#0f766e}.hljs-number,.hljs-literal{color:#b45309}.hljs-title,.hljs-section{color:#2563eb}
  @media print{body{margin:0;max-width:none}a{color:inherit}}
`

async function inlineImages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imgs = [...doc.querySelectorAll('img')]
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || ''
      if (!src || src.startsWith('data:') || /^https?:/i.test(src)) return
      try {
        const res = await fetch(src)
        const blob = await res.blob()
        const data = await new Promise((resolve) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result)
          r.readAsDataURL(blob)
        })
        img.setAttribute('src', data)
      } catch { /* leave as is */ }
    }),
  )
  return doc.body.innerHTML
}

function fullMarkdown(note) {
  const sources = note.type === 'research' ? clipsToMarkdown(note.clips) : ''
  return (note.body || '').trimEnd() + (sources ? '\n\n' + sources : '')
}

export async function noteToHtml(note, resolve, { embedImages = true } = {}) {
  let body = renderMarkdown(fullMarkdown(note), { resolve })
  body = body.replace(/<a class="wikilink[^>]*>(.*?)<\/a>/g, '<span class="wikilink">$1</span>')
  if (embedImages) body = await inlineImages(body)
  const title = note.title || 'Untitled'
  const tags = (note.tags || []).map((t) => '#' + t).join('  ')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body><h1 class="title">${escapeHtml(title)}</h1><div class="meta">${escapeHtml(fullDate(note.updated))}${tags ? ' · ' + escapeHtml(tags) : ''}</div>${body}</body></html>`
}

export async function exportHtml(note, resolve) {
  const html = await noteToHtml(note, resolve)
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${safeFile(note.title)}.html`)
}

export function exportText(note) {
  const text = `${note.title || 'Untitled'}\n${'='.repeat(Math.min(60, (note.title || 'Untitled').length))}\n\n${fullMarkdown(note)}`
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeFile(note.title)}.txt`)
}

export function exportPlain(note) {
  const text = `${note.title || 'Untitled'}\n\n${plainText(fullMarkdown(note))}`
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeFile(note.title)}.txt`)
}

export function exportJson(note) {
  download(new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' }), `${safeFile(note.title)}.json`)
}

/** "PDF" export = clean print view. The browser's Save as PDF does the rest. */
export async function printNote(note, resolve) {
  const html = await noteToHtml(note, resolve)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0'
  document.body.appendChild(frame)
  frame.srcdoc = html
  frame.onload = () => {
    setTimeout(() => {
      frame.contentWindow.focus()
      frame.contentWindow.print()
      setTimeout(() => frame.remove(), 3000)
    }, 250)
  }
}

export const exportMarkdownUrl = (id) => `api/export/note/${id}`
export const exportNotebookUrl = (id) => `api/export/notebook/${id}`
export const exportAllUrl = () => 'api/export/all'

export function triggerDownload(url) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Parse a markdown file (optionally with simple YAML front matter) into note fields. */
export function parseMarkdownFile(name, text) {
  let body = text.replace(/\r\n/g, '\n')
  let title = ''
  let tags = []
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body)
  if (fm) {
    body = body.slice(fm[0].length)
    const t = /^title:\s*(.+)$/m.exec(fm[1])
    if (t) {
      title = t[1].trim()
      try { title = JSON.parse(title) } catch { title = title.replace(/^["']|["']$/g, '') }
    }
    const tg = /^tags:\s*\[(.*)\]\s*$/m.exec(fm[1])
    if (tg) tags = tg[1].split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (!title) {
    const h = /^#\s+(.+)$/m.exec(body)
    if (h && body.trimStart().startsWith('# ')) {
      title = h[1].trim()
      body = body.replace(/^\s*#\s+.+\n+/, '')
    }
  }
  if (!title) title = name.replace(/\.(md|markdown|txt)$/i, '')
  return { title, body: body.trim() + '\n', tags }
}
