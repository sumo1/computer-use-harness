import { randomUUID } from "node:crypto"
import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import { MacHelperProcessClient } from "../adapters/mac/stdio-helper-client.js"
import "../adapters/apps/index.js"
import { getAppAdapter } from "../adapters/apps/registry.js"
import { createDefaultCapabilityChain } from "../capabilities/index.js"
import type {
  Action,
  ActionResult,
  Observation,
  PolicyDecision,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { createUseCaseAction, createUseCaseTarget, appendTraceEvent } from "./action-plan.js"
import type { UseCase, UseCaseRunResult, UseCaseStepResult } from "./types.js"

export interface NativeUseCaseRunnerOptions {
  helperCommand: string
}

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
  const timestamp = new Date().toISOString()
  const trace: TraceEvent[] = []
  const steps: UseCaseStepResult[] = []
  let currentObservation: Observation | undefined

  const adapter = getAppAdapter(target.id)
  const apiKey = process.env.ANTHROPIC_API_KEY
  const capabilityChain = createDefaultCapabilityChain(apiKey)

  if (adapter?.prepareUseCase) {
    await adapter.prepareUseCase(useCase)
  }

  appendTraceEvent(trace, {
    traceId,
    kind: "run",
    timestamp,
    target,
    metadata: {
      caseId: useCase.id,
      mode: "native",
      capabilities: capabilityChain.listCapabilities(),
    },
  })

  for (const [index, description] of useCase.steps.entries()) {
    const stepIndex = index + 1
    let plannedAction = createUseCaseAction(useCase.id, stepIndex, description, target, "mac-helper")

    if (adapter?.bindActionInput) {
      plannedAction = adapter.bindActionInput(useCase, plannedAction)
    }

    let action = plannedAction

    // Use capability chain to bind element/coordinate or extract data
    if (currentObservation && (action.kind === "click" || action.kind === "type" || action.kind === "extract")) {
      const semanticHints = (adapter as any)?.semanticHints
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
            ...(capResult.coordinate ? { x: capResult.coordinate.x, y: capResult.coordinate.y } : {}),
            capabilityUsed: usedCapability,
            ...(action.kind === "extract" && capResult.metadata?.result
              ? { extractedData: JSON.stringify(capResult.metadata.result) }
              : {}),
          },
        }
      }
    }

    const policy = evaluatePolicy({ target, actionKind: action.kind })

    appendTraceEvent(trace, {
      traceId,
      kind: "policy",
      timestamp,
      target,
      action,
      policy,
    })

    const execution =
      policy.status === "blocked"
        ? { result: createPolicyBlockedResult(action, policy) }
        : await executeNativeAction(helper, action)

    let result = withPolicy(execution.result, policy)

    if (policy.status !== "blocked") {
      appendTraceEvent(trace, {
        traceId,
        kind: "action",
        timestamp,
        target,
        action,
      })
    }

    if (execution.observation) {
      currentObservation = execution.observation

      appendTraceEvent(trace, {
        traceId,
        kind: "observation",
        timestamp,
        target,
        action,
        observation: execution.observation,
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
      timestamp,
      target,
      action,
      policy,
      result,
    })

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
    status: runStatus(steps),
    mode: "native",
    traceId,
    trace,
    steps,
    success: useCase.success,
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

async function executeNativeAction(
  helper: MacHelperClient,
  action: Action,
): Promise<{ result: ActionResult; observation?: Observation }> {
  if (action.kind === "open") {
    const openResult = await helper.open({ action })
    const appState = await helper.getAppState(action.target)
    return {
      observation: appState.observation,
      result: {
        ...openResult,
        observation: appState.observation,
      },
    }
  }

  if (action.kind === "observe") {
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

  if (action.kind === "extract") {
    // Extract action is handled by capability chain
    // Just return success - the extracted data is in action.input from capability
    const extractedData = action.input?.extractedData
    return {
      result: {
        actionId: action.id,
        ok: true,
        status: "passed",
        adapter: "mac-helper",
        metadata: {
          helperMethod: "extract",
          ...(extractedData ? { extractedData } : {}),
        },
      },
    }
  }

  if (action.kind === "click") {
    return { result: await helper.click({ action }) }
  }

  if (action.kind === "type") {
    return { result: await helper.typeText({ action, text: stringInput(action, "text", "") }) }
  }

  if (action.kind === "key") {
    return { result: await helper.key({ action, key: stringInput(action, "key", "Enter") }) }
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
      adapter: "mac-helper",
    },
  }
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
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
