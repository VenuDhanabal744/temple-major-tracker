import type { GenEd, PlanEntry, Program } from '../types'
import type { AppState } from '../lib/store'
import { counts, type AuditResult } from '../lib/audit'
import type { CollegeResolved } from '../lib/college'
import type { GenEdAudit as GenEdAuditResult } from '../lib/gened'
import { GenEdAudit } from './GenEdAudit'
import { ProgramAudit } from './ProgramAudit'
import { Legend, ProgramPicker, ProgressBar, fmt } from './common'
import { PreLawSummary } from './PreLawTab'

export type Resolved = { entry: PlanEntry; index: number; year: string; program: Program | null; result: AuditResult | null; used: Set<string> }

type Props = {
  state: AppState
  update: (fn: (s: AppState) => AppState) => void
  resolved: Resolved[]
  collegeResolved: CollegeResolved[]
  gened: GenEd | null
  genedAudit: GenEdAuditResult | null
  defaultYear: string
  years: string[]
  programsForYear: (y: string) => Program[]
  goTo: (tab: string) => void
}

export function ProgressTab({ state, update, resolved, collegeResolved, gened, genedAudit, defaultYear, years, programsForYear, goTo }: Props) {
  const setEntry = (i: number, patch: Partial<PlanEntry>) =>
    update((s) => ({ ...s, plan: s.plan.map((e, j) => (j === i ? { ...e, ...patch } : e)) }))
  const remove = (i: number) => update((s) => ({ ...s, plan: s.plan.filter((_, j) => j !== i) }))
  const add = (id: string) => update((s) => ({ ...s, plan: [...s.plan, { programId: id, catalogYear: '', concentration: null }] }))
  const setManual = (year: string, pid: string, key: string, codes: string[]) =>
    update((s) => {
      const k = `${year}/${pid}`
      return { ...s, manual: { ...s.manual, [k]: { ...(s.manual[k] ?? {}), [key]: codes } } }
    })

  const degree = degreeCredits(state, resolved, collegeResolved, genedAudit)

  const role = (r: Resolved) => (r.index === 0 ? 'Primary major' : r.program?.degree === 'Minor' ? 'Minor' : 'Second major')
  const allUsedBefore = (i: number) => {
    if (state.allowDoubleCount) return undefined
    const s = new Set<string>()
    resolved.slice(0, i).forEach((r) => r.used.forEach((c) => s.add(c)))
    return s
  }

  return (
    <div className="grid2">
      <div className="stack">
        {resolved.length === 0 && (
          <div className="card">
            <h2>Choose your major</h2>
            <p className="muted">Requirements load from the <b>{defaultYear}</b> Undergraduate Bulletin, which is the default for the Class of {state.gradYear}.</p>
            <ProgramPicker programs={programsForYear(defaultYear)} onChange={add} filter={(p) => p.degree !== 'Minor'} placeholder="Search majors, e.g. Political Science" />
          </div>
        )}

        {resolved.map((r) => {
          if (!r.program || !r.result) {
            const other = years.filter((y) => programsForYear(y).some((p) => p.id === r.entry.programId))
            return (
              <div className="card" key={r.index}>
                <div className="banner warn">
                  <b>{r.entry.programId}</b> is not in the {r.year} bulletin. It may not have been offered that year.
                  {other.length > 0 && <> Available in: {other.map((y) => <button key={y} className="btn ghost small" onClick={() => setEntry(r.index, { catalogYear: y })}>{y}</button>)}</>}
                </div>
                <button className="btn ghost danger" style={{ marginTop: 8 }} onClick={() => remove(r.index)}>Remove</button>
              </div>
            )
          }
          const key = `${r.year}/${r.program.id}`
          return (
            <ProgramAudit
              key={`${r.index}-${key}`}
              program={r.program}
              result={r.result}
              courses={state.courses}
              concentration={r.entry.concentration}
              onConcentration={(c) => setEntry(r.index, { concentration: c })}
              manual={state.manual[key] ?? {}}
              onManual={(k, codes) => setManual(r.year, r.program!.id, k, codes)}
              usedElsewhere={allUsedBefore(r.index)}
              header={
                <div className="row">
                  <span className="pill accent">{role(r)}</span>
                  <select value={r.entry.catalogYear || ''} onChange={(e) => setEntry(r.index, { catalogYear: e.target.value, concentration: null })} aria-label="Catalog year" className="small">
                    <option value="">{defaultYear} (Class of {state.gradYear} default)</option>
                    {years.filter((y) => y !== defaultYear).map((y) => <option key={y} value={y}>{y} bulletin</option>)}
                  </select>
                  <button className="btn ghost danger small" onClick={() => remove(r.index)} aria-label={`Remove ${r.program.name}`}>Remove</button>
                </div>
              }
            />
          )
        })}

        {resolved.length > 0 && (
          <div className="card">
            <h3>Add a second major or minor</h3>
            <div className="row" style={{ marginTop: 8 }}>
              <ProgramPicker programs={programsForYear(defaultYear)} onChange={add} filter={(p) => !state.plan.some((e) => e.programId === p.id)} />
              <button className="btn" onClick={() => goTo('compare')}>Find the best fit →</button>
            </div>
          </div>
        )}

        {collegeResolved.map((c) => (
          <ProgramAudit
            key={`${c.year}/${c.program.id}`}
            unit="college"
            program={c.program}
            result={c.result}
            courses={state.courses}
            concentration={null}
            onConcentration={() => {}}
            manual={state.manual[`${c.year}/${c.program.id}`] ?? {}}
            onManual={(k, codes) => setManual(c.year, c.program.id, k, codes)}
            header={<span className="pill accent">College requirement</span>}
          />
        ))}

        {gened && genedAudit && (
          <GenEdAudit
            gened={gened}
            audit={genedAudit}
            courses={state.courses}
            manual={state.manual[`${gened.year}/gened`] ?? {}}
            onManual={(k, codes) => setManual(gened.year, 'gened', k, codes)}
            manualWaived={state.genedWaived}
            onWaived={(area, on) =>
              update((s) => ({ ...s, genedWaived: on ? [...new Set([...s.genedWaived, area])] : s.genedWaived.filter((a) => a !== area) }))
            }
          />
        )}
      </div>

      <div className="stack" style={{ position: 'sticky', top: 56 }}>
        <div className="card">
          <h2>Summary</h2>
          {resolved.filter((r) => r.result).map((r) => (
            <div key={r.index} style={{ marginTop: 10 }}>
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <span>{r.program!.name}</span>
                <span className="muted">{fmt(r.result!.completed)}/{fmt(r.result!.required)} cr</span>
              </div>
              <ProgressBar total={r.result!.required} completed={r.result!.completed} inProgress={r.result!.inProgress} planned={r.result!.planned} thin />
            </div>
          ))}
          {collegeResolved.map((c) => (
            <div key={`${c.year}/${c.program.id}`} style={{ marginTop: 10 }}>
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <span>{c.program.name}</span>
                <span className="muted">{fmt(c.result.completed)}/{fmt(c.result.required)} cr</span>
              </div>
              <ProgressBar total={c.result.required} completed={c.result.completed} inProgress={c.result.inProgress} planned={c.result.planned} thin />
            </div>
          ))}
          {!resolved.length && <p className="muted small">Pick a major to see progress.</p>}
          {genedAudit && (
            <div style={{ marginTop: 10 }}>
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <a href="#gened">General Education</a>
                <span className="muted">{fmt(genedAudit.result.completed)}/{fmt(genedAudit.result.required)} cr · {genedAudit.areasMet}/{genedAudit.areasTotal} areas</span>
              </div>
              <ProgressBar total={genedAudit.result.required} completed={genedAudit.result.completed} inProgress={genedAudit.result.inProgress} planned={genedAudit.result.planned} thin />
            </div>
          )}
          {degree && <DegreeBreakdown {...degree} />}
          <div style={{ marginTop: 12 }}><Legend /></div>
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <label className="field">
            Minimum grade for a course to count
            <select value={state.minGrade} onChange={(e) => update((s) => ({ ...s, minGrade: e.target.value }))}>
              {['C', 'C-', 'D+', 'D', 'D-'].map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <p className="muted small">Most Temple majors require C- or better in major courses. Check your program's notes.</p>
          <label className="check" style={{ borderBottom: 0 }}>
            <input type="checkbox" checked={state.allowDoubleCount} onChange={(e) => update((s) => ({ ...s, allowDoubleCount: e.target.checked }))} />
            <span className="small">Let one course count toward more than one program. Confirm this with both departments, since double-counting limits vary.</span>
          </label>
        </div>
        {state.prelaw.enabled && <PreLawSummary courses={state.courses} prelaw={state.prelaw} gradYear={state.gradYear} onOpen={() => goTo('prelaw')} />}
      </div>
    </div>
  )
}

type Degree = {
  label: string
  total: number
  parts: { label: string; credits: number }[]
  shared: number
  electives: number
  completed: number
  inProgress: number
  planned: number
  bulletin: CollegeResolved['degree']['summary']
}

/** How the primary major's degree total splits into GenEd, college, program and free-elective credits. */
function degreeCredits(state: AppState, resolved: Resolved[], colleges: CollegeResolved[], gened: GenEdAuditResult | null): Degree | null {
  const primary = resolved[0]?.program
  if (!primary) return null
  const college = colleges.find((c) => c.year === resolved[0].year && c.program.collegeSlug === primary.collegeSlug)
  const total = primary.degreeCredits ?? college?.degree.credits ?? null
  if (!total) return null
  // engineering and Boyer majors list the whole degree on their page, GenEd slots included
  const genedInMajor = listsGenEd(primary)
  const parts = [
    ...(gened && !genedInMajor ? [{ label: 'GenEd (after waivers)', credits: gened.result.required }] : []),
    ...colleges.map((c) => ({ label: c.program.name, credits: c.result.required })),
    {
      label: `${resolved.length > 1 ? 'Majors and minors' : 'Major'}${genedInMajor ? ' (its page includes GenEd)' : ''}`,
      credits: resolved.reduce((s, r) => s + (r.result?.required ?? 0), 0),
    },
  ]
  // credits earned toward the degree: each passed course once, whatever it counts for
  const best = new Map<string, AppState['courses'][number]>()
  for (const c of state.courses) if (counts(c, 'D-') && !best.has(c.code)) best.set(c.code, c)
  // a course used by GenEd, the college and a major at once (STAT 2103) is only taken once
  const buckets = [genedInMajor ? undefined : gened?.result.used, ...colleges.map((c) => c.result.used), ...resolved.map((r) => r.used)].filter((b) => b !== undefined)
  let shared = 0
  for (const [code, c] of best) {
    const n = buckets.filter((b) => b.has(code)).length
    if (n > 1) shared += (c.credits || 3) * (n - 1)
  }
  const sum = (st: string) => [...best.values()].filter((c) => c.status === st).reduce((s, c) => s + (c.credits || 0), 0)
  return {
    label: `${primary.degree} degree`,
    total,
    parts,
    shared,
    electives: Math.max(0, total - parts.reduce((s, p) => s + p.credits, 0) + shared),
    completed: sum('completed'),
    inProgress: sum('in-progress'),
    planned: sum('planned'),
    bulletin: college?.degree.summary ?? [],
  }
}

function listsGenEd(p: Program): boolean {
  return p.blocks.some(
    (b) =>
      b.role !== 'info' &&
      b.sections.some((s) =>
        s.items.some((it) =>
          it.type === 'rule' || it.type === 'choose'
            ? /\bGen ?Ed\b|General Education/i.test(it.text)
            : it.type === 'course' && it.options.some((o) => o.codes.some((c) => / 0[89]\d\d$/.test(c))),
        ),
      ),
  )
}

function DegreeBreakdown({ label, total, parts, shared, electives, completed, inProgress, planned, bulletin }: Degree) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <b>{label}</b>
        <span className="muted">{fmt(completed)}/{fmt(total)} cr earned</span>
      </div>
      <ProgressBar total={total} completed={completed} inProgress={inProgress} planned={planned} thin />
      <table className="small muted" style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse' }}>
        <tbody>
          {parts.map((p) => (
            <tr key={p.label}><td>{p.label}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: 8, verticalAlign: 'top' }}>{fmt(p.credits)}</td></tr>
          ))}
          {shared > 0 && <tr><td>Courses counted twice</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: 8, verticalAlign: 'top' }}>−{fmt(shared)}</td></tr>}
          <tr><td>Free electives</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: 8, verticalAlign: 'top' }}>{fmt(electives)}</td></tr>
          <tr style={{ borderTop: '1px solid var(--border)' }}><td><b>Degree total</b></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: 8, verticalAlign: 'top' }}><b>{fmt(total)}</b></td></tr>
        </tbody>
      </table>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        Earned counts every course you passed once, including electives. Courses that meet two requirements at once free up room for electives.
      </p>
      {bulletin.length > 0 && (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          The college's own summary: {bulletin.map((b) => `${b.text} ${fmt(b.credits?.min ?? 0)}`).join(' · ')}.
        </p>
      )}
    </div>
  )
}
