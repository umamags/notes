import { useMemo, useRef, useState } from 'react'
import { Hash, X } from 'lucide-react'
import { useStore } from '../store.js'
import { cx } from '../lib/util.js'

const clean = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]+/gu, '')
    .slice(0, 40)

export default function TagInput({ tags, onChange, placeholder = 'Add tag', compact }) {
  const notes = useStore((s) => s.notes)
  const [value, setValue] = useState('')
  const [focus, setFocus] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  const suggestions = useMemo(() => {
    if (!focus) return []
    const counts = {}
    for (const n of Object.values(notes)) if (!n.trashed) for (const t of n.tags) counts[t] = (counts[t] || 0) + 1
    const q = clean(value)
    return Object.entries(counts)
      .filter(([t]) => !tags.includes(t) && (!q || t.includes(q)))
      .sort((a, b) => (q ? Number(b[0].startsWith(q)) - Number(a[0].startsWith(q)) : 0) || b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t)
  }, [notes, tags, value, focus])

  const commit = (raw) => {
    const t = clean(raw)
    setValue('')
    if (t && !tags.includes(t)) onChange([...tags, t])
  }

  return (
    <div className={cx('tag-input', compact && 'compact')} onClick={() => inputRef.current?.focus()}>
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          <Hash size={11} />
          {t}
          <button aria-label={`Remove ${t}`} onClick={(e) => { e.stopPropagation(); onChange(tags.filter((x) => x !== t)) }}>
            <X size={11} />
          </button>
        </span>
      ))}
      <div className="tag-field">
        <input
          ref={inputRef}
          value={value}
          placeholder={tags.length ? '' : placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => { setFocus(false); if (value.trim()) commit(value) }, 120)}
          onChange={(e) => { setValue(e.target.value); setActive(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
              if (value.trim() || (e.key === 'Enter' && suggestions[active])) {
                e.preventDefault()
                commit(value.trim() ? (suggestions[active] && e.key !== ',' && clean(value) !== suggestions[active] && suggestions[active].startsWith(clean(value)) ? suggestions[active] : value) : suggestions[active])
              }
            } else if (e.key === 'Backspace' && !value && tags.length) {
              onChange(tags.slice(0, -1))
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(suggestions.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Escape') {
              setValue('')
              e.currentTarget.blur()
            }
          }}
          size={Math.max(6, value.length + 1)}
        />
        {suggestions.length > 0 && (
          <div className="tag-suggest">
            {suggestions.map((s, i) => (
              <button key={s} className={cx(i === active && 'active')} onMouseDown={(e) => { e.preventDefault(); commit(s) }}>
                <Hash size={11} />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
