import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import python from 'highlight.js/lib/languages/python'
import php from 'highlight.js/lib/languages/php'
import go from 'highlight.js/lib/languages/go'
import diff from 'highlight.js/lib/languages/diff'
import csharp from 'highlight.js/lib/languages/csharp'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import markdownLang from 'highlight.js/lib/languages/markdown'
import { escapeHtml, plainText } from './util.js'

const langs = { javascript, typescript, json, xml, css, bash, yaml, sql, java, python, php, go, diff, csharp, dockerfile, markdown: markdownLang }
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def)
const aliases = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'xml', svg: 'xml', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', py: 'python', cs: 'csharp', md: 'markdown', docker: 'dockerfile', jsonc: 'json' }
for (const [a, n] of Object.entries(aliases)) hljs.registerAliases(a, { languageName: n })

const ctx = { resolve: () => null, taskIndex: 0 }

const CALLOUTS = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = /^\[\[([^\[\]|#\n]+?)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]/.exec(src)
    if (m) return { type: 'wikilink', raw: m[0], title: m[1].trim(), anchor: m[2] || '', alias: m[3] || '' }
  },
  renderer(tok) {
    const label = escapeHtml(tok.alias || tok.title)
    const target = ctx.resolve(tok.title)
    if (target) return `<a class="wikilink" href="#/all/n/${target.id}" data-note="${target.id}">${label}</a>`
    return `<a class="wikilink ghost" href="#" data-create="${escapeHtml(tok.title)}" title="This note doesn’t exist yet — click to create it">${label}</a>`
  },
}

const marked = new Marked({ gfm: true, breaks: false })
marked.use({
  extensions: [wikilink],
  renderer: {
    code({ text, lang }) {
      const l = (lang || '').trim().split(/\s+/)[0].toLowerCase()
      let html
      if (l && hljs.getLanguage(l)) html = hljs.highlight(text, { language: l, ignoreIllegals: true }).value
      else html = escapeHtml(text)
      const label = l ? `<span class="code-lang">${escapeHtml(l)}</span>` : ''
      return `<pre>${label}<button class="copy-code" type="button">Copy</button><code class="hljs">${html}</code></pre>`
    },
    checkbox({ checked }) {
      return `<input type="checkbox" data-task="${ctx.taskIndex++}"${checked ? ' checked' : ''}> `
    },
    blockquote({ tokens }) {
      const inner = this.parser.parse(tokens)
      const m = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i.exec(inner)
      if (!m) return `<blockquote>${inner}</blockquote>\n`
      const kind = m[1].toLowerCase()
      let rest = inner.slice(m[0].length)
      rest = rest.startsWith('</p>') ? rest.slice(4) : '<p>' + rest
      return `<div class="callout callout-${kind}"><div class="callout-title">${CALLOUTS[kind]}</div>${rest}</div>\n`
    },
  },
})

let hooked = false
function ensureHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      }
    }
    if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') node.removeAttribute('disabled')
  })
}

/** Render markdown to sanitised HTML. `resolve(title)` maps [[Title]] → {id} | null. */
export function renderMarkdown(md, { resolve } = {}) {
  ensureHooks()
  ctx.resolve = resolve || (() => null)
  ctx.taskIndex = 0
  let html = marked.parse(md || '')
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')
  return DOMPurify.sanitize(html, { ADD_TAGS: ['button'], ADD_ATTR: ['data-note', 'data-create', 'data-task', 'target'] })
}

/** Headings (outside code fences) for the outline panel. */
export function outline(md) {
  const out = []
  let fence = null
  const seen = {}
  const lines = (md || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    const f = /^ {0,3}(```|~~~)/.exec(ln)
    if (f) {
      fence = fence === f[1] ? null : fence || f[1]
      continue
    }
    if (fence) continue
    const m = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln)
    if (m) {
      const text = plainText(m[2]) || m[2]
      const key = text.toLowerCase()
      seen[key] = (seen[key] || 0) + 1
      out.push({ level: m[1].length, text, line: i, occ: seen[key] - 1 })
    }
  }
  return out
}

/** Flip the nth task checkbox in the markdown source. */
export function toggleTask(md, index) {
  const lines = md.split('\n')
  let fence = null
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const f = /^ {0,3}(```|~~~)/.exec(lines[i])
    if (f) {
      fence = fence === f[1] ? null : fence || f[1]
      continue
    }
    if (fence) continue
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s)/.exec(lines[i])
    if (m) {
      if (n === index) {
        lines[i] = m[1] + (m[2] === ' ' ? '[x]' : '[ ]') + lines[i].slice(m[0].length - 1)
        return lines.join('\n')
      }
      n++
    }
  }
  return md
}

export function clipsToMarkdown(clips) {
  const out = []
  for (const c of clips || []) {
    if (c.kind === 'link') {
      out.push(`- [${c.title || c.url}](${c.url})${c.site ? ' — ' + c.site : ''}${c.comment ? '\n  *My note:* ' + c.comment.replace(/\n/g, ' ') : ''}`)
    } else if (c.kind === 'quote') {
      const attr = [c.source, c.page && 'p. ' + c.page].filter(Boolean).join(', ')
      out.push(c.text.split('\n').map((l) => '> ' + l).join('\n') + (attr || c.url ? `\n> — ${attr}${c.url ? ` (${c.url})` : ''}` : '') + (c.comment ? `\n\n*My note:* ${c.comment}` : ''))
    } else if (c.kind === 'image') {
      out.push(`![${c.caption || ''}](api/files/${c.file})`)
    } else if (c.kind === 'pdf') {
      out.push(`- 📄 [${c.name || 'PDF'}](api/files/${c.file})`)
    } else if (c.kind === 'text') {
      out.push(c.text)
    }
  }
  return out.length ? '## Collected sources\n\n' + out.join('\n\n') + '\n' : ''
}
