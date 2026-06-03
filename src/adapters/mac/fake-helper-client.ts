import type { ActionResult, ElementRef, Observation, Target } from "../../core/contracts.js"
import type {
  MacActionParams,
  MacAppState,
  MacHelperClient,
  MacKeyParams,
  MacPermissionStatus,
  MacRunningApp,
  MacScrollParams,
  MacTypeParams,
  MacWindow,
} from "./helper-protocol.js"

export function createFakeMacHelperClient(): MacHelperClient {
  return {
    async permissionStatus() {
      return {
        accessibility: "granted",
        screenRecording: "granted",
        inputMonitoring: "granted",
      }
    },

    async listApps() {
      return fakeApps()
    },

    async listWindows(target: Target) {
      return fakeWindows(target)
    },

    async getAppState(target: Target) {
      const windows = fakeWindows(target)
      return {
        target,
        windows,
        observation: fakeObservation(target, "getAppState"),
      }
    },

    async open(params: MacActionParams) {
      return passedResult(params.action.id)
    },

    async click(params: MacActionParams) {
      return passedResult(params.action.id)
    },

    async typeText(params: MacTypeParams) {
      return passedResult(params.action.id, { text: params.text })
    },

    async key(params: MacKeyParams) {
      return passedResult(params.action.id, { key: params.key })
    },

    async scroll(params: MacScrollParams) {
      return passedResult(params.action.id, {
        direction: params.direction,
        amount: params.amount ?? 1,
      })
    },
  }
}

function fakeApps(): MacRunningApp[] {
  return [
    {
      appId: "com.fake.TargetApp",
      name: "Fake Target App",
      pid: 1001,
    },
  ]
}

function fakeWindows(target: Target): MacWindow[] {
  return [
    {
      id: `${target.id ?? "target"}:window:main`,
      appId: target.id ?? "com.fake.TargetApp",
      title: target.name ?? "Fake Window",
      focused: true,
    },
  ]
}

function fakeObservation(target: Target, reason: string): Observation {
  return {
    id: `${target.id ?? "target"}:observation:${reason}`,
    target,
    source: "mac-helper",
    timestamp: new Date().toISOString(),
    elements: fakeElements(target),
    metadata: {
      reason,
    },
  }
}

function fakeElements(target: Target): ElementRef[] {
  return [
    {
      id: `${target.id ?? "target"}:button:primary`,
      source: "mac-helper",
      target,
      role: "button",
      name: "Primary",
    },
    {
      id: `${target.id ?? "target"}:input:main`,
      source: "mac-helper",
      target,
      role: "textbox",
      name: "Main Input",
    },
  ]
}

function passedResult(actionId: string, metadata?: Record<string, string | number>): ActionResult {
  return {
    actionId,
    ok: true,
    status: "passed",
    adapter: "mac-helper",
    metadata,
  }
}
