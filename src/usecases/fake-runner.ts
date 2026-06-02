import { randomUUID } from "node:crypto"
import { createFakeMacHelperClient } from "../adapters/mac/fake-helper-client.js"
import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import type {
  Action,
  ActionResult,
  Observation,
  PolicyDecision,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { appendTraceEvent, createUseCaseAction, createUseCaseTarget } from "./action-plan.js"
import type { UseCase, UseCaseRunResult } from "./types.js"

export async function runFakeUseCase(useCase: UseCase): Promise<UseCaseRunResult> {
  const traceId = `trace_fake_${randomUUID()}`
  const target = createUseCaseTarget(useCase)
  const helper = createFakeMacHelperClient()
  const timestamp = new Date().toISOString()
  const trace: TraceEvent[] = []

  appendTraceEvent(trace, {
    traceId,
    kind: "run",
    timestamp,
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

    appendTraceEvent(trace, {
      traceId,
      kind: "policy",
      timestamp,
      target,
      action,
      policy,
    })

    if (policy.status === "blocked") {
      appendTraceEvent(trace, {
        traceId,
        kind: "result",
        timestamp,
        target,
        action,
        policy,
        result: createFakeActionResult(action, policy),
      })
    } else {
      const execution = await executeFakeAction(helper, action)
      const result = withPolicy(execution.result, policy)

      appendTraceEvent(trace, {
        traceId,
        kind: "action",
        timestamp,
        target,
        action,
      })

      if (execution.observation) {
        appendTraceEvent(trace, {
          traceId,
          kind: "observation",
          timestamp,
          target,
          action,
          observation: execution.observation,
        })
      }

      appendTraceEvent(trace, {
        traceId,
        kind: "result",
        timestamp,
        target,
        action,
        policy,
        result,
      })
    }

    steps.push({
      index: stepIndex,
      description,
      status: "passed" as const,
      adapter: "fake" as const,
    })
  }

  return {
    caseId: useCase.id,
    title: useCase.title,
    status: "passed",
    mode: "fake",
    traceId,
    trace,
    steps,
    success: useCase.success,
  }
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
): Promise<{ result: ActionResult; observation?: Observation }> {
  if (action.kind === "observe" || action.kind === "open") {
    const appState = await helper.getAppState(action.target)
    return {
      observation: appState.observation,
      result: {
        actionId: action.id,
        ok: true,
        status: "passed",
        adapter: "mac-helper",
        observation: appState.observation,
        metadata: {
          helperMethod: "getAppState",
        },
      },
    }
  }

  if (action.kind === "click") {
    return { result: await helper.click({ action }) }
  }

  if (action.kind === "type") {
    return { result: await helper.typeText({ action, text: "fake text" }) }
  }

  if (action.kind === "key") {
    return { result: await helper.key({ action, key: "Enter" }) }
  }

  if (action.kind === "scroll") {
    return { result: await helper.scroll({ action, direction: "down", amount: 1 }) }
  }

  if (action.kind === "policy-check") {
    const permissions = await helper.permissionStatus()
    return {
      result: {
        actionId: action.id,
        ok: true,
        status: "passed",
        adapter: "mac-helper",
        metadata: {
          helperMethod: "permissionStatus",
          permissions: permissionMetadata(permissions),
        },
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
