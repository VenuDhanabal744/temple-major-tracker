import { useCallback, useEffect, useState } from 'react'
import type { PlanEntry, StudentCourse } from '../types'

export type Letter = { id: string; name: string; kind: 'academic' | 'professional'; status: 'asked' | 'agreed' | 'submitted' | 'idea' }
export type TargetSchool = { id: string; name: string; lsatMedian: string; gpaMedian: string }

export type PreLawState = {
  enabled: boolean
  lsatScores: number[]
  lsatPlanned: string
  checklist: Record<string, boolean>
  letters: Letter[]
  schools: TargetSchool[]
  apcPlan: 'senior' | 'gap1' | 'gap2'
}

export type AppState = {
  gradYear: number
  courses: StudentCourse[]
  plan: PlanEntry[] // [0] = primary major, rest = second major / minors
  manual: Record<string, Record<string, string[]>> // `${year}/${programId}` -> itemKey -> codes
  minGrade: string
  allowDoubleCount: boolean
  genedWaived: string[] // GenEd area codes the student marked as waived (study abroad, transfer, placement)
  prelaw: PreLawState
}

const KEY = 'temple-major-tracker:v1'

export const initialState: AppState = {
  gradYear: 2029,
  courses: [],
  plan: [],
  manual: {},
  minGrade: 'C-',
  allowDoubleCount: true,
  genedWaived: [],
  prelaw: { enabled: true, lsatScores: [], lsatPlanned: '', checklist: {}, letters: [], schools: [], apcPlan: 'senior' },
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState
    const s = JSON.parse(raw)
    return { ...initialState, ...s, prelaw: { ...initialState.prelaw, ...(s.prelaw ?? {}) } }
  } catch {
    return initialState
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable (private mode); state still works for this session */
    }
  }, [state])
  const update = useCallback((fn: (s: AppState) => AppState) => setState(fn), [])
  return [state, update] as const
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}
