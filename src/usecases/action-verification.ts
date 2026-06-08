import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"
import type { Action, ActionResult, JsonObject, Observation } from "../core/contracts.js"
import { ActionErrorCode } from "../core/errors.js"

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
  const verification = await verifyObservationStateChange(
    helper,
    action,
    previousObservation,
    observed.observation,
  )
  const settled = await settleObservationIfRequested(helper, action, verification.observation)
  const baseMetadata = {
    helperMethod: "getAppState",
    observeLatencyMs:
      observed.latencyMs + verification.extraObserveLatencyMs + settled.extraObserveLatencyMs,
    observeAttempts: 1 + verification.extraObserveAttempts + settled.extraObserveAttempts,
    ...verification.metadata,
    ...settled.metadata,
  }

  return {
    metadata: baseMetadata,
    observation: settled.observation,
    result: observationResult(
      action,
      settled.observation,
      baseMetadata,
      verification.failed,
      verification.failureMessage,
    ),
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
    const observed = await tryMeasureObservation(helper, action)
    const settled = observed.observation
      ? await settleObservationIfRequested(helper, action, observed.observation)
      : undefined
    const metadata: JsonObject = {
      ...baseMetadata,
      actionReportedFailed: true,
      verification: settled?.observation
        ? "post-action-observe-after-failed-action"
        : "action-failed-without-post-observation",
      ...(settled?.observation
        ? {
            observeLatencyMs: (observed.latencyMs ?? 0) + settled.extraObserveLatencyMs,
            observeAttempts: 1 + settled.extraObserveAttempts,
          }
        : {}),
      ...(observed.errorMessage ? { observeFailure: observed.errorMessage } : {}),
      ...(settled?.metadata ?? {}),
    }

    return {
      result: {
        ...withMetadata(call.value, metadata),
        adapter: action.adapter,
        ...(settled?.observation ? { observation: settled.observation } : {}),
      },
      ...(settled?.observation ? { observation: settled.observation } : {}),
      metadata,
    }
  }

  const observed = await measureObservation(helper, action)
  const verification = await verifyObservationStateChange(
    helper,
    action,
    previousObservation,
    observed.observation,
  )
  const settled = await settleObservationIfRequested(helper, action, verification.observation)
  const metadata: JsonObject = {
    ...baseMetadata,
    observeLatencyMs:
      observed.latencyMs + verification.extraObserveLatencyMs + settled.extraObserveLatencyMs,
    observeAttempts: 1 + verification.extraObserveAttempts + settled.extraObserveAttempts,
    verification: verification.verificationMode,
    ...verification.metadata,
    ...settled.metadata,
  }

  if (verification.failed) {
    return {
      metadata,
      observation: settled.observation,
      result: {
        ...withMetadata(call.value, metadata),
        adapter: action.adapter,
        ok: false,
        status: "failed",
        observation: settled.observation,
        error: {
          code: ActionErrorCode.ACTION_FAILED,
          message:
            verification.failureMessage ?? "Timed out waiting for state change after action.",
          details: {
            timeoutMs: timeoutMs(action),
            ...(typeof metadata.stateChanged === "boolean"
              ? { stateChanged: metadata.stateChanged }
              : {}),
            ...(metadata.targetState ? { targetState: metadata.targetState } : {}),
          },
        },
      },
    }
  }

  return {
    metadata,
    observation: settled.observation,
    result: {
      ...withMetadata(call.value, metadata),
      adapter: action.adapter,
      observation: settled.observation,
    },
  }
}

async function tryMeasureObservation(
  helper: MacHelperClient,
  action: Action,
): Promise<{ observation?: Observation; latencyMs?: number; errorMessage?: string }> {
  try {
    return await measureObservation(helper, action)
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : String(error),
    }
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
  failureMessage?: string
  verificationMode: string
  extraObserveLatencyMs: number
  extraObserveAttempts: number
}> {
  const required = booleanInput(action, "waitForStateChange", false)
  const condition = semanticCondition(action)
  const previousFingerprint = previousObservation
    ? observationFingerprint(previousObservation)
    : undefined
  let currentObservation = firstObservation
  let currentFingerprint = observationFingerprint(currentObservation)
  let changed =
    previousFingerprint === undefined ? undefined : currentFingerprint !== previousFingerprint
  let targetMatched = condition
    ? observationMatchesCondition(currentObservation, condition)
    : undefined
  let extraObserveLatencyMs = 0
  let extraObserveAttempts = 0

  if (
    (required && previousFingerprint !== undefined && !changed) ||
    (condition && !targetMatched)
  ) {
    const deadline = Date.now() + timeoutMs(action)
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs(action))
      const observed = await measureObservation(helper, action)
      extraObserveLatencyMs += observed.latencyMs
      extraObserveAttempts += 1
      currentObservation = observed.observation
      currentFingerprint = observationFingerprint(currentObservation)
      changed = currentFingerprint !== previousFingerprint
      targetMatched = condition
        ? observationMatchesCondition(currentObservation, condition)
        : undefined

      const stateChangeSatisfied = !required || previousFingerprint === undefined || changed
      const targetStateSatisfied = !condition || targetMatched
      if (stateChangeSatisfied && targetStateSatisfied) {
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
  if (condition) {
    metadata.targetState = {
      kind: condition.kind,
      keyword: condition.keyword,
      matched: targetMatched === true,
    }
    metadata.timeoutMs = timeoutMs(action)
    metadata.pollIntervalMs = pollIntervalMs(action)
  }

  const stateChangeFailed = required && previousFingerprint !== undefined && changed === false
  const targetStateFailed = condition !== undefined && targetMatched !== true
  const failureMessage = targetStateFailed
    ? `Target state was not reached: ${condition.kind} '${condition.keyword}'.`
    : stateChangeFailed
      ? "Timed out waiting for state change after action."
      : undefined

  return {
    observation: currentObservation,
    metadata,
    required,
    failed: stateChangeFailed || targetStateFailed,
    failureMessage,
    verificationMode: condition
      ? "target-state"
      : required
        ? "state-change"
        : "post-action-observe",
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
  failureMessage = "Timed out waiting for state change.",
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
            message: failureMessage,
            details: {
              timeoutMs: timeoutMs(action),
              ...(typeof metadata.stateChanged === "boolean"
                ? { stateChanged: metadata.stateChanged }
                : {}),
              ...(metadata.targetState ? { targetState: metadata.targetState } : {}),
            },
          },
        }
      : {}),
  }
}

async function settleObservationIfRequested(
  helper: MacHelperClient,
  action: Action,
  firstObservation: Observation,
): Promise<{
  observation: Observation
  metadata: JsonObject
  extraObserveLatencyMs: number
  extraObserveAttempts: number
}> {
  const required =
    booleanInput(action, "targetModeObservationBarrier", false) ||
    booleanInput(action, "settleAfterAction", false)
  if (!required) {
    return {
      observation: firstObservation,
      metadata: {},
      extraObserveLatencyMs: 0,
      extraObserveAttempts: 0,
    }
  }

  const timeout = positiveNumberInput(action, "settleTimeoutMs", 1200)
  const pollInterval = positiveNumberInput(action, "settlePollIntervalMs", 250)
  const requiredStableObservations = positiveIntegerInput(action, "settleStableObservations", 1)
  const deadline = Date.now() + timeout
  let currentObservation = firstObservation
  let currentFingerprint = observationFingerprint(currentObservation)
  let stableObservations = 0
  let extraObserveLatencyMs = 0
  let extraObserveAttempts = 0

  while (Date.now() < deadline && stableObservations < requiredStableObservations) {
    await sleep(pollInterval)
    const observed = await measureObservation(helper, action)
    extraObserveLatencyMs += observed.latencyMs
    extraObserveAttempts += 1

    const nextFingerprint = observationFingerprint(observed.observation)
    stableObservations = nextFingerprint === currentFingerprint ? stableObservations + 1 : 0
    currentFingerprint = nextFingerprint
    currentObservation = observed.observation
  }

  return {
    observation: currentObservation,
    extraObserveLatencyMs,
    extraObserveAttempts,
    metadata: {
      settleRequired: true,
      settleTimeoutMs: timeout,
      settlePollIntervalMs: pollInterval,
      settleRequiredStableObservations: requiredStableObservations,
      settleStableObservations: stableObservations,
      settleAttempts: extraObserveAttempts,
      settled: stableObservations >= requiredStableObservations,
    },
  }
}

function semanticCondition(action: Action): SemanticCondition | undefined {
  const explicit = explicitTargetStateCondition(action)
  if (explicit) {
    return explicit
  }

  const description = stringInput(action, "description", "")
  const normalized = normalize(description)
  if (action.kind !== "observe") {
    return undefined
  }

  if (!normalized.includes("wait") || !normalized.includes("load")) {
    return undefined
  }

  const match = description.match(/\bwait\s+for\s+(.+?)\s+results?\s+(?:to\s+)?load/i)
  const keyword = match?.[1]?.trim()
  if (!keyword || keyword.length > 40) {
    return undefined
  }

  if (!isKnownResultCategory(normalize(keyword))) {
    return undefined
  }

  return {
    kind: "results-loaded",
    keyword,
  }
}

function explicitTargetStateCondition(action: Action): SemanticCondition | undefined {
  const state = action.input?.targetState
  if (!isRecord(state)) {
    return undefined
  }

  const kind = typeof state.kind === "string" ? state.kind : undefined
  const keyword = typeof state.keyword === "string" ? state.keyword.trim() : undefined
  if (!kind) {
    return undefined
  }

  const normalizedKeyword = keyword ?? ""

  if (kind === "tab-activated") {
    return normalizedKeyword ? { kind, keyword: normalizedKeyword } : undefined
  }

  if (kind === "results-loaded" || kind === "search-results-loaded") {
    return { kind, keyword: normalizedKeyword }
  }

  if (kind === "text-visible" || kind === "detail-visible") {
    return { kind, keyword: normalizedKeyword }
  }

  return undefined
}

function observationMatchesCondition(
  observation: Observation,
  condition: SemanticCondition,
): boolean {
  const keyword = normalize(condition.keyword)
  if (condition.kind === "tab-activated") {
    return tabContentLoaded(observation, keyword) || selectedTabVisible(observation, keyword)
  }

  if (condition.kind === "search-results-loaded") {
    return searchResultsLoaded(observation, keyword)
  }

  if (condition.kind === "text-visible") {
    return keyword ? visibleTextIncludes(observation, keyword) : false
  }

  if (condition.kind === "detail-visible") {
    return detailEvidenceVisible(observation, keyword)
  }

  if (condition.kind !== "results-loaded") {
    return false
  }

  return tabContentLoaded(observation, keyword)
}

function visibleTextIncludes(observation: Observation, keyword: string): boolean {
  return observation.elements
    .filter((element) => isVisibleFrame(element.metadata?.frame, observation))
    .some((element) => elementTextValues(element).some((text) => normalize(text).includes(keyword)))
}

function elementTextValues(element: Observation["elements"][number]): string[] {
  const metadata = element.metadata ?? {}

  return [
    element.name,
    stringMetadata(metadata.value),
    stringMetadata(metadata.title),
    stringMetadata(metadata.description),
    stringMetadata(metadata.placeholder),
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "")
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function detailEvidenceVisible(observation: Observation, keyword: string): boolean {
  const entries = visibleEntries(observation)
  const textMatches = keyword ? visibleTextIncludes(observation, keyword) : true

  return (
    textMatches && hasDateLikeEntry(entries) && entries.some((entry) => isDetailSignal(entry.name))
  )
}

function isDetailSignal(value: string): boolean {
  const normalized = normalize(value)
  return (
    normalized.includes("发行") ||
    normalized.includes("release") ||
    normalized.includes("曲目") ||
    normalized.includes("tracks") ||
    normalized.includes("播放全部") ||
    normalized.includes("专辑信息")
  )
}

function tabContentLoaded(observation: Observation, keyword: string): boolean {
  const entries = visibleEntries(observation)
  if (entries.length < 3) {
    return false
  }

  if (isAlbumKeyword(keyword)) {
    return hasDateLikeEntry(entries) && hasRecordLikeRows(entries)
  }

  return entries.some((entry) => normalize(entry.name).includes(keyword))
}

function searchResultsLoaded(observation: Observation, keyword: string): boolean {
  if (!keyword) {
    return false
  }

  return visibleEntries(observation).some((entry) => normalize(entry.name).includes(keyword))
}

function selectedTabVisible(observation: Observation, keyword: string): boolean {
  return observation.elements.some((element) => {
    if (!element.name || normalize(element.name) !== keyword) {
      return false
    }

    const role = elementSemanticRole(element)
    if (!isTabControlRole(role) || !isVisibleFrame(element.metadata?.frame, observation)) {
      return false
    }

    const selected = element.metadata?.selected
    const value = element.metadata?.value
    return selected === true || normalize(value) === "true" || normalize(value) === "selected"
  })
}

function visibleEntries(observation: Observation): VisibleEntry[] {
  return observation.elements
    .filter((element) => element.name && isVisibleFrame(element.metadata?.frame, observation))
    .map((element) => ({
      name: element.name ?? "",
      role: element.role,
      ...entryPosition(element.metadata?.frame),
    }))
}

function hasDateLikeEntry(entries: VisibleEntry[]): boolean {
  return entries.some((entry) => /\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b/.test(entry.name))
}

function hasRecordLikeRows(entries: VisibleEntry[]): boolean {
  const rowBuckets = new Map<number, number>()

  for (const entry of entries) {
    if (entry.y === undefined) {
      continue
    }

    const bucket = Math.round(entry.y / 36)
    rowBuckets.set(bucket, (rowBuckets.get(bucket) ?? 0) + 1)
  }

  return [...rowBuckets.values()].some((count) => count >= 3)
}

function entryPosition(frame: unknown): Pick<VisibleEntry, "x" | "y"> {
  if (!isRecord(frame)) {
    return {}
  }

  return {
    ...(typeof frame.x === "number" ? { x: frame.x } : {}),
    ...(typeof frame.y === "number" ? { y: frame.y } : {}),
  }
}

function isVisibleFrame(frame: unknown, observation: Observation): boolean {
  if (!isRecord(frame)) {
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

function isAlbumKeyword(keyword: string): boolean {
  return ["album", "albums", "专辑"].some((token) => keyword.includes(token))
}

function isKnownResultCategory(keyword: string): boolean {
  return [
    "album",
    "albums",
    "专辑",
    "song",
    "songs",
    "track",
    "tracks",
    "歌曲",
    "单曲",
    "artist",
    "artists",
    "歌手",
    "艺人",
    "playlist",
    "playlists",
    "歌单",
    "video",
    "videos",
    "mv",
    "视频",
  ].some((token) => keyword.includes(token))
}

function isTabControlRole(role: string): boolean {
  return (
    role.includes("tab") ||
    role.includes("button") ||
    role.includes("按钮") ||
    role.includes("radio") ||
    role.includes("segmented") ||
    role.includes("toggle") ||
    role.includes("标签")
  )
}

function elementSemanticRole(element: Observation["elements"][number]): string {
  return [
    element.role,
    element.metadata?.roleDescription,
    element.metadata?.subrole,
    element.metadata?.axIdentifier,
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ")
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

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface SemanticCondition {
  kind:
    | "results-loaded"
    | "search-results-loaded"
    | "tab-activated"
    | "text-visible"
    | "detail-visible"
  keyword: string
}

interface VisibleEntry {
  name: string
  role?: string
  x?: number
  y?: number
}
