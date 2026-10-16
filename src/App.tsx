import { useMemo, useState } from 'react'
import { audit } from './lib/audit'
import { GRAD_YEARS, courseTitles, defaultCatalogYear, useIndex, useYears } from './lib/catalog'
import { useAppState } from './lib/store'
import { auditGenEd, majorWaivers, useGenEd } from './lib/gened'
import { collegeProgram, useColleges, type CollegeResolved } from './lib/college'
import { CoursesTab } from './components/CoursesTab'
import { ProgressTab, type Resolved } from './components/ProgressTab'
import { CompareTab } from './components/CompareTab'
import { PreLawTab } from './components/PreLawTab'

type Tab = 'progress' | 'courses' | 'compare' | 'prelaw'

export default function App() {
  const [state, update] = useAppState()
  const [tab, setTab] = useState<Tab>('progress')
  const index = useIndex()
  const years = index ? Object.keys(index.years).sort().reverse() : []
  const defaultYear = defaultCatalogYear(state.gradYear)
  const neededYears = [defaultYear, ...state.plan.map((e) => e.catalogYear).filter(Boolean)]
  const data = useYears(neededYears)
  const loaded = !!data[defaultYear]

  const gened = useGenEd(defaultYear)
  const colleges = useColleges(neededYears)

  const programsForYear = (y: string) => [...(data[y]?.values() ?? [])]
  const titles = useMemo(
    () => courseTitles([...Object.values(data).flatMap((m) => [...m.values()]), ...(gened ? [gened] : [])]),
    [data, gened],
  )

  const resolved: Resolved[] = useMemo(() => {
    const out: Resolved[] = []
    const used = new Set<string>()
    state.plan.forEach((entry, index) => {
      const year = entry.catalogYear || defaultYear
      const program = data[year]?.get(entry.programId) ?? null
      if (!program) {
        out.push({ entry, index, year, program: null, result: null, used: new Set() })
        return
      }
      const result = audit(program, state.courses, {
        concentration: entry.concentration,
        minGrade: state.minGrade,
        manual: state.manual[`${year}/${program.id}`],
        exclude: state.allowDoubleCount ? undefined : new Set(used),
      })
      result.used.forEach((c) => used.add(c))
      out.push({ entry, index, year, program, result, used: result.used })
    })
    return out
  }, [state.plan, state.courses, state.minGrade, state.manual, state.allowDoubleCount, data, defaultYear])

  // college-wide requirements (e.g. the Fox BBA foundation) for each major, once per college and degree
  const collegeResolved: CollegeResolved[] = useMemo(() => {
    const out: CollegeResolved[] = []
    for (const r of resolved) {
      if (!r.program || r.program.degree === 'Minor') continue
      const c = collegeProgram(colleges[r.year], r.program)
      if (!c || out.some((o) => o.year === r.year && o.program.id === c.program.id)) continue
      const result = audit(c.program, state.courses, { concentration: null, minGrade: state.minGrade, manual: state.manual[`${r.year}/${c.program.id}`] })
      out.push({ year: r.year, program: c.program, degree: c.degree, result })
    }
    return out
  }, [resolved, colleges, state.courses, state.minGrade, state.manual])

  // GenEd follows the bulletin of the year the student entered, i.e. the class default
  const genedAudit = useMemo(() => {
    if (!gened) return null
    const majors = resolved.flatMap((r) => (r.program ? [r.program] : []))
    return auditGenEd(gened, state.courses, majorWaivers(majors), state.genedWaived, state.manual[`${gened.year}/gened`])
  }, [gened, resolved, state.courses, state.genedWaived, state.manual])

  const primary = resolved[0]?.program ?? null
  const compareYear = resolved[0]?.year ?? defaultYear

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'progress', label: 'Progress' },
    { id: 'courses', label: 'My courses', count: state.courses.length },
    { id: 'compare', label: 'Double major' },
    { id: 'prelaw', label: 'Pre-law' },
  ]

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Temple <span>Major Tracker</span></h1>
          <div className="sub">Degree progress from the Temple University Undergraduate Bulletin, by catalog year</div>
        </div>
        <div className="spacer" />
        <label className="field">
          Graduating class
          <select value={state.gradYear} onChange={(e) => update((s) => ({ ...s, gradYear: Number(e.target.value) }))}>
            {GRAD_YEARS.map((y) => <option key={y} value={y}>Class of {y} ({defaultCatalogYear(y)} bulletin)</option>)}
          </select>
        </label>
      </header>

      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{t.count ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
      </nav>

      {!loaded ? (
        <div className="card empty">Loading the {defaultYear} bulletin…</div>
      ) : (
        <>
          {tab === 'progress' && (
            <ProgressTab state={state} update={update} resolved={resolved} collegeResolved={collegeResolved} gened={gened} genedAudit={genedAudit} defaultYear={defaultYear} years={years} programsForYear={programsForYear} goTo={(t) => setTab(t as Tab)} />
          )}
          {tab === 'courses' && <CoursesTab courses={state.courses} titles={titles} onChange={(courses) => update((s) => ({ ...s, courses }))} />}
          {tab === 'compare' && (
            <CompareTab
              programs={programsForYear(compareYear)}
              year={compareYear}
              base={primary}
              baseConcentration={resolved[0]?.entry.concentration ?? null}
              courses={state.courses}
              minGrade={state.minGrade}
              planned={new Set(state.plan.map((e) => e.programId))}
              onPickBase={(id) => update((s) => ({ ...s, plan: [{ programId: id, catalogYear: '', concentration: null }, ...s.plan.slice(1).filter((e) => e.programId !== id)] }))}
              onAdd={(id, concentration) => update((s) => ({ ...s, plan: [...s.plan, { programId: id, catalogYear: s.plan[0]?.catalogYear ?? '', concentration }] }))}
            />
          )}
          {tab === 'prelaw' && <PreLawTab courses={state.courses} prelaw={state.prelaw} gradYear={state.gradYear} onChange={(prelaw) => update((s) => ({ ...s, prelaw }))} />}
        </>
      )}

      <footer className="foot">
        Requirements are scraped from <a href="https://bulletin.temple.edu" target="_blank" rel="noreferrer">bulletin.temple.edu</a> for each catalog year
        {index && <> ({Object.entries(index.years).map(([y, v]) => `${y}: ${v.majors} majors, ${v.minors} minors`).join(' · ')})</>}.
        Your catalog year is the fall term in which you <i>declared</i> your major, which may differ from your class default, so change it per program if needed.
        This is a planning aid, not an official degree audit. Confirm with DARS and your academic advisor. Your data stays in this browser.
      </footer>
    </div>
  )
}
