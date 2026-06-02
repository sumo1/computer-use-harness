import type { TraceEvent } from "../core/contracts.js"

export interface UseCase {
  id: string
  title: string
  requires?: UseCaseRequirements
  steps: string[]
  success: string[]
}

export interface UseCaseRequirements {
  platform?: string
  permissions?: string[]
  services?: string[]
}

export interface UseCaseListItem {
  id: string
  title: string
  requires: UseCaseRequirements
}

export interface UseCaseDryRunItem {
  id: string
  title: string
  requires: UseCaseRequirements
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
