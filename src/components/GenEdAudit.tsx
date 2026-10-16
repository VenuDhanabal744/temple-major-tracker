import { useState } from 'react'
import type { GenEd, StudentCourse } from '../types'
import type { ItemResult } from '../lib/audit'
import { areaOf, type GenEdAudit as Audit } from '../lib/gened'
import { ProgressBar, fmt } from './common'

type Props = {
  gened: GenEd
  audit: Audit
  courses: StudentCourse[]
  manual: Record<string, string[]>
  onManual: (itemKey: string, codes: string[]) => void
  manualWaived: string[]
  onWaived: (area: string, waived: boolean) => void
}

function markClass(r: ItemResult | undefined, waived: boolean): string {
  if (!r) return waived ? 'completed' : ''
  if (r.done) return r.worst ?? 'completed'
  if (r.matched.length) return 'partial'
  return ''
}

export function GenEdAudit({ gened, audit, courses, manual, onManual, manualWaived, onWaived }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const { result } = audit
  const taken = new Set(courses.map((c) => c.code))
  const remaining = Math.max(0, result.required - result.completed - result.inProgress - result.planned)
  const sourceLink = gened.sourceKind === 'wayback' ? 'Bulletin page as published (Internet Archive)' : gened.year === '2026-2027' ? 'Current bulletin' : 'Bulletin archive'

  return (
    <div className="card" id="gened">
      <div>
        <h2>General Education</h2>
        <div className="muted small">
          University requirement · {gened.year} bulletin ·{' '}
          <a href={gened.source} target="_blank" rel="noreferrer">{sourceLink} ↗</a>
        </div>
      </div>

      <div className="stats" style={{ marginTop: 14 }}>
        <div className="stat"><b>{audit.areasMet}/{audit.areasTotal}</b><span>areas met or waived</span></div>
        <div className="stat"><b>{fmt(result.completed)}</b><span>credits completed</span></div>
        <div className="stat"><b>{fmt(result.inProgress + result.planned)}</b><span>in progress + planned</span></div>
        <div className="stat"><b>{fmt(remaining)}</b><span>credits still unplanned</span></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <ProgressBar total={result.required} completed={result.completed} inProgress={result.inProgress} planned={result.planned} />
        <div className="muted small" style={{ marginTop: 4 }}>
          Tracking {fmt(result.required)} GenEd credits after waivers. Courses need a C- or better and count in one area only.
        </div>
      </div>

      {audit.deptOverLimit.length > 0 && (
        <div className="banner warn" style={{ marginTop: 10 }}>
          More than two breadth courses from {audit.deptOverLimit.join(', ')}. Only two courses from a single department may count toward GenEd.
        </div>
      )}

      {gened.blocks.map((b, bi) => (
        <div className="req-section" key={bi}>
          <h4>{b.heading}</h4>
          {b.sections.map((s, si) => {
            const code = areaOf(s.title) ?? ''
            const area = gened.areas.find((a) => a.code === code)
            const sec = result.blocks[bi]?.sections[si]
            const r = sec?.items[0]
            const waived = audit.waived[code]
            const fullyWaived = !r
            const choose = s.items.find((it) => it.type === 'choose')
            const pool = choose?.type === 'choose' ? choose.courses : []
            const genedPool = pool.filter((ci) => !ci.options[0].title.startsWith('Waiver'))
            const waiverPool = pool.filter((ci) => ci.options[0].title.startsWith('Waiver'))
            const assignable = courses.filter((c) => !result.used.has(c.code))
            const isOpen = open === code
            return (
              <div className="req" key={si}>
                <span className={`mark ${markClass(r, fullyWaived)}`} aria-hidden>{r?.done || fullyWaived ? '✓' : ''}</span>
                <div>
                  <div className="title">
                    {s.title}
                    {waived && <span className="pill accent" style={{ marginLeft: 6 }}>{fullyWaived ? 'Waived' : `${waived.count} waived`}</span>}
                  </div>
                  <div className="opts">
                    {area?.requirement}
                    {area?.sourceKind === 'pdf' && <> · list read from the official bulletin PDF</>}
                  </div>
                  {waived?.reasons.map((w, i) => <div key={i} className="opts">{w}</div>)}
                  {r && r.matched.length > 0 && (
                    <div className="pool">
                      {r.matched.map((m) => (
                        <span key={m.code} className={`pill ${m.status}`}>
                          {m.code}{m.manual ? ' (assigned)' : ''}
                          {m.manual && (
                            <button className="btn ghost" style={{ padding: 0, fontSize: '0.75rem' }} aria-label={`Unassign ${m.code}`}
                              onClick={() => onManual(r.key, (manual[r.key] ?? []).filter((c) => c !== m.code))}>✕</button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {r && !r.done && genedPool.some((ci) => ci.options.some((o) => o.codes.some((c) => taken.has(c) && !r.matched.some((m) => m.code === c)))) && (
                    <div className="opts" style={{ color: 'var(--warn)' }}>Taken, but below C- or already counted in another area.</div>
                  )}
                  <div className="row small" style={{ marginTop: 4, gap: 12 }}>
                    {pool.length > 0 && (
                      <button className="btn ghost small" style={{ padding: 0 }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : code)}>
                        {isOpen ? 'Hide' : 'Show'} {genedPool.length} approved courses{waiverPool.length ? ` and ${waiverPool.length} waivers` : ''}
                      </button>
                    )}
                    <label className="muted" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" checked={manualWaived.includes(code)} onChange={(e) => onWaived(code, e.target.checked)} />
                      Waived another way
                    </label>
                  </div>
                  {isOpen && (
                    <>
                      <div className="pool">
                        {genedPool.map((ci, k) => {
                          const codes = ci.options.flatMap((o) => o.codes)
                          const hit = codes.some((c) => r?.matched.some((m) => m.code === c))
                          return (
                            <span key={k} className={`chip code${hit ? ' hit' : ''}`} title={ci.options[0].title}>
                              {codes.join(' / ')}
                            </span>
                          )
                        })}
                      </div>
                      {waiverPool.length > 0 && (
                        <div className="opts" style={{ marginTop: 6 }}>
                          Also satisfied by:
                          <ul style={{ margin: '2px 0 0 18px' }}>
                            {waiverPool.map((ci, k) => (
                              <li key={k}>
                                {ci.options.map((o) => o.codes.join(' + ')).join(' or ')}
                                {ci.options[0].title.includes('·') && <> ({ci.options[0].title.split(':')[0].replace(/^Waiver · /, '')})</>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {sec && sec.notes.length > 0 && <div className="opts" style={{ marginTop: 6 }}>{sec.notes.join(' · ')}</div>}
                    </>
                  )}
                  {r && !r.done && assignable.length > 0 && (
                    <select
                      className="small"
                      style={{ marginTop: 6, maxWidth: 320 }}
                      value=""
                      onChange={(e) => e.target.value && onManual(r.key, [...(manual[r.key] ?? []), e.target.value])}
                      aria-label={`Assign one of my courses to ${s.title}`}
                    >
                      <option value="">Assign one of my courses…</option>
                      {assignable.map((c) => <option key={c.id} value={c.code}>{c.code}{c.title ? ` · ${c.title}` : ''}</option>)}
                    </select>
                  )}
                </div>
                <div className="cr">
                  {fullyWaived ? '0 cr' : <>{r!.done ? '' : r!.matched.length ? `${fmt(r!.satisfied)}/` : ''}{fmt(r!.required)} cr</>}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <details className="notes" style={{ marginTop: 14 }}>
        <summary>GenEd policies from the bulletin</summary>
        <ul>{gened.policies.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </details>
    </div>
  )
}
