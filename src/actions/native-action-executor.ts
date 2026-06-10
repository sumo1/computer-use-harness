import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import type { Action, ActionResult, JsonObject, JsonValue, Observation } from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { extractionContractFromAction, missingRequiredFields } from "../core/extraction-contract.js"
import {
  measureActionCall,
  observeAction,
  observeAfterAction,
} from "../usecases/action-verification.js"

export async function executeNativeAction(
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

function permissionMetadata(permissions: MacPermissionStatus) {
  return {
    accessibility: permissions.accessibility,
    screenRecording: permissions.screenRecording,
    inputMonitoring: permissions.inputMonitoring,
  }
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
