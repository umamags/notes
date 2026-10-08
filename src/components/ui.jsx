import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { cx } from '../lib/util.js'
import { useStore } from '../store.js'

export function useMedia(query) {
  const [m, setM] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    h()
    return () => mq.removeEventListener('change', h)
  }, [query])
  return m
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>
}

// ------------------------------------------------------------------ menus

function MenuList({ items, anchor, point, align = 'start', onClose, minWidth = 200 }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left
    let top
    if (point) {
      left = point.x
      top = point.y
    } else {
      const a = anchor.getBoundingClientRect()
      left = align === 'end' ? a.right - r.width : a.left
      top = a.bottom + 6
      if (top + r.height > innerHeight - 8) top = Math.max(8, a.top - r.height - 6)
    }
    left = Math.max(8, Math.min(left, innerWidth - r.width - 8))
    top = Math.max(8, Math.min(top, innerHeight - r.height - 8))
    setPos({ left, top })
  }, [anchor, point, align, items])

  const actionable = items.map((it, i) => (it.divider || it.header || it.disabled ? -1 : i)).filter((i) => i >= 0)

  useEffect(() => {
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = actionable.indexOf(active)
        const next = e.key === 'ArrowDown' ? (cur + 1) % actionable.length : (cur <= 0 ? actionable.length : cur) - 1
        setActive(actionable[next])
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault()
        const it = items[active]
        onClose()
        it.onClick?.()
      }
    }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  })

  return createPortal(
    <div ref={ref} className="menu" style={{ left: pos.left, top: pos.top, minWidth }} role="menu">
      {items.map((it, i) => {
        if (it.divider) return <div key={i} className="menu-divider" />
        if (it.header) return <div key={i} className="menu-header">{it.header}</div>
        const Icon = it.icon
        return (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            className={cx('menu-item', it.danger && 'danger', active === i && 'active')}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            <span className="menu-ico">{it.checked ? <Check size={15} /> : Icon ? <Icon size={15} /> : it.swatch ? <span className={cx('swatch', 'c-' + it.swatch)} /> : null}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

/** <Menu items=[…]>{({ref, toggle, open}) => <button ref={ref} onClick={toggle}/>}</Menu> */
export function Menu({ items, children, align = 'start', minWidth }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const toggle = useCallback((e) => {
    e?.stopPropagation?.()
    setOpen((o) => !o)
  }, [])
  const resolved = typeof items === 'function' ? (open ? items() : []) : items
  return (
    <>
      {children({ ref, toggle, open })}
      {open && ref.current && <MenuList items={resolved} anchor={ref.current} align={align} minWidth={minWidth} onClose={() => setOpen(false)} />}
    </>
  )
}

export function useContextMenu() {
  const [state, setState] = useState(null)
  const open = useCallback((e, items) => {
    e.preventDefault()
    e.stopPropagation()
    setState({ point: { x: e.clientX, y: e.clientY }, items })
  }, [])
  const element = state ? <MenuList items={state.items} point={state.point} onClose={() => setState(null)} /> : null
  return [open, element]
}

// ------------------------------------------------------------------ modal

export function Modal({ children, onClose, width = 560, className, label }) {
  const ref = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', key, true)
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', key, true)
      prev?.focus?.()
    }
  }, [onClose])
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={cx('modal', className)} style={{ maxWidth: width }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function ModalHeader({ title, onClose, children }) {
  return (
    <div className="modal-head">
      <h2>{title}</h2>
      <div className="grow" />
      {children}
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ toasts

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                dismiss(t.id)
                t.action()
              }}
            >
              {t.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ small bits

export function Segmented({ value, onChange, options, size }) {
  return (
    <div className={cx('segmented', size)} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={cx(value === o.value && 'on')} onClick={() => onChange(o.value)} title={o.title}>
          {o.icon}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children }) {
  return (
    <div className="empty">
      {icon && <div className="empty-ico">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}

export function Highlight({ text, ranges }) {
  if (!ranges || !ranges.length) return <>{text}</>
  const out = []
  let pos = 0
  const chars = Array.from(text)
  ranges.forEach(([start, len], i) => {
    if (start < pos) return
    out.push(chars.slice(pos, start).join(''))
    out.push(<mark key={i}>{chars.slice(start, start + len).join('')}</mark>)
    pos = start + len
  })
  out.push(chars.slice(pos).join(''))
  return <>{out}</>
}

export const NB_COLORS = ['slate', 'indigo', 'teal', 'rose', 'amber', 'green', 'sky', 'violet']

export function confirmDialog(message) {
  return window.confirm(message)
}
