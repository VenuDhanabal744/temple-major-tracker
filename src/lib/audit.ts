import type { Block, ChooseItem, CourseItem, Item, Program, RuleItem, StudentCourse } from '../types'

// anything with requirement blocks: a program, or the GenEd curriculum
type Auditable = Pick<Program, 'blocks'>

export const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']
const NO_CREDIT = new Set(['F', 'W', 'WF', 'WP', 'I', 'NR', 'AU', 'U', 'NC'])

export function normalizeCode(raw: string): string | null {
  const m = String(raw).toUpperCase().match(/\b([A-Z]{2,4})\s*[-_.]?\s*(\d{4})\b/)
  return m ? `${m[1]} ${m[2]}` : null
}

/** Does this course count toward a requirement at the given minimum grade? */
export function counts(c: StudentCourse, minGrade: string): boolean {
  if (c.status !== 'completed') return true // in-progress / planned are projected
  const g = c.grade.trim().toUpperCase()
  if (!g || ['P', 'CR', 'TR', 'T', 'S'].includes(g)) return true
  if (NO_CREDIT.has(g)) return false
  const gi = GRADE_ORDER.indexOf(g)
  const mi = GRADE_ORDER.indexOf(minGrade)
  return gi === -1 || mi === -1 || gi <= mi
}

export type Matched = { code: string; credits: number; status: StudentCourse['status']; manual?: boolean }

export type ItemResult = {
  key: string
  item: CourseItem | ChooseItem | RuleItem
  required: number // credits this item is worth toward the major
  satisfied: number // credits satisfied (capped at required)
  done: boolean
  matched: Matched[]
  worst: StudentCourse['status'] | null
}

export type SectionResult = { title: string | null; items: ItemResult[]; notes: string[] }
export type BlockResult = { heading: string | null; role: Block['role']; sections: SectionResult[] }

export type AuditResult = {
  blocks: BlockResult[]
  required: number
  completed: number
  inProgress: number
  planned: number
  used: Set<string>
  itemsDone: number
  itemsTotal: number
}

export function concentrationBlocks(p: Auditable): Block[] {
  return p.blocks.filter((b) => b.role === 'concentration')
}

/** A concentration must be picked when the program has no core table of its own. */
export function concentrationRequired(p: Auditable): boolean {
  return !p.blocks.some((b) => b.role === 'core')
}

/** Blocks that count: core blocks plus the chosen concentration (or the only one, when it is the whole program). */
export function activeBlocks(p: Auditable, concentration: number | null): Block[] {
  const conc = concentrationBlocks(p)
  return p.blocks.filter((b) => {
    if (b.role === 'core') return true
    if (b.role !== 'concentration') return false
    if (conc.length === 1 && concentrationRequired(p)) return true
    return concentration !== null && conc[concentration] === b
  })
}

const STATUS_RANK = { completed: 0, 'in-progress': 1, planned: 2 } as const

function worstOf(ms: Matched[]): Matched['status'] | null {
  if (!ms.length) return null
  return ms.reduce((w, m) => (STATUS_RANK[m.status] > STATUS_RANK[w] ? m.status : w), ms[0].status)
}

function itemCredits(it: CourseItem): number {
  return it.credits?.min ?? 3
}

function requiredFor(it: CourseItem | ChooseItem | RuleItem): number {
  if (it.type === 'course') return itemCredits(it)
  if (it.credits?.min) return it.credits.min
  if (it.count) return it.count * 3
  return 3
}

function ruleMatches(rule: RuleItem['rule'], code: string): boolean {
  if (!rule || (!rule.levels && !rule.subjects)) return false
  const [subj, num] = code.split(' ')
  const n = Number(num)
  if (rule.subjects && !rule.subjects.includes(subj)) return false
  if (rule.levels && (n < rule.levels[0] || n > rule.levels[1])) return false
  // a level range alone (no subject) is too loose to auto-apply
  return !!rule.subjects
}

export type AuditOptions = {
  concentration: number | null
  minGrade: string
  manual?: Record<string, string[]> // itemKey -> course codes the student assigned by hand
  exclude?: Set<string> // codes already used elsewhere (when double-counting is disallowed)
}

export function audit(p: Auditable, courses: StudentCourse[], opts: AuditOptions): AuditResult {
  const pool = new Map<string, StudentCourse>()
  for (const c of courses) {
    if (!counts(c, opts.minGrade)) continue
    const prev = pool.get(c.code)
    if (!prev || STATUS_RANK[c.status] < STATUS_RANK[prev.status]) pool.set(c.code, c)
  }
  const used = new Set<string>(opts.exclude ?? [])
  const take = (code: string, fallbackCredits: number, manual = false): Matched | null => {
    const c = pool.get(code)
    if (!c || used.has(code)) return null
    used.add(code)
    return { code, credits: c.credits || fallbackCredits, status: c.status, manual }
  }

  const blocks = activeBlocks(p, opts.concentration)
  const results: BlockResult[] = blocks.map((b) => ({ heading: b.heading, role: b.role, sections: [] }))
  const all: ItemResult[] = []
  const pending: { r: ItemResult; pass: number }[] = []

  blocks.forEach((b, bi) => {
    const bIndex = p.blocks.indexOf(b)
    b.sections.forEach((s, si) => {
      const sec: SectionResult = { title: s.title, items: [], notes: [] }
      s.items.forEach((it: Item, ii) => {
        if (it.type === 'note') {
          sec.notes.push(it.text)
          return
        }
        if (it.type === 'list') {
          sec.notes.push(`${it.text}: ${it.courses.map((c) => c.options[0].codes.join(' & ')).join(', ')}`)
          return
        }
        const r: ItemResult = { key: `${bIndex}:${si}:${ii}`, item: it, required: requiredFor(it), satisfied: 0, done: false, matched: [], worst: null }
        sec.items.push(r)
        all.push(r)
        pending.push({ r, pass: it.type === 'course' ? 1 : it.type === 'choose' ? 2 : 3 })
      })
      results[bi].sections.push(sec)
    })
  })

  // 0: manual assignments win
  for (const { r } of pending) {
    for (const code of opts.manual?.[r.key] ?? []) {
      const m = take(code, 3, true)
      if (m) r.matched.push(m)
    }
  }
  // 1: specific courses, 2: "select from" lists (smallest list first), 3: free-text rules
  const order = [...pending].sort((a, b) => {
    if (a.pass !== b.pass) return a.pass - b.pass
    const sa = a.r.item.type === 'choose' ? a.r.item.courses.length : 0
    const sb = b.r.item.type === 'choose' ? b.r.item.courses.length : 0
    return sa - sb
  })
  for (const { r } of order) {
    const it = r.item
    const have = () => r.matched.reduce((s, m) => s + m.credits, 0)
    const enough = () => {
      if (it.type === 'course') return r.matched.length > 0
      if (it.count && (!it.credits || (it.type === 'choose' && it.by === 'count'))) return r.matched.length >= it.count
      return have() >= r.required - 0.01
    }
    if (it.type === 'course') {
      if (!enough()) {
        for (const opt of it.options) {
          if (opt.codes.every((c) => pool.has(c) && !used.has(c))) {
            for (const c of opt.codes) {
              const m = take(c, itemCredits(it) / opt.codes.length)
              if (m) r.matched.push(m)
            }
            break
          }
        }
      }
    } else if (it.type === 'choose') {
      for (const sub of it.courses) {
        if (enough()) break
        for (const opt of sub.options) {
          if (opt.codes.every((c) => pool.has(c) && !used.has(c))) {
            for (const c of opt.codes) {
              const m = take(c, (sub.credits?.min ?? 3) / opt.codes.length)
              if (m) r.matched.push(m)
            }
            break
          }
        }
      }
    } else if (it.rule) {
      for (const code of [...pool.keys()].sort()) {
        if (enough()) break
        if (!used.has(code) && ruleMatches(it.rule, code)) {
          const m = take(code, 3)
          if (m) r.matched.push(m)
        }
      }
    }
    r.satisfied = Math.min(r.required, it.type === 'course' && r.matched.length ? r.required : have())
    r.done = enough()
    if (r.done) r.satisfied = r.required
    r.worst = worstOf(r.matched)
  }

  let completed = 0
  let inProgress = 0
  let planned = 0
  let required = 0
  for (const r of all) {
    required += r.required
    // split satisfied credits by the status of the courses that satisfied them
    let left = r.satisfied
    for (const m of [...r.matched].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])) {
      const share = Math.min(left, r.item.type === 'course' ? r.required : m.credits)
      if (m.status === 'completed') completed += share
      else if (m.status === 'in-progress') inProgress += share
      else planned += share
      left -= share
      if (left <= 0) break
    }
  }
  if (opts.exclude) for (const c of opts.exclude) used.delete(c)
  return {
    blocks: results,
    required,
    completed,
    inProgress,
    planned,
    used,
    itemsDone: all.filter((r) => r.done).length,
    itemsTotal: all.length,
  }
}

// ---------------------------------------------------------------- overlap

export function codesOf(p: Program, concentration: number | null, mandatoryOnly = false): Set<string> {
  const out = new Set<string>()
  for (const b of activeBlocks(p, concentration))
    for (const s of b.sections)
      for (const it of s.items) {
        if (it.type === 'course') it.options.forEach((o) => o.codes.forEach((c) => out.add(c)))
        else if (it.type === 'choose' && !mandatoryOnly) it.courses.forEach((ci) => ci.options.forEach((o) => o.codes.forEach((c) => out.add(c))))
      }
  return out
}

function asCourses(codes: Iterable<string>): StudentCourse[] {
  return [...codes].map((code) => ({ id: code, code, title: '', credits: 0, grade: '', term: '', status: 'completed' as const }))
}

export type Overlap = {
  other: Program
  shared: string[] // course codes appearing in both programs
  guaranteed: number // credits of B covered by A's required courses
  potential: number // credits of B coverable by courses that also count toward A
  bRequired: number
  sameCollege: boolean
}

function rulesOf(p: Program, concentration: number | null): NonNullable<RuleItem['rule']>[] {
  const out: NonNullable<RuleItem['rule']>[] = []
  for (const b of activeBlocks(p, concentration))
    for (const s of b.sections)
      for (const it of s.items) if (it.type === 'rule' && it.rule?.subjects) out.push(it.rule)
  return out
}

export function overlap(a: Program, aConc: number | null, b: Program, bConc: number | null): Overlap {
  const aRules = rulesOf(a, aConc)
  const aAll = codesOf(a, aConc)
  const aReq = codesOf(a, aConc, true)
  const bAll = codesOf(b, bConc)
  // B's listed courses that A would accept through an elective rule ("3 upper-level POLS courses")
  for (const c of bAll) if (aRules.some((r) => ruleMatches(r, c))) aAll.add(c)
  const shared = [...bAll].filter((c) => aAll.has(c)).sort()
  const g = audit(b, asCourses(aReq), { concentration: bConc, minGrade: 'D-' })
  const pot = audit(b, asCourses(aAll), { concentration: bConc, minGrade: 'D-' })
  return {
    other: b,
    shared,
    guaranteed: g.completed,
    potential: pot.completed,
    bRequired: pot.required,
    sameCollege: a.collegeSlug === b.collegeSlug,
  }
}
