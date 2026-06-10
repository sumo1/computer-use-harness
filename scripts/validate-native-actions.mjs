#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { runNativeAction } from "../dist/actions/native-action-runner.js"

const repoRoot = new URL("..", import.meta.url)

const target = {
  kind: "app",
  id: "com.fake.TargetApp",
  name: "Fake Target App",
  platform: "macos",
}

const observe = runCli(["observe", "--app", "Fake Target App", "--fake", "--pretty"])
assert.equal(observe.data.mode, "native-action")
assert.equal(observe.data.status, "passed")
assert.equal(observe.data.action.kind, "observe")
assert.equal(observe.data.observation.elements.length, 2)
assert.equal(existsSync(observe.data.tracePath), true)

const finderAlias = runCli(["observe", "--app", "Finder", "--fake", "--pretty"])
assert.equal(finderAlias.data.target.id, "com.apple.finder")
assert.equal(finderAlias.data.target.name, "Finder")

const click = runCli([
  "click",
  "--app",
  "Fake Target App",
  "--fake",
  "--keyword",
  "Primary",
  "--description",
  "click button named Primary",
  "--pretty",
])
assert.equal(click.data.status, "passed")
assert.equal(click.data.action.kind, "click")
assert.equal(click.data.action.element.name, "Primary")
assert.equal(click.data.action.input.capabilityUsed, "ax-element-finder")
assertHasObservationBefore(click.data.trace)
assertActionTraceStep(click.data.trace, "click", {
  backend: "ax-semantic",
  pointerSource: "ax-bounds",
})

const type = runCli([
  "type",
  "--app",
  "Fake Target App",
  "--fake",
  "--keyword",
  "Main Input",
  "--description",
  "type text into item named Main Input",
  "--text",
  "hello",
  "--pretty",
])
assert.equal(type.data.status, "passed")
assert.equal(type.data.action.kind, "type")
assert.equal(type.data.action.element.name, "Main Input")
assert.equal(type.data.result.metadata.text, "hello")
assert.equal(type.data.action.input.capabilityUsed, "ax-element-finder")
assertHasObservationBefore(type.data.trace)
assertActionTraceStep(type.data.trace, "type", {
  backend: "ax-semantic",
  pointerSource: "ax-bounds",
})

const scroll = runCli(["scroll", "--app", "Fake Target App", "--fake", "down", "2", "--pretty"])
assert.equal(scroll.data.status, "passed")
assert.equal(scroll.data.action.kind, "scroll")
assert.equal(scroll.data.result.metadata.helperMethod, "scroll")
assert.equal(scroll.data.result.metadata.direction, "down")
assert.equal(scroll.data.result.metadata.amount, 2)
assertHasObservationBefore(scroll.data.trace)
assertActionTraceStep(scroll.data.trace, "scroll", {
  backend: "app-targeted-event",
  pointerSource: "ax-bounds",
})

const policy = runCli(["policy-check", "--app", "Fake Target App", "--fake", "--pretty"])
assert.equal(policy.data.status, "passed")
assert.equal(policy.data.action.kind, "policy-check")

const invalid = spawnCli(["action", "dance", "--app", "Fake Target App", "--fake", "--pretty"])
assert.equal(invalid.status, 2)
const invalidResult = JSON.parse(invalid.stdout)
assert.equal(invalidResult.ok, false)
assert.equal(invalidResult.error.code, "INVALID_ACTION_KIND")

const axOnlyWithoutScreenRecording = await runNativeAction({
  target,
  helper: axOnlyHelperWithMissingScreenRecording(),
  action: {
    id: "validation:ax-only-no-screen-recording",
    kind: "observe",
    target,
    adapter: "mac-helper",
    input: {
      description: "read app state through AX",
    },
  },
})
assert.equal(axOnlyWithoutScreenRecording.status, "passed")
assert.deepEqual(axOnlyWithoutScreenRecording.trace[0].metadata.requiredPermissions, [
  "accessibility",
])
assert.equal(axOnlyWithoutScreenRecording.trace[0].metadata.permissions.screenRecording, "missing")

console.log("native action regression checks passed")

function runCli(args) {
  const result = spawnCli(args)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ok, true)
  return parsed
}

function spawnCli(args) {
  return spawnSync(process.execPath, ["dist/cli/index.js", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
    },
  })
}

function assertHasObservationBefore(trace) {
  assert(
    trace.some(
      (event) => event.kind === "observation" && event.action?.id.endsWith(":observe-before"),
    ),
  )
}

function assertActionTraceStep(trace, actionKind, expected) {
  const resultEvent = trace.find(
    (event) => event.kind === "result" && event.action?.kind === actionKind,
  )
  assert(resultEvent, `missing result event for ${actionKind}`)
  assert(resultEvent.actionTraceStep, `missing actionTraceStep for ${actionKind}`)
  assert.equal(resultEvent.actionTraceStep.action.kind, actionKind)
  assert.equal(resultEvent.actionTraceStep.execution.inputBackend.backend, expected.backend)
  assert.equal(
    resultEvent.actionTraceStep.execution.inputBackend.pointerImpact,
    expected.backend === "ax-semantic" ? "none" : "target-app",
  )
  assert.equal(resultEvent.actionTraceStep.virtualPointer.source, expected.pointerSource)
  assert.equal(resultEvent.actionTraceStep.verification.hasBeforeObservation, true)
  assert.equal(resultEvent.actionTraceStep.verification.hasAfterObservation, true)
  assert.equal(resultEvent.actionTraceStep.verification.status, "passed")
  assert.equal(resultEvent.result.metadata.actionTraceStep.actionKind, actionKind)
  assert.equal(
    resultEvent.result.metadata.actionTraceStep.execution.inputBackend.backend,
    expected.backend,
  )
  const overlay = resultEvent.result.metadata.actionTraceStep.virtualPointerOverlay
  assert.equal(overlay.format, "svg")
  assert.equal(typeof overlay.x, "number")
  assert.equal(typeof overlay.y, "number")
  assert(overlay.x >= 0 && overlay.x <= overlay.width)
  assert(overlay.y >= 0 && overlay.y <= overlay.height)
}

function axOnlyHelperWithMissingScreenRecording() {
  return {
    async permissionStatus() {
      return {
        accessibility: "granted",
        screenRecording: "missing",
        inputMonitoring: "unknown",
      }
    },
    async listApps() {
      return []
    },
    async listWindows() {
      return []
    },
    async getAppState(observedTarget) {
      const elements = [
        {
          id: "ax-only:button:primary",
          source: "mac-helper",
          target: observedTarget,
          role: "button",
          name: "Primary",
          metadata: {
            frame: { x: 10, y: 10, width: 80, height: 32 },
          },
        },
      ]

      return {
        target: observedTarget,
        windows: [],
        observation: {
          id: "ax-only:observation",
          target: observedTarget,
          source: "mac-helper",
          timestamp: new Date().toISOString(),
          elements,
          axElements: elements,
          visualTextElements: [],
          metadata: {
            observationMode: "ax-only",
          },
          permissions: {
            accessibility: "granted",
            screenRecording: "missing",
            inputMonitoring: "unknown",
          },
        },
      }
    },
    async screenshot() {
      throw new Error("screenshot should not be required for ax-only observation")
    },
    async open(params) {
      return passed(params.action.id)
    },
    async click(params) {
      return passed(params.action.id)
    },
    async secondaryClick(params) {
      return passed(params.action.id)
    },
    async hover(params) {
      return passed(params.action.id)
    },
    async drag(params) {
      return passed(params.action.id)
    },
    async typeText(params) {
      return passed(params.action.id, { text: params.text })
    },
    async key(params) {
      return passed(params.action.id, { key: params.key })
    },
    async scroll(params) {
      return passed(params.action.id, {
        direction: params.direction,
        amount: params.amount ?? 1,
      })
    },
  }
}

function passed(actionId, metadata = {}) {
  return {
    actionId,
    ok: true,
    status: "passed",
    adapter: "mac-helper",
    metadata,
  }
}
