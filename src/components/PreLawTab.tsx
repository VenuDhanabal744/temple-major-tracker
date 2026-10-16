import { useState } from 'react'
import type { StudentCourse } from '../types'
import { LSAC_POINTS, MILESTONES, SKILL_AREAS, TEMPLE_POINTS } from '../lib/prelaw'
import { uid, type Letter, type PreLawState } from '../lib/store'
import { ProgressBar, fmt } from './common'

type GPA = { value: number | null; credits: number }

/** Temple: only the highest grade of a repeated course counts (Policy 02.10.12). */
export function templeGpa(courses: StudentCourse[]): GPA {
  const best = new Map<string, { pts: number; cr: number }>()
  for (const c of courses) {
    const p = TEMPLE_POINTS[c.grade.toUpperCase()]
    if (c.status !== 'completed' || p === undefined) continue
    const prev = best.get(c.code)
    if (!prev || p > prev.pts) best.set(c.code, { pts: p, cr: c.credits })
  }
  let q = 0
  let cr = 0
  for (const { pts, cr: c } of best.values()) { q += pts * c; cr += c }
  return { value: cr ? q / cr : null, credits: cr }
}

/** LSAC: every graded attempt counts, on LSAC's scale. */
export function lsacGpa(courses: StudentCourse[]): GPA {
  let q = 0
  let cr = 0
  for (const c of courses) {
    const p = LSAC_POINTS[c.grade.toUpperCase()]
    if (c.status !== 'completed' || p === undefined) continue
    q += p * c.credits
    cr += c.credits
  }
  return { value: cr ? q / cr : null, credits: cr }
}

export function skillCoverage(courses: StudentCourse[]) {
  const have = new Map(courses.map((c) => [c.code, c.status]))
  return SKILL_AREAS.map((a) => {
    const hits = a.courses.filter((c) => c.codes.some((k) => have.has(k)))
    return { area: a, hits, met: Math.min(hits.length, a.target) }
  })
}

const gap = (p: PreLawState) => (p.apcPlan === 'gap2' ? 2 : p.apcPlan === 'gap1' ? 1 : 0)

export function PreLawSummary({ courses, prelaw, gradYear, onOpen }: { courses: StudentCourse[]; prelaw: PreLawState; gradYear: number; onOpen: () => void }) {
  const t = templeGpa(courses)
  const l = lsacGpa(courses)
  const cov = skillCoverage(courses)
  const done = cov.reduce((n, c) => n + c.met, 0)
  const target = cov.reduce((n, c) => n + c.area.target, 0)
  const next = MILESTONES.find((m) => !prelaw.checklist[m.id])
  const best = prelaw.lsatScores.length ? Math.max(...prelaw.lsatScores) : null
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Pre-law</h2>
        <button className="btn ghost small" onClick={onOpen}>Open tracker →</button>
      </div>
      <div className="stats" style={{ marginTop: 8 }}>
        <div className="stat"><b>{t.value?.toFixed(2) ?? '—'}</b><span>Temple GPA</span></div>
        <div className="stat"><b>{l.value?.toFixed(2) ?? '—'}</b><span>LSAC GPA</span></div>
        <div className="stat"><b>{best ?? '—'}</b><span>best LSAT</span></div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="small" style={{ marginBottom: 4 }}>Skill-building coursework: {done}/{target}</div>
        <ProgressBar total={target} completed={done} thin />
      </div>
      {next && (
        <div className="small" style={{ marginTop: 12 }}>
          <span className="muted">Next step:</span> {next.label} <span className="pill accent">{next.when(gradYear, gap(prelaw))}</span>
        </div>
      )}
    </div>
  )
}

export function PreLawTab({ courses, prelaw, gradYear, onChange }: { courses: StudentCourse[]; prelaw: PreLawState; gradYear: number; onChange: (p: PreLawState) => void }) {
  const [score, setScore] = useState('')
  const set = (patch: Partial<PreLawState>) => onChange({ ...prelaw, ...patch })
  const t = templeGpa(courses)
  const l = lsacGpa(courses)
  const cov = skillCoverage(courses)
  const status = new Map(courses.map((c) => [c.code, c.status]))
  const g = gap(prelaw)
  const best = prelaw.lsatScores.length ? Math.max(...prelaw.lsatScores) : null
  const academicLetters = prelaw.letters.filter((x) => x.kind === 'academic').length

  const editLetter = (id: string, patch: Partial<Letter>) => set({ letters: prelaw.letters.map((x) => (x.id === id ? { ...x, ...patch } : x)) })

  return (
    <div className="stack">
      <div className="banner">
        Temple has <b>no required pre-law curriculum</b>. Its Pre-Law FAQ says law schools don't favor any major, and that GPA, LSAT,
        recommendations and the personal statement matter most. This tracker follows that guidance: the courses below build the skills
        the ABA names, and nothing here is a graduation requirement.{' '}
        <a href="https://careercenter.temple.edu/sites/careercenter/files/Pre-law-FAQ.pdf" target="_blank" rel="noreferrer">Temple Pre-Law FAQ ↗</a>
      </div>

      <div className="grid2">
        <div className="stack">
          <div className="card">
            <h2>Skill-building coursework</h2>
            <p className="muted small" style={{ marginTop: 0 }}>Courses are matched against your course list automatically. Codes are from the Temple bulletin course catalog.</p>
            {cov.map(({ area, hits, met }) => (
              <div key={area.id} className="req-section">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>{area.label}</h3>
                  <span className={`pill ${met >= area.target ? 'completed' : hits.length ? 'in-progress' : 'missing'}`}>{met}/{area.target} suggested</span>
                </div>
                <div className="muted small">{area.why}</div>
                <div className="pool" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {area.courses.map((c) => {
                    const st = c.codes.map((k) => status.get(k)).find(Boolean)
                    return (
                      <span key={c.codes[0]} className={`pill ${st ?? 'missing'}`} title={c.title}>
                        <span className="code">{c.codes.join(' / ')}</span> {c.title}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Timeline</h2>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                Start law school
                <select value={prelaw.apcPlan} onChange={(e) => set({ apcPlan: e.target.value as PreLawState['apcPlan'] })}>
                  <option value="senior">right after graduating (Fall {gradYear})</option>
                  <option value="gap1">after 1 gap year (Fall {gradYear + 1})</option>
                  <option value="gap2">after 2 gap years (Fall {gradYear + 2})</option>
                </select>
              </label>
            </div>
            <p className="muted small" style={{ marginTop: 4 }}>Temple's FAQ notes that about two-thirds of admitted applicants nationally apply after graduating, so a gap year isn't a disadvantage.</p>
            {MILESTONES.map((m) => (
              <label key={m.id} className="check">
                <input type="checkbox" checked={!!prelaw.checklist[m.id]} onChange={(e) => set({ checklist: { ...prelaw.checklist, [m.id]: e.target.checked } })} />
                <span>
                  {m.label}
                  {m.link && <> · <a href={m.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>link ↗</a></>}
                  {m.detail && <div className="muted small">{m.detail}</div>}
                </span>
                <span className="when">{m.when(gradYear, g)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>GPA</h2>
            <div className="stats" style={{ marginTop: 8 }}>
              <div className="stat"><b>{t.value?.toFixed(2) ?? '—'}</b><span>Temple ({fmt(t.credits)} graded cr)</span></div>
              <div className="stat"><b>{l.value?.toFixed(2) ?? '—'}</b><span>LSAC ({fmt(l.credits)} graded cr)</span></div>
            </div>
            <p className="muted small">
              Temple counts only your highest grade in a repeated course. LSAC counts <b>every</b> graded attempt, including F and WF, so your
              LSAC GPA can come out lower. Enter grades on the My Courses tab.
            </p>
          </div>

          <div className="card">
            <h2>LSAT</h2>
            <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => {
              e.preventDefault()
              const n = Number(score)
              if (n >= 120 && n <= 180) { set({ lsatScores: [...prelaw.lsatScores, n] }); setScore('') }
            }}>
              <input type="number" min={120} max={180} value={score} onChange={(e) => setScore(e.target.value)} placeholder="Score (120–180)" style={{ width: 150 }} aria-label="LSAT score" />
              <button className="btn" type="submit">Add score</button>
            </form>
            <div className="row" style={{ marginTop: 8 }}>
              {prelaw.lsatScores.map((s, i) => (
                <span key={i} className={`pill ${s === best ? 'completed' : 'missing'}`}>
                  {s}
                  <button className="btn ghost" style={{ padding: 0, fontSize: '0.75rem' }} aria-label={`Remove score ${s}`} onClick={() => set({ lsatScores: prelaw.lsatScores.filter((_, j) => j !== i) })}>✕</button>
                </span>
              ))}
              {!prelaw.lsatScores.length && <span className="muted small">No scores yet.</span>}
            </div>
            <label className="field" style={{ marginTop: 10 }}>
              Planned test date
              <input type="date" value={prelaw.lsatPlanned} onChange={(e) => set({ lsatPlanned: e.target.value })} />
            </label>
          </div>

          <div className="card">
            <h2>Recommendation letters</h2>
            <p className="muted small" style={{ marginTop: 0 }}>Most law schools expect at least two letters, with at least one from a college instructor.</p>
            <span className={`pill ${prelaw.letters.length >= 2 && academicLetters >= 1 ? 'completed' : 'missing'}`}>
              {prelaw.letters.length} letters · {academicLetters} academic
            </span>
            {prelaw.letters.map((x) => (
              <div className="row" key={x.id} style={{ marginTop: 8 }}>
                <input type="text" value={x.name} placeholder="Recommender" onChange={(e) => editLetter(x.id, { name: e.target.value })} style={{ flex: 1, minWidth: 120 }} aria-label="Recommender name" />
                <select value={x.kind} onChange={(e) => editLetter(x.id, { kind: e.target.value as Letter['kind'] })} aria-label="Letter type">
                  <option value="academic">Academic</option>
                  <option value="professional">Professional</option>
                </select>
                <select value={x.status} onChange={(e) => editLetter(x.id, { status: e.target.value as Letter['status'] })} aria-label="Letter status">
                  <option value="idea">Considering</option>
                  <option value="asked">Asked</option>
                  <option value="agreed">Agreed</option>
                  <option value="submitted">Submitted to LSAC</option>
                </select>
                <button className="btn ghost danger" aria-label="Remove letter" onClick={() => set({ letters: prelaw.letters.filter((y) => y.id !== x.id) })}>✕</button>
              </div>
            ))}
            <button className="btn" style={{ marginTop: 10 }} onClick={() => set({ letters: [...prelaw.letters, { id: uid(), name: '', kind: 'academic', status: 'idea' }] })}>+ Add recommender</button>
          </div>

          <div className="card">
            <h2>Target schools</h2>
            <p className="muted small" style={{ marginTop: 0 }}>Enter medians from each school's ABA Standard 509 report to see where you stand.</p>
            {prelaw.schools.map((s) => {
              const lm = Number(s.lsatMedian)
              const gm = Number(s.gpaMedian)
              return (
                <div key={s.id} className="req-section">
                  <div className="row">
                    <input type="text" value={s.name} placeholder="School" style={{ flex: 1, minWidth: 120 }} aria-label="School name"
                      onChange={(e) => set({ schools: prelaw.schools.map((y) => (y.id === s.id ? { ...y, name: e.target.value } : y)) })} />
                    <button className="btn ghost danger" aria-label="Remove school" onClick={() => set({ schools: prelaw.schools.filter((y) => y.id !== s.id) })}>✕</button>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <input type="number" value={s.lsatMedian} placeholder="LSAT median" style={{ width: 120 }} aria-label="LSAT median"
                      onChange={(e) => set({ schools: prelaw.schools.map((y) => (y.id === s.id ? { ...y, lsatMedian: e.target.value } : y)) })} />
                    <input type="number" step="0.01" value={s.gpaMedian} placeholder="GPA median" style={{ width: 120 }} aria-label="GPA median"
                      onChange={(e) => set({ schools: prelaw.schools.map((y) => (y.id === s.id ? { ...y, gpaMedian: e.target.value } : y)) })} />
                  </div>
                  <div className="row small" style={{ marginTop: 6 }}>
                    {lm > 0 && best !== null && <span className={`pill ${best >= lm ? 'completed' : 'in-progress'}`}>LSAT {best >= lm ? '+' : ''}{best - lm} vs median</span>}
                    {gm > 0 && l.value !== null && <span className={`pill ${l.value >= gm ? 'completed' : 'in-progress'}`}>GPA {l.value >= gm ? '+' : ''}{(l.value - gm).toFixed(2)} vs median</span>}
                  </div>
                </div>
              )
            })}
            <button className="btn" style={{ marginTop: 10 }} onClick={() => set({ schools: [...prelaw.schools, { id: uid(), name: '', lsatMedian: '', gpaMedian: '' }] })}>+ Add school</button>
          </div>

          <div className="card small">
            <h3>Temple resources</h3>
            <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
              <li><a href="https://liberalarts.temple.edu/academics/departments-and-programs/philosophy/undergraduate/pre-law" target="_blank" rel="noreferrer">CLA Pre-Law advising ↗</a>, open to all majors</li>
              <li><a href="https://listserv.temple.edu/cgi-bin/wa?SUBED1=CLA-LAW" target="_blank" rel="noreferrer">Pre-Law Listserv (CLA-LAW) ↗</a></li>
              <li>Student groups: Pre-Law Society, Phi Alpha Delta, AMTA Mock Trial, Black Law Students Association</li>
              <li>Legal Studies BBA / minor (Fox) and, from 2026-27, the Communication BA with Pre-Law Concentration (Klein). Compare them on the Double major tab.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
