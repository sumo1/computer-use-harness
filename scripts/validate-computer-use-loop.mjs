#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AXElementFinder,
  AXStructuredExtractor,
  CapabilityChain,
  CoordinateClicker,
} from "../dist/capabilities/index.js"
import { createUseCaseAction } from "../dist/usecases/action-plan.js"
import { observeAction, observeAfterAction } from "../dist/usecases/action-verification.js"
import { extractionRecoveryCandidates } from "../dist/usecases/recovery-plan.js"

let spawnIndex = 0
const cliCommand = process.env.COMPUTER_USE_CLI ?? "computer-use"

const target = {
  kind: "app",
  id: "com.fake.MediaApp",
  name: "Fake Media App",
  platform: "macos",
}

const extractDescription =
  "extract latest album from visible results; only accept entries where artist is 周杰伦, compare release dates, and return albumName releaseDate artist"

const chain = new CapabilityChain([new AXStructuredExtractor(), new AXElementFinder()])

const firstExtract = createUseCaseAction("LOOP", 1, extractDescription, target, "mac-helper")
const firstExtractResult = await chain.execute(firstExtract, searchResultsObservation())
assert.equal(firstExtractResult.result.success, false)

const recovery = extractionRecoveryCandidates(extractDescription, searchResultsObservation())
assert.equal(recovery[0]?.description, "click tab named 专辑")
assert.equal(
  recovery.some((candidate) => candidate.description === "click tab named 歌手"),
  false,
)

const afterAlbumTab = recovery.filter((candidate) => candidate.key !== recovery[0].key)
assert.equal(afterAlbumTab[0]?.description, "scroll down 5")

const candidateRecovery = extractionRecoveryCandidates(
  extractDescription,
  albumNamesOnlyObservation(),
  "Visible album names in the rightmost column ('魔杰座', '太阳之子', '周杰伦的床边故事'). No release dates are visible.",
)
assert.equal(
  candidateRecovery.some((candidate) => candidate.description === "click item named 周杰伦"),
  false,
)
assert.equal(
  candidateRecovery.some((candidate) => candidate.description === "click item named 魔杰座"),
  false,
)
assert.equal(candidateRecovery[0]?.description, "scroll down 5")

const clickTab = createUseCaseAction("LOOP", 2, recovery[0].description, target, "mac-helper")
const clickTabResult = await chain.execute(clickTab, searchResultsObservation())
assert.equal(clickTabResult.result.success, true)
assert.equal(clickTabResult.usedCapability, "ax-element-finder")
assert.equal(clickTabResult.result.element?.name, "专辑")
assert.equal(clickTabResult.result.element?.role, "AXUnknown")
assert.equal(clickTabResult.result.element?.metadata?.roleDescription, "按钮")

const staticOnlyClickTabResult = await chain.execute(clickTab, staticColumnObservation())
assert.equal(staticOnlyClickTabResult.result.success, false)

const coordinateOnlyTabChain = new CapabilityChain([new CoordinateClicker()])
const coordinateOnlyTabResult = await coordinateOnlyTabChain.execute(
  {
    ...clickTab,
    input: {
      ...clickTab.input,
      x: 210,
      y: 180,
    },
  },
  staticColumnObservation(),
)
assert.equal(coordinateOnlyTabResult.result.success, false)

const staleSearchAction = createUseCaseAction(
  "LOOP",
  4,
  "wait for search results to load",
  target,
  "mac-helper",
)
const staleSearchResult = await observeAction(
  fakeObserveHelper(staleSearchObservation()),
  {
    ...staleSearchAction,
    input: {
      ...staleSearchAction.input,
      targetState: {
        kind: "search-results-loaded",
        keyword: "周杰伦",
      },
      timeoutMs: 1,
      pollIntervalMs: 1,
    },
  },
  searchResultsObservation(),
)
assert.equal(staleSearchResult.result.status, "failed")

const failedTypeAction = createUseCaseAction(
  "LOOP",
  5,
  "type 周杰伦 into search input",
  target,
  "mac-helper",
)
const observedFailedTypeResult = await observeAfterAction(
  fakeObserveHelper(searchResultsObservation()),
  failedTypeAction,
  {
    value: {
      actionId: failedTypeAction.id,
      ok: false,
      status: "failed",
      adapter: "mac-helper",
      error: {
        code: "ACTION_FAILED",
        message: "Unable to paste text into search element.",
      },
    },
    latencyMs: 1,
    attempts: 1,
  },
  "type",
  staleSearchObservation(),
)
assert.equal(observedFailedTypeResult.result.status, "failed")
assert.equal(
  observedFailedTypeResult.observation?.elements?.some((element) => element.name === "周杰伦"),
  true,
)
assert.equal(
  observedFailedTypeResult.result.metadata?.verification,
  "post-action-observe-after-failed-action",
)

const staleRecovery = extractionRecoveryCandidates(
  "wait for search results to load",
  staleSearchObservation(),
  "Target state was not reached: search-results-loaded ''.",
)
assert.equal(
  staleRecovery.some((candidate) => candidate.description === "click item named 查看你的听歌报告"),
  false,
)

const secondExtract = createUseCaseAction("LOOP", 3, extractDescription, target, "mac-helper")
const secondExtractResult = await chain.execute(secondExtract, albumResultsObservation())
assert.equal(secondExtractResult.result.success, true)
assert.equal(secondExtractResult.usedCapability, "ax-structured-extractor")
assert.deepEqual(secondExtractResult.result.metadata?.result, {
  albumName: "太阳之子",
  releaseDate: "2026-03-25",
  artist: "周杰伦",
})

const fileExtract = createUseCaseAction(
  "LOOP",
  30,
  "extract largest file from visible Downloads file list; compare file sizes and return fileName fileSize",
  target,
  "mac-helper",
)
const fileExtractResult = await chain.execute(fileExtract, downloadsFilesObservation())
assert.equal(fileExtractResult.result.success, true)
assert.equal(fileExtractResult.usedCapability, "ax-structured-extractor")
assert.deepEqual(fileExtractResult.result.metadata?.result, {
  fileName: "dataset.parquet",
  fileSize: "2.4 GB",
})

const helperPath = writeLoopHelper("happy")
const cliRun = spawnCliWithHelper(helperPath, ["usecases", "run", "UC-102"])

assert.equal(cliRun.status, 0, cliRun.stderr || cliRun.stdout)

const cliResult = JSON.parse(cliRun.stdout)
assert.equal(cliResult.ok, true)
assert.equal(cliResult.data.status, "passed")
assert(cliResult.data.steps.at(-1)?.description.includes("extract target goal result"))
assertTargetLoopMetadata(cliResult.data.trace)

const filesHelperPath = writeLoopHelper("files-largest")
const filesCliRun = spawnCliWithHelper(filesHelperPath, ["usecases", "run", "UC-120"])

assert.equal(filesCliRun.status, 0, filesCliRun.stderr || filesCliRun.stdout)

const filesCliResult = JSON.parse(filesCliRun.stdout)
assert.equal(filesCliResult.ok, true)
assert.equal(filesCliResult.data.status, "passed")
assertTargetLoopMetadata(filesCliResult.data.trace)

const filesExtractResult = filesCliResult.data.trace
  .filter((event) => event.kind === "result")
  .map((event) => event.result)
  .find((result) => result?.metadata?.helperMethod === "extract" && result.ok)
const filesExtractedData = JSON.parse(filesExtractResult.metadata.extractedData)
assert.equal(filesExtractedData.fileName, "dataset.parquet")
assert.equal(filesExtractedData.fileSize, "2.4 GB")
assert.equal(filesExtractedData.coverageEvidence.status, "satisfied")
assert.equal(filesExtractedData.coverageEvidence.observedScanAttempts, 2)
filesCliRun.stdout = ""
filesCliResult.data.trace = []

const actionObserveRun = spawnCli(
  ["action", "observe", "--app", "com.fake.MediaApp", "--name", "Fake Media App"],
  {
    macHelper: helperPath,
  },
)

assert.equal(actionObserveRun.status, 0, actionObserveRun.stderr || actionObserveRun.stdout)

const actionObserveResult = JSON.parse(actionObserveRun.stdout)
assert.equal(actionObserveResult.ok, true)
assert.equal(actionObserveResult.data.mode, "native-action")
assert.equal(actionObserveResult.data.status, "passed")
assert.equal(actionObserveResult.data.observation.elements.length > 0, true)
assert.equal(
  actionObserveResult.data.trace.some(
    (event) => event.kind === "action" && event.action?.kind === "observe",
  ),
  true,
)

const actionClickRun = spawnCli([
  "click",
  "--app",
  "Fake Target App",
  "--fake",
  "--keyword",
  "Primary",
  "--description",
  "click button named Primary",
])

assert.equal(actionClickRun.status, 0, actionClickRun.stderr || actionClickRun.stdout)

const actionClickResult = JSON.parse(actionClickRun.stdout)
assert.equal(actionClickResult.ok, true)
assert.equal(actionClickResult.data.mode, "native-action")
assert.equal(actionClickResult.data.status, "passed")
assert.equal(actionClickResult.data.action.kind, "click")
assert.equal(actionClickResult.data.action.element.name, "Primary")
assert(
  actionClickResult.data.trace.some(
    (event) => event.kind === "observation" && event.action?.id.endsWith(":observe-before"),
  ),
)

const extractResult = cliResult.data.trace
  .filter((event) => event.kind === "result")
  .map((event) => event.result)
  .find((result) => result?.metadata?.helperMethod === "extract")

const extractedData = JSON.parse(extractResult.metadata.extractedData)
assert.equal(extractedData.albumName, "太阳之子")
assert.equal(extractedData.releaseDate, "2026-03-25")
assert.equal(extractedData.artist, "周杰伦")
assert.equal(extractedData.sourceEvidence.includes("source=detail"), true)
assert.equal(extractedData.coverageEvidence.status, "satisfied")
assert.equal(extractedData.coverageEvidence.observedScanAttempts, 2)
assert.equal(extractedData.coverageEvidence.viewportChanged, true)
assert.equal(extractedData.coverageEvidence.stopReason, "stable-after-change")

const coverageScans = cliResult.data.trace.filter(
  (event) => event.kind === "action" && event.action?.input?.targetModePhase === "scan-results",
)
assert.deepEqual(
  coverageScans.map((event) => event.action.input.description),
  ["scroll down 5 for result coverage 1", "scroll down 5 for result coverage 2"],
)
assert.equal(coverageScans[0]?.action.input.targetModeIntent.kind, "scroll")
assert.equal(coverageScans[0]?.action.input.targetModeIntent.expect.viewportChange, true)

assert(
  cliResult.data.trace.some(
    (event) =>
      event.kind === "observation" &&
      event.observation?.elements?.some((element) => element.name === "专辑"),
  ),
)
assert(
  cliResult.data.trace.some(
    (event) =>
      event.kind === "action" &&
      event.action?.kind === "click" &&
      event.action?.input?.description === "click item named 太阳之子",
  ),
)
const detailClick = cliResult.data.trace.find(
  (event) =>
    event.kind === "action" &&
    event.action?.kind === "click" &&
    event.action?.input?.description === "click item named 太阳之子",
)
assert.equal(detailClick.action.input.targetModeIntent.kind, "click")
assert.equal(detailClick.action.input.targetModeIntent.expect.detailEvidence, true)
assert.equal(detailClick.action.input.targetModeVerifiedOutcome.actionKind, "scroll")
assert(
  !cliResult.data.trace.some(
    (event) =>
      event.kind === "action" &&
      event.action?.kind === "click" &&
      event.action?.input?.description === "click item named 添加新歌单",
  ),
)
cliRun.stdout = ""
cliResult.data.trace = []

const stuckScrollHelperPath = writeLoopHelper("stuck-scroll")
const stuckScrollCliRun = spawnCliWithHelper(stuckScrollHelperPath, ["usecases", "run", "UC-102"])

assert.equal(stuckScrollCliRun.status, 0, stuckScrollCliRun.stderr || stuckScrollCliRun.stdout)

const stuckScrollCliResult = JSON.parse(stuckScrollCliRun.stdout)
assert.equal(stuckScrollCliResult.ok, true)
assert.equal(stuckScrollCliResult.data.status, "passed")

const stuckScrollScans = stuckScrollCliResult.data.trace.filter(
  (event) => event.kind === "action" && event.action?.input?.targetModePhase === "scan-results",
)
assert.deepEqual(
  stuckScrollScans.map((event) => event.action.input.description),
  [
    "scroll down 5 for result coverage 1",
    "drag by 0, -420 for result coverage 2",
    "scroll down 5 for result coverage 3",
  ],
)
stuckScrollCliRun.stdout = ""
stuckScrollCliResult.data.trace = []

const loadingAfterDragHelperPath = writeLoopHelper("loading-after-drag")
const loadingAfterDragCliRun = spawnCliWithHelper(loadingAfterDragHelperPath, [
  "usecases",
  "run",
  "UC-102",
])

assert.equal(
  loadingAfterDragCliRun.status,
  0,
  loadingAfterDragCliRun.stderr || loadingAfterDragCliRun.stdout,
)

const loadingAfterDragCliResult = JSON.parse(loadingAfterDragCliRun.stdout)
assert.equal(loadingAfterDragCliResult.ok, true)
assert.equal(loadingAfterDragCliResult.data.status, "passed")
const loadingAfterDragResult = loadingAfterDragCliResult.data.trace.find(
  (event) =>
    event.kind === "result" &&
    event.action?.input?.description === "drag by 0, -420 for result coverage 2",
)
assert.equal(loadingAfterDragResult?.result?.metadata?.settleRequired, true)
assert(loadingAfterDragResult?.result?.metadata?.settleAttempts > 0)
loadingAfterDragCliRun.stdout = ""
loadingAfterDragCliResult.data.trace = []

const stalledHelperPath = writeLoopHelper("stalled-tab")
const stalledCliRun = spawnCliWithHelper(stalledHelperPath, ["usecases", "run", "UC-102"])

assert.equal(stalledCliRun.status, 0, stalledCliRun.stderr || stalledCliRun.stdout)

const stalledCliResult = JSON.parse(stalledCliRun.stdout)
assert.equal(stalledCliResult.ok, true)
assert.equal(stalledCliResult.data.status, "passed")

const stalledExtractResult = stalledCliResult.data.trace
  .filter((event) => event.kind === "result")
  .map((event) => event.result)
  .find((result) => result?.metadata?.helperMethod === "extract" && result.ok)

const stalledExtractedData = JSON.parse(stalledExtractResult.metadata.extractedData)
assert.equal(stalledExtractedData.albumName, "太阳之子")
assert.equal(stalledExtractedData.releaseDate, "2026-03-25")
assert.equal(stalledExtractedData.artist, "周杰伦")
assert.equal(stalledExtractedData.sourceEvidence.includes("source=detail"), true)
assert.equal(stalledExtractedData.coverageEvidence.status, "satisfied")
assert.equal(stalledExtractedData.coverageEvidence.observedScanAttempts, 2)
assert.equal(stalledExtractedData.coverageEvidence.viewportChanged, true)
assert.equal(stalledExtractedData.coverageEvidence.stopReason, "stable-after-change")

const unstableUntilMaxHelperPath = writeLoopHelper("unstable-until-max")
const unstableUntilMaxCliRun = spawnCliWithHelper(unstableUntilMaxHelperPath, [
  "usecases",
  "run",
  "UC-102",
])

assert.equal(
  unstableUntilMaxCliRun.status,
  0,
  unstableUntilMaxCliRun.stderr || unstableUntilMaxCliRun.stdout,
)

const unstableUntilMaxCliResult = JSON.parse(unstableUntilMaxCliRun.stdout)
assert.equal(unstableUntilMaxCliResult.ok, true)
assert.equal(unstableUntilMaxCliResult.data.status, "failed")
assert(
  unstableUntilMaxCliResult.data.trace.some(
    (event) =>
      event.kind === "decision" &&
      event.metadata?.reason === "ordered result coverage could not be proven",
  ),
)

const albumTabClicks = stalledCliResult.data.trace.filter(
  (event) =>
    event.kind === "action" &&
    event.action?.kind === "click" &&
    event.action?.input?.description === "click tab named 专辑",
)
assert.equal(albumTabClicks.length, 1)
assert(
  stalledCliResult.data.trace.some(
    (event) =>
      event.kind === "action" &&
      event.action?.kind === "scroll" &&
      event.action?.input?.description === "scroll down 5",
  ),
)
stalledCliRun.stdout = ""
stalledCliResult.data.trace = []

const falseNegativeHelperPath = writeLoopHelper("type-false-negative")
const falseNegativeCliRun = spawnCliWithHelper(falseNegativeHelperPath, [
  "usecases",
  "run",
  "UC-102",
])

assert.equal(
  falseNegativeCliRun.status,
  0,
  falseNegativeCliRun.stderr || falseNegativeCliRun.stdout,
)

const falseNegativeCliResult = JSON.parse(falseNegativeCliRun.stdout)
assert.equal(falseNegativeCliResult.ok, true)
assert.equal(falseNegativeCliResult.data.status, "passed")
assertTargetLoopMetadata(falseNegativeCliResult.data.trace)
assert(
  falseNegativeCliResult.data.trace.some(
    (event) =>
      event.kind === "result" && event.action?.kind === "type" && event.result?.status === "failed",
  ),
)
assert(
  falseNegativeCliResult.data.trace.some(
    (event) => event.kind === "observation" && event.action?.kind === "type",
  ),
)
const submitAfterFalseNegative = falseNegativeCliResult.data.trace.find(
  (event) => event.kind === "action" && event.action?.input?.targetModePhase === "submit-query",
)
assert.equal(submitAfterFalseNegative.action.input.targetModeVerifiedOutcome.actionKind, "type")
assert.equal(submitAfterFalseNegative.action.input.targetModeVerifiedOutcome.actionStatus, "failed")
assert.equal(
  submitAfterFalseNegative.action.input.targetModeVerifiedOutcome.actionReportedFailed,
  true,
)

console.log("computer-use loop regression checks passed")

function assertTargetLoopMetadata(trace) {
  const targetActions = trace.filter(
    (event) => event.kind === "action" && event.action?.input?.targetModeLoop,
  )
  assert(targetActions.length > 0)

  for (const event of targetActions) {
    assert.equal(event.action.input.targetModePlanner, "heuristic-fallback")
    assert.equal(typeof event.action.input.targetModeIntent?.kind, "string")
    if (event.action.kind !== "extract") {
      assert.equal(event.action.input.targetModeObservationBarrier, true)
    }
  }

  const decidedActions = targetActions.filter(
    (event) => event.action.input.targetModeVerifiedOutcome,
  )
  assert(decidedActions.length > 0)
  assert(
    decidedActions.every(
      (event) => typeof event.action.input.targetModeVerifiedOutcome.observationId === "string",
    ),
  )

  const decisions = trace.filter(
    (event) => event.kind === "decision" && event.metadata?.targetModeLoop === true,
  )
  assert(decisions.length > 0)

  for (const actionEvent of decidedActions) {
    const decision = trace
      .filter((event) => event.index < actionEvent.index)
      .findLast(
        (event) =>
          event.kind === "decision" &&
          event.metadata?.nextAction?.description === actionEvent.action.input.description,
      )

    assert(decision, `missing decision event for ${actionEvent.action.input.description}`)
    assert.equal(
      decision.observation?.id,
      actionEvent.action.input.targetModeVerifiedOutcome.observationId,
    )
  }

  const settledResults = trace.filter(
    (event) =>
      event.kind === "result" &&
      event.action?.input?.targetModeObservationBarrier === true &&
      event.action?.kind !== "extract",
  )
  assert(settledResults.length > 0)
  assert(settledResults.every((event) => event.result?.metadata?.settleRequired === true))
  assert(settledResults.every((event) => event.actionTraceStep?.verification.hasAfterObservation))
  assert(
    settledResults.every(
      (event) => event.result?.metadata?.actionTraceStep?.verification?.hasAfterObservation,
    ),
  )
  assert(
    settledResults.every(
      (event) =>
        event.actionTraceStep?.execution.inputBackend?.backend || event.action?.kind === "observe",
    ),
  )
}

function spawnCliWithHelper(helperPath, args) {
  return spawnCli(args, { macHelper: helperPath })
}

function spawnCli(args, options = {}) {
  let result
  for (let attempt = 0; attempt < 5; attempt++) {
    sleepMs(150 + attempt * 250)
    result = spawnCliOnce(args, options)
    if (!shouldRetryCliRun(result)) {
      return result
    }
  }

  sleepMs(3000)
  return spawnCliOnce(args, options)
}

function shouldRetryCliRun(result) {
  const output = `${result.stdout}\n${result.stderr}`
  return output.includes("mac-helper exited with signal SIGKILL") || output.includes("write EPIPE")
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function spawnCliOnce(args, options) {
  const dir = join(tmpdir(), "computer-use-harness")
  mkdirSync(dir, { recursive: true })

  const stdoutPath = join(dir, `validate-loop-${process.pid}-${spawnIndex++}.stdout.json`)
  const stderrPath = join(dir, `validate-loop-${process.pid}-${spawnIndex++}.stderr.log`)
  const command = `${[cliCommand, ...args].map(shellQuote).join(" ")} > ${shellQuote(
    stdoutPath,
  )} 2> ${shellQuote(stderrPath)}`
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      ...(options.macHelper ? { COMPUTER_USE_MAC_HELPER: options.macHelper } : {}),
    },
  })

  const output = {
    ...result,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
  }

  sleepMs(750)
  return output
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function writeLoopHelper(scenario) {
  const dir = join(tmpdir(), "computer-use-harness")
  mkdirSync(dir, { recursive: true })

  const helperPath = join(dir, `computer-use-loop-helper-${scenario}.mjs`)
  writeFileSync(helperPath, helperSource(scenario), "utf8")
  chmodSync(helperPath, 0o755)

  return helperPath
}

function helperSource(scenario) {
  return `#!/usr/bin/env node
import { createInterface } from "node:readline"

const scenario = ${JSON.stringify(scenario)}
let stage = "home"
let query = ""

const lines = createInterface({ input: process.stdin })
lines.on("line", (line) => {
  const request = JSON.parse(line)
  const params = request.params ?? {}
  const action = params.action ?? {}
  const target = action.target ?? params.target ?? {
    kind: "app",
    id: "com.fake.MediaApp",
    name: "Fake Media App",
    platform: "macos",
  }

  if (request.method === "permissionStatus") {
    respond(request.id, {
      accessibility: "granted",
      screenRecording: "granted",
      inputMonitoring: "granted",
    })
    return
  }

  if (request.method === "getAppState") {
    const currentObservation = observation(target)
    respond(request.id, {
      target,
      windows: windows(target),
      observation: currentObservation,
    })
    advanceLoadingStage()
    return
  }

  if (request.method === "screenshot") {
    respond(request.id, {
      format: "png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      width: 1,
      height: 1,
    })
    return
  }

  if (request.method === "type") {
    query = params.text ?? ""
    if (scenario === "type-false-negative") {
      respond(request.id, failed(action.id, "Unable to paste text into search element."))
      return
    }

    respond(request.id, passed(action.id, { text: query }))
    return
  }

  if (request.method === "key") {
    if ((params.key ?? "").toLowerCase().includes("enter") && query) {
      stage = "songs"
    }
    respond(request.id, passed(action.id, { key: params.key ?? "" }))
    return
  }

  if (request.method === "click") {
    if ((action.element?.name ?? "") === "专辑" && scenario !== "stalled-tab") {
      stage = "albums-top"
    }
    if ((action.element?.name ?? "") === "太阳之子") {
      stage = "detail"
    }
    respond(request.id, passed(action.id, { clicked: action.element?.name ?? "" }))
    return
  }

  if (request.method === "scroll") {
    if (scenario === "files-largest" && stage === "home") {
      stage = "files-bottom"
    } else if (scenario === "unstable-until-max" && stage === "albums-top") {
      stage = "albums-middle"
    } else if (scenario === "unstable-until-max" && stage === "albums-middle") {
      stage = "albums-bottom"
    } else if (scenario === "unstable-until-max" && stage === "albums-bottom") {
      stage = "albums-tail"
    } else if (scenario === "stalled-tab" && stage === "songs") {
      stage = "albums-top"
    } else if (
      (scenario === "stuck-scroll" || scenario === "loading-after-drag") &&
      stage === "albums-top"
    ) {
      stage = "albums-top"
    } else if (stage === "albums-top") {
      stage = "albums-bottom"
    }
    respond(request.id, passed(action.id))
    return
  }

  if (request.method === "drag") {
    if (scenario === "files-largest" && stage === "home") {
      stage = "files-bottom"
    } else if (scenario === "unstable-until-max" && stage === "albums-top") {
      stage = "albums-middle"
    } else if (scenario === "unstable-until-max" && stage === "albums-middle") {
      stage = "albums-bottom"
    } else if (scenario === "unstable-until-max" && stage === "albums-bottom") {
      stage = "albums-tail"
    } else if (scenario === "loading-after-drag" && stage === "albums-top") {
      stage = "albums-loading"
    } else if (stage === "albums-top") {
      stage = "albums-bottom"
    }
    respond(request.id, passed(action.id))
    return
  }

  if (request.method === "open") {
    respond(request.id, passed(action.id))
    return
  }

  respond(request.id, passed(action.id))
})

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n")
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

function advanceLoadingStage() {
  if (scenario === "loading-after-drag" && stage === "albums-loading") {
    stage = "albums-bottom"
  }
  if (scenario === "loading-after-drag" && stage === "detail-loading") {
    stage = "detail"
  }
}

function failed(actionId, message) {
  return {
    actionId,
    ok: false,
    status: "failed",
    adapter: "mac-helper",
    error: {
      code: "ACTION_FAILED",
      message,
    },
  }
}

function windows(target) {
  return [
    {
      id: "main",
      appId: target.id,
      title: target.name,
      focused: true,
    },
  ]
}

function observation(target) {
  return {
    id: "fake:" + stage,
    target,
    source: "mac-helper",
    timestamp: new Date().toISOString(),
    elements: elements(target),
    focusedWindow: {
      id: "main",
      appId: target.id,
      title: target.name,
      focused: true,
      bounds: { x: 0, y: 0, width: 1200, height: 900 },
    },
    windows: windows(target),
    coordinateSpace: {
      screenWidth: 1200,
      screenHeight: 900,
      scale: 2,
    },
  }
}

function elements(target) {
  if (scenario === "files-largest" && stage === "files-bottom") {
    return [
      element(target, "heading:downloads", "AXStaticText", "Downloads", 120, 180),
      element(target, "file:video", "AXStaticText", "meeting.mov", 120, 250),
      element(target, "size:video", "AXStaticText", "900 MB", 430, 250),
      element(target, "file:data", "AXStaticText", "dataset.parquet", 120, 320),
      element(target, "size:data", "AXStaticText", "2.4 GB", 430, 320),
      element(target, "file:archive", "AXStaticText", "archive.zip", 120, 390),
      element(target, "size:archive", "AXStaticText", "1.1 GB", 430, 390),
    ]
  }

  if (scenario === "files-largest") {
    return [
      element(target, "heading:downloads", "AXStaticText", "Downloads", 120, 180),
      element(target, "file:readme", "AXStaticText", "readme.txt", 120, 250),
      element(target, "size:readme", "AXStaticText", "12 KB", 430, 250),
      element(target, "file:photo", "AXStaticText", "photo.png", 120, 320),
      element(target, "size:photo", "AXStaticText", "5 MB", 430, 320),
      element(target, "file:video", "AXStaticText", "meeting.mov", 120, 390),
      element(target, "size:video", "AXStaticText", "900 MB", 430, 390),
    ]
  }

  const search = element(target, "search", "AXTextField", "搜索", 120, 120, 360, 32)
  if (stage === "albums-top") {
    return [
      search,
      element(target, "sidebar:add", "AXButton", "添加新歌单", 24, 250, 80, 28, "按钮"),
      element(target, "tab:songs", "AXUnknown", "歌曲", 120, 180, 120, 28, "按钮"),
      element(target, "tab:albums", "AXUnknown", "专辑", 210, 180, 120, 28, "按钮"),
      element(target, "album:old", "AXStaticText", "最伟大的作品", 120, 250),
      element(target, "artist:old", "AXStaticText", "周杰伦", 320, 250),
      element(target, "date:old", "AXStaticText", "2022-07-15", 430, 250),
      element(target, "album:bedtime", "AXStaticText", "周杰伦的床边故事", 120, 320),
      element(target, "artist:bedtime", "AXStaticText", "周杰伦", 320, 320),
      element(target, "date:bedtime", "AXStaticText", "2016-06-24", 430, 320),
      element(target, "album:other", "AXStaticText", "别人的新专辑", 120, 390),
      element(target, "artist:other", "AXStaticText", "其他歌手", 320, 390),
      element(target, "date:other", "AXStaticText", "2027-01-01", 430, 390),
    ]
  }

  if (stage === "albums-bottom") {
    return [
      search,
      element(target, "sidebar:add", "AXButton", "添加新歌单", 24, 320, 80, 28, "按钮"),
      element(target, "tab:songs", "AXUnknown", "歌曲", 120, 180, 120, 28, "按钮"),
      element(target, "tab:albums", "AXUnknown", "专辑", 210, 180, 120, 28, "按钮"),
      element(target, "album:old", "AXStaticText", "最伟大的作品", 120, 250),
      element(target, "artist:old", "AXStaticText", "周杰伦", 320, 250),
      element(target, "date:old", "AXStaticText", "2022-07-15", 430, 250),
      element(target, "album:new", "AXStaticText", "太阳之子", 120, 320),
      element(target, "artist:new", "AXStaticText", "周杰伦", 320, 320),
      element(target, "date:new", "AXStaticText", "2026-03-25", 430, 320),
      element(target, "album:other", "AXStaticText", "别人的新专辑", 120, 390),
      element(target, "artist:other", "AXStaticText", "其他歌手", 320, 390),
      element(target, "date:other", "AXStaticText", "2027-01-01", 430, 390),
    ]
  }

  if (stage === "albums-middle") {
    return [
      search,
      element(target, "sidebar:add", "AXButton", "添加新歌单", 24, 290, 80, 28, "按钮"),
      element(target, "tab:songs", "AXUnknown", "歌曲", 120, 180, 120, 28, "按钮"),
      element(target, "tab:albums", "AXUnknown", "专辑", 210, 180, 120, 28, "按钮"),
      element(target, "album:old", "AXStaticText", "最伟大的作品", 120, 230),
      element(target, "artist:old", "AXStaticText", "周杰伦", 320, 230),
      element(target, "date:old", "AXStaticText", "2022-07-15", 430, 230),
      element(target, "album:bedtime", "AXStaticText", "周杰伦的床边故事", 120, 300),
      element(target, "artist:bedtime", "AXStaticText", "周杰伦", 320, 300),
      element(target, "date:bedtime", "AXStaticText", "2016-06-24", 430, 300),
      element(target, "album:opus12", "AXStaticText", "十二新作", 120, 370),
      element(target, "artist:opus12", "AXStaticText", "周杰伦", 320, 370),
      element(target, "date:opus12", "AXStaticText", "2012-12-28", 430, 370),
    ]
  }

  if (stage === "albums-tail") {
    return [
      search,
      element(target, "sidebar:add", "AXButton", "添加新歌单", 24, 350, 80, 28, "按钮"),
      element(target, "tab:songs", "AXUnknown", "歌曲", 120, 180, 120, 28, "按钮"),
      element(target, "tab:albums", "AXUnknown", "专辑", 210, 180, 120, 28, "按钮"),
      element(target, "album:new", "AXStaticText", "太阳之子", 120, 260),
      element(target, "artist:new", "AXStaticText", "周杰伦", 320, 260),
      element(target, "date:new", "AXStaticText", "2026-03-25", 430, 260),
      element(target, "album:old", "AXStaticText", "最伟大的作品", 120, 330),
      element(target, "artist:old", "AXStaticText", "周杰伦", 320, 330),
      element(target, "date:old", "AXStaticText", "2022-07-15", 430, 330),
      element(target, "album:other", "AXStaticText", "别人的新专辑", 120, 400),
      element(target, "artist:other", "AXStaticText", "其他歌手", 320, 400),
      element(target, "date:other", "AXStaticText", "2027-01-01", 430, 400),
    ]
  }

  if (stage === "albums-loading") {
    return [
      search,
      element(target, "loading:cover", "AXGroup", "加载中", 120, 250, 240, 180),
      element(target, "loading:list", "AXGroup", "加载占位", 120, 470, 760, 240),
    ]
  }

  if (stage === "detail") {
    return [
      search,
      element(target, "tab:albums", "AXUnknown", "专辑", 210, 180, 120, 28, "按钮"),
      element(target, "album:title", "AXStaticText", "太阳之子", 120, 250, 240, 36),
      element(target, "album:artist", "AXStaticText", "歌手：周杰伦", 120, 310, 240, 28),
      element(target, "album:date", "AXStaticText", "发行日期：2026-03-25", 120, 350, 260, 28),
      element(target, "album:tracks", "AXStaticText", "曲目数：13 首", 120, 390, 220, 28),
    ]
  }

  if (stage === "detail-loading") {
    return [
      search,
      element(target, "loading:cover", "AXGroup", "加载中", 120, 250, 240, 180),
      element(target, "loading:list", "AXGroup", "加载占位", 120, 470, 760, 240),
    ]
  }

  if (stage === "songs") {
    return [
      search,
      element(target, "tab:songs", "AXUnknown", "歌曲", 120, 180, 120, 28, "按钮"),
      element(target, "tab:albums", "AXUnknown", "专辑", 210, 180, 120, 28, "按钮"),
      element(target, "column:album", "AXUnknown", "专辑", 430, 210, 120, 28, "文本"),
      element(target, "song:noise", "AXRow", "晴天", 120, 250),
      element(target, "artist:jay", "AXStaticText", "周杰伦", 320, 250),
    ]
  }

  return [search, element(target, "home:label", "AXStaticText", "QQ音乐", 120, 180)]
}

function element(target, id, role, name, x, y, width = 120, height = 28, roleDescription) {
  return {
    id,
    source: "mac-helper",
    target,
    role,
    name,
    metadata: {
      frame: { x, y, width, height },
      ...(roleDescription ? { roleDescription } : {}),
    },
  }
}
`
}

function searchResultsObservation() {
  return observation([
    element("tab:songs", "AXUnknown", "歌曲", 120, 180, "按钮"),
    element("tab:albums", "AXUnknown", "专辑", 210, 180, "按钮"),
    element("column:album", "AXUnknown", "专辑", 430, 210, "文本"),
    element("row:noise", "AXRow", "晴天", 120, 250),
    element("artist:jay", "AXStaticText", "周杰伦", 320, 250),
  ])
}

function staticColumnObservation() {
  return observation([
    element("column:album", "AXUnknown", "专辑", 430, 210, "文本"),
    element("row:noise", "AXRow", "晴天", 120, 250),
    element("artist:jay", "AXStaticText", "周杰伦", 320, 250),
  ])
}

function staleSearchObservation() {
  return observation([
    element("search", "AXTextField", "搜索", 120, 120),
    element("report", "AXLink", "查看你的听歌报告", 700, 180, "链接"),
    element("song:stale", "AXUnknown", "歌曲名：鸭子 - 歌手名：苏慧伦", 120, 250, "文本"),
  ])
}

function albumResultsObservation() {
  return observation([
    element("tab:albums", "AXUnknown", "专辑", 210, 180, "按钮"),
    element("album:old", "AXStaticText", "最伟大的作品", 120, 250),
    element("artist:old", "AXStaticText", "周杰伦", 320, 250),
    element("date:old", "AXStaticText", "2022-07-15", 430, 250),
    element("album:new", "AXStaticText", "太阳之子", 120, 320),
    element("artist:new", "AXStaticText", "周杰伦", 320, 320),
    element("date:new", "AXStaticText", "2026-03-25", 430, 320),
    element("album:other", "AXStaticText", "别人的新专辑", 120, 390),
    element("artist:other", "AXStaticText", "其他歌手", 320, 390),
    element("date:other", "AXStaticText", "2027-01-01", 430, 390),
  ])
}

function albumNamesOnlyObservation() {
  return observation([
    element("artist:jay", "AXStaticText", "周杰伦", 320, 250),
    element("album:magic", "AXStaticText", "魔杰座", 430, 250),
    element("album:sun", "AXStaticText", "太阳之子", 430, 320),
    element("album:bedtime", "AXStaticText", "周杰伦的床边故事", 430, 390),
  ])
}

function downloadsFilesObservation() {
  return observation([
    element("heading:downloads", "AXStaticText", "Downloads", 120, 180),
    element("file:readme", "AXStaticText", "readme.txt", 120, 250),
    element("size:readme", "AXStaticText", "12 KB", 430, 250),
    element("file:video", "AXStaticText", "meeting.mov", 120, 320),
    element("size:video", "AXStaticText", "900 MB", 430, 320),
    element("file:data", "AXStaticText", "dataset.parquet", 120, 390),
    element("size:data", "AXStaticText", "2.4 GB", 430, 390),
  ])
}

function observation(elements) {
  return {
    id: "fake:observation",
    target,
    source: "mac-helper",
    timestamp: new Date().toISOString(),
    elements,
    coordinateSpace: {
      screenWidth: 1200,
      screenHeight: 900,
      scale: 2,
    },
  }
}

function element(id, role, name, x, y, roleDescription) {
  return {
    id,
    source: "mac-helper",
    target,
    role,
    name,
    metadata: {
      frame: {
        x,
        y,
        width: 120,
        height: 28,
      },
      ...(roleDescription ? { roleDescription } : {}),
    },
  }
}

function fakeObserveHelper(observation) {
  return {
    async getAppState() {
      return {
        target,
        windows: [],
        observation,
      }
    },
  }
}
