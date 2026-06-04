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
  Observation,
  PolicyDecision,
  TraceEvent,
} from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"
import { evaluatePolicy } from "../runtime/policy.js"
import { createUseCaseAction, createUseCaseTarget, appendTraceEvent } from "./action-plan.js"
import { measureActionCall, observeAction, observeAfterAction } from "./action-verification.js"
import type { UseCase, UseCaseRunResult, UseCaseStepResult } from "./types.js"

export interface NativeUseCaseRunnerOptions {
  helperCommand: string
}

interface QueuedUseCaseStep {
  description: string
  adaptive?: boolean
  originalExtractDescription?: string
}

interface AdaptiveRunState {
  extractRetryCounts: Map<string, number>
  triedTargets: Set<string>
  clickRecoveryCounts: Map<string, number>
}

const MAX_ADAPTIVE_EXTRACT_RETRIES = 3

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
  const pendingSteps: QueuedUseCaseStep[] = useCase.steps.map((description) => ({ description }))
  const adaptiveState: AdaptiveRunState = {
    extractRetryCounts: new Map(),
    triedTargets: new Set(),
    clickRecoveryCounts: new Map(),
  }
  let currentObservation: Observation | undefined
  let firstActionRecorded = false
  let firstStateRecorded = false

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
    return permissionBlockedRunResult(useCase, traceId, trace, target, permissions, missingPermissions)
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
    let plannedAction = createUseCaseAction(useCase.id, stepIndex, description, target, "mac-helper")

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

    if (adapter?.bindActionInput) {
      plannedAction = adapter.bindActionInput(useCase, plannedAction)
    }

    let action = plannedAction

    // Use capability chain to bind element/coordinate or extract data
    if (currentObservation && canBindActionWithCapabilities(action)) {
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

    if (canRetryPointClick(action, result, adaptiveState)) {
      adaptiveState.clickRecoveryCounts.set(description, (adaptiveState.clickRecoveryCounts.get(description) ?? 0) + 1)
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

    if (currentObservation && canContinueAfterExtractFailure(action, result)) {
      const originalExtractDescription = queuedStep.originalExtractDescription ?? description
      const followUp = planExtractFollowUp(originalExtractDescription, currentObservation, adaptiveState)

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

function canBindActionWithCapabilities(action: Action): boolean {
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

function canRetryPointClick(action: Action, result: ActionResult, adaptiveState: AdaptiveRunState): boolean {
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
): QueuedUseCaseStep[] | undefined {
  const retries = adaptiveState.extractRetryCounts.get(originalExtractDescription) ?? 0
  if (retries >= MAX_ADAPTIVE_EXTRACT_RETRIES) {
    return undefined
  }

  if (wantsAlbumResult(originalExtractDescription) && !adaptiveState.triedTargets.has("tab:专辑")) {
    adaptiveState.extractRetryCounts.set(originalExtractDescription, retries + 1)
    adaptiveState.triedTargets.add("tab:专辑")

    return [
      {
        description: "click tab named 专辑",
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

  const candidate = rankedExplorationCandidates(observation, adaptiveState).at(0)
  if (!candidate) {
    return undefined
  }

  adaptiveState.extractRetryCounts.set(originalExtractDescription, retries + 1)
  adaptiveState.triedTargets.add(candidate.key)

  return [
    {
      description: `click item named ${candidate.name}`,
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

function wantsAlbumResult(description: string): boolean {
  const normalized = normalize(description)
  return normalized.includes("album") || normalized.includes("专辑")
}

function rankedExplorationCandidates(
  observation: Observation,
  adaptiveState: AdaptiveRunState,
): Array<{ key: string; name: string; score: number }> {
  return observation.elements
    .filter((element) => element.name && isVisibleElement(element, observation))
    .map((element) => {
      const name = element.name ?? ""
      const key = elementKey(element)

      return {
        key,
        name,
        score: explorationScore(element),
      }
    })
    .filter((candidate) => candidate.score > 0 && !adaptiveState.triedTargets.has(candidate.key))
    .sort((left, right) => right.score - left.score)
}

function explorationScore(element: Observation["elements"][number]): number {
  const role = normalize(element.role)
  const name = (element.name ?? "").trim()
  const normalizedName = normalize(name)

  if (!name || isChromeOrPlaybackLabel(normalizedName)) {
    return -100
  }

  let score = 0
  if (role.includes("link")) {
    score += 35
  }
  if (role.includes("button")) {
    score += 25
  }
  if (role.includes("row") || role.includes("cell")) {
    score += 25
  }
  if (role.includes("tab") || role.includes("heading")) {
    score += 15
  }
  if (score === 0) {
    return -100
  }

  if (containsDateLikeText(name)) {
    score += 30
  }
  if (looksLikeDetailOrListTarget(normalizedName)) {
    score += 15
  }
  if (name.length > 1 && name.length <= 120) {
    score += 5
  }
  if (normalizedName.includes("播放") || normalizedName.includes("play")) {
    score -= 20
  }

  return score
}

function looksLikeDetailOrListTarget(normalizedName: string): boolean {
  return [
    "专辑",
    "album",
    "详情",
    "detail",
    "更多",
    "more",
    "全部",
    "all",
    "查看",
    "view",
    "列表",
    "list",
    "结果",
    "result",
    "下一",
    "next",
  ].some((token) => normalizedName.includes(token))
}

function isChromeOrPlaybackLabel(normalizedName: string): boolean {
  return [
    "关闭",
    "最小化",
    "全屏",
    "搜索",
    "刷新",
    "上一步",
    "下一步",
    "上一首",
    "下一首",
    "暂停播放",
    "播放列表",
    "评论",
    "更多操作",
    "添加到我喜欢",
    "close",
    "minimize",
    "fullscreen",
    "search",
    "refresh",
  ].includes(normalizedName)
}

function isVisibleElement(element: Observation["elements"][number], observation: Observation): boolean {
  const frame = element.metadata?.frame
  if (!isJsonObject(frame)) {
    return true
  }

  const x = typeof frame.x === "number" ? frame.x : 0
  const y = typeof frame.y === "number" ? frame.y : 0
  const width = typeof frame.width === "number" ? frame.width : 0
  const height = typeof frame.height === "number" ? frame.height : 0
  const screenWidth = observation.coordinateSpace?.screenWidth
  const screenHeight = observation.coordinateSpace?.screenHeight

  if (width <= 0 || height <= 0) {
    return false
  }

  if (typeof screenWidth === "number" && typeof screenHeight === "number") {
    return x + width > 0 && y + height > 0 && x < screenWidth && y < screenHeight
  }

  return true
}

function elementKey(element: Observation["elements"][number]): string {
  const frame = element.metadata?.frame
  if (isJsonObject(frame)) {
    return [
      element.role ?? "",
      element.name ?? "",
      frame.x ?? "",
      frame.y ?? "",
      frame.width ?? "",
      frame.height ?? "",
    ].join("|")
  }

  return [element.role ?? "", element.name ?? ""].join("|")
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function containsDateLikeText(value: string): boolean {
  return /\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b/.test(value)
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
    const failure = extractFailure(extractedData)

    return {
      result: {
        actionId: action.id,
        ok: !failure,
        status: failure ? "failed" : "passed",
        adapter: "mac-helper",
        metadata: {
          helperMethod: "extract",
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
    const call = await measureActionCall(action, () => helper.key({ action, key: stringInput(action, "key", "Enter") }))
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
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : "down"
}

function numberInput(action: Action, key: string, fallback: number): number {
  const value = action.input?.[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function extractFailure(extractedData: unknown): string | undefined {
  if (typeof extractedData !== "string" || extractedData.trim() === "") {
    return "Extract action did not produce structured data."
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
  if (status && (status.includes("no_") || status.includes("not_found") || status.includes("failed"))) {
    return `Extract action failed semantically: ${parsed.status}.`
  }

  const hasAlbumName = typeof parsed.albumName === "string" && parsed.albumName.trim() !== ""
  const hasArtist = typeof parsed.artist === "string" && parsed.artist.trim() !== ""
  const hasReleaseDate =
    (typeof parsed.releaseDate === "string" && parsed.releaseDate.trim() !== "") ||
    (typeof parsed.releaseYear === "string" && parsed.releaseYear.trim() !== "") ||
    (typeof parsed.releaseInfo === "string" && parsed.releaseInfo.trim() !== "")

  if (!hasAlbumName || !hasArtist || !hasReleaseDate) {
    return "Extract action did not return albumName, artist, and release date fields."
  }

  return undefined
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
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
