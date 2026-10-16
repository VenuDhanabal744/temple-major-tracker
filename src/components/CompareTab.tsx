import { useMemo, useState } from 'react'
import type { Program, StudentCourse } from '../types'
import { audit, concentrationBlocks, overlap, type Overlap } from '../lib/audit'
import { ProgramAudit } from './ProgramAudit'
import { ProgramPicker, ProgressBar, fmt } from './common'

type Props = {
  programs: Program[]
  year: string
  base: Program | null
  baseConcentration: number | null
  courses: StudentCourse[]
  minGrade: string
  onPickBase: (id: string) => void
  onAdd: (id: string, concentration: number | null) => void
  planned: Set<string>
}

type Row = Overlap & { conc: number | null; myRemaining: number; myDone: number; pct: number }

type Sort = 'overlap' | 'remaining' | 'shared'

export function CompareTab({ programs, year, base, baseConcentration, courses, minGrade, onPickBase, onAdd, planned }: Props) {
  const [kind, setKind] = useState<'major' | 'minor'>('major')
  const [sort, setSort] = useState<Sort>('overlap')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [selConc, setSelConc] = useState<number | null>(null)

  const rows = useMemo<Row[]>(() => {
    if (!base) return []
    return programs
      .filter((p) => p.id !== base.id && (kind === 'minor' ? p.degree === 'Minor' : p.degree !== 'Minor'))
      .map((p) => {
        // try each concentration and keep the one that overlaps most
        const concs = concentrationBlocks(p).length > 1 ? concentrationBlocks(p).map((_, i) => i) : [null]
        let best: (Overlap & { conc: number | null }) | null = null
        for (const c of concs) {
          const o = overlap(base, baseConcentration, p, c)
          if (!best || o.potential > best.potential) best = { ...o, conc: c }
        }
        const mine = audit(p, courses, { concentration: best!.conc, minGrade })
        const myDone = mine.completed + mine.inProgress + mine.planned
        return { ...best!, myDone, myRemaining: Math.max(0, mine.required - myDone), pct: best!.bRequired ? best!.potential / best!.bRequired : 0 }
      })
      .filter((r) => r.bRequired > 0)
  }, [programs, base, baseConcentration, kind, courses, minGrade])

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = rows.filter((r) => terms.every((t) => `${r.other.name} ${r.other.college}`.toLowerCase().includes(t)))
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      overlap: (a, b) => b.pct - a.pct || b.potential - a.potential,
      remaining: (a, b) => a.myRemaining - b.myRemaining,
      shared: (a, b) => b.shared.length - a.shared.length,
    }
    return list.sort(by[sort])
  }, [rows, q, sort])

  const selected = rows.find((r) => r.other.id === sel) ?? null
  const selectedConc = selected ? (selConc ?? selected.conc) : null
  const detail = useMemo(() => (selected ? audit(selected.other, courses, { concentration: selectedConc, minGrade }) : null), [selected, selectedConc, courses, minGrade])

  return (
    <div className="stack">
      <div className="card">
        <h2>Find a double major or minor</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each program in the {year} bulletin is compared with your primary major. <b>Overlap</b> is how many of its required credits could
          be met by courses that also count toward your major. <b>Left for you</b> uses the courses you've already entered.
        </p>
        <div className="row">
          <ProgramPicker programs={programs} value={base?.id} onChange={onPickBase} filter={(p) => p.degree !== 'Minor'} placeholder="Primary major to compare against" />
        </div>
        <div className="banner" style={{ marginTop: 12 }}>
          Temple policy: a double major across colleges needs the requirements of <b>both</b> majors, including two writing-intensive
          courses in each, but only <b>one</b> set of college requirements (from the primary major's college), plus approval from both
          colleges.{' '}
          <a href="https://bulletin.temple.edu/undergraduate/academic-policies/double-major-across-colleges/" target="_blank" rel="noreferrer">Bulletin policy ↗</a>
        </div>
      </div>

      {base && (
        <div className="grid2">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <button className={`btn${kind === 'major' ? ' primary' : ''}`} onClick={() => setKind('major')}>Majors</button>
                <button className={`btn${kind === 'minor' ? ' primary' : ''}`} onClick={() => setKind('minor')}>Minors</button>
              </div>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="overlap">Most overlap with {base.name}</option>
                  <option value="remaining">Fewest credits left for me</option>
                  <option value="shared">Most shared courses</option>
                </select>
              </label>
            </div>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or college" style={{ width: '100%', marginTop: 10 }} aria-label="Filter programs" />
            <div className="legend" style={{ marginTop: 8 }}>
              <span><i style={{ background: 'var(--done)' }} />Covered by your major's required courses</span>
              <span><i style={{ background: 'var(--ip)' }} />Coverable with electives that count for both</span>
            </div>
            <div className="rank-row muted small" style={{ cursor: 'default', fontWeight: 600 }}>
              <span>Program</span><span className="hide-sm">Overlap</span><span>Left for you</span>
            </div>
            {shown.map((r) => (
              <div key={r.other.id} className="rank-row" onClick={() => { setSel(r.other.id); setSelConc(null) }} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') { setSel(r.other.id); setSelConc(null) } }}
                style={sel === r.other.id ? { background: 'var(--surface-2)' } : undefined}>
                <div>
                  <div>{r.other.name} {planned.has(r.other.id) && <span className="pill completed">in plan</span>}</div>
                  <div className="muted small">{r.other.college}{r.sameCollege ? ' · same college' : ''} · {r.shared.length} shared course{r.shared.length === 1 ? '' : 's'}</div>
                </div>
                <div className="hide-sm">
                  <ProgressBar total={r.bRequired} completed={r.guaranteed} inProgress={Math.max(0, r.potential - r.guaranteed)} thin />
                  <div className="muted small">{Math.round(r.pct * 100)}% · {fmt(r.potential)}/{fmt(r.bRequired)} cr</div>
                </div>
                <div><b>{fmt(r.myRemaining)}</b> <span className="muted small">cr</span></div>
              </div>
            ))}
            {!shown.length && <div className="empty">No programs match.</div>}
          </div>

          <div className="stack" style={{ position: 'sticky', top: 56 }}>
            {selected && detail ? (
              <>
                <div className="card">
                  <h2>{base.name} + {selected.other.name}</h2>
                  <div className="stats" style={{ marginTop: 10 }}>
                    <div className="stat"><b>{fmt(selected.guaranteed)}</b><span>credits covered by {base.name}'s required courses</span></div>
                    <div className="stat"><b>{fmt(selected.potential)}</b><span>credits coverable if you pick electives that count for both</span></div>
                    <div className="stat"><b>{fmt(selected.myRemaining)}</b><span>credits left given your courses</span></div>
                  </div>
                  <div className="muted small" style={{ marginTop: 8 }}>
                    {selected.sameCollege ? 'Same college: one set of college requirements.' : `Different college (${selected.other.college}). The primary major's college requirements apply.`}
                  </div>
                  <h3 style={{ marginTop: 12 }}>Shared courses</h3>
                  <div className="pool" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {selected.shared.length ? selected.shared.map((c) => <span key={c} className="chip shared code">{c}</span>) : <span className="muted small">No course appears in both programs' lists.</span>}
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn primary" disabled={planned.has(selected.other.id)} onClick={() => onAdd(selected.other.id, selectedConc)}>
                      {planned.has(selected.other.id) ? 'Already in your plan' : `Add as ${selected.other.degree === 'Minor' ? 'minor' : 'second major'}`}
                    </button>
                  </div>
                </div>
                <ProgramAudit
                  program={selected.other}
                  result={detail}
                  courses={courses}
                  concentration={selectedConc}
                  onConcentration={setSelConc}
                  manual={{}}
                  onManual={() => {}}
                  readOnly
                  highlight={new Set(selected.shared)}
                />
              </>
            ) : (
              <div className="card empty">Select a program to see the shared courses and requirement details.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
