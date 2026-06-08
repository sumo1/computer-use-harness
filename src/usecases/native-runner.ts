import { randomUUID } from "node:crypto"
import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import { MacHelperProcessClient } from "../adapters/mac/stdio-helper-client.js"
import "../adapters/apps/index.js"
import { getAppAdapter } from "../adapters/apps/registry.js"
import { createDefaultCapabilityChain } from "../capabilities/index.js"
import type {
  Action,
  ActionResult,
  JsonObject,
  JsonValue,
  Observation,
  PolicyDecision,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { extractionContractFromAction, missingRequiredFields } from "../core/extraction-contract.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { appendTraceEvent, createUseCaseAction, createUseCaseTarget } from "./action-plan.js"
import { measureActionCall, observeAction, observeAfterAction } from "./action-verification.js"
import { extractionRecoveryCandidates } from "./recovery-plan.js"
import {
  type TargetModeLoopAdvance,
  type TargetModeLoopState,
  advanceTargetModeLoop,
  createTargetModeLoopState,
  targetModeLoopInitialSteps,
} from "./target-loop.js"
import type { TargetModePlannedStep } from "./target-mode.js"
import type { UseCase, UseCaseRunResult, UseCaseStepResult } from "./types.js"

export interface NativeUseCaseRunnerOptions {
  helperCommand: string
}

interface QueuedUseCaseStep {
  description: string
  adaptive?: boolean
  originalExtractDescription?: string
  element?: Action["element"]
  input?: JsonObject
}

interface AdaptiveRunState {
  extractRetryCounts: Map<string, number>
  triedTargets: Set<string>
  triedNavigationDescriptions: Set<string>
  clickRecoveryCounts: Map<string, number>
  lastRecoveryDescription?: string
}

const MAX_ADAPTIVE_EXTRACT_RETRIES = 6

export async function runNativeUseCase(
  useCase: UseCase,
  options: NativeUseCaseRunnerOptions,
): Promise<UseCaseRunResult> {
  const helper = new MacHelperProcessClient({ command: options.helperCommand })

  try {
    return await runWithHelper(useCase, helper)
  } finally {
    helper.close()
  }
}

async function runWithHelper(useCase: UseCase, helper: MacHelperClient): Promise<UseCaseRunResult> {
  const traceId = `trace_native_${randomUUID()}`
  const target = createUseCaseTarget(useCase)
  const runStartedAt = Date.now()
  const trace: TraceEvent[] = []
  const steps: UseCaseStepResult[] = []
  const pendingSteps: QueuedUseCaseStep[] = useCase.goal
    ? targetModeLoopInitialSteps(useCase.goal).map(toQueuedUseCaseStep)
    : useCase.steps.map((description) => ({ description }))
  const adaptiveState: AdaptiveRunState = {
    extractRetryCounts: new Map(),
    triedTargets: new Set(),
    triedNavigationDescriptions: new Set(),
    clickRecoveryCounts: new Map(),
  }
  const targetModeState = useCase.goal ? createTargetModeLoopState() : undefined
  let currentObservation: Observation | undefined
  let firstActionRecorded = false
  let firstStateRecorded = false
  let lastSearchQuery: string | undefined

  const adapter = getAppAdapter(target.id)
  const apiKey = process.env.ANTHROPIC_API_KEY
  const capabilityChain = createDefaultCapabilityChain(apiKey, helper)
  const permissions = await helper.permissionStatus()
  const missingPermissions = missingRequiredPermissions(permissions)

  appendTraceEvent(trace, {
    traceId,
    kind: "run",
    target,
    metadata: {
      caseId: useCase.id,
      mode: "native",
      capabilities: capabilityChain.listCapabilities(),
      permissions: permissionMetadata(permissions),
      requiredPermissions: ["accessibility", "screenRecording"],
    },
  })

  if (missingPermissions.length > 0) {
    return permissionBlockedRunResult(
      useCase,
      traceId,
      trace,
      target,
      permissions,
      missingPermissions,
    )
  }

  if (adapter?.prepareUseCase) {
    await adapter.prepareUseCase(useCase)
  }

  let executedStepIndex = 0
  while (pendingSteps.length > 0) {
    const queuedStep = pendingSteps.shift()
    if (!queuedStep) {
      break
    }

    const description = queuedStep.description
    const stepIndex = executedStepIndex + 1
    executedStepIndex += 1
    let plannedAction = createUseCaseAction(
      useCase.id,
      stepIndex,
      description,
      target,
      "mac-helper",
    )

    if (queuedStep.adaptive) {
      plannedAction = {
        ...plannedAction,
        input: {
          ...plannedAction.input,
          adaptive: true,
          ...(queuedStep.originalExtractDescription
            ? { originalExtractDescription: queuedStep.originalExtractDescription }
            : {}),
        },
      }
    }
    if (queuedStep.element) {
      plannedAction = {
        ...plannedAction,
        element: queuedStep.element,
      }
    }
    if (queuedStep.input) {
      plannedAction = {
        ...plannedAction,
        input: {
          ...plannedAction.input,
          ...queuedStep.input,
        },
      }
    }

    if (adapter?.bindActionInput) {
      plannedAction = adapter.bindActionInput(useCase, plannedAction)
    }
    plannedAction = bindRuntimeSearchState(plannedAction, lastSearchQuery)

    if (!currentObservation && requiresObservationBeforeAction(plannedAction)) {
      pendingSteps.unshift(
        {
          description: "read app state before action",
          adaptive: true,
          originalExtractDescription: queuedStep.originalExtractDescription,
        },
        queuedStep,
      )
      executedStepIndex -= 1
      continue
    }

    let action = plannedAction

    // Use capability chain to bind element/coordinate or extract data
    if (currentObservation && canBindActionWithCapabilities(action)) {
      const semanticHints = adapter?.semanticHints
      const { result: capResult, usedCapability } = await capabilityChain.execute(
        action,
        currentObservation,
        semanticHints,
      )

      if (capResult.success) {
        action = {
          ...action,
          element: capResult.element,
          input: {
            ...action.input,
            ...(capResult.coordinate
              ? { x: capResult.coordinate.x, y: capResult.coordinate.y }
              : {}),
            capabilityUsed: usedCapability,
            ...(action.kind === "extract" && capResult.metadata?.result
              ? { extractedData: JSON.stringify(capResult.metadata.result) }
              : {}),
          },
        }
      } else if (action.kind === "extract") {
        const capabilityMetadata = toJsonObject(capResult.metadata)
        action = {
          ...action,
          input: {
            ...action.input,
            capabilityUsed: usedCapability,
            capabilityFailure:
              capResult.reason ?? "Capability chain did not produce extracted data.",
            ...(capabilityMetadata ? { capabilityMetadata } : {}),
          },
        }
      }
    }

    const policy = evaluatePolicy({ target, actionKind: action.kind })

    appendTraceEvent(trace, {
      traceId,
      kind: "policy",
      target,
      action,
      policy,
    })

    const execution =
      policy.status === "blocked"
        ? { result: createPolicyBlockedResult(action, policy), metadata: undefined }
        : await executeNativeAction(helper, action, currentObservation)

    let result = annotateFirstAction(withPolicy(execution.result, policy), {
      firstActionRecorded,
      runStartedAt,
      blocked: policy.status === "blocked",
    })
    if (policy.status !== "blocked") {
      firstActionRecorded = true
    }
    lastSearchQuery = updateLastSearchQuery(action, result, lastSearchQuery)

    if (policy.status !== "blocked") {
      appendTraceEvent(trace, {
        traceId,
        kind: "action",
        target,
        action,
        metadata: execution.metadata,
      })
    }

    if (execution.observation) {
      currentObservation = execution.observation
      const observationMetadata = annotateFirstState(execution.metadata, {
        firstStateRecorded,
        runStartedAt,
      })
      firstStateRecorded = true

      appendTraceEvent(trace, {
        traceId,
        kind: "observation",
        target,
        action,
        observation: execution.observation,
        metadata: observationMetadata,
      })

      // App-specific verification
      if (adapter?.verifyAction) {
        const verificationResult = await adapter.verifyAction(action, currentObservation)
        if (verificationResult) {
          result = verificationResult
        }
      }
    }

    appendTraceEvent(trace, {
      traceId,
      kind: "result",
      target,
      action,
      policy,
      result,
    })

    rememberNavigationAttempt(action, adaptiveState)

    const hasFreshObservation = Boolean(execution.observation)
    const canUseCurrentObservationForTargetMode =
      result.status !== "failed" || hasFreshObservation || action.kind === "extract"

    if (
      useCase.goal &&
      targetModeState &&
      currentObservation &&
      canUseCurrentObservationForTargetMode
    ) {
      const targetModeFollowUp = await planTargetModeFollowUp(
        useCase.goal,
        action,
        currentObservation,
        targetModeState,
        result,
        pendingSteps.length,
      )

      if (targetModeFollowUp) {
        appendTraceEvent(trace, {
          traceId,
          kind: "decision",
          target,
          action,
          observation: currentObservation,
          result,
          metadata: targetModeDecisionMetadata(targetModeFollowUp),
        })

        if (targetModeFollowUp.step) {
          pendingSteps.unshift(toQueuedUseCaseStep(targetModeFollowUp.step))
          continue
        }
      }
    }

    if (useCase.goal) {
      steps.push({
        index: stepIndex,
        description,
        status: result.status,
        adapter: "mac-helper",
      })
      continue
    }

    if (canRetryPointClick(action, result, adaptiveState)) {
      adaptiveState.clickRecoveryCounts.set(
        description,
        (adaptiveState.clickRecoveryCounts.get(description) ?? 0) + 1,
      )
      pendingSteps.unshift(
        {
          description: "read app state before retrying click",
          adaptive: true,
          originalExtractDescription: queuedStep.originalExtractDescription,
        },
        {
          description,
          adaptive: true,
          originalExtractDescription: queuedStep.originalExtractDescription,
        },
      )
      continue
    }

    if (currentObservation && canContinueAfterTargetStateFailure(action, result)) {
      const followUp = planTargetStateFollowUp(
        action,
        description,
        currentObservation,
        adaptiveState,
        result,
      )

      if (followUp) {
        pendingSteps.unshift(...followUp)
        continue
      }
    }

    if (currentObservation && canContinueAfterExtractFailure(action, result)) {
      const originalExtractDescription = queuedStep.originalExtractDescription ?? description
      const followUp = planExtractFollowUp(
        originalExtractDescription,
        currentObservation,
        adaptiveState,
        result,
      )

      if (followUp) {
        pendingSteps.unshift(...followUp)
        continue
      }
    }

    steps.push({
      index: stepIndex,
      description,
      status: result.status,
      adapter: "mac-helper",
    })
  }

  return {
    caseId: useCase.id,
    title: useCase.title,
    status: finalRunStatus(useCase, steps, trace),
    mode: "native",
    traceId,
    trace,
    steps,
    success: useCase.success,
  }
}

function toQueuedUseCaseStep(step: TargetModePlannedStep): QueuedUseCaseStep {
  return {
    description: step.description,
    adaptive: true,
    element: step.element,
    input: step.input,
  }
}

async function planTargetModeFollowUp(
  goal: NonNullable<UseCase["goal"]>,
  action: Action,
  observation: Observation,
  state: TargetModeLoopState,
  result: ActionResult,
  pendingStepCount: number,
): Promise<TargetModeLoopAdvance | undefined> {
  if (action.kind === "extract" && action.input?.targetModePhase === "complete") {
    return undefined
  }
  if (action.kind === "extract" && action.input?.targetModePhase === "failed") {
    return undefined
  }

  const hasPendingSteps = pendingStepCount > 0
  if (hasPendingSteps && result.status !== "failed") {
    return undefined
  }

  const followUp = await advanceTargetModeLoop(goal, action, result, observation, state)
  if (!followUp.step) {
    return followUp
  }
  if (hasPendingSteps && !canPreemptPendingTargetModeStep(followUp.step)) {
    return undefined
  }

  return followUp
}

function canPreemptPendingTargetModeStep(step: TargetModePlannedStep): boolean {
  return false
}

function targetModeDecisionMetadata(followUp: TargetModeLoopAdvance): JsonObject {
  return {
    targetMode: true,
    targetModeLoop: true,
    status: followUp.decision.status,
    reason: followUp.decision.reason,
    evidence: followUp.decision.evidence.map((candidate) => ({
      key: candidate.key,
      source: candidate.source,
      confidence: candidate.confidence,
      missingFields: candidate.missingFields,
      fields: candidate.fields,
      ...(candidate.title ? { title: candidate.title } : {}),
      ...(candidate.artist ? { artist: candidate.artist } : {}),
      ...(candidate.releaseDate ? { releaseDate: candidate.releaseDate } : {}),
    })),
    ...(followUp.step
      ? {
          nextAction: {
            description: followUp.step.description,
            phase: followUp.step.input?.targetModePhase ?? null,
            intent: followUp.step.input?.targetModeIntent ?? null,
          },
        }
      : {}),
  }
}

function createPolicyBlockedResult(action: Action, policy: PolicyDecision): ActionResult {
  return {
    actionId: action.id,
    ok: false,
    status: "blocked",
    adapter: "mac-helper",
    policy,
    error: {
      code: ActionErrorCode.POLICY_BLOCKED,
      message: policy.reason,
      details: {
        ruleId: policy.ruleId ?? "unknown",
      },
    },
  }
}

function requiresObservationBeforeAction(action: Action): boolean {
  return canBindActionWithCapabilities(action) || action.kind === "scroll"
}

function canBindActionWithCapabilities(action: Action): boolean {
  if (
    action.kind === "extract" &&
    (hasPrecomputedExtraction(action) || isTerminalTargetModeExtract(action))
  ) {
    return false
  }

  return (
    action.kind === "click" ||
    action.kind === "secondary-click" ||
    action.kind === "hover" ||
    action.kind === "drag" ||
    action.kind === "type" ||
    action.kind === "key" ||
    action.kind === "extract"
  )
}

function hasPrecomputedExtraction(action: Action): boolean {
  return typeof action.input?.extractedData === "string" && action.input.extractedData.trim() !== ""
}

function isTerminalTargetModeExtract(action: Action): boolean {
  return action.input?.targetModePhase === "failed" || action.input?.targetModeTerminal === true
}

function finalRunStatus(
  useCase: UseCase,
  steps: UseCaseStepResult[],
  trace: TraceEvent[],
): UseCaseRunResult["status"] {
  const status = runStatus(steps)
  if (!useCase.goal) {
    return status
  }

  if (status === "blocked" || status === "skipped") {
    return status
  }

  return hasTargetModeEndToEndCompletion(useCase.goal, trace) ? "passed" : "failed"
}

function hasTargetModeEndToEndCompletion(
  goal: NonNullable<UseCase["goal"]>,
  trace: TraceEvent[],
): boolean {
  return trace.some((event) => {
    const action = event.action
    const result = event.result
    if (
      event.kind !== "result" ||
      action?.kind !== "extract" ||
      action.input?.targetModePhase !== "complete" ||
      result?.status !== "passed"
    ) {
      return false
    }

    const payload = parseExtractionPayload(result.metadata?.extractedData)
    if (
      !payload ||
      missingRequiredFields(payload, { requiredFields: goal.requiredFields }).length > 0
    ) {
      return false
    }

    const confirmationSatisfied =
      goal.confirmation === "detail" ? hasDetailSourceEvidence(payload) : true

    return confirmationSatisfied && hasRequiredCoverageEvidence(goal, payload)
  })
}

function parseExtractionPayload(value: unknown): JsonObject | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return isJsonObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function hasDetailSourceEvidence(payload: JsonObject): boolean {
  const sourceEvidence = payload.sourceEvidence
  return typeof sourceEvidence === "string" && sourceEvidence.includes("source=detail")
}

function hasRequiredCoverageEvidence(
  goal: NonNullable<UseCase["goal"]>,
  payload: JsonObject,
): boolean {
  if (!goal.orderBy || goal.coverage?.strategy !== "scroll-until-stable") {
    return true
  }

  const coverage = payload.coverageEvidence
  if (!isJsonObject(coverage)) {
    return false
  }

  return (
    coverage.strategy === "scroll-until-stable" &&
    coverage.status === "satisfied" &&
    isSatisfiedCoverageStopReason(coverage.stopReason) &&
    typeof coverage.observedScanAttempts === "number" &&
    coverage.observedScanAttempts > 0
  )
}

function isSatisfiedCoverageStopReason(value: JsonValue | undefined): boolean {
  return value === "stable-after-change" || value === "end-of-list"
}

function canContinueAfterExtractFailure(action: Action, result: ActionResult): boolean {
  if (action.kind !== "extract" || result.status !== "failed") {
    return false
  }

  const message = result.error?.message.toLowerCase() ?? ""
  return (
    message.includes("no_album_info_found") ||
    message.includes("did not return") ||
    message.includes("did not produce") ||
    message.includes("missing")
  )
}

function canContinueAfterTargetStateFailure(action: Action, result: ActionResult): boolean {
  if ((action.kind !== "observe" && action.kind !== "click") || result.status !== "failed") {
    return false
  }

  const targetState = failedTargetState(result)
  if (
    targetState?.kind === "search-results-loaded" &&
    typeof targetState.keyword === "string" &&
    targetState.keyword.trim() === ""
  ) {
    return false
  }

  const message = result.error?.message.toLowerCase() ?? ""
  return message.includes("target state was not reached")
}

function failedTargetState(result: ActionResult): JsonObject | undefined {
  const targetState = result.metadata?.targetState
  return isJsonObject(targetState) ? targetState : undefined
}

function canRetryPointClick(
  action: Action,
  result: ActionResult,
  adaptiveState: AdaptiveRunState,
): boolean {
  if (action.kind !== "click" || result.status !== "failed") {
    return false
  }

  const description = stringInput(action, "description", "")
  const retries = adaptiveState.clickRecoveryCounts.get(description) ?? 0
  if (retries >= 1) {
    return false
  }

  const message = result.error?.message.toLowerCase() ?? ""
  return message.includes("front layer-zero window") || message.includes("requires action.element")
}

function planExtractFollowUp(
  originalExtractDescription: string,
  observation: Observation,
  adaptiveState: AdaptiveRunState,
  result: ActionResult,
): QueuedUseCaseStep[] | undefined {
  const retries = adaptiveState.extractRetryCounts.get(originalExtractDescription) ?? 0
  if (retries >= MAX_ADAPTIVE_EXTRACT_RETRIES) {
    return undefined
  }

  if (adaptiveState.lastRecoveryDescription?.startsWith("click item named ")) {
    const key = `confirm-selection:${adaptiveState.lastRecoveryDescription}`
    if (!adaptiveState.triedTargets.has(key)) {
      adaptiveState.extractRetryCounts.set(originalExtractDescription, retries + 1)
      adaptiveState.triedTargets.add(key)
      adaptiveState.lastRecoveryDescription = "press key Enter"

      return extractRetrySteps("press key Enter", originalExtractDescription)
    }
  }

  const candidate = extractionRecoveryCandidates(
    originalExtractDescription,
    observation,
    failureText(result),
  ).find(
    (entry) =>
      !adaptiveState.triedTargets.has(entry.key) &&
      !adaptiveState.triedNavigationDescriptions.has(normalizeDescription(entry.description)),
  )
  if (!candidate) {
    return undefined
  }

  adaptiveState.extractRetryCounts.set(originalExtractDescription, retries + 1)
  adaptiveState.triedTargets.add(candidate.key)
  adaptiveState.lastRecoveryDescription = candidate.description

  return extractRetrySteps(candidate.description, originalExtractDescription)
}

function planTargetStateFollowUp(
  action: Action,
  failedStateDescription: string,
  observation: Observation,
  adaptiveState: AdaptiveRunState,
  result: ActionResult,
): QueuedUseCaseStep[] | undefined {
  const retries = adaptiveState.extractRetryCounts.get(failedStateDescription) ?? 0
  if (retries >= MAX_ADAPTIVE_EXTRACT_RETRIES) {
    return undefined
  }

  const candidate = extractionRecoveryCandidates(
    failedStateDescription,
    observation,
    failureText(result),
  ).find(
    (entry) =>
      !adaptiveState.triedTargets.has(entry.key) &&
      !adaptiveState.triedNavigationDescriptions.has(normalizeDescription(entry.description)),
  )
  if (!candidate) {
    return undefined
  }

  adaptiveState.extractRetryCounts.set(failedStateDescription, retries + 1)
  adaptiveState.triedTargets.add(candidate.key)
  adaptiveState.lastRecoveryDescription = candidate.description

  const navigationSteps: QueuedUseCaseStep[] = [
    {
      description: candidate.description,
      adaptive: true,
    },
    {
      description: "read app state after adaptive navigation",
      adaptive: true,
    },
  ]

  if (action.kind === "click") {
    return navigationSteps
  }

  return [
    ...navigationSteps,
    {
      description: failedStateDescription,
      adaptive: true,
    },
  ]
}

function rememberNavigationAttempt(action: Action, adaptiveState: AdaptiveRunState): void {
  const description = stringInput(action, "description", "")
  if (!isNavigationAttempt(action, description)) {
    return
  }

  adaptiveState.triedNavigationDescriptions.add(normalizeDescription(description))
}

function isNavigationAttempt(action: Action, description: string): boolean {
  const normalized = normalizeDescription(description)
  if (action.kind === "scroll") {
    return true
  }

  if (action.kind === "key") {
    const key = stringInput(action, "key", "")
    return /^(enter|pagedown|pageup|arrowdown|arrowup|arrowleft|arrowright)$/i.test(key)
  }

  if (action.kind !== "click") {
    return false
  }

  return (
    normalized.includes("click tab named") ||
    normalized.includes("click item named") ||
    normalized.includes("click result named") ||
    normalized.includes("click link named") ||
    normalized.includes("click button named")
  )
}

function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ")
}

function bindRuntimeSearchState(action: Action, lastSearchQuery: string | undefined): Action {
  const state = action.input?.targetState
  if (!isJsonObject(state) || state.kind !== "search-results-loaded") {
    return action
  }

  if (!lastSearchQuery) {
    return action
  }

  return {
    ...action,
    input: {
      ...action.input,
      targetState: {
        ...state,
        keyword: lastSearchQuery,
      },
    },
  }
}

function updateLastSearchQuery(
  action: Action,
  result: ActionResult,
  previous: string | undefined,
): string | undefined {
  if (action.kind !== "type") {
    return previous
  }

  const description = normalizeDescription(stringInput(action, "description", ""))
  if (!description.includes("search")) {
    return previous
  }

  const text = stringInput(action, "text", "")
  return text || previous
}

function failureText(result: ActionResult): string {
  return [
    result.error?.message,
    typeof result.metadata?.extractedData === "string" ? result.metadata.extractedData : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
}

function extractRetrySteps(
  navigationDescription: string,
  originalExtractDescription: string,
): QueuedUseCaseStep[] {
  return [
    {
      description: navigationDescription,
      adaptive: true,
      originalExtractDescription,
    },
    {
      description: "read app state after adaptive navigation",
      adaptive: true,
      originalExtractDescription,
    },
    {
      description: originalExtractDescription,
      adaptive: true,
      originalExtractDescription,
    },
  ]
}

function permissionBlockedRunResult(
  useCase: UseCase,
  traceId: string,
  trace: TraceEvent[],
  target: Action["target"],
  permissions: MacPermissionStatus,
  missingPermissions: string[],
): UseCaseRunResult {
  const action: Action = {
    id: `${useCase.id}:preflight:permissions`,
    kind: "policy-check",
    target,
    adapter: "mac-helper",
    input: {
      requiredPermissions: missingPermissions,
    },
  }
  const result: ActionResult = {
    actionId: action.id,
    ok: false,
    status: "blocked",
    adapter: "mac-helper",
    error: {
      code: ActionErrorCode.PERMISSION_REQUIRED,
      message: `Missing required macOS permissions: ${missingPermissions.join(", ")}.`,
      details: {
        permissions: permissionMetadata(permissions),
        missingPermissions,
      },
    },
    metadata: {
      helperMethod: "permissionStatus",
      permissions: permissionMetadata(permissions),
      missingPermissions,
    },
  }

  appendTraceEvent(trace, {
    traceId,
    kind: "result",
    target,
    action,
    result,
    metadata: result.metadata,
  })

  return {
    caseId: useCase.id,
    title: useCase.title,
    status: "blocked",
    mode: "native",
    traceId,
    trace,
    steps: [
      {
        index: 0,
        description: "Preflight required macOS permissions",
        status: "blocked",
        adapter: "mac-helper",
      },
    ],
    success: useCase.success,
  }
}

async function executeNativeAction(
  helper: MacHelperClient,
  action: Action,
  previousObservation?: Observation,
): Promise<{ result: ActionResult; observation?: Observation; metadata?: JsonObject }> {
  if (action.kind === "open") {
    const call = await measureActionCall(action, () => helper.open({ action }))
    return observeAfterAction(helper, action, call, "open", previousObservation)
  }

  if (action.kind === "observe") {
    return observeAction(helper, action, previousObservation)
  }

  if (action.kind === "extract") {
    // Extract action is handled by capability chain
    const extractedData = action.input?.extractedData
    const failure = extractFailure(action, extractedData)

    return {
      result: {
        actionId: action.id,
        ok: !failure,
        status: failure ? "failed" : "passed",
        adapter: "mac-helper",
        metadata: {
          helperMethod: "extract",
          extractionContract: {
            requiredFields: extractionContractFromAction(action).requiredFields,
          },
          ...(typeof action.input?.capabilityFailure === "string"
            ? { capabilityFailure: action.input.capabilityFailure }
            : {}),
          ...(action.input?.capabilityMetadata
            ? { capabilityMetadata: action.input.capabilityMetadata }
            : {}),
          ...(extractedData ? { extractedData } : {}),
        },
        ...(failure
          ? {
              error: {
                code: ActionErrorCode.ACTION_FAILED,
                message: failure,
              },
            }
          : {}),
      },
    }
  }

  if (action.kind === "click") {
    const call = await measureActionCall(action, () => helper.click({ action }))
    return observeAfterAction(helper, action, call, "click", previousObservation)
  }

  if (action.kind === "secondary-click") {
    const call = await measureActionCall(action, () => helper.secondaryClick({ action }))
    return observeAfterAction(helper, action, call, "secondary-click", previousObservation)
  }

  if (action.kind === "hover") {
    const call = await measureActionCall(action, () => helper.hover({ action }))
    return observeAfterAction(helper, action, call, "hover", previousObservation)
  }

  if (action.kind === "drag") {
    const call = await measureActionCall(action, () => helper.drag({ action }))
    return observeAfterAction(helper, action, call, "drag", previousObservation)
  }

  if (action.kind === "type") {
    const call = await measureActionCall(action, () =>
      helper.typeText({ action, text: stringInput(action, "text", "") }),
    )
    return observeAfterAction(helper, action, call, "type", previousObservation)
  }

  if (action.kind === "key") {
    const call = await measureActionCall(action, () =>
      helper.key({ action, key: stringInput(action, "key", "Enter") }),
    )
    return observeAfterAction(helper, action, call, "key", previousObservation)
  }

  if (action.kind === "scroll") {
    const call = await measureActionCall(action, () =>
      helper.scroll({
        action,
        direction: scrollDirectionInput(action),
        amount: numberInput(action, "amount", 1),
      }),
    )
    return observeAfterAction(helper, action, call, "scroll", previousObservation)
  }

  if (action.kind === "policy-check") {
    const call = await measureAsync(() => helper.permissionStatus())
    const permissions = call.value
    const metadata = {
      helperMethod: "permissionStatus",
      actionLatencyMs: call.latencyMs,
      permissions: permissionMetadata(permissions),
    }

    return {
      metadata,
      result: {
        actionId: action.id,
        ok: true,
        status: "passed",
        adapter: "mac-helper",
        metadata,
      },
    }
  }

  return {
    result: {
      actionId: action.id,
      ok: true,
      status: "passed",
      adapter: "mac-helper",
    },
  }
}

async function measureAsync<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const startedAt = Date.now()
  const value = await operation()

  return {
    value,
    latencyMs: Date.now() - startedAt,
  }
}

function annotateFirstAction(
  result: ActionResult,
  options: { firstActionRecorded: boolean; runStartedAt: number; blocked: boolean },
): ActionResult {
  if (options.firstActionRecorded || options.blocked) {
    return result
  }

  return withMetadata(result, {
    timeToFirstActionMs: Date.now() - options.runStartedAt,
  })
}

function annotateFirstState(
  metadata: JsonObject | undefined,
  options: { firstStateRecorded: boolean; runStartedAt: number },
): JsonObject | undefined {
  if (options.firstStateRecorded) {
    return metadata
  }

  return mergeMetadata(metadata, {
    timeToFirstAppStateMs: Date.now() - options.runStartedAt,
  })
}

function withMetadata(result: ActionResult, metadata: JsonObject): ActionResult {
  return {
    ...result,
    metadata: mergeMetadata(result.metadata, metadata),
  }
}

function mergeMetadata(existing: JsonObject | undefined, next: JsonObject): JsonObject {
  return {
    ...(existing ?? {}),
    ...next,
  }
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function scrollDirectionInput(action: Action): "up" | "down" | "left" | "right" {
  const value = stringInput(action, "direction", "down")
  return value === "up" || value === "down" || value === "left" || value === "right"
    ? value
    : "down"
}

function numberInput(action: Action, key: string, fallback: number): number {
  const value = action.input?.[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function extractFailure(action: Action, extractedData: unknown): string | undefined {
  if (typeof extractedData !== "string" || extractedData.trim() === "") {
    const capabilityFailure =
      typeof action.input?.capabilityFailure === "string"
        ? action.input.capabilityFailure
        : undefined
    return capabilityFailure ?? "Extract action did not produce structured data."
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractedData)
  } catch {
    return "Extract action returned invalid JSON."
  }

  if (!isJsonObject(parsed)) {
    return "Extract action returned a non-object payload."
  }

  const status = typeof parsed.status === "string" ? parsed.status.toLowerCase() : undefined
  if (
    status &&
    (status.includes("no_") || status.includes("not_found") || status.includes("failed"))
  ) {
    return `Extract action failed semantically: ${parsed.status}.`
  }

  const missing = missingRequiredFields(parsed, extractionContractFromAction(action))
  if (missing.length > 0) {
    return `Extract action did not return required fields: ${missing.join(", ")}.`
  }

  return undefined
}

function toJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true
  }

  const valueType = typeof value
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  return isJsonObject(value)
}

function withPolicy(result: ActionResult, policy: PolicyDecision): ActionResult {
  return {
    ...result,
    policy,
  }
}

function permissionMetadata(permissions: MacPermissionStatus) {
  return {
    accessibility: permissions.accessibility,
    screenRecording: permissions.screenRecording,
    inputMonitoring: permissions.inputMonitoring,
  }
}

function missingRequiredPermissions(permissions: MacPermissionStatus): string[] {
  return [
    permissions.accessibility === "granted" ? undefined : "accessibility",
    permissions.screenRecording === "granted" ? undefined : "screenRecording",
  ].filter((permission): permission is string => permission !== undefined)
}

function runStatus(steps: UseCaseStepResult[]): UseCaseRunResult["status"] {
  if (steps.some((step) => step.status === "blocked")) {
    return "blocked"
  }

  if (steps.some((step) => step.status === "failed")) {
    return "failed"
  }

  if (steps.some((step) => step.status === "skipped")) {
    return "skipped"
  }

  return "passed"
}
