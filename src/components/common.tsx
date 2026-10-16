import { useMemo, useRef, useState } from 'react'
import type { Program } from '../types'

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function ProgressBar({ total, completed, inProgress = 0, planned = 0, thin }: { total: number; completed: number; inProgress?: number; planned?: number; thin?: boolean }) {
  const pct = (n: number) => (total > 0 ? `${Math.min(100, (n / total) * 100)}%` : '0%')
  return (
    <div className={`bar${thin ? ' thin' : ''}`} role="img" aria-label={`${fmt(completed)} of ${fmt(total)} credits completed`}>
      <i className="c" style={{ width: pct(completed) }} />
      <i className="p" style={{ width: pct(inProgress) }} />
      <i className="l" style={{ width: pct(planned) }} />
    </div>
  )
}

export function Legend() {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--done)' }} />Completed</span>
      <span><i style={{ background: 'var(--ip)' }} />In progress</span>
      <span><i style={{ background: 'var(--plan)', opacity: 0.7 }} />Planned</span>
    </div>
  )
}

export function ProgramPicker({ programs, value, onChange, placeholder = 'Search majors and minors…', filter }: {
  programs: Program[]
  value?: string | null
  onChange: (id: string) => void
  placeholder?: string
  filter?: (p: Program) => boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const current = programs.find((p) => p.id === value)
  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    return programs
      .filter((p) => (filter ? filter(p) : true))
      .filter((p) => terms.every((t) => `${p.name} ${p.college}`.toLowerCase().includes(t)))
      .slice(0, 60)
  }, [programs, q, filter])
  const pick = (p: Program) => {
    onChange(p.id)
    setQ('')
    setOpen(false)
    ref.current?.blur()
  }
  return (
    <div className="combo" style={{ minWidth: 260, flex: 1 }}>
      <input
        ref={ref}
        type="search"
        style={{ width: '100%' }}
        value={open ? q : current ? current.name : q}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, list.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter' && list[active]) pick(list[active])
          if (e.key === 'Escape') setOpen(false)
        }}
        aria-label={placeholder}
      />
      {open && (
        <div className="combo-list" role="listbox">
          {list.length === 0 && <div className="muted small" style={{ padding: 10 }}>No matches in this catalog year.</div>}
          {list.map((p, i) => (
            <button key={p.id} className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              <div>{p.name}</div>
              <div className="muted small">{p.college}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
