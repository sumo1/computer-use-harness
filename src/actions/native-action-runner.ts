import { randomUUID } from "node:crypto"
import { createFakeMacHelperClient } from "../adapters/mac/fake-helper-client.js"
import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import { MacHelperProcessClient } from "../adapters/mac/stdio-helper-client.js"
import { createDefaultCapabilityChain } from "../capabilities/index.js"
import type {
  Action,
  ActionResult,
  JsonObject,
  JsonValue,
  Observation,
  Target,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { appendTraceEvent } from "../usecases/action-plan.js"
import { executeNativeAction } from "./native-action-executor.js"

export interface NativeActionRunnerOptions {
  target: Target
  action: Action
  helperCommand?: string
  fake?: boolean
  helper?: MacHelperClient
}

export interface NativeActionRunResult {
  mode: "native-action"
  status: ActionResult["status"]
  traceId: string
  trace: TraceEvent[]
  target: Target
  action: Action
  result: ActionResult
  observation?: Observation
}

export async function runNativeAction(
  options: NativeActionRunnerOptions,
): Promise<NativeActionRunResult> {
  const { helper, close } = createHelper(options)

  try {
    return await runWithHelper(options, helper)
  } finally {
    close?.()
  }
}

async function runWithHelper(
  options: NativeActionRunnerOptions,
  helper: MacHelperClient,
): Promise<NativeActionRunResult> {
  const traceId = `trace_action_${randomUUID()}`
  const runStartedAt = Date.now()
  const trace: TraceEvent[] = []
  const capabilityChain = createDefaultCapabilityChain(process.env.ANTHROPIC_API_KEY, helper)
  const permissions = await helper.permissionStatus()
  const requiredPermissions = requiredPermissionsForAction(options.action)
  const missingPermissions = missingRequiredPermissions(permissions, requiredPermissions)

  appendTraceEvent(trace, {
    traceId,
    kind: "run",
    target: options.target,
    action: options.action,
    metadata: {
      mode: "native-action",
      capabilities: capabilityChain.listCapabilities(),
      permissions: permissionMetadata(permissions),
      requiredPermissions,
    },
  })

  if (missingPermissions.length > 0 && options.action.kind !== "policy-check") {
    const result = permissionBlockedActionResult(options.action, permissions, missingPermissions)
    appendTraceEvent(trace, {
      traceId,
      kind: "result",
      target: options.target,
      action: options.action,
      result,
      metadata: result.metadata,
    })

    return {
      mode: "native-action",
      status: result.status,
      traceId,
      trace,
      target: options.target,
      action: options.action,
      result,
    }
  }

  let currentObservation: Observation | undefined
  if (requiresObservationBeforeAction(options.action)) {
    const preflight = await observeBeforeAction(helper, options.action, traceId, trace)
    currentObservation = preflight.observation
  }

  let action = options.action
  if (currentObservation && canBindActionWithCapabilities(action)) {
    const { result: capResult, usedCapability } = await capabilityChain.execute(
      action,
      currentObservation,
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
    } else {
      const capabilityMetadata = toJsonObject(capResult.metadata)
      action = {
        ...action,
        input: {
          ...action.input,
          capabilityUsed: usedCapability,
          capabilityFailure:
            capResult.reason ?? "Capability chain did not resolve the requested action target.",
          ...(capabilityMetadata ? { capabilityMetadata } : {}),
        },
      }
    }
  }

  const policy = evaluatePolicy({ target: options.target, actionKind: action.kind })
  appendTraceEvent(trace, {
    traceId,
    kind: "policy",
    target: options.target,
    action,
    policy,
  })

  const execution =
    policy.status === "blocked"
      ? { result: createPolicyBlockedResult(action, policy), metadata: undefined }
      : await executeNativeAction(helper, action, currentObservation)

  const result =
    policy.status === "blocked"
      ? execution.result
      : withMetadata(withPolicy(execution.result, policy), {
          timeToFirstActionMs: Date.now() - runStartedAt,
        })

  if (policy.status !== "blocked") {
    appendTraceEvent(trace, {
      traceId,
      kind: "action",
      target: options.target,
      action,
      metadata: execution.metadata,
    })
  }

  if (execution.observation) {
    currentObservation = execution.observation
    appendTraceEvent(trace, {
      traceId,
      kind: "observation",
      target: options.target,
      action,
      observation: execution.observation,
      metadata: execution.metadata,
    })
  }

  appendTraceEvent(trace, {
    traceId,
    kind: "result",
    target: options.target,
    action,
    policy,
    result,
    metadata: result.metadata,
  })

  return {
    mode: "native-action",
    status: result.status,
    traceId,
    trace,
    target: options.target,
    action,
    result,
    ...(currentObservation ? { observation: currentObservation } : {}),
  }
}

function createHelper(options: NativeActionRunnerOptions): {
  helper: MacHelperClient
  close?: () => void
} {
  if (options.helper) {
    return { helper: options.helper }
  }

  if (options.fake) {
    return { helper: createFakeMacHelperClient() }
  }

  if (!options.helperCommand) {
    throw new Error("Native action requires --fake or --mac-helper <path>.")
  }

  const helper = new MacHelperProcessClient({ command: options.helperCommand })
  return {
    helper,
    close: () => helper.close(),
  }
}

async function observeBeforeAction(
  helper: MacHelperClient,
  action: Action,
  traceId: string,
  trace: TraceEvent[],
): Promise<{ observation?: Observation }> {
  const observeAction: Action = {
    ...action,
    id: `${action.id}:observe-before`,
    kind: "observe",
    input: {
      description: `read app state before ${action.kind}`,
      ...(typeof action.input?.observationMode === "string"
        ? { observationMode: action.input.observationMode }
        : {}),
      ...(typeof action.input?.disableVisualFallback === "boolean"
        ? { disableVisualFallback: action.input.disableVisualFallback }
        : {}),
    },
  }
  const policy = evaluatePolicy({ target: observeAction.target, actionKind: observeAction.kind })
  const execution =
    policy.status === "blocked"
      ? { result: createPolicyBlockedResult(observeAction, policy), metadata: undefined }
      : await executeNativeAction(helper, observeAction)

  appendTraceEvent(trace, {
    traceId,
    kind: "policy",
    target: observeAction.target,
    action: observeAction,
    policy,
  })

  if (policy.status !== "blocked") {
    appendTraceEvent(trace, {
      traceId,
      kind: "action",
      target: observeAction.target,
      action: observeAction,
      metadata: execution.metadata,
    })
  }

  if (execution.observation) {
    appendTraceEvent(trace, {
      traceId,
      kind: "observation",
      target: observeAction.target,
      action: observeAction,
      observation: execution.observation,
      metadata: execution.metadata,
    })
  }

  appendTraceEvent(trace, {
    traceId,
    kind: "result",
    target: observeAction.target,
    action: observeAction,
    policy,
    result: withPolicy(execution.result, policy),
    metadata: execution.result.metadata,
  })

  return {
    ...(execution.observation ? { observation: execution.observation } : {}),
  }
}

function requiresObservationBeforeAction(action: Action): boolean {
  if (action.kind === "observe" || action.kind === "open" || action.kind === "policy-check") {
    return false
  }

  return canBindActionWithCapabilities(action) || action.kind === "scroll"
}

function canBindActionWithCapabilities(action: Action): boolean {
  if (action.kind === "extract" && typeof action.input?.extractedData === "string") {
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

function createPolicyBlockedResult(
  action: Action,
  policy: ReturnType<typeof evaluatePolicy>,
): ActionResult {
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

function permissionBlockedActionResult(
  action: Action,
  permissions: MacPermissionStatus,
  missingPermissions: string[],
): ActionResult {
  return {
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
}

function withPolicy(result: ActionResult, policy: ReturnType<typeof evaluatePolicy>): ActionResult {
  return {
    ...result,
    policy,
  }
}

function withMetadata(result: ActionResult, metadata: JsonObject): ActionResult {
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      ...metadata,
    },
  }
}

function permissionMetadata(permissions: MacPermissionStatus) {
  return {
    accessibility: permissions.accessibility,
    screenRecording: permissions.screenRecording,
    inputMonitoring: permissions.inputMonitoring,
  }
}

function requiredPermissionsForAction(action: Action): Array<keyof MacPermissionStatus> {
  if (action.kind === "policy-check") {
    return []
  }

  const observationMode =
    typeof action.input?.observationMode === "string"
      ? action.input.observationMode.toLowerCase()
      : "ax-first"

  return observationMode === "full" || observationMode === "visual-text"
    ? ["accessibility", "screenRecording"]
    : ["accessibility"]
}

function missingRequiredPermissions(
  permissions: MacPermissionStatus,
  requiredPermissions: Array<keyof MacPermissionStatus>,
): string[] {
  return requiredPermissions.filter((permission) => permissions[permission] !== "granted")
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
