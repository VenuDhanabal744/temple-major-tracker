import { useEffect, useState } from 'react'
import type { CatalogIndex, Program, YearData } from '../types'
import { SKILL_AREAS } from './prelaw'

const BASE = import.meta.env.BASE_URL

/**
 * Temple students follow the bulletin for the year they declared their major
 * (a fall term; spring and Summer I declarations use the preceding fall).
 * Absent other information, a student graduating in May of `gradYear` after
 * four years entered — and most often declared — in the fall four years earlier.
 */
export function defaultCatalogYear(gradYear: number): string {
  const start = gradYear - 4
  return `${start}-${start + 1}`
}

export const GRAD_YEARS = [2027, 2028, 2029, 2030]

let indexPromise: Promise<CatalogIndex> | null = null
const yearCache = new Map<string, Promise<YearData>>()

export function loadIndex(): Promise<CatalogIndex> {
  indexPromise ??= fetch(`${BASE}data/index.json`).then((r) => r.json())
  return indexPromise
}

export function loadYear(year: string): Promise<YearData> {
  let p = yearCache.get(year)
  if (!p) {
    p = fetch(`${BASE}data/${year}.json`).then((r) => {
      if (!r.ok) throw new Error(`No catalog data for ${year}`)
      return r.json()
    })
    yearCache.set(year, p)
  }
  return p
}

export function useIndex(): CatalogIndex | null {
  const [idx, setIdx] = useState<CatalogIndex | null>(null)
  useEffect(() => {
    loadIndex().then(setIdx)
  }, [])
  return idx
}

/** Loads every year in `years`; returns a map year -> programs by id. */
export function useYears(years: string[]): Record<string, Map<string, Program>> {
  const key = [...new Set(years)].sort().join(',')
  const [data, setData] = useState<Record<string, Map<string, Program>>>({})
  useEffect(() => {
    let live = true
    const ys = key ? key.split(',') : []
    Promise.all(ys.map((y) => loadYear(y).catch(() => ({ year: y, programs: [] })))).then((all) => {
      if (!live) return
      const out: Record<string, Map<string, Program>> = {}
      for (const d of all) out[d.year] = new Map(d.programs.map((p) => [p.id, p]))
      setData(out)
    })
    return () => {
      live = false
    }
  }, [key])
  return data
}

/** code -> title/credits, from every course mentioned in a year's programs (or GenEd lists). */
export function courseTitles(programs: Iterable<Pick<Program, 'blocks'>>): Map<string, { title: string; credits: number }> {
  const out = new Map<string, { title: string; credits: number }>()
  for (const p of programs)
    for (const b of p.blocks)
      for (const s of b.sections)
        for (const it of s.items) {
          const list = it.type === 'course' ? [it] : it.type === 'choose' || it.type === 'list' ? it.courses : []
          for (const ci of list)
            for (const o of ci.options)
              if (o.codes.length === 1 && !out.has(o.codes[0]) && o.title)
                out.set(o.codes[0], { title: o.title, credits: ci.credits?.min ?? 3 })
        }
  for (const a of SKILL_AREAS)
    for (const c of a.courses) for (const code of c.codes) if (!out.has(code)) out.set(code, { title: c.title, credits: 3 })
  return out
}

export function sourceLabel(p: Program): string {
  switch (p.sourceKind) {
    case 'live':
      return p.year === '2026-2027' ? 'Current bulletin' : 'Bulletin archive'
    case 'wayback':
      return 'Bulletin page as published (Internet Archive)'
    case 'pdf-verified':
      return 'Official bulletin PDF (course list verified)'
    case 'pdf':
      return 'Parsed from official bulletin PDF, so verify the details'
  }
}
