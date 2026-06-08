#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AXElementFinder,
  AXStructuredExtractor,
  CapabilityChain,
  CoordinateClicker,
} from "../dist/capabilities/index.js"
import { createUseCaseAction } from "../dist/usecases/action-plan.js"
import { observeAction } from "../dist/usecases/action-verification.js"
import { extractionRecoveryCandidates } from "../dist/usecases/recovery-plan.js"

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

const helperPath = writeLoopHelper("happy")
const cliRun = spawnSync(
  process.execPath,
  ["dist/cli/index.js", "usecases", "run", "UC-102", "--mac-helper", helperPath, "--pretty"],
  {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
    },
  },
)

assert.equal(cliRun.status, 0, cliRun.stderr || cliRun.stdout)

const cliResult = JSON.parse(cliRun.stdout)
assert.equal(cliResult.ok, true)
assert.equal(cliResult.data.status, "passed")
assert(cliResult.data.steps.at(-1)?.description.includes("extract latest"))

const extractResult = cliResult.data.trace
  .filter((event) => event.kind === "result")
  .map((event) => event.result)
  .find((result) => result?.metadata?.helperMethod === "extract")

assert.deepEqual(JSON.parse(extractResult.metadata.extractedData), {
  albumName: "太阳之子",
  releaseDate: "2026-03-25",
  artist: "周杰伦",
})

assert(
  cliResult.data.trace.some(
    (event) =>
      event.kind === "observation" &&
      event.observation?.elements?.some((element) => element.name === "专辑"),
  ),
)

const stalledHelperPath = writeLoopHelper("stalled-tab")
const stalledCliRun = spawnSync(
  process.execPath,
  ["dist/cli/index.js", "usecases", "run", "UC-102", "--mac-helper", stalledHelperPath, "--pretty"],
  {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
    },
  },
)

assert.equal(stalledCliRun.status, 0, stalledCliRun.stderr || stalledCliRun.stdout)

const stalledCliResult = JSON.parse(stalledCliRun.stdout)
assert.equal(stalledCliResult.ok, true)
assert.equal(stalledCliResult.data.status, "passed")

const stalledExtractResult = stalledCliResult.data.trace
  .filter((event) => event.kind === "result")
  .map((event) => event.result)
  .find((result) => result?.metadata?.helperMethod === "extract" && result.ok)

assert.deepEqual(JSON.parse(stalledExtractResult.metadata.extractedData), {
  albumName: "太阳之子",
  releaseDate: "2026-03-25",
  artist: "周杰伦",
})

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

console.log("computer-use loop regression checks passed")

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
    respond(request.id, {
      target,
      windows: windows(target),
      observation: observation(target),
    })
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
      stage = "albums"
    }
    respond(request.id, passed(action.id, { clicked: action.element?.name ?? "" }))
    return
  }

  if (request.method === "scroll") {
    if (scenario === "stalled-tab" && stage === "songs") {
      stage = "albums"
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
  const search = element(target, "search", "AXTextField", "搜索", 120, 120, 360, 32)
  if (stage === "albums") {
    return [
      search,
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
