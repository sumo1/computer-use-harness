import type { Action, ActionResult, JsonObject, Observation, Target } from "../../core/contracts.js"
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
  | "click"
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
}

export interface MacAppState {
  target: Target
  windows: MacWindow[]
  observation: Observation
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

export interface MacHelperClient {
  permissionStatus(): Promise<MacPermissionStatus>
  listApps(): Promise<MacRunningApp[]>
  listWindows(target: Target): Promise<MacWindow[]>
  getAppState(target: Target): Promise<MacAppState>
  click(params: MacActionParams): Promise<ActionResult>
  typeText(params: MacTypeParams): Promise<ActionResult>
  key(params: MacKeyParams): Promise<ActionResult>
  scroll(params: MacScrollParams): Promise<ActionResult>
}
