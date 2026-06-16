import type {
  Action,
  ActionResult,
  JsonObject,
  Observation,
  Screenshot,
  Target,
} from "../../core/contracts.js"
import type { ActionErrorCode } from "../../core/errors.js"

export type MacPermissionState = "granted" | "missing" | "unknown"
export type MacHelperErrorCode =
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "UNKNOWN_METHOD"
  | "ENCODE_ERROR"
  | ActionErrorCode

export type MacHelperMethod =
  | "permissionStatus"
  | "listApps"
  | "listWindows"
  | "getAppState"
  | "screenshot"
  | "open"
  | "click"
  | "secondary-click"
  | "hover"
  | "drag"
  | "type"
  | "key"
  | "scroll"

export interface MacHelperRequest<TParams extends object = object> {
  jsonrpc: "2.0"
  id: string
  method: MacHelperMethod
  params: TParams
}

export interface MacHelperResponse<TResult extends object = object> {
  jsonrpc: "2.0"
  id: string
  result?: TResult
  error?: MacHelperError
}

export interface MacHelperError {
  code: MacHelperErrorCode
  message: string
  details?: JsonObject
}

export interface MacPermissionStatus {
  accessibility: MacPermissionState
  screenRecording: MacPermissionState
  inputMonitoring: MacPermissionState
}

export interface MacRunningApp {
  appId: string
  name: string
  pid?: number
}

export interface MacWindow {
  id: string
  appId: string
  title: string
  focused: boolean
  pid?: number
}

export interface MacAppState {
  target: Target
  windows: MacWindow[]
  observation: Observation
}

export type MacObservationMode = "full" | "ax-only" | "visual-text"

export interface MacObservationOptions {
  mode?: MacObservationMode
  includeOCR?: boolean
  includeScreenshotPayload?: boolean
}

export interface MacActionParams {
  action: Action
}

export interface MacTypeParams extends MacActionParams {
  text: string
}

export interface MacKeyParams extends MacActionParams {
  key: string
}

export interface MacScrollParams extends MacActionParams {
  direction: "up" | "down" | "left" | "right"
  amount?: number
}

export type MacDragParams = MacActionParams

export type MacScreenshot = Screenshot

export interface MacHelperClient {
  permissionStatus(): Promise<MacPermissionStatus>
  listApps(): Promise<MacRunningApp[]>
  listWindows(target: Target): Promise<MacWindow[]>
  getAppState(target: Target, options?: MacObservationOptions): Promise<MacAppState>
  screenshot(target: Target): Promise<MacScreenshot>
  open(params: MacActionParams): Promise<ActionResult>
  click(params: MacActionParams): Promise<ActionResult>
  secondaryClick(params: MacActionParams): Promise<ActionResult>
  hover(params: MacActionParams): Promise<ActionResult>
  drag(params: MacDragParams): Promise<ActionResult>
  typeText(params: MacTypeParams): Promise<ActionResult>
  key(params: MacKeyParams): Promise<ActionResult>
  scroll(params: MacScrollParams): Promise<ActionResult>
}
