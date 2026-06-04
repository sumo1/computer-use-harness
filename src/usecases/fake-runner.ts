import { randomUUID } from "node:crypto"
import { createFakeMacHelperClient } from "../adapters/mac/fake-helper-client.js"
import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import type {
  Action,
  ActionResult,
  JsonObject,
  Observation,
  PolicyDecision,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { appendTraceEvent, createUseCaseAction, createUseCaseTarget } from "./action-plan.js"
import { measureActionCall, observeAction, observeAfterAction } from "./action-verification.js"
import type { UseCase, UseCaseRunResult } from "./types.js"

export async function runFakeUseCase(useCase: UseCase): Promise<UseCaseRunResult> {
  const traceId = `trace_fake_${randomUUID()}`
  const target = createUseCaseTarget(useCase)
  const helper = createFakeMacHelperClient()
  const runStartedAt = Date.now()
  const trace: TraceEvent[] = []
  let currentObservation: Observation | undefined
  let firstActionRecorded = false
  let firstStateRecorded = false

  appendTraceEvent(trace, {
    traceId,
    kind: "run",
    target,
    metadata: {
      caseId: useCase.id,
      mode: "fake",
    },
  })

  const steps = []
  for (const [index, description] of useCase.steps.entries()) {
    const stepIndex = index + 1
    const action = createUseCaseAction(useCase.id, stepIndex, description, target, "fake")
    const policy = evaluatePolicy({ target, actionKind: action.kind })
    let stepStatus: ActionResult["status"]

    appendTraceEvent(trace, {
      traceId,
      kind: "policy",
      target,
      action,
      policy,
    })

    if (policy.status === "blocked") {
      const result = createFakeActionResult(action, policy)
      stepStatus = result.status

      appendTraceEvent(trace, {
        traceId,
        kind: "result",
        target,
        action,
        policy,
        result,
      })
    } else {
      const execution = await executeFakeAction(helper, action, currentObservation)
      const result = annotateFirstAction(withPolicy(execution.result, policy), {
        firstActionRecorded,
        runStartedAt,
      })
      stepStatus = result.status
      firstActionRecorded = true

      appendTraceEvent(trace, {
        traceId,
        kind: "action",
        target,
        action,
        metadata: execution.metadata,
      })

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
      }

      appendTraceEvent(trace, {
        traceId,
        kind: "result",
        target,
        action,
        policy,
        result,
      })
    }

    steps.push({
      index: stepIndex,
      description,
      status: stepStatus,
      adapter: "fake" as const,
    })
  }

  return {
    caseId: useCase.id,
    title: useCase.title,
    status: runStatus(steps),
    mode: "fake",
    traceId,
    trace,
    steps,
    success: useCase.success,
  }
}

function runStatus(steps: Array<{ status: ActionResult["status"] }>): UseCaseRunResult["status"] {
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

function createFakeActionResult(
  action: Action,
  policy: PolicyDecision,
  observation?: Observation,
): ActionResult {
  if (policy.status === "blocked") {
    return {
      actionId: action.id,
      ok: false,
      status: "blocked",
      adapter: "fake",
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

  return {
    actionId: action.id,
    ok: true,
    status: "passed",
    adapter: "fake",
    policy,
    observation,
  }
}

async function executeFakeAction(
  helper: MacHelperClient,
  action: Action,
  previousObservation?: Observation,
): Promise<{ result: ActionResult; observation?: Observation; metadata?: JsonObject }> {
  if (action.kind === "observe" || action.kind === "open") {
    return observeAction(helper, action, previousObservation)
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
    const call = await measureActionCall(action, () => helper.typeText({ action, text: "fake text" }))
    return observeAfterAction(helper, action, call, "type", previousObservation)
  }

  if (action.kind === "key") {
    const call = await measureActionCall(action, () => helper.key({ action, key: "Enter" }))
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
        adapter: action.adapter,
        metadata,
      },
    }
  }

  return {
    result: {
      actionId: action.id,
      ok: true,
      status: "passed",
      adapter: "fake",
    },
  }
}

async function measureAsync<T>(operation: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const startedAt = Date.now()
  const value = await operation()

  return {
    value,
    latencyMs: Date.now() - startedAt,
  }
}

function annotateFirstAction(
  result: ActionResult,
  options: { firstActionRecorded: boolean; runStartedAt: number },
): ActionResult {
  if (options.firstActionRecorded) {
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

function withPolicy(result: ActionResult, policy: PolicyDecision): ActionResult {
  return {
    ...result,
    policy,
  }
}

function scrollDirectionInput(action: Action): "up" | "down" | "left" | "right" {
  const value = action.input?.direction
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : "down"
}

function numberInput(action: Action, key: string, fallback: number): number {
  const value = action.input?.[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function permissionMetadata(permissions: MacPermissionStatus) {
  return {
    accessibility: permissions.accessibility,
    screenRecording: permissions.screenRecording,
    inputMonitoring: permissions.inputMonitoring,
  }
}
