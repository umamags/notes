import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, dropCursor, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { fuzzy, isUrl } from '../lib/util.js'

const mdStyle = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-h1' },
  { tag: t.heading2, class: 'tok-h2' },
  { tag: t.heading3, class: 'tok-h3' },
  { tag: [t.heading4, t.heading5, t.heading6], class: 'tok-h4' },
  { tag: t.strong, class: 'tok-strong' },
  { tag: t.emphasis, class: 'tok-em' },
  { tag: t.strikethrough, class: 'tok-strike' },
  { tag: t.link, class: 'tok-link' },
  { tag: t.url, class: 'tok-url' },
  { tag: t.monospace, class: 'tok-code' },
  { tag: t.quote, class: 'tok-quote' },
  { tag: [t.processingInstruction, t.contentSeparator], class: 'tok-mark' },
])

const wikiDeco = new MatchDecorator({
  regexp: /\[\[[^\]\n]+\]\]/g,
  decoration: () => Decoration.mark({ class: 'cm-wikilink' }),
})
const wikiPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = wikiDeco.createDeco(view)
    }
    update(u) {
      this.decorations = wikiDeco.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

const structural = EditorView.theme({
  '&': { height: 'auto', background: 'transparent' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: 0, caretColor: 'var(--accent)' },
  '.cm-line': { padding: 0 },
  '&.cm-focused': { outline: 'none' },
})

// ------------------------------------------------------------------ formatting commands

function wrap(view, before, after = before) {
  const tr = view.state.changeByRange((range) => {
    const s = view.state
    const text = s.sliceDoc(range.from, range.to)
    const bf = s.sliceDoc(Math.max(0, range.from - before.length), range.from)
    const af = s.sliceDoc(range.to, range.to + after.length)
    if (bf === before && af === after) {
      return {
        changes: [{ from: range.from - before.length, to: range.from }, { from: range.to, to: range.to + after.length }],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      }
    }
    if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
      return {
        changes: [{ from: range.from, to: range.from + before.length }, { from: range.to - after.length, to: range.to }],
        range: EditorSelection.range(range.from, range.to - before.length - after.length),
      }
    }
    return {
      changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    }
  })
  view.dispatch(tr, { scrollIntoView: true, userEvent: 'input' })
  view.focus()
}

function toggleLinePrefix(view, prefix, kind) {
  const { state } = view
  const lines = []
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const b = state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) if (!lines.includes(n)) lines.push(n)
  }
  const re = kind === 'heading' ? /^#{1,6}\s+/ : kind === 'ol' ? /^\d+\.\s+/ : kind === 'task' ? /^[-*+]\s+\[[ xX]\]\s+/ : kind === 'ul' ? /^[-*+]\s+(?!\[[ xX]\])/ : /^>\s?/
  const all = lines.every((n) => re.test(state.doc.line(n).text))
  const changes = []
  lines.forEach((n, i) => {
    const line = state.doc.line(n)
    const m = re.exec(line.text)
    if (all && m) changes.push({ from: line.from, to: line.from + m[0].length })
    else {
      const stripped = kind === 'heading' || m ? (m ? m[0].length : 0) : 0
      const p = kind === 'ol' ? `${i + 1}. ` : prefix
      changes.push({ from: line.from, to: line.from + stripped, insert: p })
    }
  })
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' })
  view.focus()
}

function insertLink(view) {
  const { state } = view
  const r = state.selection.main
  const text = state.sliceDoc(r.from, r.to)
  const insert = `[${text || 'link text'}](url)`
  const urlFrom = r.from + insert.length - 4
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.range(urlFrom, urlFrom + 3), scrollIntoView: true })
  view.focus()
}

const formatKeymap = [
  { key: 'Mod-b', run: (v) => (wrap(v, '**'), true) },
  { key: 'Mod-i', run: (v) => (wrap(v, '*'), true) },
  { key: 'Mod-Shift-x', run: (v) => (wrap(v, '~~'), true) },
  { key: 'Mod-Shift-c', run: (v) => (wrap(v, '`'), true) },
  { key: 'Mod-Shift-k', run: (v) => (insertLink(v), true) },
  { key: 'Mod-Shift-7', run: (v) => (toggleLinePrefix(v, '1. ', 'ol'), true) },
  { key: 'Mod-Shift-8', run: (v) => (toggleLinePrefix(v, '- ', 'ul'), true) },
  { key: 'Mod-Shift-9', run: (v) => (toggleLinePrefix(v, '- [ ] ', 'task'), true) },
]

// ------------------------------------------------------------------ component

// Enter on an empty bullet / numbered / task item removes the marker (ends the list)
function exitEmptyListItem(view) {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.to) return false
  if (!/^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/.test(line.text)) return false
  view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from }, userEvent: 'delete' })
  return true
}

const Editor = forwardRef(function Editor({ noteId, epoch, syncTick, doc, onChange, getTitles, onCreateLink, onFiles, onFollowLink, spellcheck, placeholderText }, ref) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const statesRef = useRef(new Map())
  const keyRef = useRef(null)
  const spellRef = useRef(new Compartment())
  const cb = useRef({})
  cb.current = { onChange, getTitles, onCreateLink, onFiles, onFollowLink }
  const docRef = useRef(doc)
  docRef.current = doc
  const ignoreRef = useRef(false)

  function buildState(text) {
    const wikiSource = async (ctx) => {
      const m = ctx.matchBefore(/\[\[[^\]\[\n]*/)
      if (!m) return null
      const q = m.text.slice(2)
      const titles = cb.current.getTitles?.() || []
      let ranked
      if (!q.trim()) ranked = titles.slice(0, 12)
      else {
        ranked = titles
          .map((n) => ({ n, f: fuzzy(q, n.title) }))
          .filter((x) => x.f)
          .sort((a, b) => b.f.score - a.f.score)
          .slice(0, 12)
          .map((x) => x.n)
      }
      const insertTitle = (view, from, to, title) => {
        const hasClose = view.state.sliceDoc(to, to + 2) === ']]'
        view.dispatch({
          changes: { from, to: hasClose ? to + 2 : to, insert: title + ']]' },
          selection: { anchor: from + title.length + 2 },
          userEvent: 'input.complete',
        })
      }
      const options = ranked.map((n) => ({
        label: n.title,
        detail: n.type === 'research' ? 'research' : '',
        apply: (view, _c, from, to) => insertTitle(view, from, to, n.title),
      }))
      const exact = titles.some((n) => n.title.toLowerCase() === q.trim().toLowerCase())
      if (q.trim() && !exact) {
        options.push({
          label: `Create “${q.trim()}”`,
          type: 'create',
          apply: (view, _c, from, to) => {
            insertTitle(view, from, to, q.trim())
            cb.current.onCreateLink?.(q.trim())
          },
        })
      }
      return { from: m.from + 2, options, filter: false }
    }

    return EditorState.create({
      doc: text,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdStyle),
        wikiPlugin,
        structural,
        placeholder(placeholderText || 'Start writing…   Type [[ to link to another note.'),
        autocompletion({ override: [wikiSource], icons: false, activateOnTyping: true, closeOnBlur: true, maxRenderedOptions: 12 }),
        keymap.of([{ key: 'Enter', run: exitEmptyListItem }, ...formatKeymap, ...completionKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
        spellRef.current.of(EditorView.contentAttributes.of({ spellcheck: spellcheck ? 'true' : 'false', autocapitalize: 'sentences' })),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !ignoreRef.current) cb.current.onChange?.(u.state.doc.toString())
        }),
        EditorView.domEventHandlers({
          paste(e, view) {
            const files = [...(e.clipboardData?.files || [])]
            if (files.length) {
              e.preventDefault()
              cb.current.onFiles?.(files, view)
              return true
            }
            const text = e.clipboardData?.getData('text/plain') || ''
            const sel = view.state.selection.main
            if (isUrl(text) && !sel.empty) {
              e.preventDefault()
              const label = view.state.sliceDoc(sel.from, sel.to)
              const insert = `[${label}](${text.trim()})`
              view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.paste' })
              return true
            }
            return false
          },
          drop(e, view) {
            const files = [...(e.dataTransfer?.files || [])]
            if (!files.length) return false
            e.preventDefault()
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos != null) view.dispatch({ selection: { anchor: pos } })
            cb.current.onFiles?.(files, view)
            return true
          },
          mousedown(e, view) {
            if (!(e.metaKey || e.ctrlKey)) return false
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos == null) return false
            const line = view.state.doc.lineAt(pos)
            const re = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g
            let m
            while ((m = re.exec(line.text))) {
              const a = line.from + m.index
              if (pos >= a && pos <= a + m[0].length) {
                e.preventDefault()
                cb.current.onFollowLink?.(m[1].trim())
                return true
              }
            }
            return false
          },
        }),
      ],
    })
  }

  // create the view once
  useLayoutEffect(() => {
    const view = new EditorView({ state: EditorState.create({ doc: '' }), parent: hostRef.current })
    viewRef.current = view
    keyRef.current = null
    return () => {
      view.destroy()
      viewRef.current = null
      keyRef.current = null
    }
  }, [])

  // switch notes: keep each note's undo history + cursor while its tab stays warm
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    const key = `${noteId}:${epoch}`
    if (keyRef.current === key) return
    if (keyRef.current) statesRef.current.set(keyRef.current, view.state)
    let st = statesRef.current.get(key)
    if (st && st.doc.toString() !== docRef.current) st = null
    if (!st) st = buildState(docRef.current ?? '')
    view.setState(st)
    keyRef.current = key
    if (statesRef.current.size > 24) statesRef.current.delete(statesRef.current.keys().next().value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, epoch])

  // pick up changes made outside the editor (task ticks, "insert into notes") — only when the parent says so,
  // never as an echo of our own typing
  useEffect(() => {
    const v = viewRef.current
    if (!v || !syncTick || docRef.current == null) return
    const doc = docRef.current
    if (v.state.doc.length === doc.length && v.state.doc.toString() === doc) return
    ignoreRef.current = true
    try {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc }, annotations: Transaction.addToHistory.of(false) })
    } finally {
      ignoreRef.current = false
    }
  }, [syncTick])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: spellRef.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: spellcheck ? 'true' : 'false', autocapitalize: 'sentences' })) })
  }, [spellcheck])

  useImperativeHandle(ref, () => ({
    focus: (end) => {
      const v = viewRef.current
      if (!v) return
      v.focus()
      if (end) v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true })
    },
    insert: (text) => {
      const v = viewRef.current
      if (!v) return
      const r = v.state.selection.main
      v.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length }, scrollIntoView: true, userEvent: 'input' })
      v.focus()
    },
    wrap: (a, b) => viewRef.current && wrap(viewRef.current, a, b),
    prefix: (p, kind) => viewRef.current && toggleLinePrefix(viewRef.current, p, kind),
    link: () => viewRef.current && insertLink(viewRef.current),
    selection: () => {
      const v = viewRef.current
      if (!v) return ''
      const r = v.state.selection.main
      return v.state.sliceDoc(r.from, r.to)
    },
    scrollToLine: (line) => {
      const v = viewRef.current
      if (!v) return
      const l = v.state.doc.line(Math.min(v.state.doc.lines, line + 1))
      v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 90 }) })
      v.focus()
    },
    view: () => viewRef.current,
  }))

  return <div className="cm-host" ref={hostRef} />
})

export default Editor
