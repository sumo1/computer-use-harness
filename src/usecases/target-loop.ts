import type { Action, ActionResult, JsonObject, Observation } from "../core/contracts.js"
import {
  type EntityCandidate,
  type TargetModeDecision,
  type TargetModePlannedStep,
  type TargetModeRuntimeState,
  createTargetModeState,
  decideTargetMode,
  targetModeInitialSteps as heuristicInitialSteps,
  rankingToJson,
  recordTargetModeProgress,
} from "./target-mode.js"
import type { UseCaseGoal } from "./types.js"

export interface TargetModeLoopState {
  plannerName: string
  heuristicState: TargetModeRuntimeState
  lastOutcome?: TargetModeVerifiedOutcome
  decisions: TargetModeDecisionRecord[]
}

export interface TargetModeVerifiedOutcome {
  actionId: string
  actionKind: Action["kind"]
  actionStatus: ActionResult["status"]
  description?: string
  phase?: string
  verification?: string
  stateChanged?: boolean
  targetState?: JsonObject
  actionReportedFailed?: boolean
  hasFreshObservation: boolean
  observationId: string
}

export interface TargetModeDecisionRecord {
  planner: string
  status: TargetModeDecision["status"]
  reason: string
  observationId: string
  outcome: TargetModeVerifiedOutcome
}

export interface TargetModePlannerInput {
  goal: UseCaseGoal
  observation: Observation
  state: TargetModeRuntimeState
  loop: TargetModeLoopState
  outcome: TargetModeVerifiedOutcome
}

export interface TargetModePlanner {
  readonly name: string
  decide(input: TargetModePlannerInput): TargetModeDecision | Promise<TargetModeDecision>
}

export interface TargetModeLoopAdvance {
  decision: TargetModeDecision
  step?: TargetModePlannedStep
}

export class HeuristicTargetPlanner implements TargetModePlanner {
  readonly name = "heuristic-fallback"

  decide(input: TargetModePlannerInput): TargetModeDecision {
    return decideTargetMode(input.goal, input.observation, input.state)
  }
}

const DEFAULT_PLANNER = new HeuristicTargetPlanner()

export function createTargetModeLoopState(
  planner: TargetModePlanner = DEFAULT_PLANNER,
): TargetModeLoopState {
  return {
    plannerName: planner.name,
    heuristicState: createTargetModeState(),
    decisions: [],
  }
}

export function targetModeLoopInitialSteps(
  goal: UseCaseGoal,
  planner: TargetModePlanner = DEFAULT_PLANNER,
): TargetModePlannedStep[] {
  return heuristicInitialSteps(goal).map((step, index) =>
    withLoopStepMetadata(
      goal,
      {
        ...step,
        input: {
          ...step.input,
          targetModePhase: stringInput(step.input, "targetModePhase") ?? initialPhase(index),
        },
      },
      planner.name,
      undefined,
      undefined,
    ),
  )
}

export async function advanceTargetModeLoop(
  goal: UseCaseGoal,
  action: Action,
  result: ActionResult,
  observation: Observation,
  loop: TargetModeLoopState,
  planner: TargetModePlanner = DEFAULT_PLANNER,
): Promise<TargetModeLoopAdvance> {
  const outcome = verifiedOutcome(action, result, observation)
  loop.lastOutcome = outcome

  recordTargetModeProgress(goal, action, result, observation, loop.heuristicState)

  const decision = await planner.decide({
    goal,
    observation,
    state: loop.heuristicState,
    loop,
    outcome,
  })

  loop.decisions.push({
    planner: planner.name,
    status: decision.status,
    reason: decision.reason,
    observationId: observation.id,
    outcome,
  })

  return {
    decision,
    step: decision.step
      ? withLoopStepMetadata(goal, decision.step, planner.name, decision, outcome)
      : undefined,
  }
}

function withLoopStepMetadata(
  goal: UseCaseGoal,
  step: TargetModePlannedStep,
  plannerName: string,
  decision: TargetModeDecision | undefined,
  outcome: TargetModeVerifiedOutcome | undefined,
): TargetModePlannedStep {
  return {
    ...step,
    input: {
      ...step.input,
      targetMode: true,
      targetModeLoop: true,
      targetModePlanner: plannerName,
      targetModeIntent: actionIntent(goal, step),
      ...observationBarrierInput(goal, step),
      ...(decision
        ? {
            targetModeStatus: decision.status,
            targetModeDecisionReason: decision.reason,
            targetModeEvidenceSummary: decision.evidence.map(candidateSummary),
          }
        : {}),
      ...(outcome ? { targetModeVerifiedOutcome: outcomeToJson(outcome) } : {}),
    },
  }
}

function verifiedOutcome(
  action: Action,
  result: ActionResult,
  observation: Observation,
): TargetModeVerifiedOutcome {
  return {
    actionId: action.id,
    actionKind: action.kind,
    actionStatus: result.status,
    description: stringInput(action.input, "description"),
    phase: stringInput(action.input, "targetModePhase"),
    verification: stringInput(result.metadata, "verification"),
    stateChanged: booleanInput(result.metadata, "stateChanged"),
    targetState: jsonObjectInput(result.metadata, "targetState"),
    actionReportedFailed: booleanInput(result.metadata, "actionReportedFailed"),
    hasFreshObservation: result.observation?.id === observation.id,
    observationId: observation.id,
  }
}

function observationBarrierInput(goal: UseCaseGoal, step: TargetModePlannedStep): JsonObject {
  const phase = stringInput(step.input, "targetModePhase")
  if (phase === "complete" || phase === "failed") {
    return {}
  }

  const base: JsonObject = {
    targetModeObservationBarrier: true,
    settleTimeoutMs: 1800,
    settlePollIntervalMs: 300,
    settleStableObservations: 1,
  }

  if (phase === "enter-query") {
    return {
      ...base,
      targetState: { kind: "text-visible", keyword: goal.query },
      timeoutMs: 3500,
      pollIntervalMs: 250,
    }
  }

  if (phase === "submit-query") {
    return {
      ...base,
      waitForStateChange: true,
      targetState: { kind: "search-results-loaded", keyword: goal.query },
      timeoutMs: 5000,
      pollIntervalMs: 300,
    }
  }

  if (phase === "switch-semantic-tab") {
    const tabLabel = targetTabLabel(goal, step)
    return {
      ...base,
      ...(tabLabel ? { targetState: { kind: "tab-activated", keyword: tabLabel } } : {}),
      timeoutMs: 5000,
      pollIntervalMs: 300,
    }
  }

  if (phase === "scan-results" || phase === "revisit-selected-result") {
    return {
      ...base,
      waitForStateChange: true,
      timeoutMs: 3500,
      pollIntervalMs: 300,
    }
  }

  if (phase === "confirm-candidate-detail") {
    const candidate = jsonObjectInput(step.input, "targetModeCandidate")
    const title = stringInput(candidate, "title")
    return {
      ...base,
      targetState: { kind: "detail-visible", keyword: title ?? "" },
      timeoutMs: 5000,
      pollIntervalMs: 300,
    }
  }

  if (phase === "confirm-detail-evidence" || phase === "settle-scan-results") {
    return {
      ...base,
      timeoutMs: 3000,
      pollIntervalMs: 300,
    }
  }

  return base
}

function targetTabLabel(goal: UseCaseGoal, step: TargetModePlannedStep): string | undefined {
  const description = step.description.toLowerCase()
  return (goal.navigation?.semanticTabs ?? []).find((label) =>
    description.includes(label.toLowerCase()),
  )
}

function actionIntent(goal: UseCaseGoal, step: TargetModePlannedStep): JsonObject {
  const phase = stringInput(step.input, "targetModePhase")
  const description = step.description

  if (phase === "open-app") {
    return {
      kind: "open_app",
      expect: { freshObservation: true },
    }
  }

  if (phase === "observe-initial" || phase === "observe-results") {
    return {
      kind: "observe",
      expect: { resultContext: phase === "observe-results" },
    }
  }

  if (phase === "enter-query") {
    return {
      kind: "type",
      target: { role: "search-input" },
      value: goal.query,
      expect: { queryVisible: goal.query },
    }
  }

  if (phase === "submit-query") {
    return {
      kind: "press_key",
      key: "Enter",
      expect: { resultContext: true },
    }
  }

  if (phase === "switch-semantic-tab") {
    return {
      kind: "click",
      target: {
        role: "semantic-tab",
        labels: goal.navigation?.semanticTabs ?? [],
      },
      expect: { semanticResultContext: true },
    }
  }

  if (phase === "scan-results") {
    return {
      kind: description.startsWith("drag ") ? "drag" : "scroll",
      target: { role: "result-region" },
      expect: {
        viewportChange: true,
        additionalEvidence: true,
      },
    }
  }

  if (phase === "settle-scan-results") {
    return {
      kind: "wait",
      expect: { targetEvidenceVisible: true },
    }
  }

  if (phase === "revisit-selected-result") {
    return {
      kind: "scroll",
      target: { role: "result-region" },
      expect: { selectedCandidateVisible: true },
    }
  }

  if (phase === "confirm-candidate-detail") {
    return {
      kind: "click",
      target: {
        role: "candidate",
        candidate: step.input?.targetModeCandidate ?? {},
      },
      expect: { detailEvidence: true },
    }
  }

  if (phase === "confirm-detail-evidence") {
    return {
      kind: description.startsWith("press key") ? "press_key" : "wait",
      expect: { detailEvidence: true },
    }
  }

  if (phase === "complete" || phase === "failed") {
    return {
      kind: "extract",
      fields: goal.requiredFields,
    }
  }

  return {
    kind: "act",
    description,
  }
}

function initialPhase(index: number): string {
  return index === 0 ? "open-app" : "observe-initial"
}

function candidateSummary(candidate: EntityCandidate): JsonObject {
  return {
    key: candidate.key,
    source: candidate.source,
    confidence: candidate.confidence,
    missingFields: candidate.missingFields,
    fields: candidate.fields,
    evidenceText: candidate.evidenceText,
    ...(candidate.label ? { label: candidate.label } : {}),
    ...(candidate.ranking ? { ranking: rankingToJson(candidate.ranking) } : {}),
  }
}

function outcomeToJson(outcome: TargetModeVerifiedOutcome): JsonObject {
  return {
    actionId: outcome.actionId,
    actionKind: outcome.actionKind,
    actionStatus: outcome.actionStatus,
    hasFreshObservation: outcome.hasFreshObservation,
    observationId: outcome.observationId,
    ...(outcome.description ? { description: outcome.description } : {}),
    ...(outcome.phase ? { phase: outcome.phase } : {}),
    ...(outcome.verification ? { verification: outcome.verification } : {}),
    ...(typeof outcome.stateChanged === "boolean" ? { stateChanged: outcome.stateChanged } : {}),
    ...(outcome.targetState ? { targetState: outcome.targetState } : {}),
    ...(typeof outcome.actionReportedFailed === "boolean"
      ? { actionReportedFailed: outcome.actionReportedFailed }
      : {}),
  }
}

function stringInput(input: JsonObject | undefined, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function booleanInput(input: JsonObject | undefined, key: string): boolean | undefined {
  const value = input?.[key]
  return typeof value === "boolean" ? value : undefined
}

function jsonObjectInput(input: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = input?.[key]
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined
}
