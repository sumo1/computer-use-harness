import type {
  Action,
  ActionError,
  ActionResult,
  ActionStatus,
  ActionTraceStep,
  AdapterKind,
  CoordinateBounds,
  InputBackend,
  InputBackendMetadata,
  JsonObject,
  Observation,
  PointerImpact,
  VirtualPointerState,
} from "../core/contracts.js"

export interface CreateActionTraceStepInput {
  action: Action
  result: ActionResult
  before?: Observation
  after?: Observation
  executionMetadata?: JsonObject
}

export function createActionTraceStep(input: CreateActionTraceStepInput): ActionTraceStep {
  const inputBackend = inputBackendMetadata(input.action, input.result)
  const virtualPointer = virtualPointerState(input.action, input.after ?? input.before)

  return {
    stepId: input.action.id,
    action: input.action,
    ...(input.before ? { before: input.before } : {}),
    execution: {
      ok: input.result.ok,
      status: input.result.status,
      adapter: input.result.adapter,
      ...(inputBackend ? { inputBackend } : {}),
      ...(input.executionMetadata ? { metadata: input.executionMetadata } : {}),
      ...(input.result.error ? { error: input.result.error } : {}),
    },
    ...(input.after ? { after: input.after } : {}),
    verification: verificationResult(input.result, input.before, input.after),
    ...(virtualPointer ? { virtualPointer } : {}),
  }
}

export function actionTraceStepMetadata(step: ActionTraceStep): JsonObject {
  const overlay = step.virtualPointer
    ? virtualPointerOverlay(step.virtualPointer, step.after ?? step.before)
    : undefined

  return {
    stepId: step.stepId,
    actionId: step.action.id,
    actionKind: step.action.kind,
    beforeObservationId: step.before?.id ?? null,
    afterObservationId: step.after?.id ?? null,
    execution: {
      ok: step.execution.ok,
      status: step.execution.status,
      adapter: step.execution.adapter,
      ...(step.execution.inputBackend
        ? { inputBackend: inputBackendMetadataJson(step.execution.inputBackend) }
        : {}),
      ...(step.execution.error ? { error: errorMetadata(step.execution.error) } : {}),
    },
    verification: verificationMetadata(step.verification),
    ...(step.virtualPointer
      ? {
          virtualPointer: virtualPointerMetadata(step.virtualPointer),
          ...(overlay ? { virtualPointerOverlay: overlay } : {}),
        }
      : {}),
  }
}

export function inputBackendMetadata(
  action: Action,
  result: ActionResult,
): InputBackendMetadata | undefined {
  if (action.kind === "observe" || action.kind === "policy-check" || action.kind === "extract") {
    return undefined
  }

  const explicit = explicitInputBackend(result.metadata)
  if (explicit) {
    return explicit
  }

  const inputMethod = stringMetadata(result.metadata, "inputMethod")
  const backend = inputMethod
    ? classifyInputMethod(inputMethod)
    : defaultBackendForAction(action, result.metadata)
  const method = inputMethod ?? defaultInputMethod(action, backend, result.metadata)

  return {
    backend,
    method,
    pointerImpact: pointerImpact(backend),
    permissionUsed: permissionsForBackend(backend),
    ...(backend !== "ax-semantic" && action.element ? { fallbackFrom: "ax-semantic" } : {}),
  }
}

function explicitInputBackend(metadata: JsonObject | undefined): InputBackendMetadata | undefined {
  const inputBackend = metadata?.inputBackend
  if (!isRecord(inputBackend)) {
    return undefined
  }

  const backend = inputBackend.backend
  const method = inputBackend.method
  const pointerImpactValue = inputBackend.pointerImpact
  if (!isInputBackend(backend) || typeof method !== "string") {
    return undefined
  }

  return {
    backend,
    method,
    pointerImpact: isPointerImpact(pointerImpactValue)
      ? pointerImpactValue
      : pointerImpact(backend),
    permissionUsed: permissionsForBackend(backend),
    ...(isInputBackend(inputBackend.fallbackFrom)
      ? { fallbackFrom: inputBackend.fallbackFrom }
      : {}),
  }
}

function classifyInputMethod(inputMethod: string): InputBackend {
  const normalized = inputMethod.toLowerCase()

  if (normalized.includes("hid")) {
    return "global-hid"
  }

  if (
    normalized.includes("pid") ||
    normalized.includes("paste") ||
    normalized.includes("scroll-wheel") ||
    normalized.includes("key-chord")
  ) {
    return "app-targeted-event"
  }

  if (normalized.includes("ax")) {
    return "ax-semantic"
  }

  return "app-targeted-event"
}

function defaultBackendForAction(action: Action, metadata: JsonObject | undefined): InputBackend {
  if (action.kind === "click" || action.kind === "type") {
    return "ax-semantic"
  }

  if (action.kind === "key" || action.kind === "scroll" || action.kind === "open") {
    return "app-targeted-event"
  }

  if (action.kind === "secondary-click" || action.kind === "hover" || action.kind === "drag") {
    return hasPointMetadata(metadata) || hasCoordinateInput(action)
      ? "global-hid"
      : "app-targeted-event"
  }

  return "app-targeted-event"
}

function defaultInputMethod(
  action: Action,
  backend: InputBackend,
  metadata: JsonObject | undefined,
): string {
  const helperMethod = stringMetadata(metadata, "helperMethod")

  if (backend === "ax-semantic") {
    return action.kind === "type" ? "AXSetValue" : "AXPress"
  }

  if (helperMethod === "scroll") {
    return "CGEvent.postToPid.scroll"
  }

  if (helperMethod === "key") {
    return "CGEvent.postToPid.key"
  }

  if (backend === "global-hid") {
    return "CGEvent.cghidEventTap"
  }

  return helperMethod ? `CGEvent.postToPid.${helperMethod}` : "CGEvent.postToPid"
}

function pointerImpact(backend: InputBackend): PointerImpact {
  if (backend === "ax-semantic") {
    return "none"
  }

  return backend === "global-hid" ? "global" : "target-app"
}

function permissionsForBackend(
  backend: InputBackend,
): Array<"accessibility" | "screen-recording" | "input-monitoring"> {
  if (backend === "global-hid") {
    return ["accessibility", "input-monitoring"]
  }

  return ["accessibility"]
}

function virtualPointerState(
  action: Action,
  observation: Observation | undefined,
): VirtualPointerState | undefined {
  const explicitPoint = explicitPointInput(action)
  if (explicitPoint) {
    return {
      ...explicitPoint,
      coordinateSpace: "screen",
      source: "explicit-coordinate",
      visibleInOverlay: Boolean(observation?.screenshot),
    }
  }

  const elementFrame = frameFromElement(action.element)
  if (elementFrame) {
    return {
      x: elementFrame.x + elementFrame.width / 2,
      y: elementFrame.y + elementFrame.height / 2,
      coordinateSpace: "screen",
      targetElementId: action.element?.id,
      source: elementSource(action.element) ?? "ax-bounds",
      visibleInOverlay: Boolean(observation?.screenshot),
    }
  }

  const focusedElement = observation?.focusedElementId
    ? observation.elements.find((element) => element.id === observation.focusedElementId)
    : undefined
  const focusedFrame = frameFromElement(focusedElement)
  if (focusedFrame) {
    return {
      x: focusedFrame.x + focusedFrame.width / 2,
      y: focusedFrame.y + focusedFrame.height / 2,
      coordinateSpace: "screen",
      targetElementId: focusedElement?.id,
      source: "ax-bounds",
      visibleInOverlay: Boolean(observation?.screenshot),
    }
  }

  const windowBounds = observation?.focusedWindow?.bounds
  if (windowBounds) {
    return {
      x: windowBounds.x + windowBounds.width / 2,
      y: windowBounds.y + windowBounds.height / 2,
      coordinateSpace: "screen",
      source: "inferred",
      visibleInOverlay: Boolean(observation?.screenshot),
    }
  }

  const coordinateSpace = observation?.coordinateSpace
  if (coordinateSpace) {
    return {
      x: coordinateSpace.screenWidth / 2,
      y: coordinateSpace.screenHeight / 2,
      coordinateSpace: "screen",
      source: "inferred",
      visibleInOverlay: Boolean(observation?.screenshot),
    }
  }

  return undefined
}

function verificationResult(
  result: ActionResult,
  before: Observation | undefined,
  after: Observation | undefined,
) {
  const metadata = result.metadata
  const mode =
    stringMetadata(metadata, "verification") ?? (after ? "post-action-observe" : "execution-only")

  return {
    status: result.status,
    mode,
    hasBeforeObservation: Boolean(before),
    hasAfterObservation: Boolean(after),
    ...(before ? { beforeObservationId: before.id } : {}),
    ...(after ? { afterObservationId: after.id } : {}),
    ...(typeof metadata?.stateChanged === "boolean" ? { stateChanged: metadata.stateChanged } : {}),
    ...(isRecord(metadata?.targetState) ? { targetState: metadata.targetState } : {}),
    ...(result.error?.message ? { message: result.error.message } : {}),
  }
}

function virtualPointerOverlay(
  pointer: VirtualPointerState,
  observation: Observation | undefined,
): JsonObject | undefined {
  const screenshot = observation?.screenshot
  if (!screenshot) {
    return undefined
  }

  const radius = 10
  const width = screenshot.width
  const height = screenshot.height
  const point = overlayPoint(pointer, observation)
  const x = Number(point.x.toFixed(2))
  const y = Number(point.y.toFixed(2))
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="#ff3b30" stroke-width="3"/>`,
    `<line x1="${x - radius * 1.8}" y1="${y}" x2="${x + radius * 1.8}" y2="${y}" stroke="#ff3b30" stroke-width="2"/>`,
    `<line x1="${x}" y1="${y - radius * 1.8}" x2="${x}" y2="${y + radius * 1.8}" stroke="#ff3b30" stroke-width="2"/>`,
    "</svg>",
  ].join("")

  return {
    format: "svg",
    width,
    height,
    x,
    y,
    data: svg,
  }
}

function overlayPoint(
  pointer: VirtualPointerState,
  observation: Observation | undefined,
): { x: number; y: number } {
  const screenshot = observation?.screenshot
  const windowBounds = observation?.focusedWindow?.bounds

  if (
    pointer.coordinateSpace === "screen" &&
    screenshot &&
    windowBounds &&
    windowBounds.width > 0 &&
    windowBounds.height > 0
  ) {
    return {
      x: clamp(
        (pointer.x - windowBounds.x) * (screenshot.width / windowBounds.width),
        0,
        screenshot.width,
      ),
      y: clamp(
        (pointer.y - windowBounds.y) * (screenshot.height / windowBounds.height),
        0,
        screenshot.height,
      ),
    }
  }

  return { x: pointer.x, y: pointer.y }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function verificationMetadata(result: ActionTraceStep["verification"]): JsonObject {
  return {
    status: result.status,
    mode: result.mode,
    hasBeforeObservation: result.hasBeforeObservation,
    hasAfterObservation: result.hasAfterObservation,
    beforeObservationId: result.beforeObservationId ?? null,
    afterObservationId: result.afterObservationId ?? null,
    ...(typeof result.stateChanged === "boolean" ? { stateChanged: result.stateChanged } : {}),
    ...(result.targetState ? { targetState: result.targetState } : {}),
    ...(result.message ? { message: result.message } : {}),
  }
}

function inputBackendMetadataJson(inputBackend: InputBackendMetadata): JsonObject {
  return {
    backend: inputBackend.backend,
    method: inputBackend.method,
    pointerImpact: inputBackend.pointerImpact,
    permissionUsed: inputBackend.permissionUsed,
    ...(inputBackend.fallbackFrom ? { fallbackFrom: inputBackend.fallbackFrom } : {}),
  }
}

function virtualPointerMetadata(pointer: VirtualPointerState): JsonObject {
  return {
    x: pointer.x,
    y: pointer.y,
    coordinateSpace: pointer.coordinateSpace,
    source: pointer.source,
    visibleInOverlay: pointer.visibleInOverlay,
    ...(pointer.targetElementId ? { targetElementId: pointer.targetElementId } : {}),
  }
}

function errorMetadata(error: ActionError): JsonObject {
  return {
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  }
}

function explicitPointInput(action: Action): { x: number; y: number } | undefined {
  const x = action.input?.x
  const y = action.input?.y

  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined
}

function frameFromElement(element: Action["element"] | undefined): CoordinateBounds | undefined {
  const frame = element?.metadata?.frame ?? element?.metadata?.bounds
  if (!isRecord(frame)) {
    return undefined
  }

  const { x, y, width, height } = frame
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return undefined
  }

  return { x, y, width, height }
}

function elementSource(
  element: Action["element"] | undefined,
): VirtualPointerState["source"] | undefined {
  if (element?.metadata?.source === "screenshot-ocr") {
    return "vision"
  }

  return element ? "ax-bounds" : undefined
}

function hasCoordinateInput(action: Action): boolean {
  return typeof action.input?.x === "number" && typeof action.input?.y === "number"
}

function hasPointMetadata(metadata: JsonObject | undefined): boolean {
  return typeof metadata?.x === "number" && typeof metadata?.y === "number"
}

function stringMetadata(metadata: JsonObject | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function isInputBackend(value: unknown): value is InputBackend {
  return value === "ax-semantic" || value === "app-targeted-event" || value === "global-hid"
}

function isPointerImpact(value: unknown): value is PointerImpact {
  return value === "none" || value === "target-app" || value === "global"
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
