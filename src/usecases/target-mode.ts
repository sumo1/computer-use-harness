import type {
  Action,
  ActionResult,
  ElementRef,
  JsonObject,
  Observation,
} from "../core/contracts.js"
import { normalizeFieldName } from "../core/extraction-contract.js"
import type { UseCaseGoal } from "./types.js"

export interface TargetModePlannedStep {
  description: string
  element?: ElementRef
  input?: JsonObject
}

export interface TargetModeRuntimeState {
  iterations: number
  triedDescriptions: Set<string>
  openedCandidateKeys: Set<string>
  candidates: Map<string, EntityCandidate>
  visibleCandidateKeys: Set<string>
  progress: TargetModeProgress
  coverage: TargetModeCoverageState
  reverseScrollAttempts: number
}

export interface TargetModeProgress {
  queryEntered: boolean
  querySubmitted: boolean
  resultContextObserved: boolean
}

export interface TargetModeCoverageState {
  lastViewportSignature?: string
  observations: number
  scanAttempts: number
  observedScanAttempts: number
  stableObservations: number
  viewportChanged: boolean
  signatures: Set<string>
}

export interface EntityCandidate {
  key: string
  fields: Record<string, string>
  title?: string
  artist?: string
  releaseDate?: string
  source: "list" | "detail"
  confidence: number
  missingFields: string[]
  element?: ElementRef
}

export interface TargetModeDecision {
  status: "continue" | "complete" | "failed"
  reason: string
  step?: TargetModePlannedStep
  evidence: EntityCandidate[]
}

interface VisibleEntry {
  element: ElementRef
  text: string
  role: string
  x?: number
  y?: number
  width?: number
  height?: number
}

interface EntryRegion {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

const DATE_PATTERN = /\b(\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)\b/
const DEFAULT_MAX_ITERATIONS = 12
const GENERIC_NAVIGATION_STEPS = ["scroll down 5", "press key PageDown"]
const DEFAULT_MAX_SCAN_ATTEMPTS = 3
const DEFAULT_MIN_COVERAGE_OBSERVATIONS = 2
const DEFAULT_STABLE_OBSERVATIONS = 1

export function createTargetModeState(): TargetModeRuntimeState {
  return {
    iterations: 0,
    triedDescriptions: new Set(),
    openedCandidateKeys: new Set(),
    candidates: new Map(),
    visibleCandidateKeys: new Set(),
    progress: {
      queryEntered: false,
      querySubmitted: false,
      resultContextObserved: false,
    },
    coverage: {
      observations: 0,
      scanAttempts: 0,
      observedScanAttempts: 0,
      stableObservations: 0,
      viewportChanged: false,
      signatures: new Set(),
    },
    reverseScrollAttempts: 0,
  }
}

export function targetModeInitialSteps(goal: UseCaseGoal): TargetModePlannedStep[] {
  return [
    { description: "open app" },
    {
      description: "read app state for target goal",
      input: { targetMode: true, targetModePhase: "observe-initial" },
    },
  ]
}

export function recordTargetModeProgress(
  goal: UseCaseGoal,
  action: Action,
  result: ActionResult,
  observation: Observation,
  state: TargetModeRuntimeState,
): void {
  const phase = stringInput(action, "targetModePhase")

  if (phase === "enter-query" && (result.status !== "failed" || queryVisible(goal, observation))) {
    state.progress.queryEntered = true
  }

  if (phase === "submit-query" && result.status !== "failed") {
    state.progress.querySubmitted = true
  }

  if (
    (phase === "submit-query" || phase === "observe-results" || phase === "switch-semantic-tab") &&
    result.status !== "failed" &&
    hasResultContext(goal, observation)
  ) {
    state.progress.queryEntered = true
    state.progress.querySubmitted = true
    state.progress.resultContextObserved = true
  }
}

export function decideTargetMode(
  goal: UseCaseGoal,
  observation: Observation,
  state: TargetModeRuntimeState,
): TargetModeDecision {
  state.iterations += 1

  const visibleEvidence = rankedCandidates(goal, observation)
  const preparationStep = contextPreparationStep(goal, observation, state)
  if (preparationStep) {
    return continueDecision(
      preparationStep,
      [],
      "target context is not ready for evidence extraction",
    )
  }

  rememberEvidence(goal, observation, state, visibleEvidence)
  const evidence = mergedEvidence(goal, state, visibleEvidence)
  const coverageSettleStep = coverageSettlingStep(goal, state, visibleEvidence)
  if (coverageSettleStep) {
    return continueDecision(
      coverageSettleStep,
      evidence,
      "latest coverage scan has not produced observable target evidence yet",
    )
  }

  const completeDetail = evidence.find(
    (candidate) => candidate.source === "detail" && candidate.missingFields.length === 0,
  )
  if (completeDetail) {
    const coverageStep = coverageExplorationStep(goal, state, visibleEvidence)
    if (coverageStep) {
      return continueDecision(
        coverageStep,
        evidence,
        "detail evidence is complete but ordered result coverage is not proven yet",
      )
    }
    if (requiresCoverage(goal) && !isCoverageSatisfied(goal, state)) {
      return failedDecision(goal, evidence, "ordered result coverage could not be proven")
    }

    return completeDecision(
      goal,
      completeDetail,
      evidence,
      state,
      "detail evidence satisfies target goal",
    )
  }

  const completeList = evidence.find((candidate) => candidate.missingFields.length === 0)
  if (completeList) {
    const coverageStep = coverageExplorationStep(goal, state, visibleEvidence)
    if (coverageStep) {
      return continueDecision(
        coverageStep,
        evidence,
        "current evidence is complete but ordered result coverage is not proven yet",
      )
    }
    if (requiresCoverage(goal) && !isCoverageSatisfied(goal, state)) {
      return failedDecision(goal, evidence, "ordered result coverage could not be proven")
    }

    const needsDetail = (goal.confirmation ?? "list") === "detail"
    if (needsDetail && state.openedCandidateKeys.has(completeList.key)) {
      const detailStep = detailConfirmationExplorationStep(state)
      if (detailStep) {
        return continueDecision(
          detailStep,
          evidence,
          "candidate was opened; wait for detail evidence instead of reusing list evidence",
        )
      }
    }

    const visibleCandidate = visibleEvidence.find((candidate) => candidate.key === completeList.key)
    if (
      needsDetail &&
      !visibleCandidate?.element &&
      state.coverage.scanAttempts > 0 &&
      state.reverseScrollAttempts < state.coverage.scanAttempts
    ) {
      state.reverseScrollAttempts += 1
      return continueDecision(
        {
          description: `scroll up 5 to revisit selected result ${state.reverseScrollAttempts}`,
          input: {
            targetMode: true,
            targetModePhase: "revisit-selected-result",
            targetModeReason: "best candidate was found during coverage scan but is not visible",
          },
        },
        evidence,
        "return to the best candidate after list coverage scan",
      )
    }

    const candidateToOpen = visibleCandidate ?? completeList
    if (
      needsDetail &&
      candidateToOpen.element &&
      !state.openedCandidateKeys.has(candidateToOpen.key)
    ) {
      state.openedCandidateKeys.add(candidateToOpen.key)
      return continueDecision(
        {
          description: `click item named ${candidateLabel(candidateToOpen)}`,
          element: candidateToOpen.element,
          input: {
            targetMode: true,
            targetModePhase: "confirm-candidate-detail",
            targetModeReason: "candidate has required fields; opening detail page for confirmation",
            targetModeCandidate: candidateToJson(candidateToOpen),
          },
        },
        evidence,
        "open newest candidate detail before final extraction",
      )
    }

    return completeDecision(
      goal,
      completeList,
      evidence,
      state,
      "list evidence satisfies target goal",
    )
  }

  const semanticTabStep = semanticTabNavigationStep(goal, observation, state)
  if (semanticTabStep) {
    return continueDecision(
      semanticTabStep,
      evidence,
      "switch to the semantic result tab required by the goal",
    )
  }

  const explorationStep = genericExplorationStep(state)
  if (explorationStep) {
    return continueDecision(
      explorationStep,
      evidence,
      "visible evidence is incomplete; explore more result content",
    )
  }

  if (state.iterations >= (goal.maxIterations ?? DEFAULT_MAX_ITERATIONS)) {
    return {
      status: "failed",
      reason: `target mode exhausted ${state.iterations} iterations without complete evidence`,
      step: failedExtractionStep(goal, evidence),
      evidence,
    }
  }

  return {
    status: "failed",
    reason: "target mode found no useful navigation or extraction path",
    step: failedExtractionStep(goal, evidence),
    evidence,
  }
}

function completeDecision(
  goal: UseCaseGoal,
  candidate: EntityCandidate,
  evidence: EntityCandidate[],
  state: TargetModeRuntimeState,
  reason: string,
): TargetModeDecision {
  const payload = candidatePayload(goal, candidate, state)

  return {
    status: "complete",
    reason,
    step: {
      description: extractionDescription(goal),
      input: {
        targetMode: true,
        targetModePhase: "complete",
        targetModeReason: reason,
        extractionFields: goal.requiredFields,
        extractedData: JSON.stringify(payload),
        targetModeEvidence: evidence.map(candidateToJson),
      },
    },
    evidence,
  }
}

function continueDecision(
  step: TargetModePlannedStep,
  evidence: EntityCandidate[],
  reason: string,
): TargetModeDecision {
  return {
    status: "continue",
    reason,
    step,
    evidence,
  }
}

function failedDecision(
  goal: UseCaseGoal,
  evidence: EntityCandidate[],
  reason: string,
): TargetModeDecision {
  return {
    status: "failed",
    reason,
    step: failedExtractionStep(goal, evidence),
    evidence,
  }
}

function contextPreparationStep(
  goal: UseCaseGoal,
  observation: Observation,
  state: TargetModeRuntimeState,
): TargetModePlannedStep | undefined {
  if (hasResultContext(goal, observation)) {
    state.progress.queryEntered = true
    state.progress.querySubmitted = true
    state.progress.resultContextObserved = true
    return undefined
  }

  if (!state.progress.queryEntered) {
    const description = `type ${goal.query} into search input`
    if (!rememberTriedDescription(state, description)) {
      return {
        description,
        input: {
          targetMode: true,
          targetModePhase: "enter-query",
          targetModeReason: "goal query must be present before collecting target evidence",
        },
      }
    }
  }

  if (!state.progress.querySubmitted) {
    const description = "press key Enter in search input wait for state change timeout 5s"
    if (!rememberTriedDescription(state, description)) {
      return {
        description,
        input: {
          targetMode: true,
          targetModePhase: "submit-query",
          targetModeReason: "goal query must be submitted before collecting target evidence",
        },
      }
    }
  }

  if (!state.progress.resultContextObserved) {
    const description = "wait for search results to load"
    if (!rememberTriedDescription(state, description)) {
      return {
        description,
        input: {
          targetMode: true,
          targetModePhase: "observe-results",
          targetModeReason: "target evidence must come from the current query result context",
        },
      }
    }
  }

  return undefined
}

function failedExtractionStep(
  goal: UseCaseGoal,
  evidence: EntityCandidate[],
): TargetModePlannedStep {
  return {
    description: extractionDescription(goal),
    input: {
      targetMode: true,
      targetModePhase: "failed",
      targetModeTerminal: true,
      extractionFields: goal.requiredFields,
      capabilityFailure: "Target mode did not collect complete evidence for the goal.",
      capabilityMetadata: {
        evidence: evidence.map(candidateToJson),
      },
    },
  }
}

function semanticTabNavigationStep(
  goal: UseCaseGoal,
  observation: Observation,
  state: TargetModeRuntimeState,
): TargetModePlannedStep | undefined {
  const labels = goal.navigation?.semanticTabs ?? []
  if (labels.length === 0) {
    return undefined
  }

  if (hasCandidateShape(observation)) {
    return undefined
  }

  const tabEntry = labels
    .map((label) => ({
      label,
      entry: visibleTabLabelEntry(observation, label),
    }))
    .find((candidate) => candidate.entry)
  if (!tabEntry) {
    return undefined
  }

  const description = `click tab named ${tabEntry.label}`
  if (rememberTriedDescription(state, description)) {
    return undefined
  }

  return {
    description,
    element: tabEntry.entry?.element,
    input: {
      targetMode: true,
      targetModePhase: "switch-semantic-tab",
      targetModeReason: `goal entity '${goal.entity}' requires semantic result content`,
    },
  }
}

function genericExplorationStep(state: TargetModeRuntimeState): TargetModePlannedStep | undefined {
  for (const description of GENERIC_NAVIGATION_STEPS) {
    if (!rememberTriedDescription(state, description)) {
      return {
        description,
        input: {
          targetMode: true,
          targetModePhase: "explore-results",
          targetModeReason: "required fields are not visible yet",
        },
      }
    }
  }

  return undefined
}

function detailConfirmationExplorationStep(
  state: TargetModeRuntimeState,
): TargetModePlannedStep | undefined {
  for (const description of ["wait for detail page to load", "press key PageDown"]) {
    if (!rememberTriedDescription(state, description)) {
      return {
        description,
        input: {
          targetMode: true,
          targetModePhase: "confirm-detail-evidence",
          targetModeReason: "detail confirmation is required but detail fields are not visible yet",
        },
      }
    }
  }

  return undefined
}

function rememberTriedDescription(state: TargetModeRuntimeState, description: string): boolean {
  const key = normalizeDescription(description)
  if (state.triedDescriptions.has(key)) {
    return true
  }

  state.triedDescriptions.add(key)
  return false
}

function rememberEvidence(
  goal: UseCaseGoal,
  observation: Observation,
  state: TargetModeRuntimeState,
  visibleEvidence: EntityCandidate[],
): void {
  state.visibleCandidateKeys = new Set(visibleEvidence.map((candidate) => candidate.key))

  for (const candidate of visibleEvidence) {
    const existing = state.candidates.get(candidate.key)
    if (!existing || candidate.confidence >= existing.confidence || candidate.element) {
      state.candidates.set(candidate.key, candidate)
    }
  }

  const coverageEvidence = coverageVisibleEvidence(visibleEvidence)
  if (!requiresCoverage(goal) || coverageEvidence.length === 0) {
    return
  }

  state.coverage.observations += 1
  const signature = viewportSignature(observation, coverageEvidence)
  const previousSignature = state.coverage.lastViewportSignature

  if (signature) {
    state.coverage.signatures.add(signature)
  }

  if (signature && previousSignature && signature !== previousSignature) {
    state.coverage.viewportChanged = true
  }

  if (signature && signature === previousSignature) {
    state.coverage.stableObservations += 1
  } else {
    state.coverage.stableObservations = 0
  }

  if (state.coverage.scanAttempts > state.coverage.observedScanAttempts) {
    state.coverage.observedScanAttempts = state.coverage.scanAttempts
  }
  state.coverage.lastViewportSignature = signature
}

function mergedEvidence(
  goal: UseCaseGoal,
  state: TargetModeRuntimeState,
  visibleEvidence: EntityCandidate[],
): EntityCandidate[] {
  const candidates = new Map(state.candidates)
  for (const candidate of visibleEvidence) {
    candidates.set(candidate.key, candidate)
  }

  return Array.from(candidates.values())
    .map((candidate) => ({
      ...candidate,
      missingFields: missingFields(goal, candidate),
    }))
    .filter((candidate) => matchesConstraints(goal, candidate))
    .sort((left, right) => compareCandidates(goal, left, right))
}

function coverageExplorationStep(
  goal: UseCaseGoal,
  state: TargetModeRuntimeState,
  visibleEvidence: EntityCandidate[],
): TargetModePlannedStep | undefined {
  const coverage = goal.coverage
  if (!requiresCoverage(goal) || coverage?.strategy !== "scroll-until-stable") {
    return undefined
  }
  if (visibleEvidence.length === 0) {
    return undefined
  }
  if (isCoverageSatisfied(goal, state)) {
    return undefined
  }

  const coverageEvidence = coverageVisibleEvidence(visibleEvidence)
  if (coverageEvidence.length === 0) {
    return undefined
  }

  const maxScans = maxCoverageScans(goal)
  if (state.coverage.scanAttempts >= maxScans) {
    return undefined
  }

  const nextScanAttempt = state.coverage.scanAttempts + 1
  const description = coverageScanDescription(state, nextScanAttempt)
  const anchor = scrollAnchorElement(coverageEvidence)
  state.coverage.scanAttempts = nextScanAttempt

  return {
    description,
    element: anchor,
    input: {
      targetMode: true,
      targetModePhase: "scan-results",
      targetModeReason: "ordered goal requires more visible result coverage before selection",
      targetModeScanAttempt: nextScanAttempt,
      ...(anchor ? { targetModeScrollAnchor: anchor.name ?? anchor.id } : {}),
    },
  }
}

function coverageSettlingStep(
  goal: UseCaseGoal,
  state: TargetModeRuntimeState,
  visibleEvidence: EntityCandidate[],
): TargetModePlannedStep | undefined {
  if (!requiresCoverage(goal) || coverageVisibleEvidence(visibleEvidence).length > 0) {
    return undefined
  }
  if (state.coverage.scanAttempts <= state.coverage.observedScanAttempts) {
    return undefined
  }

  const description = `wait for result coverage scan ${state.coverage.scanAttempts} to settle`
  if (rememberTriedDescription(state, description)) {
    return undefined
  }

  return {
    description,
    input: {
      targetMode: true,
      targetModePhase: "settle-scan-results",
      targetModeReason: "coverage scan changed the page, but target evidence is not observable yet",
      targetModeScanAttempt: state.coverage.scanAttempts,
    },
  }
}

function requiresCoverage(goal: UseCaseGoal): boolean {
  return Boolean(goal.orderBy && goal.coverage?.strategy === "scroll-until-stable")
}

function isCoverageSatisfied(goal: UseCaseGoal, state: TargetModeRuntimeState): boolean {
  const minObservations = minCoverageObservations(goal)
  const stableObservations = stableCoverageObservations(goal)

  if (state.coverage.observations < minObservations) {
    return false
  }
  if (state.coverage.observedScanAttempts === 0) {
    return false
  }
  if (state.coverage.observedScanAttempts < state.coverage.scanAttempts) {
    return false
  }

  return state.coverage.viewportChanged && state.coverage.stableObservations >= stableObservations
}

function coverageVisibleEvidence(visibleEvidence: EntityCandidate[]): EntityCandidate[] {
  return visibleEvidence.filter((candidate) => candidate.source === "list")
}

function maxCoverageScans(goal: UseCaseGoal): number {
  return goal.coverage?.maxScans ?? goal.coverage?.maxScrolls ?? DEFAULT_MAX_SCAN_ATTEMPTS
}

function minCoverageObservations(goal: UseCaseGoal): number {
  return goal.coverage?.minObservations ?? DEFAULT_MIN_COVERAGE_OBSERVATIONS
}

function stableCoverageObservations(goal: UseCaseGoal): number {
  return goal.coverage?.stableObservations ?? DEFAULT_STABLE_OBSERVATIONS
}

function coverageScanDescription(state: TargetModeRuntimeState, nextScanAttempt: number): string {
  if (state.coverage.scanAttempts > 0 && !state.coverage.viewportChanged) {
    return `drag by 0, -420 for result coverage ${nextScanAttempt}`
  }

  return `scroll down 5 for result coverage ${nextScanAttempt}`
}

function scrollAnchorElement(visibleEvidence: EntityCandidate[]): ElementRef | undefined {
  return visibleEvidence
    .filter((candidate) => candidate.source === "list" && candidate.element)
    .filter((candidate) => candidate.confidence >= 0.7)
    .sort(
      (left, right) =>
        candidateElementY(right) - candidateElementY(left) || right.confidence - left.confidence,
    )[0]?.element
}

function candidateElementY(candidate: EntityCandidate): number {
  const frame = candidate.element?.metadata?.frame
  return isRecord(frame) && typeof frame.y === "number" ? frame.y : 0
}

function viewportSignature(observation: Observation, visibleEvidence: EntityCandidate[]): string {
  const candidateSignature = visibleEvidence
    .filter((candidate) => candidate.source === "list")
    .map((candidate) => {
      const frame = candidate.element?.metadata?.frame
      const y = isRecord(frame) && typeof frame.y === "number" ? Math.round(frame.y) : ""
      return `${candidate.key}@${y}`
    })
    .join("|")

  if (candidateSignature) {
    return candidateSignature.slice(0, 1000)
  }

  return visibleEntries(observation)
    .map((entry) => entry.text.trim())
    .filter((text) => text && !isChromeOrControlText(text))
    .join("|")
    .slice(0, 1000)
}

function rankedCandidates(goal: UseCaseGoal, observation: Observation): EntityCandidate[] {
  return [...detailCandidates(goal, observation), ...listCandidates(goal, observation)]
    .map((candidate) => ({
      ...candidate,
      missingFields: missingFields(goal, candidate),
    }))
    .filter((candidate) => matchesConstraints(goal, candidate))
    .sort((left, right) => compareCandidates(goal, left, right))
}

function listCandidates(goal: UseCaseGoal, observation: Observation): EntityCandidate[] {
  const entries = visibleEntries(observation)
  const resultEntries = entriesInResultRegion(goal, entries, observation)
  const dateEntries = resultEntries.filter((entry) => DATE_PATTERN.test(entry.text))
  const candidates: EntityCandidate[] = []

  for (const dateEntry of dateEntries) {
    const releaseDate = normalizeDate(dateEntry.text.match(DATE_PATTERN)?.[1] ?? "")
    const inlineCandidate = inlineCandidateFromEntry(goal, dateEntry, releaseDate)
    if (inlineCandidate) {
      candidates.push(inlineCandidate)
    }

    const cardCandidate = cardCandidateFromDateEntry(goal, dateEntry, resultEntries, releaseDate)
    if (cardCandidate) {
      candidates.push(cardCandidate)
    }

    const neighbors = nearbyEntries(dateEntry, resultEntries)
    const artist = artistFromEntries(goal, neighbors)
    const titleEntry = titleEntryFromRow(neighbors, dateEntry, artist)
    if (!releaseDate || !titleEntry) {
      continue
    }

    candidates.push({
      key: candidateKey("list", titleEntry.text, artist, releaseDate),
      fields: candidateFields(titleEntry.text, artist, releaseDate),
      title: titleEntry.text,
      artist,
      releaseDate,
      source: "list",
      confidence: (artist ? 0.7 : 0.45) + (titleEntry.element ? 0.1 : 0),
      missingFields: [],
      element: titleEntry.element,
    })
  }

  return candidates
}

function detailCandidates(goal: UseCaseGoal, observation: Observation): EntityCandidate[] {
  const entries = visibleEntries(observation)
  const resultEntries = entriesInResultRegion(goal, entries, observation)
  const detailSignal = hasDetailSignal(entries)
  const releaseDateEntry =
    resultEntries.find((entry) => isReleaseDateText(entry.text)) ??
    (detailSignal ? resultEntries.find((entry) => DATE_PATTERN.test(entry.text)) : undefined)
  const dateEntry = releaseDateEntry
  const releaseDate = normalizeDate(dateEntry?.text.match(DATE_PATTERN)?.[1] ?? "")
  const artist =
    detailFieldValue(resultEntries, ["歌手", "artist"]) ?? artistFromEntries(goal, resultEntries)
  const stackedCandidate = dateEntry
    ? cardCandidateFromDateEntry(goal, dateEntry, resultEntries, releaseDate)
    : undefined
  const titleEntry = stackedCandidate
    ? { text: stackedCandidate.title ?? "", element: stackedCandidate.element }
    : detailTitleEntry(resultEntries, artist, dateEntry)
  const candidateArtist = stackedCandidate?.artist ?? artist

  if (!releaseDate || !titleEntry?.text || !detailSignal) {
    return []
  }

  return [
    {
      key: candidateKey("detail", titleEntry.text, candidateArtist, releaseDate),
      fields: candidateFields(titleEntry.text, candidateArtist, releaseDate),
      title: titleEntry.text,
      artist: candidateArtist,
      releaseDate,
      source: "detail",
      confidence: 0.95,
      missingFields: [],
      element: titleEntry.element,
    },
  ]
}

function visibleEntries(observation: Observation): VisibleEntry[] {
  return observation.elements
    .filter((element) => element.name && isVisibleFrame(element.metadata?.frame, observation))
    .map((element) => ({
      element,
      text: element.name ?? "",
      role: elementSemanticRole(element),
      ...entryPosition(element.metadata?.frame),
    }))
    .sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0))
}

function entriesInResultRegion(
  goal: UseCaseGoal,
  entries: VisibleEntry[],
  observation: Observation,
): VisibleEntry[] {
  const region = resultContentRegion(goal, entries, observation)
  if (!region) {
    return entries
  }

  const resultEntries = entries.filter((entry) => isEntryInRegion(entry, region))

  return resultEntries.length > 0 ? resultEntries : entries
}

function resultContentRegion(
  goal: UseCaseGoal,
  entries: VisibleEntry[],
  observation: Observation,
): EntryRegion | undefined {
  const tabRow = semanticTabRow(goal, entries)
  const heading = searchResultHeadingEntry(goal, entries)
  if (!tabRow && !heading) {
    return undefined
  }

  const leftEdges = [tabRow?.left, heading?.x].filter(isNumber)
  const topEdges = [tabRow?.top, heading?.y].filter(isNumber)
  const screenWidth = observation.coordinateSpace?.screenWidth
  const screenHeight = observation.coordinateSpace?.screenHeight

  return {
    ...(leftEdges.length > 0 ? { left: Math.max(0, Math.min(...leftEdges) - 32) } : {}),
    ...(topEdges.length > 0 ? { top: Math.max(0, Math.min(...topEdges) - 16) } : {}),
    ...(typeof screenWidth === "number" ? { right: screenWidth } : {}),
    ...(typeof screenHeight === "number" ? { bottom: screenHeight } : {}),
  }
}

function semanticTabRow(
  goal: UseCaseGoal,
  entries: VisibleEntry[],
): (EntryRegion & { count: number }) | undefined {
  const configuredLabels = new Set((goal.navigation?.semanticTabs ?? []).map(normalize))
  const candidates = entries
    .filter((entry) => entry.x !== undefined && entry.y !== undefined)
    .filter((entry) => configuredLabels.has(normalize(entry.text)) || isKnownTabLabel(entry.text))

  const rows = candidates
    .map((entry) => {
      const rowEntries = candidates.filter(
        (candidate) =>
          candidate.y !== undefined &&
          entry.y !== undefined &&
          Math.abs(candidate.y - entry.y) <= 24,
      )
      const configuredHit = rowEntries.some((candidate) =>
        configuredLabels.has(normalize(candidate.text)),
      )

      return {
        count: rowEntries.length,
        configuredHit,
        left: Math.min(...rowEntries.map((candidate) => candidate.x).filter(isNumber)),
        top: Math.min(...rowEntries.map((candidate) => candidate.y).filter(isNumber)),
      }
    })
    .filter((row) => row.configuredHit)
    .filter((row) => isNumber(row.left) && isNumber(row.top))
    .sort((left, right) => {
      const configuredDelta = Number(right.configuredHit) - Number(left.configuredHit)
      return configuredDelta || right.count - left.count || (left.top ?? 0) - (right.top ?? 0)
    })

  return rows[0]
}

function searchResultHeadingEntry(
  goal: UseCaseGoal,
  entries: VisibleEntry[],
): VisibleEntry | undefined {
  const query = normalize(goal.query)

  return entries.find((entry) => {
    const text = normalize(entry.text)
    return (
      text === `搜索 ${query}` ||
      text === `search ${query}` ||
      (text.includes(query) && (text.startsWith("搜索") || text.startsWith("search")))
    )
  })
}

function isEntryInRegion(entry: VisibleEntry, region: EntryRegion): boolean {
  const left = region.left
  const top = region.top
  const right = region.right
  const bottom = region.bottom

  if (entry.x !== undefined) {
    const entryRight = entry.x + (entry.width ?? 0)
    if (left !== undefined && entryRight < left) {
      return false
    }
    if (right !== undefined && entry.x > right) {
      return false
    }
  }

  if (entry.y !== undefined) {
    const entryBottom = entry.y + (entry.height ?? 0)
    if (top !== undefined && entryBottom < top) {
      return false
    }
    if (bottom !== undefined && entry.y > bottom) {
      return false
    }
  }

  return true
}

function nearbyEntries(anchor: VisibleEntry, entries: VisibleEntry[]): VisibleEntry[] {
  if (anchor.y === undefined) {
    return entries.filter((entry) => entry !== anchor).slice(0, 20)
  }

  const anchorY = anchor.y
  return entries
    .filter(
      (entry) => entry !== anchor && entry.y !== undefined && Math.abs(entry.y - anchorY) <= 36,
    )
    .sort(
      (left, right) =>
        Math.abs((left.x ?? 0) - (anchor.x ?? 0)) - Math.abs((right.x ?? 0) - (anchor.x ?? 0)),
    )
}

function artistFromEntries(goal: UseCaseGoal, entries: VisibleEntry[]): string | undefined {
  const requestedArtist = constraintValue(goal, "artist")
  if (requestedArtist) {
    return entries.find((entry) => normalize(entry.text).includes(normalize(requestedArtist)))?.text
  }

  return entries
    .map((entry) => entry.text.trim())
    .filter((text) => text && !DATE_PATTERN.test(text))
    .filter((text) => !isChromeOrControlText(text))
    .filter((text) => !isKnownTabLabel(text))
    .find((text) => text.length <= 40)
}

function titleEntryFromRow(
  entries: VisibleEntry[],
  dateEntry: VisibleEntry,
  artist: string | undefined,
): VisibleEntry | undefined {
  const ignored = new Set(
    [dateEntry.text, artist].filter((value): value is string => Boolean(value)),
  )

  return entries
    .filter((entry) => !ignored.has(entry.text))
    .filter(isCandidateTextEntry)
    .sort((left, right) => titleScore(right.text) - titleScore(left.text))[0]
}

function detailTitleEntry(
  entries: VisibleEntry[],
  artist: string | undefined,
  dateEntry: VisibleEntry | undefined,
): VisibleEntry | undefined {
  const ignored = new Set(
    [artist, dateEntry?.text].filter((value): value is string => Boolean(value)),
  )
  const detailY = dateEntry?.y

  return entries
    .filter((entry) => !ignored.has(entry.text))
    .filter((entry) => !entry.text.includes(":") && !entry.text.includes("："))
    .filter(isCandidateTextEntry)
    .filter((entry) => (detailY === undefined || entry.y === undefined ? true : entry.y <= detailY))
    .sort((left, right) => detailTitleScore(right) - detailTitleScore(left))[0]
}

function detailTitleScore(entry: VisibleEntry): number {
  let score = titleScore(entry.text)
  if (entry.y !== undefined) {
    score += Math.max(0, 1000 - entry.y) / 100
  }
  if (entry.role.includes("heading") || entry.role.includes("statictext")) {
    score += 5
  }
  return score
}

function detailFieldValue(entries: VisibleEntry[], labels: string[]): string | undefined {
  const normalizedLabels = labels.map(normalize)

  for (const entry of entries) {
    const text = entry.text.trim()
    const normalizedText = normalize(text)
    const label = normalizedLabels.find((candidate) => normalizedText.includes(candidate))
    if (!label) {
      continue
    }

    const match = text.match(/[:：]\s*(.+)$/)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return undefined
}

function candidatePayload(
  goal: UseCaseGoal,
  candidate: EntityCandidate,
  state: TargetModeRuntimeState,
): JsonObject {
  const payload: JsonObject = {}
  const coverage = coverageEvidence(goal, state)

  for (const field of goal.requiredFields) {
    const value = candidateValue(candidate, field)
    if (value) {
      payload[field] = value
    }
  }

  payload.sourceEvidence = [
    `source=${candidate.source}`,
    candidate.title ? `title=${candidate.title}` : undefined,
    candidate.artist ? `artist=${candidate.artist}` : undefined,
    candidate.releaseDate ? `releaseDate=${candidate.releaseDate}` : undefined,
    coverage ? `coverage=${coverageSummary(coverage)}` : undefined,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("; ")

  if (coverage) {
    payload.coverageEvidence = coverage
  }

  return payload
}

function coverageEvidence(
  goal: UseCaseGoal,
  state: TargetModeRuntimeState,
): JsonObject | undefined {
  if (!requiresCoverage(goal)) {
    return undefined
  }

  const stopReason = coverageStopReason(goal, state)

  return {
    strategy: goal.coverage?.strategy ?? "visible",
    status: isCoverageSatisfied(goal, state) ? "satisfied" : "insufficient",
    stopReason,
    observations: state.coverage.observations,
    scanAttempts: state.coverage.scanAttempts,
    observedScanAttempts: state.coverage.observedScanAttempts,
    stableObservations: state.coverage.stableObservations,
    viewportChanged: state.coverage.viewportChanged,
    uniqueViewports: state.coverage.signatures.size,
    maxScans: maxCoverageScans(goal),
  }
}

function coverageStopReason(goal: UseCaseGoal, state: TargetModeRuntimeState): string {
  if (state.coverage.observedScanAttempts === 0) {
    return "not-started"
  }

  if (state.coverage.observedScanAttempts < state.coverage.scanAttempts) {
    return "pending-observation"
  }

  if (
    state.coverage.viewportChanged &&
    state.coverage.stableObservations >= stableCoverageObservations(goal)
  ) {
    return "stable-after-change"
  }

  if (state.coverage.scanAttempts >= maxCoverageScans(goal)) {
    return state.coverage.viewportChanged
      ? "max-scans-without-stability"
      : "max-scans-without-change"
  }

  if (!state.coverage.viewportChanged) {
    return "waiting-for-viewport-change"
  }

  return "insufficient"
}

function coverageSummary(coverage: JsonObject): string {
  return [
    coverage.strategy,
    coverage.status,
    coverage.stopReason,
    `scans=${coverage.scanAttempts}`,
    `observed=${coverage.observedScanAttempts}`,
    `changed=${coverage.viewportChanged}`,
    `viewports=${coverage.uniqueViewports}`,
  ].join("/")
}

function candidateFields(
  title: string | undefined,
  artist: string | undefined,
  releaseDate: string | undefined,
): Record<string, string> {
  return Object.fromEntries(
    [
      ["title", title],
      ["name", title],
      ["albumName", title],
      ["artist", artist],
      ["releaseDate", releaseDate],
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
  )
}

function candidateValue(candidate: EntityCandidate, field: string): string | undefined {
  const normalized = normalizeFieldName(field)
  const explicit = Object.entries(candidate.fields).find(
    ([key]) => normalizeFieldName(key) === normalized,
  )?.[1]
  if (explicit) {
    return explicit
  }

  if (
    normalized === "name" ||
    normalized === "title" ||
    normalized.includes("albumname") ||
    normalized === "专辑名"
  ) {
    return candidate.title
  }

  if (normalized.includes("artist") || normalized.includes("歌手") || normalized.includes("艺人")) {
    return candidate.artist
  }

  if (normalized.includes("date") || normalized.includes("time") || normalized.includes("发行")) {
    return candidate.releaseDate
  }

  return undefined
}

function missingFields(goal: UseCaseGoal, candidate: EntityCandidate): string[] {
  return goal.requiredFields.filter((field) => !candidateValue(candidate, field))
}

function matchesConstraints(goal: UseCaseGoal, candidate: EntityCandidate): boolean {
  const artist = constraintValue(goal, "artist")
  if (artist && !normalize(candidate.artist).includes(normalize(artist))) {
    return false
  }

  return true
}

function compareCandidates(
  goal: UseCaseGoal,
  left: EntityCandidate,
  right: EntityCandidate,
): number {
  const field = normalizeFieldName(goal.orderBy?.field ?? "releaseDate")
  const direction = goal.orderBy?.direction ?? "desc"
  let delta = right.confidence - left.confidence

  if (field.includes("date") || field.includes("time") || field.includes("发行")) {
    delta =
      Date.parse(right.releaseDate ?? "") - Date.parse(left.releaseDate ?? "") ||
      right.confidence - left.confidence
  }

  return direction === "desc" ? delta : -delta
}

function visibleTabLabelEntry(observation: Observation, label: string): VisibleEntry | undefined {
  const normalizedLabel = normalize(label)
  const entries = visibleEntries(observation).filter((entry) => {
    const name = normalize(entry.text)
    return name === normalizedLabel || name === `${normalizedLabel}s`
  })

  const controlEntry = entries.find((entry) => isTabControlRole(entry.role))
  if (controlEntry) {
    return controlEntry
  }

  return entries
    .filter(isScreenshotOcrEntry)
    .filter((entry) => hasKnownTabRowPeers(entry, visibleEntries(observation)))
    .sort(
      (left, right) => (left.y ?? Number.MAX_SAFE_INTEGER) - (right.y ?? Number.MAX_SAFE_INTEGER),
    )[0]
}

function hasResultContext(goal: UseCaseGoal, observation: Observation): boolean {
  const entries = visibleEntries(observation)

  return (
    queryVisible(goal, observation) &&
    (hasSearchResultHeading(goal, entries) ||
      (hasConfiguredSemanticTab(goal, entries) && hasSemanticNavigationRow(entries)))
  )
}

function queryVisible(goal: UseCaseGoal, observation: Observation): boolean {
  const query = normalize(goal.query)
  if (!query) {
    return false
  }

  return observation.elements
    .filter((element) => isVisibleFrame(element.metadata?.frame, observation))
    .some((element) => elementTextValues(element).some((text) => normalize(text).includes(query)))
}

function elementTextValues(element: ElementRef): string[] {
  const metadata = element.metadata ?? {}

  return [
    element.name,
    stringMetadata(metadata.value),
    stringMetadata(metadata.title),
    stringMetadata(metadata.description),
    stringMetadata(metadata.placeholder),
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "")
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function hasSemanticNavigationRow(entries: VisibleEntry[]): boolean {
  const tabEntries = entries.filter((entry) => isKnownTabLabel(entry.text))
  if (tabEntries.length < 2) {
    return false
  }

  return tabEntries.some((entry) => {
    if (entry.y === undefined) {
      return tabEntries.length >= 3
    }

    const rowY = entry.y
    return (
      tabEntries.filter(
        (candidate) => candidate.y !== undefined && Math.abs(candidate.y - rowY) <= 32,
      ).length >= 2
    )
  })
}

function hasSearchResultHeading(goal: UseCaseGoal, entries: VisibleEntry[]): boolean {
  const query = normalize(goal.query)

  return entries.some((entry) => {
    const text = normalize(entry.text)
    return (
      text === `搜索 ${query}` ||
      text === `search ${query}` ||
      (text.includes(query) && (text.startsWith("搜索") || text.startsWith("search")))
    )
  })
}

function hasConfiguredSemanticTab(goal: UseCaseGoal, entries: VisibleEntry[]): boolean {
  const labels = goal.navigation?.semanticTabs ?? []
  if (labels.length === 0) {
    return false
  }

  const normalizedLabels = new Set(labels.map(normalize))
  return entries.some((entry) => normalizedLabels.has(normalize(entry.text)))
}

function hasKnownTabRowPeers(entry: VisibleEntry, entries: VisibleEntry[]): boolean {
  const rowY = entry.y
  if (rowY === undefined) {
    return false
  }

  const peerCount = entries.filter(
    (candidate) =>
      candidate !== entry &&
      candidate.y !== undefined &&
      Math.abs(candidate.y - rowY) <= 24 &&
      isScreenshotOcrEntry(candidate) &&
      isKnownTabLabel(candidate.text),
  ).length

  return peerCount >= 2
}

function hasCandidateShape(observation: Observation): boolean {
  const entries = visibleEntries(observation)
  return entries.some((entry) => DATE_PATTERN.test(entry.text)) && entries.length >= 3
}

function hasDetailSignal(entries: VisibleEntry[]): boolean {
  return entries.some((entry) => isReleaseDateText(entry.text) || isDetailMetricText(entry.text))
}

function isDetailMetricText(value: string): boolean {
  const normalized = normalize(value)
  return (
    /^(曲目数?|tracks?)\s*[:：]/i.test(value.trim()) ||
    /^歌曲\s*\d+$/i.test(value.trim()) ||
    normalized === "曲目" ||
    normalized === "曲目数" ||
    normalized === "专辑信息" ||
    normalized.includes("立即购买") ||
    normalized.includes("播放全部") ||
    normalized === "tracks"
  )
}

function isReleaseDateText(value: string): boolean {
  const normalized = normalize(value)
  return DATE_PATTERN.test(value) && (normalized.includes("发行") || normalized.includes("release"))
}

function constraintValue(goal: UseCaseGoal, field: string): string | undefined {
  const normalizedField = normalizeFieldName(field)

  return Object.entries(goal.constraints ?? {}).find(
    ([key]) => normalizeFieldName(key) === normalizedField,
  )?.[1]
}

function extractionDescription(goal: UseCaseGoal): string {
  return `extract target goal result and return ${goal.requiredFields.join(" ")}`
}

function candidateToJson(candidate: EntityCandidate): JsonObject {
  return {
    key: candidate.key,
    source: candidate.source,
    confidence: candidate.confidence,
    missingFields: candidate.missingFields,
    fields: candidate.fields,
    ...(candidate.title ? { title: candidate.title } : {}),
    ...(candidate.artist ? { artist: candidate.artist } : {}),
    ...(candidate.releaseDate ? { releaseDate: candidate.releaseDate } : {}),
  }
}

function candidateLabel(candidate: EntityCandidate): string {
  return candidate.title ?? candidate.fields.title ?? candidate.fields.name ?? candidate.key
}

function candidateKey(
  source: EntityCandidate["source"],
  title: string | undefined,
  artist: string | undefined,
  releaseDate: string | undefined,
): string {
  return [source, title ?? "", artist ?? "", releaseDate ?? ""].map(normalize).join("|")
}

function normalizeDate(value: string): string {
  const match = value.match(DATE_PATTERN)?.[1]
  if (!match) {
    return ""
  }

  const parts = match.match(/\d+/g)
  if (!parts || parts.length < 2) {
    return ""
  }

  const [year, month, day = "1"] = parts
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ")
}

function stringInput(action: Action, key: string): string | undefined {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function titleScore(text: string): number {
  let score = 0
  if (text.length > 1 && text.length <= 80) {
    score += 20
  }
  if (/[\u4e00-\u9fa5A-Za-z0-9]/.test(text)) {
    score += 10
  }
  if (text.includes("：") || text.includes(":")) {
    score -= 10
  }
  return score
}

function isCandidateTextEntry(entry: VisibleEntry): boolean {
  const text = entry.text.trim()
  return (
    titleScore(text) > 0 &&
    !DATE_PATTERN.test(text) &&
    !isChromeOrControlText(text) &&
    !isKnownTabLabel(text)
  )
}

function isKnownTabLabel(value: string): boolean {
  const normalized = normalize(value)
  return [
    "歌曲",
    "专辑",
    "歌手",
    "歌单",
    "视频",
    "songs",
    "song",
    "albums",
    "album",
    "artists",
    "artist",
    "playlists",
    "playlist",
    "videos",
    "video",
  ].includes(normalized)
}

function isChromeOrControlText(value: string): boolean {
  const normalized = normalize(value)
  return (
    normalized.length <= 1 ||
    normalized.startsWith("搜索 ") ||
    normalized.startsWith("search ") ||
    [
      "搜索",
      "qq音乐",
      "关闭",
      "最小化",
      "全屏",
      "更多",
      "播放",
      "暂停播放",
      "search",
      "close",
      "minimize",
      "fullscreen",
      "more",
      "play",
    ].includes(normalized)
  )
}

function inlineCandidateFromEntry(
  goal: UseCaseGoal,
  entry: VisibleEntry,
  releaseDate: string,
): EntityCandidate | undefined {
  if (!releaseDate) {
    return undefined
  }

  const requestedArtist = constraintValue(goal, "artist")
  if (requestedArtist && !normalize(entry.text).includes(normalize(requestedArtist))) {
    return undefined
  }

  const artist = requestedArtist ?? artistFromEntries(goal, [entry])
  const title = inlineTitle(entry.text, artist)
  if (!title) {
    return undefined
  }

  return {
    key: candidateKey("list", title, artist, releaseDate),
    fields: candidateFields(title, artist, releaseDate),
    title,
    artist,
    releaseDate,
    source: "list",
    confidence: 0.72,
    missingFields: [],
    element: entry.element,
  }
}

function cardCandidateFromDateEntry(
  goal: UseCaseGoal,
  dateEntry: VisibleEntry,
  entries: VisibleEntry[],
  releaseDate: string,
): EntityCandidate | undefined {
  if (!releaseDate || dateEntry.x === undefined || dateEntry.y === undefined) {
    return undefined
  }

  const dateX = dateEntry.x
  const dateY = dateEntry.y
  const requestedArtist = constraintValue(goal, "artist")
  const columnEntries = entries.filter((entry) => {
    if (entry === dateEntry || entry.x === undefined || entry.y === undefined) {
      return false
    }

    return Math.abs(entry.x - dateX) <= 120 && entry.y <= dateY && dateY - entry.y <= 96
  })
  const artistEntry = requestedArtist
    ? columnEntries.find((entry) => normalize(entry.text).includes(normalize(requestedArtist)))
    : undefined
  const artistY = artistEntry?.y
  if (requestedArtist && !artistEntry) {
    return undefined
  }

  const titleEntry = columnEntries
    .filter((entry) => entry !== artistEntry)
    .filter(isCandidateTextEntry)
    .filter((entry) => (artistY === undefined || entry.y === undefined ? true : entry.y < artistY))
    .sort((left, right) => (right.y ?? 0) - (left.y ?? 0))[0]
  if (!titleEntry) {
    return undefined
  }

  const artist = requestedArtist ?? artistEntry?.text

  return {
    key: candidateKey("list", titleEntry.text, artist, releaseDate),
    fields: candidateFields(titleEntry.text, artist, releaseDate),
    title: titleEntry.text,
    artist,
    releaseDate,
    source: "list",
    confidence: 0.82,
    missingFields: [],
    element: titleEntry.element,
  }
}

function inlineTitle(text: string, artist: string | undefined): string | undefined {
  let title = text.replace(DATE_PATTERN, " ")
  if (artist) {
    title = title.replace(new RegExp(escapeRegExp(artist), "g"), " ")
  }

  title = title
    .replace(/(?:专辑|album|歌手|artist|发行日期|release\s*date)\s*[:：]?/gi, " ")
    .replace(/[|｜,，;；·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return titleScore(title) > 0 && !isChromeOrControlText(title) ? title : undefined
}

function isScreenshotOcrEntry(entry: VisibleEntry): boolean {
  return (
    entry.element.metadata?.source === "screenshot-ocr" || normalize(entry.role).includes("ocr")
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function elementSemanticRole(element: ElementRef): string {
  return [
    element.role,
    element.metadata?.roleDescription,
    element.metadata?.subrole,
    element.metadata?.axIdentifier,
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ")
}

function isTabControlRole(role: string): boolean {
  return (
    role.includes("tab") ||
    role.includes("button") ||
    role.includes("按钮") ||
    role.includes("radio") ||
    role.includes("segmented") ||
    role.includes("toggle") ||
    role.includes("标签")
  )
}

function entryPosition(frame: unknown): Pick<VisibleEntry, "x" | "y" | "width" | "height"> {
  if (!isRecord(frame)) {
    return {}
  }

  return {
    ...(typeof frame.x === "number" ? { x: frame.x } : {}),
    ...(typeof frame.y === "number" ? { y: frame.y } : {}),
    ...(typeof frame.width === "number" ? { width: frame.width } : {}),
    ...(typeof frame.height === "number" ? { height: frame.height } : {}),
  }
}

function isVisibleFrame(frame: unknown, observation: Observation): boolean {
  if (!isRecord(frame)) {
    return true
  }

  const x = typeof frame.x === "number" ? frame.x : 0
  const y = typeof frame.y === "number" ? frame.y : 0
  const width = typeof frame.width === "number" ? frame.width : 0
  const height = typeof frame.height === "number" ? frame.height : 0
  const screenWidth = observation.coordinateSpace?.screenWidth
  const screenHeight = observation.coordinateSpace?.screenHeight

  if (width <= 0 || height <= 0) {
    return false
  }

  if (typeof screenWidth === "number" && typeof screenHeight === "number") {
    return x + width > 0 && y + height > 0 && x < screenWidth && y < screenHeight
  }

  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
