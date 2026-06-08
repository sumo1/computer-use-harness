import type { TargetKind, TraceEvent } from "../core/contracts.js"

export interface UseCase {
  id: string
  title: string
  target?: UseCaseTarget
  requires?: UseCaseRequirements
  goal?: UseCaseGoal
  steps: string[]
  success: string[]
}

export interface UseCaseTarget {
  kind: TargetKind
  id?: string
  name?: string
  platform?: "any" | "macos"
}

export interface UseCaseRequirements {
  platform?: string
  permissions?: string[]
  services?: string[]
}

export interface UseCaseGoal {
  mode: "target"
  entity: string
  query: string
  constraints?: Record<string, string>
  navigation?: UseCaseGoalNavigation
  coverage?: UseCaseGoalCoverage
  orderBy?: UseCaseGoalOrder
  requiredFields: string[]
  confirmation?: "list" | "detail"
  maxIterations?: number
}

export interface UseCaseGoalNavigation {
  semanticTabs?: string[]
}

export interface UseCaseGoalCoverage {
  strategy: "visible" | "scroll-until-stable"
  maxScans?: number
  maxScrolls?: number
  stableObservations?: number
  minObservations?: number
}

export interface UseCaseGoalOrder {
  field: string
  direction: "asc" | "desc"
}

export interface UseCaseListItem {
  id: string
  title: string
  requires: UseCaseRequirements
}

export interface UseCaseDryRunItem {
  id: string
  title: string
  target?: UseCaseTarget
  requires: UseCaseRequirements
  goal?: UseCaseGoal
  steps: string[]
  success: string[]
}

export interface UseCaseStepResult {
  index: number
  description: string
  status: "passed" | "failed" | "blocked" | "skipped"
  adapter: "fake" | "mac-helper"
}

export interface UseCaseRunResult {
  caseId: string
  title: string
  status: "passed" | "failed" | "blocked" | "skipped"
  mode: "fake" | "native"
  traceId: string
  trace: TraceEvent[]
  steps: UseCaseStepResult[]
  success: string[]
}
