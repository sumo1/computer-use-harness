export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type TargetKind = "app" | "browser" | "screen"
export type AdapterKind = "fake" | "browser-harness" | "mac-helper" | "app-specific"
export type ActionKind = "observe" | "open" | "click" | "type" | "key" | "scroll" | "policy-check"
export type ActionStatus = "passed" | "failed" | "blocked" | "skipped"
export type TraceEventKind = "run" | "observation" | "action" | "result" | "policy"
export type AppSupportLevel = "blocked" | "custom" | "automation" | "generic" | "screen"
export type PolicyDecisionStatus = "allowed" | "blocked" | "confirm-required"

export interface Target {
  kind: TargetKind
  id?: string
  name?: string
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

export interface Observation {
  id: string
  target: Target
  source: AdapterKind
  timestamp: string
  elements: ElementRef[]
  metadata?: JsonObject
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
