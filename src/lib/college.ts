import { useEffect, useState } from 'react'
import type { CollegeDegree, CollegeYear, Program } from '../types'
import type { AuditResult } from './audit'

const BASE = import.meta.env.BASE_URL
const cache = new Map<string, Promise<CollegeYear | null>>()

function loadCollegeYear(year: string): Promise<CollegeYear | null> {
  let p = cache.get(year)
  if (!p) {
    p = fetch(`${BASE}data/college/${year}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    cache.set(year, p)
  }
  return p
}

/** College-wide requirements for each year in `years`, keyed by year. */
export function useColleges(years: string[]): Record<string, CollegeYear> {
  const key = [...new Set(years)].sort().join(',')
  const [data, setData] = useState<Record<string, CollegeYear>>({})
  useEffect(() => {
    let live = true
    const ys = key ? key.split(',') : []
    Promise.all(ys.map(loadCollegeYear)).then((all) => {
      if (!live) return
      const out: Record<string, CollegeYear> = {}
      for (const d of all) if (d) out[d.year] = d
      setData(out)
    })
    return () => {
      live = false
    }
  }, [key])
  return data
}

export type CollegeResolved = { year: string; program: Program; degree: CollegeDegree; result: AuditResult }

/**
 * The college's degree requirements for a major (e.g. the Fox BBA foundation for Accounting BBA),
 * shaped as a Program so the shared audit and ProgramAudit card can show them.
 */
export function collegeProgram(colleges: CollegeYear | undefined, major: Program): { program: Program; degree: CollegeDegree } | null {
  const college = colleges?.colleges[major.collegeSlug]
  const degree = college?.degrees[major.degree]
  if (!college || !degree) return null
  const totals = degree.blocks.map((b) => b.total).filter((t) => t !== null)
  return {
    degree,
    program: {
      id: `college-${major.collegeSlug}-${major.degree}`,
      name: `${college.name}: ${major.degree} requirements`,
      degree: major.degree,
      college: college.name,
      collegeSlug: major.collegeSlug,
      year: major.year,
      statedYear: null,
      url: college.url,
      source: college.source,
      sourceKind: college.sourceKind,
      majorCredits: totals.length ? { min: totals.reduce((s, t) => s + t.min, 0), max: totals.reduce((s, t) => s + t.max, 0) } : null,
      degreeCredits: degree.credits,
      blocks: degree.blocks,
      footnotes: [],
      notes: [],
    },
  }
}
