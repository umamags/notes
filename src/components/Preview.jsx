import { forwardRef, memo, useDeferredValue, useImperativeHandle, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/markdown.js'

const Preview = forwardRef(function Preview({ markdown, resolve, onToggleTask, onFollow, onCreate, onImage, className = '' }, ref) {
  const root = useRef(null)
  const deferred = useDeferredValue(markdown)
  const html = useMemo(() => renderMarkdown(deferred, { resolve }), [deferred, resolve])

  useImperativeHandle(ref, () => ({
    scrollToHeading(text, occ) {
      const hs = [...root.current.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.textContent.trim().toLowerCase() === text.trim().toLowerCase())
      const el = hs[occ] || hs[0]
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    root: () => root.current,
  }))

  const onClick = (e) => {
    const t = e.target
    const link = t.closest?.('a.wikilink')
    if (link) {
      e.preventDefault()
      if (link.dataset.note) onFollow?.(link.dataset.note)
      else if (link.dataset.create) onCreate?.(link.dataset.create)
      return
    }
    const copy = t.closest?.('.copy-code')
    if (copy) {
      const code = copy.parentElement.querySelector('code')?.textContent || ''
      navigator.clipboard?.writeText(code)
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1400)
      return
    }
    if (t.tagName === 'INPUT' && t.dataset.task != null) {
      e.stopPropagation()
      onToggleTask?.(Number(t.dataset.task))
      return
    }
    if (t.tagName === 'IMG' && onImage) onImage(t.getAttribute('src'), t.getAttribute('alt'))
  }

  return <div ref={root} className={`md ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
})

export default memo(Preview)
