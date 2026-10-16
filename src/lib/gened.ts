import { useEffect, useState } from 'react'
import type { GenEd, Program, StudentCourse } from '../types'
import { audit, type AuditResult } from './audit'

const BASE = import.meta.env.BASE_URL
const cache = new Map<string, Promise<GenEd | null>>()

export function loadGenEd(year: string): Promise<GenEd | null> {
  let p = cache.get(year)
  if (!p) {
    p = fetch(`${BASE}data/gened/${year}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    cache.set(year, p)
  }
  return p
}

export function useGenEd(year: string): GenEd | null {
  const [data, setData] = useState<{ year: string; gened: GenEd | null } | null>(null)
  useEffect(() => {
    let live = true
    loadGenEd(year).then((gened) => live && setData({ year, gened }))
    return () => {
      live = false
    }
  }, [year])
  return data?.year === year ? data.gened : null
}

/** Area code from a GenEd section title such as "Science & Technology (GS)". */
export function areaOf(title: string | null): string | null {
  return title?.match(/\((G[A-Z])\)$/)?.[1] ?? null
}

export type Waiver = { area: string; count: number; source: string; text: string }

/**
 * Waivers a major grants on completion, stated in its bulletin notes, e.g. "Students who complete
 * CST majors receive a waiver for 2 Science & Technology (GS) and 1 Quantitative Literacy (GQ)
 * GenEd courses." Course-sequence waivers (MATH 1041 for GQ, BIOL 1111 + 1112 for GS) are part of
 * the GenEd course lists instead.
 */
export function majorWaivers(programs: Program[]): Waiver[] {
  const out: Waiver[] = []
  for (const p of programs) {
    if (p.degree === 'Minor') continue
    const seen = new Set<string>()
    for (const n of p.notes) {
      for (const sentence of n.text.split(/(?<=\.)\s+/)) {
        const m = sentence.match(/receive a waiver for (.+?) GenEd courses?/i)
        if (!m) continue
        for (const a of m[1].matchAll(/(\d+)\s+[^,()]*?\((G[A-Z])\)/g)) {
          if (seen.has(a[2])) continue
          seen.add(a[2])
          out.push({ area: a[2], count: Number(a[1]), source: p.name, text: sentence.trim() })
        }
      }
    }
  }
  return out
}

export type GenEdAudit = {
  result: AuditResult
  waived: Record<string, { count: number; reasons: string[] }> // area -> courses waived
  required: number // credits still required after waivers
  areasMet: number
  areasTotal: number
  deptOverLimit: string[] // subjects with more than two breadth courses
}

/**
 * Audit GenEd with the shared engine. Waived courses come off an area's count (and its credits,
 * proportionally); a fully waived area drops out of the audit and counts as met.
 */
export function auditGenEd(
  gened: GenEd,
  courses: StudentCourse[],
  waivers: Waiver[],
  manualWaived: string[],
  manual: Record<string, string[]> | undefined,
): GenEdAudit {
  const waived: GenEdAudit['waived'] = {}
  const add = (area: string, count: number, reason: string) => {
    const w = (waived[area] ??= { count: 0, reasons: [] })
    w.count += count
    w.reasons.push(reason)
  }
  for (const w of waivers) add(w.area, w.count, `${w.source}: ${w.text}`)
  for (const a of manualWaived) {
    const area = gened.areas.find((x) => x.code === a)
    if (area) add(a, area.count, 'Marked as waived by you')
  }

  const blocks = gened.blocks.map((b) => ({
    ...b,
    sections: b.sections.map((s) => {
      const w = waived[areaOf(s.title) ?? '']
      if (!w) return s
      const items = s.items.flatMap((it) => {
        if (it.type !== 'choose' || !it.count) return [it]
        const left = it.count - w.count
        if (left <= 0) return []
        const scale = left / it.count
        return [{ ...it, count: left, credits: it.credits && { min: it.credits.min * scale, max: it.credits.max * scale } }]
      })
      return { ...s, items }
    }),
  }))

  // GenEd courses need a C- or better
  const result = audit({ blocks }, courses, { concentration: null, minGrade: 'C-', manual })

  let areasMet = 0
  result.blocks.forEach((b) =>
    b.sections.forEach((s) => {
      if (s.items.length === 0 || s.items.every((r) => r.done)) areasMet++
    }),
  )

  const foundation = new Set(gened.areas.filter((a) => a.foundation).map((a) => a.code))
  const perSubject = new Map<string, number>()
  result.blocks.forEach((b) =>
    b.sections.forEach((s) => {
      if (foundation.has(areaOf(s.title) ?? '')) return
      for (const r of s.items)
        for (const m of r.matched) {
          if (!/ 0[89]\d\d$/.test(m.code)) continue // waiver sequences are not GenEd courses
          const subj = m.code.split(' ')[0]
          perSubject.set(subj, (perSubject.get(subj) ?? 0) + 1)
        }
    }),
  )

  return {
    result,
    waived,
    required: result.required,
    areasMet,
    areasTotal: gened.areas.length,
    deptOverLimit: [...perSubject].filter(([, n]) => n > 2).map(([s]) => s),
  }
}
