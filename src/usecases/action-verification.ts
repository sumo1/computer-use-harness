import type { Action, ActionResult, JsonObject, Observation } from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"

export interface MeasuredActionCall {
  value: ActionResult
  latencyMs: number
  attempts: number
}

export async function measureActionCall(
  action: Action,
  operation: () => Promise<ActionResult>,
): Promise<MeasuredActionCall> {
  const startedAt = Date.now()
  const maxAttempts = 1 + Math.min(3, positiveIntegerInput(action, "retries", 0))
  let attempts = 0
  let lastResult: ActionResult | undefined

  while (attempts < maxAttempts) {
    attempts += 1
    const result = await operation()
    lastResult = result

    if (result.ok || attempts >= maxAttempts) {
      break
    }

    await sleep(100 * attempts)
  }

  return {
    value: lastResult ?? failedAction(action, "Action was not attempted."),
    latencyMs: Date.now() - startedAt,
    attempts,
  }
}

export async function observeAction(
  helper: MacHelperClient,
  action: Action,
  previousObservation: Observation | undefined,
): Promise<{ result: ActionResult; observation?: Observation; metadata?: JsonObject }> {
  const observed = await measureObservation(helper, action)
  const verification = await verifyObservationStateChange(helper, action, previousObservation, observed.observation)
  const metadata = {
    helperMethod: "getAppState",
    observeLatencyMs: observed.latencyMs + verification.extraObserveLatencyMs,
    observeAttempts: 1 + verification.extraObserveAttempts,
    ...verification.metadata,
  }

  return {
    metadata,
    observation: verification.observation,
    result: observationResult(action, verification.observation, metadata, verification.failed),
  }
}

export async function observeAfterAction(
  helper: MacHelperClient,
  action: Action,
  call: MeasuredActionCall,
  helperMethod: string,
  previousObservation: Observation | undefined,
): Promise<{ result: ActionResult; observation?: Observation; metadata?: JsonObject }> {
  const baseMetadata = {
    helperMethod,
    actionLatencyMs: call.latencyMs,
    attempts: call.attempts,
  }

  if (!call.value.ok) {
    return {
      result: {
        ...withMetadata(call.value, baseMetadata),
        adapter: action.adapter,
      },
      metadata: baseMetadata,
    }
  }

  const observed = await measureObservation(helper, action)
  const verification = await verifyObservationStateChange(helper, action, previousObservation, observed.observation)
  const metadata = {
    ...baseMetadata,
    observeLatencyMs: observed.latencyMs + verification.extraObserveLatencyMs,
    observeAttempts: 1 + verification.extraObserveAttempts,
    verification: verification.required ? "state-change" : "post-action-observe",
    ...verification.metadata,
  }

  if (verification.failed) {
    return {
      metadata,
      observation: verification.observation,
      result: {
        ...withMetadata(call.value, metadata),
        adapter: action.adapter,
        ok: false,
        status: "failed",
        observation: verification.observation,
        error: {
          code: ActionErrorCode.ACTION_FAILED,
          message: "Timed out waiting for state change after action.",
          details: {
            timeoutMs: timeoutMs(action),
            stateChanged: false,
          },
        },
      },
    }
  }

  return {
    metadata,
    observation: verification.observation,
    result: {
      ...withMetadata(call.value, metadata),
      adapter: action.adapter,
      observation: verification.observation,
    },
  }
}

async function verifyObservationStateChange(
  helper: MacHelperClient,
  action: Action,
  previousObservation: Observation | undefined,
  firstObservation: Observation,
): Promise<{
  observation: Observation
  metadata: JsonObject
  required: boolean
  failed: boolean
  extraObserveLatencyMs: number
  extraObserveAttempts: number
}> {
  const required = booleanInput(action, "waitForStateChange", false)
  const previousFingerprint = previousObservation ? observationFingerprint(previousObservation) : undefined
  let currentObservation = firstObservation
  let currentFingerprint = observationFingerprint(currentObservation)
  let changed = previousFingerprint === undefined ? undefined : currentFingerprint !== previousFingerprint
  let extraObserveLatencyMs = 0
  let extraObserveAttempts = 0

  if (required && previousFingerprint !== undefined && !changed) {
    const deadline = Date.now() + timeoutMs(action)
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs(action))
      const observed = await measureObservation(helper, action)
      extraObserveLatencyMs += observed.latencyMs
      extraObserveAttempts += 1
      currentObservation = observed.observation
      currentFingerprint = observationFingerprint(currentObservation)
      changed = currentFingerprint !== previousFingerprint

      if (changed) {
        break
      }
    }
  }

  const metadata: JsonObject = {
    stateChangeRequired: required,
  }

  if (changed !== undefined) {
    metadata.stateChanged = changed
  }
  if (required) {
    metadata.timeoutMs = timeoutMs(action)
    metadata.pollIntervalMs = pollIntervalMs(action)
  }

  return {
    observation: currentObservation,
    metadata,
    required,
    failed: required && previousFingerprint !== undefined && changed === false,
    extraObserveLatencyMs,
    extraObserveAttempts,
  }
}

async function measureObservation(
  helper: MacHelperClient,
  action: Action,
): Promise<{ observation: Observation; latencyMs: number }> {
  const startedAt = Date.now()
  const state = await helper.getAppState(action.target)

  return {
    observation: state.observation,
    latencyMs: Date.now() - startedAt,
  }
}

function observationResult(
  action: Action,
  observation: Observation,
  metadata: JsonObject,
  failed: boolean,
): ActionResult {
  return {
    actionId: action.id,
    ok: !failed,
    status: failed ? "failed" : "passed",
    adapter: action.adapter,
    observation,
    metadata,
    ...(failed
      ? {
          error: {
            code: ActionErrorCode.ACTION_FAILED,
            message: "Timed out waiting for state change.",
            details: {
              timeoutMs: timeoutMs(action),
              stateChanged: false,
            },
          },
        }
      : {}),
  }
}

function observationFingerprint(observation: Observation): string {
  return JSON.stringify({
    focusedElementId: observation.focusedElementId,
    focusedWindow: observation.focusedWindow
      ? {
          id: observation.focusedWindow.id,
          title: observation.focusedWindow.title,
          focused: observation.focusedWindow.focused,
          bounds: observation.focusedWindow.bounds,
        }
      : undefined,
    windows: observation.windows?.map((window) => ({
      id: window.id,
      title: window.title,
      focused: window.focused,
      bounds: window.bounds,
    })),
    elements: observation.elements.map((element) => ({
      id: element.id,
      role: element.role,
      name: element.name,
      metadata: element.metadata,
    })),
    accessibilityTree: observation.accessibilityTree,
    screenshot: observation.screenshot
      ? {
          format: observation.screenshot.format,
          width: observation.screenshot.width,
          height: observation.screenshot.height,
          signature: dataSignature(observation.screenshot.data),
        }
      : undefined,
  })
}

function dataSignature(value: string): string {
  return `${value.length}:${value.slice(0, 32)}:${value.slice(-32)}`
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

function failedAction(action: Action, message: string): ActionResult {
  return {
    actionId: action.id,
    ok: false,
    status: "failed",
    adapter: action.adapter,
    error: {
      code: ActionErrorCode.ACTION_FAILED,
      message,
    },
  }
}

function timeoutMs(action: Action): number {
  return positiveNumberInput(action, "timeoutMs", 3000)
}

function pollIntervalMs(action: Action): number {
  return positiveNumberInput(action, "pollIntervalMs", 250)
}

function positiveNumberInput(action: Action, key: string, fallback: number): number {
  const value = action.input?.[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function positiveIntegerInput(action: Action, key: string, fallback: number): number {
  const value = action.input?.[key]
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback
}

function booleanInput(action: Action, key: string, fallback: boolean): boolean {
  const value = action.input?.[key]
  return typeof value === "boolean" ? value : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
