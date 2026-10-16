import { useState } from 'react'
import type { Program, StudentCourse } from '../types'
import { concentrationBlocks, concentrationRequired, type AuditResult, type ItemResult } from '../lib/audit'
import { sourceLabel } from '../lib/catalog'
import { ProgressBar, fmt } from './common'

type Props = {
  program: Program
  result: AuditResult
  courses: StudentCourse[]
  concentration: number | null
  onConcentration: (i: number | null) => void
  manual: Record<string, string[]>
  onManual: (itemKey: string, codes: string[]) => void
  usedElsewhere?: Set<string>
  highlight?: Set<string> // course codes to mark as shared with another program
  header?: React.ReactNode
  readOnly?: boolean
}

function markClass(r: ItemResult): string {
  if (r.done) return r.worst ?? 'completed'
  if (r.matched.length) return 'partial'
  return ''
}

function itemLabel(r: ItemResult): { title: string; sub?: string } {
  const it = r.item
  if (it.type === 'course') {
    const [first, ...alts] = it.options
    return {
      title: `${first.codes.join(' & ')}${first.title ? ` · ${first.title}` : ''}`,
      sub: alts.length ? `or ${alts.map((o) => o.codes.join(' & ')).join(', or ')}` : undefined,
    }
  }
  return { title: it.text }
}

export function ProgramAudit({ program, result, courses, concentration, onConcentration, manual, onManual, usedElsewhere, highlight, header, readOnly }: Props) {
  const [showAll, setShowAll] = useState(false)
  const conc = concentrationBlocks(program)
  const taken = new Set(courses.map((c) => c.code))
  const pct = result.required ? Math.round((result.completed / result.required) * 100) : 0
  const remaining = Math.max(0, result.required - result.completed - result.inProgress - result.planned)

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>{program.name}</h2>
          <div className="muted small">
            {program.college} · {program.year} bulletin ·{' '}
            <a href={program.source} target="_blank" rel="noreferrer">{sourceLabel(program)} ↗</a>
          </div>
        </div>
        {header}
      </div>

      {program.sourceKind === 'pdf' && (
        <div className="banner warn" style={{ marginTop: 10 }}>
          The {program.year} requirements for this program were read from the official bulletin PDF and its course lists can be imperfect. Open the source link to double-check.
        </div>
      )}

      {(conc.length > 1 || (conc.length === 1 && !concentrationRequired(program))) && (
        <label className="field" style={{ marginTop: 12, maxWidth: 520 }}>
          {concentrationRequired(program) ? 'Concentration / track (required)' : 'Optional concentration / emphasis'}
          <select value={concentration ?? ''} onChange={(e) => onConcentration(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{concentrationRequired(program) ? `Choose one (${conc.length} options)` : 'None'}</option>
            {conc.map((b, i) => <option key={i} value={i}>{b.heading}</option>)}
          </select>
        </label>
      )}

      <div className="stats" style={{ marginTop: 14 }}>
        <div className="stat"><b>{pct}%</b><span>of major credits completed</span></div>
        <div className="stat"><b>{fmt(result.completed)}</b><span>credits completed</span></div>
        <div className="stat"><b>{fmt(result.inProgress + result.planned)}</b><span>in progress + planned</span></div>
        <div className="stat"><b>{fmt(remaining)}</b><span>credits still unplanned</span></div>
        <div className="stat"><b>{result.itemsDone}/{result.itemsTotal}</b><span>requirements met</span></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <ProgressBar total={result.required} completed={result.completed} inProgress={result.inProgress} planned={result.planned} />
        <div className="muted small" style={{ marginTop: 4 }}>
          Tracking {fmt(result.required)} credits of listed major requirements
          {program.majorCredits ? ` (bulletin total: ${fmt(program.majorCredits.min)}${program.majorCredits.max !== program.majorCredits.min ? `–${fmt(program.majorCredits.max)}` : ''})` : ''}
          {program.degreeCredits ? ` · degree requires ${program.degreeCredits} total credits` : ''}.
        </div>
      </div>

      {result.blocks.map((b, bi) => (
        <div key={bi}>
          {(result.blocks.length > 1 || b.role === 'concentration') && b.heading && <h3 style={{ marginTop: 16 }}>{b.heading}</h3>}
          {b.sections.map((s, si) => (
            <div className="req-section" key={si}>
              {s.title && <h4>{s.title}</h4>}
              {s.items.map((r) => {
                const { title, sub } = itemLabel(r)
                const it = r.item
                const unmetSlot = !r.done && it.type !== 'course'
                const assignable = courses.filter((c) => !result.used.has(c.code) && !usedElsewhere?.has(c.code))
                return (
                  <div className="req" key={r.key}>
                    <span className={`mark ${markClass(r)}`} aria-hidden>{r.done ? '✓' : ''}</span>
                    <div>
                      <div className="title">{title}</div>
                      {sub && <div className="opts">{sub}</div>}
                      {it.type !== 'course' && it.notes?.length ? <div className="opts">{it.notes.join(' ')}</div> : null}
                      {it.type === 'rule' && it.rule?.subjects && (
                        <div className="opts">
                          Auto-matching {it.rule.subjects.join('/')} courses{it.rule.levels ? ` numbered ${it.rule.levels[0]}–${it.rule.levels[1]}` : ''}
                          {it.rule.inferred ? ' (subject inferred from the major)' : ''}
                        </div>
                      )}
                      {it.type === 'choose' && (
                        <div className="pool">
                          {(showAll ? it.courses : it.courses.slice(0, 14)).map((ci, k) => {
                            const codes = ci.options.flatMap((o) => o.codes)
                            const hit = codes.some((c) => r.matched.some((m) => m.code === c))
                            const shared = !hit && codes.some((c) => highlight?.has(c))
                            return (
                              <span key={k} className={`chip code${hit ? ' hit' : shared ? ' shared' : ''}`} title={ci.options.map((o) => o.title).join(' / ')}>
                                {ci.options.map((o) => o.codes.join('&')).join(' / ')}
                              </span>
                            )
                          })}
                          {it.courses.length > 14 && (
                            <button className="chip" style={{ cursor: 'pointer' }} onClick={() => setShowAll((v) => !v)}>
                              {showAll ? 'show fewer' : `+${it.courses.length - 14} more`}
                            </button>
                          )}
                        </div>
                      )}
                      {r.matched.length > 0 && (
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
                      {it.type === 'course' && !r.done && it.options.some((o) => o.codes.some((c) => taken.has(c))) && (
                        <div className="opts" style={{ color: 'var(--warn)' }}>Taken, but the grade is below the minimum or the course already counts toward another program.</div>
                      )}
                      {!readOnly && unmetSlot && assignable.length > 0 && (
                        <select
                          className="small"
                          style={{ marginTop: 6, maxWidth: 320 }}
                          value=""
                          onChange={(e) => e.target.value && onManual(r.key, [...(manual[r.key] ?? []), e.target.value])}
                          aria-label="Assign one of my courses to this requirement"
                        >
                          <option value="">Assign one of my courses…</option>
                          {assignable.map((c) => <option key={c.id} value={c.code}>{c.code}{c.title ? ` · ${c.title}` : ''}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="cr">
                      {r.done ? '' : r.matched.length ? `${fmt(r.satisfied)}/` : ''}
                      {fmt(r.required)} cr
                    </div>
                  </div>
                )
              })}
              {s.notes.length > 0 && <div className="opts muted small" style={{ marginTop: 4 }}>{s.notes.join(' · ')}</div>}
            </div>
          ))}
        </div>
      ))}

      {(program.footnotes.length > 0 || program.notes.length > 0) && (
        <details className="notes" style={{ marginTop: 14 }}>
          <summary>College requirements, writing-intensive courses and footnotes from the bulletin</summary>
          {program.notes.length > 0 && (
            <ul>{program.notes.filter((n) => n.tag !== 'h2').map((n, i) => <li key={i}>{n.text}</li>)}</ul>
          )}
          {program.footnotes.length > 0 && (
            <ol>{program.footnotes.map((f, i) => <li key={i}>{f}</li>)}</ol>
          )}
        </details>
      )}
    </div>
  )
}
