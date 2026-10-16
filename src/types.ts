// Shapes of the scraped bulletin data (see scripts/scrape_bulletin.py)

export type Hours = { min: number; max: number } | null

export type CourseOption = { codes: string[]; title: string }

export type CourseItem = { type: 'course'; options: CourseOption[]; credits: Hours }

export type ChooseItem = {
  type: 'choose'
  text: string
  credits: Hours
  count: number | null
  courses: CourseItem[]
  notes: string[] | null
  by?: 'count' // met by `count` courses whatever their credits (GenEd areas)
}

export type Rule = { levels?: [number, number]; subjects?: string[]; inferred?: boolean }

export type RuleItem = { type: 'rule'; text: string; credits: Hours; count: number | null; rule: Rule | null; notes: string[] | null }

export type NoteItem = { type: 'note'; text: string }

// a reference list of courses that no requirement line points to; it adds no credits
export type ListItem = { type: 'list'; text: string; courses: CourseItem[] }

export type Item = CourseItem | ChooseItem | RuleItem | NoteItem | ListItem

export type Section = { title: string | null; items: Item[] }

export type Block = {
  heading: string | null
  total: Hours
  role: 'core' | 'concentration' | 'info'
  sections: Section[]
}

export type Program = {
  id: string
  name: string
  degree: string
  college: string
  collegeSlug: string
  year: string
  statedYear: string | null
  url: string
  source: string
  sourceKind: 'live' | 'wayback' | 'pdf-verified' | 'pdf'
  majorCredits: Hours
  degreeCredits: number | null
  blocks: Block[]
  footnotes: string[]
  notes: { tag: string; text: string }[]
}

export type YearData = { year: string; programs: Program[] }

// College-wide degree requirements listed once on a college's page (see scripts/scrape_college.py)
export type CollegeDegree = { credits: number | null; blocks: Block[]; summary: { text: string; credits: Hours }[] }

export type CollegeReqs = {
  name: string
  url: string
  source: string
  sourceKind: Program['sourceKind']
  degrees: Record<string, CollegeDegree> // keyed by Program.degree, e.g. BBA
}

export type CollegeYear = { year: string; colleges: Record<string, CollegeReqs> }

// General Education requirements for one catalog year (see scripts/scrape_gened.py)
export type GenEdArea = {
  code: string // GW, GQ, GY, GZ, GA, GB, GD, GG, GS, GU
  name: string
  requirement: string
  count: number
  credits: { min: number; max: number }
  foundation: boolean
  url: string
  source: string
  sourceKind: Program['sourceKind']
}

export type GenEd = {
  year: string
  url: string
  source: string
  sourceKind: Program['sourceKind']
  areas: GenEdArea[]
  blocks: Block[] // one section per area, titled "Name (GX)"
  policies: string[]
}

export type CatalogIndex = {
  years: Record<string, { count: number; majors: number; minors: number; source: string; scrapedAt: string }>
}

// The student's own records

export type CourseStatus = 'completed' | 'in-progress' | 'planned'

export type StudentCourse = {
  id: string
  code: string // normalized "SUBJ 1234"
  title: string
  credits: number
  grade: string
  term: string
  status: CourseStatus
}

export type PlanEntry = {
  programId: string
  catalogYear: string // may differ from the class default: catalog year follows the term the major was declared
  concentration: number | null // index into concentration blocks
}
