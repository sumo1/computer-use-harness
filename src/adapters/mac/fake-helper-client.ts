import type { ActionResult, ElementRef, Observation, Target } from "../../core/contracts.js"
import type {
  MacActionParams,
  MacAppState,
  MacDragParams,
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

    async screenshot() {
      return {
        format: "png",
        data: "",
        width: 1920,
        height: 1080,
      }
    },

    async open(params: MacActionParams) {
      return passedResult(params.action.id)
    },

    async click(params: MacActionParams) {
      return passedResult(params.action.id)
    },

    async secondaryClick(params: MacActionParams) {
      return passedResult(params.action.id, {
        button: "right",
        x: numberInput(params.action, "x", 0),
        y: numberInput(params.action, "y", 0),
      })
    },

    async hover(params: MacActionParams) {
      return passedResult(params.action.id, {
        x: numberInput(params.action, "x", 0),
        y: numberInput(params.action, "y", 0),
      })
    },

    async drag(params: MacDragParams) {
      const fromX = numberInput(params.action, "x", 0)
      const fromY = numberInput(params.action, "y", 0)
      const toX = numberInput(params.action, "toX", fromX + numberInput(params.action, "deltaX", 0))
      const toY = numberInput(params.action, "toY", fromY + numberInput(params.action, "deltaY", 0))

      return passedResult(params.action.id, {
        fromX,
        fromY,
        toX,
        toY,
        deltaX: toX - fromX,
        deltaY: toY - fromY,
      })
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
  const focusedWindow = fakeObservationWindow(target)

  return {
    id: `${target.id ?? "target"}:observation:${reason}`,
    target,
    source: "mac-helper",
    timestamp: new Date().toISOString(),
    elements: fakeElements(target),
    metadata: {
      reason,
    },
    screenshot: {
      format: "png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      width: 1,
      height: 1,
      timestamp: new Date().toISOString(),
    },
    accessibilityTree: fakeAccessibilityTree(target),
    focusedElementId: `${target.id ?? "target"}:input:main`,
    focusedWindow,
    windows: [focusedWindow],
    coordinateSpace: {
      screenWidth: 1920,
      screenHeight: 1080,
      scale: 2,
    },
    permissions: {
      accessibility: "granted",
      screenRecording: "granted",
      inputMonitoring: "granted",
    },
  }
}

function fakeObservationWindow(target: Target) {
  return {
    id: `${target.id ?? "target"}:window:main`,
    appId: target.id ?? "com.fake.TargetApp",
    title: target.name ?? "Fake Window",
    focused: true,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  }
}

function fakeAccessibilityTree(target: Target): Observation["accessibilityTree"] {
  return [
    {
      id: `${target.id ?? "target"}:ax:root`,
      role: "window",
      name: target.name ?? "Fake Window",
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      children: [
        {
          id: `${target.id ?? "target"}:button:primary`,
          role: "button",
          name: "Primary",
          bounds: { x: 100, y: 100, width: 120, height: 40 },
        },
        {
          id: `${target.id ?? "target"}:input:main`,
          role: "textbox",
          name: "Main Input",
          value: "",
          bounds: { x: 100, y: 160, width: 300, height: 32 },
        },
      ],
    },
  ]
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

function numberInput(action: { input?: Record<string, unknown> }, key: string, fallback: number): number {
  const value = action.input?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}
