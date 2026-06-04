#!/usr/bin/env node
import assert from "node:assert/strict"
import { createUseCaseAction } from "../dist/usecases/action-plan.js"
import { runFakeUseCase } from "../dist/usecases/fake-runner.js"

const target = {
  kind: "app",
  id: "com.fake.TargetApp",
  name: "Fake Target App",
  platform: "macos",
}

const rightClick = createUseCaseAction("VERIFY", 1, "right click at 100, 200", target, "fake")
assert.equal(rightClick.kind, "secondary-click")
assert.deepEqual(rightClick.input, {
  description: "right click at 100, 200",
  x: 100,
  y: 200,
})

const drag = createUseCaseAction("VERIFY", 2, "drag from 10, 20 to 30, 40", target, "fake")
assert.equal(drag.kind, "drag")
assert.deepEqual(drag.input, {
  description: "drag from 10, 20 to 30, 40",
  x: 10,
  y: 20,
  toX: 30,
  toY: 40,
})

const run = await runFakeUseCase({
  id: "VERIFY",
  title: "Hardening regression checks",
  target,
  steps: [
    "observe current app state",
    "click at 100, 200",
    "right click at 100, 200",
    "hover at 100, 200",
    "drag from 10, 20 to 30, 40",
    "scroll up 2",
  ],
  success: ["all core pointer actions complete"],
})

assert.equal(run.status, "passed")
assert.deepEqual(
  run.trace.filter((event) => event.kind === "action").map((event) => event.action?.kind),
  ["observe", "click", "secondary-click", "hover", "drag", "scroll"],
)

const observedActions = run.trace
  .filter((event) => event.kind === "observation")
  .map((event) => event.action?.kind)
assert.deepEqual(observedActions, ["observe", "click", "secondary-click", "hover", "drag", "scroll"])

const waitRun = await runFakeUseCase({
  id: "VERIFY-WAIT",
  title: "Hardening explicit wait regression check",
  target,
  steps: ["observe current app state", "click at 100, 200 wait for state change timeout 1ms"],
  success: ["state-change wait fails when fake observation does not change"],
})

assert.equal(waitRun.status, "failed")
assert.equal(waitRun.steps[1]?.status, "failed")

console.log("hardening regression checks passed")
