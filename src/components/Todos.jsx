import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, FileText, Plus, Trash2 } from 'lucide-react'
import { useStore, TODO_PRIORITY, TODO_STATUS, todoSummary } from '../store.js'
import { cx, uid } from '../lib/util.js'
import { toggleTask } from '../lib/markdown.js'
import Preview from './Preview.jsx'
import { Menu, Segmented } from './ui.jsx'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
]

const noLinks = () => null

const newItem = (text = '') => ({ id: uid(8), text, notes: '', status: 'open', priority: 'medium', created: Date.now() })
const labelOf = (list, value) => list.find((o) => o.value === value)?.label ?? value

/** Checklist editor for a ToDo note. Every change goes through patchNote, so it saves and conflict-checks like body text. */
export default function TodoView({ note, readOnly }) {
  const patchNote = useStore((s) => s.patchNote)
  const [filter, setFilter] = useState('all')
  const [focusId, setFocusId] = useState(null)
  const [draft, setDraft] = useState('')
  const items = note.items || []
  const summary = todoSummary(items)
  const done = summary.total - summary.open

  const setItems = (next) => patchNote(note.id, { items: next })
  const update = (i, patch) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const remove = (i) => setItems(items.filter((_, j) => j !== i))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  const insertAfter = (i) => {
    const it = newItem()
    setItems([...items.slice(0, i + 1), it, ...items.slice(i + 1)])
    setFocusId(it.id)
  }
  const addFromDraft = () => {
    const text = draft.trim()
    if (!text) return
    setItems([...items, newItem(text)])
    setDraft('')
  }

  const visible = items.map((it, i) => ({ it, i })).filter(({ it }) => filter === 'all' || it.status !== 'done')

  return (
    <div className="todo-wrap">
      <div className="todo-bar">
        <span className="todo-progress">
          {summary.total === 0 ? 'No items yet' : `${summary.open} open · ${done} done`}
        </span>
        <div className="grow" />
        <Segmented size="sm" value={filter} onChange={setFilter} options={FILTERS} />
      </div>

      <div className="todo-list">
        {visible.map(({ it, i }) => (
          <TodoRow
            key={it.id}
            item={it}
            index={i}
            last={items.length - 1}
            readOnly={readOnly}
            autoFocus={focusId === it.id}
            onChange={(patch) => update(i, patch)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
            onEnter={() => insertAfter(i)}
          />
        ))}
        {filter === 'open' && items.length > 0 && visible.length === 0 && (
          <p className="todo-empty muted small">Everything is done. Switch to All to see completed items.</p>
        )}
        {items.length === 0 && !readOnly && <p className="todo-empty muted small">Add the first item below.</p>}
      </div>

      {!readOnly && (
        <div className="todo-add">
          <Plus size={15} />
          <input
            value={draft}
            placeholder="Add an item…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                addFromDraft()
              }
            }}
          />
        </div>
      )}
    </div>
  )
}

function TodoRow({ item, index, last, readOnly, autoFocus, onChange, onMove, onRemove, onEnter }) {
  const [showNotes, setShowNotes] = useState(!!item.notes)
  const [editingNotes, setEditingNotes] = useState(false)
  const isDone = item.status === 'done'
  const hasNotes = !!item.notes?.trim()

  return (
    <div className={cx('todo-row', isDone && 'done')}>
      <button
        className="todo-check"
        disabled={readOnly}
        aria-label={isDone ? 'Mark as open' : 'Mark as done'}
        title={isDone ? 'Mark as open' : 'Mark as done'}
        onClick={() => onChange({ status: isDone ? 'open' : 'done' })}
      >
        <Check size={13} strokeWidth={3} />
      </button>

      <div className="todo-main">
        <div className="todo-line">
          <input
            className="todo-text"
            value={item.text}
            autoFocus={autoFocus}
            readOnly={readOnly}
            placeholder="What needs doing?"
            spellCheck
            onChange={(e) => onChange({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (item.text.trim()) onEnter()
              }
            }}
            onBlur={() => {
              if (!item.text.trim() && !item.notes?.trim()) onRemove()
            }}
          />

          <Menu
            items={TODO_STATUS.map((s) => ({ label: s.label, checked: s.value === item.status, onClick: () => onChange({ status: s.value }) }))}
          >
            {({ ref, toggle }) => (
              <button ref={ref} className="todo-pill" onClick={toggle} disabled={readOnly} title="Status">
                <span className={cx('todo-dot', item.status)} />
                {labelOf(TODO_STATUS, item.status)}
              </button>
            )}
          </Menu>

          <Menu
            items={TODO_PRIORITY.map((p) => ({ label: p.label, checked: p.value === item.priority, onClick: () => onChange({ priority: p.value }) }))}
          >
            {({ ref, toggle }) => (
              <button ref={ref} className="todo-pill" onClick={toggle} disabled={readOnly} title="Priority">
                <span className={cx('todo-dot prio', item.priority)} />
                {labelOf(TODO_PRIORITY, item.priority)}
              </button>
            )}
          </Menu>

          <div className="todo-actions">
            <button
              className={cx('icon-btn xs', (showNotes || hasNotes) && 'on')}
              title={hasNotes ? 'Notes' : 'Add notes'}
              onClick={() => {
                setShowNotes((v) => !v)
                if (!hasNotes) setEditingNotes(true)
              }}
            >
              <FileText size={14} />
            </button>
            {!readOnly && (
              <>
                <button className="icon-btn xs" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn xs" title="Move down" disabled={index === last} onClick={() => onMove(1)}>
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn xs" title="Delete item" onClick={onRemove}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {showNotes && (
          <div className="todo-notes">
            {editingNotes && !readOnly ? (
              <textarea
                autoFocus
                value={item.notes}
                rows={Math.min(12, Math.max(3, item.notes.split('\n').length + 1))}
                placeholder="Notes for this item — Markdown works"
                onChange={(e) => onChange({ notes: e.target.value })}
                onBlur={() => setEditingNotes(false)}
              />
            ) : hasNotes ? (
              <div
                onClick={(e) => {
                  if (readOnly || e.target.closest('a, input, button')) return
                  setEditingNotes(true)
                }}
              >
                <Preview markdown={item.notes} resolve={noLinks} onToggleTask={(n) => !readOnly && onChange({ notes: toggleTask(item.notes, n) })} />
              </div>
            ) : (
              <button className="link-btn small" disabled={readOnly} onClick={() => setEditingNotes(true)}>Add notes…</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
