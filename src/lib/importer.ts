import readXlsxFile from 'read-excel-file/browser'
import type { CourseStatus, StudentCourse } from '../types'
import { GRADE_ORDER, normalizeCode } from './audit'

type Cell = string | number | boolean | Date | null
type Row = Cell[]

export type ImportResult = { courses: StudentCourse[]; skipped: number; sheet: string; mapping: Record<string, string> }

const HEADERS: Record<string, RegExp> = {
  code: /^(course( ?(code|id|#|number))?|class|code|course\/?section)$/i,
  subject: /^(subject|subj|dept|department|prefix)$/i,
  number: /^(number|num|no\.?|catalog( ?(number|#|nbr))?|course ?(number|no\.?|#)|crs ?#?)$/i,
  title: /^(title|course ?title|name|course ?name|description)$/i,
  credits: /^(credits?|credit ?hours?|hours|hrs|units?|s\.?h\.?|cr)$/i,
  grade: /^(grade|final ?grade|mark|letter ?grade)$/i,
  term: /^(term|semester|session|year|when|taken)$/i,
  status: /^(status|state|progress)$/i,
}

function text(c: Cell): string {
  if (c === null || c === undefined) return ''
  if (c instanceof Date) return c.toISOString().slice(0, 10)
  return String(c).trim()
}

function findHeader(rows: Row[]): { index: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const map: Record<string, number> = {}
    rows[i].forEach((cell, j) => {
      const t = text(cell).replace(/[:*]/g, '').trim()
      for (const [key, re] of Object.entries(HEADERS)) if (!(key in map) && re.test(t)) map[key] = j
    })
    if ('code' in map || ('subject' in map && 'number' in map)) return { index: i, map }
  }
  return null
}

/** Rough term dates: Spring Jan-May, Summer May-Aug, Fall Aug-Dec. */
function termStatus(term: string, now = new Date()): CourseStatus | null {
  const m = term.match(/(spring|summer|fall|autumn|winter)\D*(\d{4})|(\d{4})\D*(spring|summer|fall|autumn|winter)/i)
  if (!m) return null
  const season = (m[1] ?? m[4]).toLowerCase()
  const year = Number(m[2] ?? m[3])
  const [s, e] = { winter: [0, 1], spring: [0, 4], summer: [4, 7], fall: [7, 11], autumn: [7, 11] }[season] as [number, number]
  const start = new Date(year, s, 10)
  const end = new Date(year, e + 1, 0)
  if (now > end) return 'completed'
  if (now >= start) return 'in-progress'
  return 'planned'
}

function statusOf(raw: string, grade: string, term: string): CourseStatus {
  const s = raw.toLowerCase()
  if (/plan|future|next|intend/.test(s)) return 'planned'
  if (/progress|current|enrolled|registered|taking|ip\b/.test(s)) return 'in-progress'
  if (/complete|done|taken|finished|passed|yes|transfer/.test(s)) return 'completed'
  if (grade.toUpperCase() === 'IP') return 'in-progress'
  if (grade) return 'completed'
  // no grade and no status: decide from the term if there is one
  return termStatus(term) ?? 'completed'
}

function cleanGrade(g: string): string {
  const u = g.toUpperCase().replace(/\s/g, '')
  if (GRADE_ORDER.includes(u) || ['P', 'CR', 'TR', 'T', 'W', 'WF', 'I', 'NR', 'IP', 'S', 'U'].includes(u)) return u === 'IP' ? '' : u
  return g
}

export function rowsToCourses(rows: Row[], titles: Map<string, { title: string; credits: number }>): Omit<ImportResult, 'sheet'> {
  const courses: StudentCourse[] = []
  let skipped = 0
  const header = findHeader(rows)
  const mapping: Record<string, string> = {}
  const seen = new Set<string>()
  const push = (code: string, extra: Partial<StudentCourse>) => {
    const known = titles.get(code)
    const c: StudentCourse = {
      id: `${code}-${extra.term ?? ''}-${courses.length}-${Math.random().toString(36).slice(2, 7)}`,
      code,
      title: extra.title || known?.title || '',
      credits: extra.credits || known?.credits || 3,
      grade: extra.grade ?? '',
      term: extra.term ?? '',
      status: extra.status ?? 'completed',
    }
    const key = `${code}|${c.term}|${c.grade}`
    if (seen.has(key)) return
    seen.add(key)
    courses.push(c)
  }

  if (header) {
    for (const [k, j] of Object.entries(header.map)) mapping[k] = text(rows[header.index][j])
    for (const row of rows.slice(header.index + 1)) {
      const get = (k: string) => (k in header.map ? text(row[header.map[k]]) : '')
      const raw = get('code') || `${get('subject')} ${get('number')}`
      const code = normalizeCode(raw)
      if (!code) {
        if (row.some((c) => text(c))) skipped++
        continue
      }
      const grade = cleanGrade(get('grade'))
      const cr = parseFloat(get('credits'))
      push(code, {
        title: get('title'),
        credits: Number.isFinite(cr) ? cr : undefined,
        grade,
        term: get('term'),
        status: statusOf(get('status'), get('grade'), get('term')),
      })
    }
  } else {
    // no recognizable header (e.g. a pasted DARS audit): scan every cell for course codes
    mapping['(scan)'] = 'Course codes found anywhere in the sheet'
    for (const row of rows) {
      for (let j = 0; j < row.length; j++) {
        const code = normalizeCode(text(row[j]))
        if (!code) continue
        const rest = row.slice(j + 1).map(text)
        const grade = rest.find((t) => GRADE_ORDER.includes(t.toUpperCase())) ?? ''
        const cr = rest.map((t) => parseFloat(t)).find((n) => Number.isFinite(n) && n > 0 && n <= 8)
        push(code, { grade, credits: cr, status: 'completed' })
      }
    }
  }
  return { courses, skipped, mapping }
}

function parseCsv(src: string): Row[] {
  const rows: Row[] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',' || ch === '\t') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

export async function importFile(file: File, titles: Map<string, { title: string; credits: number }>): Promise<ImportResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    return { ...rowsToCourses(parseCsv(await file.text()), titles), sheet: file.name }
  }
  if (name.endsWith('.xls')) {
    throw new Error('Old .xls files are not supported. In Excel choose File > Save As > Excel Workbook (.xlsx) or CSV, then upload again.')
  }
  const sheets = await readXlsxFile(file)
  // pick the sheet that yields the most courses
  let best: ImportResult | null = null
  for (const s of sheets) {
    const r = { ...rowsToCourses(s.data as Row[], titles), sheet: s.sheet }
    if (!best || r.courses.length > best.courses.length) best = r
  }
  if (!best || !best.courses.length) throw new Error('No course codes (like "POLS 1101") were found in that file.')
  return best
}

export function toCsv(courses: StudentCourse[]): string {
  const esc = (s: string | number) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s))
  const lines = [['Course', 'Title', 'Credits', 'Grade', 'Term', 'Status']]
  for (const c of courses) lines.push([c.code, c.title, String(c.credits), c.grade, c.term, c.status])
  return lines.map((l) => l.map(esc).join(',')).join('\n')
}
