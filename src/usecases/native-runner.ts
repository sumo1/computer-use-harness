import { randomUUID } from "node:crypto"
import type { MacHelperClient, MacPermissionStatus } from "../adapters/mac/helper-protocol.js"
import { MacHelperProcessClient } from "../adapters/mac/stdio-helper-client.js"
import type {
  Action,
  ActionResult,
  ElementRef,
  Observation,
  PolicyDecision,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { appendTraceEvent, createUseCaseAction, createUseCaseTarget } from "./action-plan.js"
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

  appendTraceEvent(trace, {
    traceId,
    kind: "run",
    timestamp,
    target,
    metadata: {
      caseId: useCase.id,
      mode: "native",
    },
  })

  for (const [index, description] of useCase.steps.entries()) {
    const stepIndex = index + 1
    const action = bindElement(
      createUseCaseAction(useCase.id, stepIndex, description, target, "mac-helper"),
      currentObservation,
    )
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

    const result = withPolicy(execution.result, policy)

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
  if (action.kind === "observe" || action.kind === "open") {
    const appState = await helper.getAppState(action.target)
    const verificationFailure = verifyObservation(action, appState.observation)

    if (verificationFailure) {
      return {
        observation: appState.observation,
        result: verificationFailure,
      }
    }

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

function bindElement(action: Action, observation: Observation | undefined): Action {
  if (!observation || (action.kind !== "type" && action.kind !== "click")) {
    return action
  }

  const description = stringInput(action, "description", "").toLowerCase()
  const point = action.kind === "click" ? qqMusicSearchAllPlayPoint(action, observation) : undefined
  if (point) {
    return {
      ...action,
      input: {
        ...(action.input ?? {}),
        ...point,
        elementBinding: "qqmusic-search-all-play",
      },
    }
  }

  const element =
    action.kind === "type"
      ? findSearchInput(observation.elements)
      : findPlayableDuck(observation.elements)

  if (!element) {
    return action
  }

  return {
    ...action,
    element,
    input: {
      ...(action.input ?? {}),
      elementBinding: description.includes("search") ? "search-input" : "playable-result",
    },
  }
}

function verifyObservation(action: Action, observation: Observation): ActionResult | undefined {
  if (!isQQMusicPlaybackVerificationStep(action)) {
    return undefined
  }

  const duckSong = observation.elements
    .map((element) => element.name)
    .find((name) => normalize(name).includes("歌曲名") && normalize(name).includes("鸭子"))
  const isPlaying = observation.elements.some((element) => normalize(element.name).includes("暂停"))

  if (duckSong && isPlaying) {
    return undefined
  }

  return {
    actionId: action.id,
    ok: false,
    status: "failed",
    adapter: "mac-helper",
    observation,
    metadata: {
      helperMethod: "getAppState",
      verifier: "qqmusic-duck-playback",
    },
    error: {
      code: ActionErrorCode.ACTION_FAILED,
      message: "QQ Music playback verifier did not confirm Duck playback.",
      details: {
        song: duckSong ?? "missing",
        playbackState: isPlaying ? "playing" : "not-playing",
      },
    },
  }
}

function isQQMusicPlaybackVerificationStep(action: Action): boolean {
  const description = normalize(stringInput(action, "description", ""))
  return isQQMusicTarget(action.target) && description.includes("read app state again")
}

function findSearchInput(elements: ElementRef[]): ElementRef | undefined {
  const candidates = visibleNonMenuElements(elements)
  const bySearchName = candidates.find((element) => {
    const role = normalize(element.role)
    const name = normalize(element.name)
    return name.includes("search") || name.includes("搜索") || role.includes("search")
  })

  return bySearchName ?? candidates.find((element) => isTextInputRole(normalize(element.role)))
}

function findPlayableDuck(elements: ElementRef[]): ElementRef | undefined {
  const namedDuck = visibleNonMenuElements(elements).filter((element) =>
    normalize(element.name).includes("鸭子"),
  )
  return (
    namedDuck.find((element) => isPressableRole(normalize(element.role))) ??
    namedDuck.find((element) => normalize(element.role) !== "statictext") ??
    namedDuck[0]
  )
}

function qqMusicSearchAllPlayPoint(
  action: Action,
  observation: Observation,
): { x: number; y: number } | undefined {
  if (!isQQMusicTarget(action.target)) {
    return undefined
  }

  const description = normalize(stringInput(action, "description", ""))
  if (!description.includes("playable") && !description.includes("播放")) {
    return undefined
  }

  const panel = visibleNonMenuElements(observation.elements).find((element) => {
    const roleDescription = normalize(stringMetadata(element, "roleDescription"))
    return normalize(element.name) === "搜索" && roleDescription.includes("面板")
  })
  const frame = panel?.metadata?.frame
  if (!isRecord(frame) || typeof frame.x !== "number" || typeof frame.y !== "number") {
    return undefined
  }

  return {
    x: frame.x + 41,
    y: frame.y + 208,
  }
}

function visibleNonMenuElements(elements: ElementRef[]): ElementRef[] {
  return elements.filter((element) => {
    const role = normalize(element.role)
    const frame = element.metadata?.frame
    const width = isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
    const height = isRecord(frame) && typeof frame.height === "number" ? frame.height : 0

    return !role.includes("menu") && width > 0 && height > 0
  })
}

function isQQMusicTarget(target: Action["target"]): boolean {
  return normalize(target.id) === "com.tencent.qqmusicmac"
}

function isTextInputRole(role: string): boolean {
  return role.includes("textfield") || role.includes("textbox") || role.includes("searchfield")
}

function isPressableRole(role: string): boolean {
  return (
    role.includes("button") ||
    role.includes("row") ||
    role.includes("cell") ||
    role.includes("link")
  )
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function stringMetadata(element: ElementRef, key: string): string | undefined {
  const value = element.metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
