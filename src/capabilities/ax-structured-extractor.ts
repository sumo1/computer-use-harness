import type { AccessibilityNode, Action, Observation } from "../core/contracts.js"
import {
  extractionContractFromAction,
  missingRequiredFields,
  normalizeFieldName,
} from "../core/extraction-contract.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

interface TextEntry {
  role: string
  text: string
  x?: number
  y?: number
}

interface RecordCandidate {
  name: string
  artist?: string
  releaseDate: string
  score: number
}

const DATE_PATTERN = /\b(\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)\b/

/**
 * Extract simple date-ranked records from accessibility text before falling back to vision.
 *
 * This is intentionally generic: it does not know QQ Music. It looks for visible date-like
 * values, nearby title/artist text, and optional constraints expressed in the action query.
 */
export class AXStructuredExtractor implements Capability {
  readonly name = "ax-structured-extractor"

  canHandle(action: Action, _observation: Observation, _hints?: SemanticHints): boolean {
    return action.kind === "extract"
  }

  async execute(
    action: Action,
    observation: Observation,
    _hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const query = stringInput(action, "query", "")
    const description = stringInput(action, "description", "")
    const taskText = `${description}\n${query}`
    const entries = visibleTextEntries(observation)
    const candidates = dateRankedCandidates(entries, taskText)
    const contract = extractionContractFromAction(action)

    if (candidates.length === 0) {
      return {
        success: false,
        reason: "No date-ranked accessibility records matched the extraction constraints.",
      }
    }

    const best = candidates[0]
    const result = recordResult(best, contract.requiredFields)
    const missing = missingRequiredFields(result, contract)
    if (missing.length > 0) {
      return {
        success: false,
        reason: `Date-ranked accessibility record was missing required fields: ${missing.join(", ")}.`,
        metadata: {
          source: "accessibility-date-ranked-records",
          candidates: candidates.slice(0, 5),
          missingFields: missing,
        },
      }
    }

    return {
      success: true,
      metadata: {
        source: "accessibility-date-ranked-records",
        result,
        candidates: candidates.slice(0, 5),
      },
    }
  }
}

function recordResult(
  candidate: RecordCandidate,
  requiredFields: string[],
): Record<string, string> {
  if (requiredFields.length === 0) {
    return {
      name: candidate.name,
      releaseDate: candidate.releaseDate,
      ...(candidate.artist ? { artist: candidate.artist } : {}),
    }
  }

  const result: Record<string, string> = {}

  for (const field of requiredFields) {
    const value = candidateValueForField(candidate, field)
    if (value) {
      result[field] = value
    }
  }

  return result
}

function candidateValueForField(candidate: RecordCandidate, field: string): string | undefined {
  const normalized = normalizeFieldName(field)

  if (
    normalized === "name" ||
    normalized === "title" ||
    normalized.includes("albumname") ||
    normalized === "专辑名"
  ) {
    return candidate.name
  }

  if (normalized.includes("date") || normalized.includes("time") || normalized.includes("发行")) {
    return candidate.releaseDate
  }

  if (normalized.includes("artist") || normalized.includes("歌手") || normalized.includes("艺人")) {
    return candidate.artist
  }

  return undefined
}

function dateRankedCandidates(entries: TextEntry[], taskText: string): RecordCandidate[] {
  const requestedArtist = requestedArtistConstraint(taskText)
  const dateEntries = entries.filter((entry) => DATE_PATTERN.test(entry.text))

  return dateEntries
    .map((dateEntry) => recordNearDate(dateEntry, entries, requestedArtist))
    .filter((candidate): candidate is RecordCandidate => candidate !== undefined)
    .sort((left, right) => {
      const dateDelta =
        Date.parse(normalizeDate(right.releaseDate)) - Date.parse(normalizeDate(left.releaseDate))
      return dateDelta !== 0 ? dateDelta : right.score - left.score
    })
}

function recordNearDate(
  dateEntry: TextEntry,
  entries: TextEntry[],
  requestedArtist: string | undefined,
): RecordCandidate | undefined {
  const releaseDate = normalizeDate(dateEntry.text.match(DATE_PATTERN)?.[1] ?? "")
  if (!releaseDate) {
    return undefined
  }

  const neighbors = nearbyEntries(dateEntry, entries)
  const artist = requestedArtist
    ? neighbors.find((entry) => normalize(entry.text).includes(normalize(requestedArtist)))?.text
    : likelyArtist(neighbors)

  if (requestedArtist && !artist) {
    return undefined
  }

  const name = likelyTitle(neighbors, dateEntry, artist)
  if (!name) {
    return undefined
  }

  return {
    name,
    artist: artist ?? requestedArtist,
    releaseDate,
    score: (artist ? 40 : 0) + (hasCoordinates(dateEntry) ? 10 : 0),
  }
}

function nearbyEntries(anchor: TextEntry, entries: TextEntry[]): TextEntry[] {
  if (anchor.y === undefined) {
    return entries.filter((entry) => entry !== anchor).slice(0, 20)
  }

  const anchorY = anchor.y
  const sameRow = entries.filter(
    (entry) => entry !== anchor && entry.y !== undefined && Math.abs(entry.y - anchorY) <= 36,
  )
  const nearby =
    sameRow.length > 0
      ? sameRow
      : entries.filter(
          (entry) => entry !== anchor && entry.y !== undefined && Math.abs(entry.y - anchorY) <= 72,
        )

  return nearby.sort(
    (left, right) =>
      Math.abs((left.x ?? 0) - (anchor.x ?? 0)) - Math.abs((right.x ?? 0) - (anchor.x ?? 0)),
  )
}

function likelyTitle(
  entries: TextEntry[],
  dateEntry: TextEntry,
  artist: string | undefined,
): string | undefined {
  const ignored = new Set(
    [dateEntry.text, artist].filter((value): value is string => Boolean(value)),
  )

  return entries
    .map((entry) => entry.text.trim())
    .filter((text) => text && !ignored.has(text))
    .filter((text) => !DATE_PATTERN.test(text))
    .filter((text) => !isChromeOrControlText(text))
    .sort((left, right) => titleScore(right) - titleScore(left))[0]
}

function likelyArtist(entries: TextEntry[]): string | undefined {
  return entries
    .map((entry) => entry.text.trim())
    .filter((text) => text && !DATE_PATTERN.test(text))
    .filter((text) => !isChromeOrControlText(text))
    .find((text) => text.length <= 40)
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

function requestedArtistConstraint(taskText: string): string | undefined {
  const explicit = taskText.match(/artist\s+is\s+([^\s,，.;；]+)/i)?.[1]
  if (explicit) {
    return explicit.trim()
  }

  const chinese = taskText.match(/(?:歌手|艺人)(?:是|为|:|：)\s*([^\s,，.;；]+)/)?.[1]
  return chinese?.trim()
}

function visibleTextEntries(observation: Observation): TextEntry[] {
  const entries: TextEntry[] = []

  for (const element of observation.elements) {
    if (!element.name || !isVisibleFrame(element.metadata?.frame, observation)) {
      continue
    }

    entries.push({
      role: element.role ?? "unknown",
      text: element.name,
      ...entryPosition(element.metadata?.frame),
    })
  }

  for (const root of observation.accessibilityTree ?? []) {
    collectAccessibilityText(root, observation, entries)
  }

  return uniqueEntries(entries)
}

function collectAccessibilityText(
  node: AccessibilityNode,
  observation: Observation,
  entries: TextEntry[],
): void {
  for (const text of [node.name, node.value, node.description]) {
    if (text && isVisibleFrame(node.bounds, observation)) {
      entries.push({
        role: node.role,
        text,
        ...entryPosition(node.bounds),
      })
    }
  }

  for (const child of node.children ?? []) {
    collectAccessibilityText(child, observation, entries)
  }
}

function uniqueEntries(entries: TextEntry[]): TextEntry[] {
  const seen = new Set<string>()

  return entries.filter((entry) => {
    const key = [entry.role, entry.text, entry.x ?? "", entry.y ?? ""].join("|")
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function normalizeDate(value: string): string {
  const match = value.match(/(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?/)
  if (!match?.[1] || !match[2]) {
    return ""
  }

  const month = match[2].padStart(2, "0")
  const day = (match[3] ?? "1").padStart(2, "0")
  return `${match[1]}-${month}-${day}`
}

function entryPosition(frame: unknown): Pick<TextEntry, "x" | "y"> {
  if (!isRecord(frame)) {
    return {}
  }

  return {
    ...(typeof frame.x === "number" ? { x: frame.x } : {}),
    ...(typeof frame.y === "number" ? { y: frame.y } : {}),
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

function isChromeOrControlText(value: string): boolean {
  return [
    "关闭",
    "最小化",
    "全屏",
    "搜索",
    "播放",
    "暂停播放",
    "上一首",
    "下一首",
    "更多操作",
    "close",
    "minimize",
    "fullscreen",
    "search",
    "play",
  ].includes(normalize(value))
}

function hasCoordinates(entry: TextEntry): boolean {
  return entry.x !== undefined && entry.y !== undefined
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
