// Pre-law guidance. Temple has no required pre-law curriculum: per Temple's Pre-Law FAQ
// (careercenter.temple.edu), law schools don't favor a major or require courses, and
// advisors point students to courses that build the skills the ABA identifies.
// Every course below was checked against the Temple Undergraduate Bulletin course
// descriptions (bulletin.temple.edu/undergraduate/courses/). Communication courses were
// renumbered from CSI to COMC in 2026-2027, so both codes are listed.

export type SkillArea = {
  id: string
  label: string
  why: string
  target: number // suggested number of courses
  courses: { codes: string[]; title: string }[]
}

export const SKILL_AREAS: SkillArea[] = [
  {
    id: 'logic',
    label: 'Logic & analytical reasoning',
    why: 'The LSAT is built on argument analysis and logical reasoning; formal logic is the most direct preparation.',
    target: 1,
    courses: [
      { codes: ['PHIL 1066', 'PHIL 1966'], title: 'Introduction to Logic (or Honors)' },
      { codes: ['PHIL 3211'], title: 'Intermediate Logic' },
      { codes: ['PHIL 1062', 'PHIL 1962'], title: 'Morality and the Law (or Honors)' },
      { codes: ['PHIL 3243'], title: 'Philosophy of Law' },
    ],
  },
  {
    id: 'writing',
    label: 'Writing & research',
    why: 'Legal study is reading-heavy and writing-heavy; the ABA lists writing and research among core skills.',
    target: 2,
    courses: [
      { codes: ['ENG 2009'], title: 'Writing the Research Essay' },
      { codes: ['ADV 1196'], title: 'Persuasive Writing' },
      { codes: ['ENG 2207'], title: 'Literature and the Law' },
      { codes: ['ENG 2006'], title: 'Non-Fiction Writing' },
      { codes: ['POLS 2597', 'POLS 2997'], title: 'Writing Preparation Seminar (Political Science)' },
      { codes: ['HIST 3096'], title: 'Intermediate Writing Seminar (History)' },
    ],
  },
  {
    id: 'oral',
    label: 'Oral advocacy & argument',
    why: 'Oral communication and listening are on the ABA list, and moot court and mock trial build on them.',
    target: 1,
    courses: [
      { codes: ['CSI 1111', 'CSI 1911'], title: 'Introduction to Public Speaking' },
      { codes: ['CSI 2111', 'COMC 2111'], title: 'Argumentation and Advocacy' },
      { codes: ['CSI 1113', 'COMC 1113'], title: 'Persuasion / Persuasion Theory and Practice' },
    ],
  },
  {
    id: 'law',
    label: 'Law & legal institutions',
    why: 'Optional. Law schools don\'t expect law coursework, but these show interest and help you test your fit.',
    target: 1,
    courses: [
      { codes: ['LGLS 0856', 'LGLS 0956'], title: 'Law and American Society (or Honors)' },
      { codes: ['LGLS 1102'], title: 'Law of Contracts' },
      { codes: ['POLS 3121'], title: 'American Constitutional Principles I' },
      { codes: ['POLS 3123'], title: 'American Constitutional Principles II: Civil Rights' },
      { codes: ['POLS 3103'], title: 'The American Supreme Court' },
      { codes: ['CJ 2501'], title: 'Introduction to Criminal Law' },
      { codes: ['HIST 2105'], title: 'Race and the U.S. Constitution' },
      { codes: ['ECON 3543'], title: 'Law and Economics' },
    ],
  },
  {
    id: 'experience',
    label: 'Pre-law seminar / internship',
    why: 'Credit-bearing ways to get legal work experience and recommendation-letter relationships.',
    target: 1,
    courses: [
      { codes: ['PHIL 3075'], title: 'Pre-Law Seminar' },
      { codes: ['PHIL 3085'], title: 'Pre-Law Internship' },
      { codes: ['PHIL 4297'], title: 'Pre-Law Tutorial' },
      { codes: ['LGLS 3581'], title: 'Pre-Law Internship and Seminar' },
      { codes: ['LGLS 4596'], title: 'Legal Reasoning in Action' },
    ],
  },
]

export type Milestone = { id: string; label: string; detail?: string; when: (g: number, gap: number) => string; link?: string }

// g = graduation year (May); gap = years between graduation and starting law school.
// You apply in the fall before you want to start law school.
export const MILESTONES: Milestone[] = [
  { id: 'listserv', label: 'Join the Temple Pre-Law Listserv', detail: 'Temple\'s main channel for pre-law news (CLA-LAW list). Subscribe with your Temple email.', when: (g) => `Fall ${g - 4}`, link: 'https://listserv.temple.edu/cgi-bin/wa?SUBED1=CLA-LAW' },
  { id: 'advisor', label: 'Meet a pre-law advisor', detail: 'CLA Academic Advising or the CLA Director of Pre-Law; advising is open to every major.', when: (g) => `Fall ${g - 4}`, link: 'https://liberalarts.temple.edu/academics/departments-and-programs/philosophy/undergraduate/pre-law' },
  { id: 'orgs', label: 'Get involved: Pre-Law Society, Phi Alpha Delta, Mock Trial, BLSA', when: (g) => `${g - 4}–${g - 3}` },
  { id: 'faculty', label: 'Build relationships with 2+ professors (future recommenders)', when: (g) => `${g - 3}–${g - 2}` },
  { id: 'experience', label: 'Legal internship or relevant work experience', when: (g) => `Summer ${g - 2}` },
  { id: 'lsac', label: 'Create an LSAC account and register for Credential Assembly Service (CAS)', when: (g, gap) => `Spring ${g - 1 + gap}`, link: 'https://www.lsac.org' },
  { id: 'lsatprep', label: 'Start LSAT prep (diagnostic test first)', when: (g, gap) => `Spring ${g - 2 + gap}` },
  { id: 'lsat', label: 'Take the LSAT', detail: 'Leave room for a retake before applications open.', when: (g, gap) => `Summer ${g - 1 + gap}`, link: 'https://www.lsac.org/lsat' },
  { id: 'letters', label: 'Ask for letters of recommendation', detail: 'Most schools expect at least two, at least one academic.', when: (g, gap) => `Spring–Summer ${g - 1 + gap}` },
  { id: 'transcripts', label: 'Send transcripts from every college attended to LSAC', when: (g, gap) => `Summer ${g - 1 + gap}` },
  { id: 'statement', label: 'Draft personal statement and resume', detail: 'Two-page personal statement. Have a pre-law advisor review it.', when: (g, gap) => `Summer ${g - 1 + gap}` },
  { id: 'apply', label: 'Submit law school applications', detail: 'Apply in the fall before you start law school.', when: (g, gap) => `Sep–Dec ${g - 1 + gap}` },
  { id: 'aid', label: 'FAFSA and scholarship negotiations', when: (g, gap) => `Jan–Apr ${g + gap}` },
  { id: 'deposit', label: 'Choose a school and submit a seat deposit', when: (g, gap) => `Apr–May ${g + gap}` },
]

// LSAC converts every grade to its own 4.33 scale and counts all attempts of repeated courses.
export const LSAC_POINTS: Record<string, number> = {
  'A+': 4.33, A: 4.0, 'A-': 3.67, 'B+': 3.33, B: 3.0, 'B-': 2.67, 'C+': 2.33, C: 2.0, 'C-': 1.67, 'D+': 1.33, D: 1.0, 'D-': 0.67, F: 0, WF: 0,
}
// Temple's scale tops out at A = 4.00 (no A+).
export const TEMPLE_POINTS: Record<string, number> = {
  A: 4.0, 'A-': 3.67, 'B+': 3.33, B: 3.0, 'B-': 2.67, 'C+': 2.33, C: 2.0, 'C-': 1.67, 'D+': 1.33, D: 1.0, 'D-': 0.67, F: 0,
}
