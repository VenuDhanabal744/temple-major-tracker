import { useRef, useState } from 'react'
import type { CourseStatus, StudentCourse } from '../types'
import { normalizeCode } from '../lib/audit'
import { importFile, toCsv, type ImportResult } from '../lib/importer'
import { uid } from '../lib/store'
import { download, fmt } from './common'

type Props = {
  courses: StudentCourse[]
  titles: Map<string, { title: string; credits: number }>
  onChange: (courses: StudentCourse[]) => void
}

const STATUSES: CourseStatus[] = ['completed', 'in-progress', 'planned']

export function CoursesTab({ courses, titles, onChange }: Props) {
  const [over, setOver] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [draft, setDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (f: File) => {
    setMsg(null)
    try {
      const r = await importFile(f, titles)
      setPending(r)
    } catch (e) {
      setMsg({ kind: 'warn', text: (e as Error).message })
    }
  }

  const applyImport = (mode: 'replace' | 'merge') => {
    if (!pending) return
    const incoming = pending.courses
    if (mode === 'replace') onChange(incoming)
    else {
      const key = (c: StudentCourse) => `${c.code}|${c.term}`
      const have = new Set(courses.map(key))
      onChange([...courses, ...incoming.filter((c) => !have.has(key(c)))])
    }
    setMsg({ kind: 'ok', text: `Imported ${incoming.length} course${incoming.length === 1 ? '' : 's'} from "${pending.sheet}".` })
    setPending(null)
  }

  const add = () => {
    const parts = draft.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
    const added: StudentCourse[] = []
    const bad: string[] = []
    for (const p of parts) {
      const code = normalizeCode(p)
      if (!code) { bad.push(p); continue }
      const known = titles.get(code)
      added.push({ id: uid(), code, title: known?.title ?? '', credits: known?.credits ?? 3, grade: '', term: '', status: 'completed' })
    }
    if (added.length) onChange([...courses, ...added])
    setDraft(bad.join(', '))
    if (bad.length) setMsg({ kind: 'warn', text: `Couldn't read: ${bad.join(', ')}. Use the form SUBJ 1234.` })
  }

  const edit = (id: string, patch: Partial<StudentCourse>) => onChange(courses.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const sorted = [...courses].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.code.localeCompare(b.code))
  const totals = STATUSES.map((s) => courses.filter((c) => c.status === s).reduce((n, c) => n + (c.credits || 0), 0))

  return (
    <div className="stack">
      <div className="card">
        <h2>Import from Excel</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Upload an <b>.xlsx</b> or <b>.csv</b> file with a column for the course (e.g. <span className="code">POLS 1101</span>, or separate
          Subject and Number columns). Optional columns: Title, Credits, Grade, Term, Status (completed, in progress, or planned). If the
          sheet has no headers, such as an audit you copied into Excel, every cell is scanned for course codes. The file is read in your browser and never uploaded anywhere.
        </p>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
        >
          <b>Drop a spreadsheet here</b> <span className="muted">or click to choose a file</span>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn" href={`${import.meta.env.BASE_URL}course-template.xlsx`} download>Download Excel template</a>
          <button className="btn" disabled={!courses.length} onClick={() => download('my-temple-courses.csv', toCsv(courses))}>Export my courses (CSV)</button>
        </div>
        {pending && (
          <div className="banner" style={{ marginTop: 12 }}>
            Found <b>{pending.courses.length}</b> courses on sheet "{pending.sheet}"
            {pending.skipped ? `, skipped ${pending.skipped} rows without a course code` : ''}.{' '}
            <span className="muted small">Columns used: {Object.entries(pending.mapping).map(([k, v]) => `${k} ← "${v}"`).join(', ')}</span>
            <div className="row" style={{ marginTop: 8 }}>
              {courses.length > 0 && <button className="btn primary" onClick={() => applyImport('merge')}>Add to my {courses.length} courses</button>}
              <button className={`btn${courses.length ? '' : ' primary'}`} onClick={() => applyImport('replace')}>{courses.length ? 'Replace my list' : 'Import'}</button>
              <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        {msg && <div className={`banner ${msg.kind}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>My courses</h2>
          <div className="row small muted">
            <span className="pill completed">{fmt(totals[0])} cr completed</span>
            <span className="pill in-progress">{fmt(totals[1])} cr in progress</span>
            <span className="pill planned">{fmt(totals[2])} cr planned</span>
          </div>
        </div>
        <form className="row" style={{ margin: '10px 0' }} onSubmit={(e) => { e.preventDefault(); add() }}>
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add courses: POLS 1101, PHIL 1066, ENG 0802" style={{ flex: 1, minWidth: 220 }} aria-label="Course codes to add" />
          <button className="btn primary" type="submit" disabled={!draft.trim()}>Add</button>
        </form>
        {courses.length === 0 ? (
          <div className="empty">No courses yet. Import a spreadsheet or type course codes above.</div>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr><th>Course</th><th>Title</th><th style={{ width: 70 }}>Credits</th><th style={{ width: 80 }}>Grade</th><th style={{ width: 120 }}>Term</th><th style={{ width: 130 }}>Status</th><th /></tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id}>
                    <td className="code">{c.code}</td>
                    <td><input type="text" value={c.title} onChange={(e) => edit(c.id, { title: e.target.value })} aria-label={`${c.code} title`} /></td>
                    <td><input type="number" min={0} max={12} step={0.5} value={c.credits} onChange={(e) => edit(c.id, { credits: Number(e.target.value) })} aria-label={`${c.code} credits`} /></td>
                    <td><input type="text" value={c.grade} onChange={(e) => edit(c.id, { grade: e.target.value.toUpperCase() })} placeholder="—" aria-label={`${c.code} grade`} /></td>
                    <td><input type="text" value={c.term} onChange={(e) => edit(c.id, { term: e.target.value })} placeholder="Fall 2025" aria-label={`${c.code} term`} /></td>
                    <td>
                      <select value={c.status} onChange={(e) => edit(c.id, { status: e.target.value as CourseStatus })} aria-label={`${c.code} status`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('-', ' ')}</option>)}
                      </select>
                    </td>
                    <td><button className="btn ghost danger" onClick={() => onChange(courses.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.code}`}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {courses.length > 0 && (
          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button className="btn ghost danger" onClick={() => { if (confirm('Remove all courses from this tracker?')) onChange([]) }}>Clear all</button>
          </div>
        )}
      </div>
    </div>
  )
}
