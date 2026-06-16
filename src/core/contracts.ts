export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type TargetKind = "app" | "browser" | "screen"
export type AdapterKind = "fake" | "browser-harness" | "mac-helper" | "app-specific"
export type ActionKind =
  | "observe"
  | "open"
  | "click"
  | "secondary-click"
  | "hover"
  | "drag"
  | "type"
  | "key"
  | "scroll"
  | "policy-check"
  | "extract"
export type ActionStatus = "passed" | "failed" | "blocked" | "skipped"
export type TraceEventKind = "run" | "observation" | "action" | "result" | "policy" | "decision"
export type AppSupportLevel = "blocked" | "custom" | "automation" | "generic" | "screen"
export type PolicyDecisionStatus = "allowed" | "blocked" | "confirm-required"
export type InputBackend = "ax-semantic" | "app-targeted-event" | "global-hid"
export type PointerImpact = "none" | "target-app" | "global"
export type PointerCoordinateSpace = "screen" | "window" | "element"
export type VirtualPointerSource = "ax-bounds" | "vision" | "explicit-coordinate" | "inferred"

export interface Target {
  kind: TargetKind
  id?: string
  name?: string
  pid?: number
  windowTitle?: string
  platform?: "any" | "macos"
}

export interface ElementRef {
  id: string
  source: AdapterKind
  target: Target
  role?: string
  name?: string
  metadata?: JsonObject
}

export interface CoordinateBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CoordinateSpace {
  screenWidth: number
  screenHeight: number
  scale?: number
}

export interface Screenshot {
  format: string
  data: string
  width: number
  height: number
  timestamp?: string
}

export interface AccessibilityNode {
  id: string
  role: string
  name?: string
  value?: string
  description?: string
  bounds?: CoordinateBounds
  children?: AccessibilityNode[]
  metadata?: JsonObject
}

export interface WindowMetadata {
  id: string
  title: string
  focused: boolean
  bounds?: CoordinateBounds
  appId?: string
  pid?: number
}

export interface PermissionsSnapshot {
  [key: string]: "granted" | "missing" | "unknown"
}

export interface Observation {
  id: string
  target: Target
  source: AdapterKind
  timestamp: string
  elements: ElementRef[]
  metadata?: JsonObject

  axElements?: ElementRef[]
  visualTextElements?: ElementRef[]
  screenshot?: Screenshot
  accessibilityTree?: AccessibilityNode[]
  focusedElementId?: string
  focusedWindow?: WindowMetadata
  windows?: WindowMetadata[]
  coordinateSpace?: CoordinateSpace
  permissions?: PermissionsSnapshot
}

export interface Action {
  id: string
  kind: ActionKind
  target: Target
  adapter: AdapterKind
  element?: ElementRef
  input?: JsonObject
}

export interface ActionError {
  code: string
  message: string
  details?: JsonObject
}

export interface ActionResult {
  actionId: string
  ok: boolean
  status: ActionStatus
  adapter: AdapterKind
  policy?: PolicyDecision
  error?: ActionError
  observation?: Observation
  metadata?: JsonObject
}

export interface InputBackendMetadata {
  backend: InputBackend
  method: string
  pointerImpact: PointerImpact
  permissionUsed: Array<"accessibility" | "screen-recording" | "input-monitoring">
  fallbackFrom?: InputBackend
}

export interface VirtualPointerState {
  x: number
  y: number
  coordinateSpace: PointerCoordinateSpace
  targetElementId?: string
  source: VirtualPointerSource
  visibleInOverlay: boolean
}

export interface ActionVerificationResult {
  status: ActionStatus
  mode: string
  hasBeforeObservation: boolean
  hasAfterObservation: boolean
  beforeObservationId?: string
  afterObservationId?: string
  stateChanged?: boolean
  targetState?: JsonObject
  message?: string
}

export interface ActionExecutionSummary {
  ok: boolean
  status: ActionStatus
  adapter: AdapterKind
  inputBackend?: InputBackendMetadata
  metadata?: JsonObject
  error?: ActionError
}

export interface ActionTraceStep {
  stepId: string
  goalId?: string
  action: Action
  before?: Observation
  execution: ActionExecutionSummary
  after?: Observation
  verification: ActionVerificationResult
  virtualPointer?: VirtualPointerState
}

export interface PolicyDecision {
  id: string
  status: PolicyDecisionStatus
  target: Target
  reason: string
  ruleId?: string
  requiresConfirmation: boolean
}

export interface TraceEvent {
  traceId: string
  index: number
  kind: TraceEventKind
  timestamp: string
  target?: Target
  action?: Action
  observation?: Observation
  policy?: PolicyDecision
  result?: ActionResult
  actionTraceStep?: ActionTraceStep
  metadata?: JsonObject
}

export interface AppCapability {
  appId: string
  displayName: string
  aliases?: string[]
  supportLevel: AppSupportLevel
  adapters: AdapterKind[]
  fallback: AppSupportLevel[]
  requiredPermissions: string[]
}
