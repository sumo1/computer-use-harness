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

interface RankingValue {
  field: string
  raw: string
  value: string
  type: "date" | "file-size" | "number"
  numeric: number
}

interface RecordCandidate {
  label: string
  fields: Record<string, string>
  ranking: RankingValue
  evidenceText: string[]
  score: number
}

const DATE_PATTERN = /\b(\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)\b/
const FILE_SIZE_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(bytes?|b|kb|kib|mb|mib|gb|gib|tb|tib|字节|千字节|兆字节|吉字节)\b/i
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/

/**
 * Extract ordered records from AX text before falling back to screenshot vision.
 *
 * The extractor is data-shaped, not app-shaped: it looks for the ranking field requested by the
 * action, groups nearby visible text into a record, applies textual constraints, and returns the
 * required fields.
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
    const contract = extractionContractFromAction(action)
    const orderField = requestedRankingField(taskText, contract.requiredFields)
    const entries = visibleTextEntries(observation)
    const constraints = requestedConstraints(taskText)
    const candidates = rankedRecordCandidates(
      entries,
      contract.requiredFields,
      orderField,
      constraints,
    )

    if (candidates.length === 0) {
      return {
        success: false,
        reason: "No ordered accessibility records matched the extraction constraints.",
      }
    }

    const best = candidates[0]
    const result = recordResult(best, contract.requiredFields)
    const missing = missingRequiredFields(result, contract)
    if (missing.length > 0) {
      return {
        success: false,
        reason: `Accessibility record was missing required fields: ${missing.join(", ")}.`,
        metadata: {
          source: "accessibility-ordered-records",
          candidates: candidates.slice(0, 5),
          missingFields: missing,
        },
      }
    }

    return {
      success: true,
      metadata: {
        source: "accessibility-ordered-records",
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
    return candidate.fields
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
  const explicit = Object.entries(candidate.fields).find(
    ([key]) => normalizeFieldName(key) === normalized,
  )?.[1]
  if (explicit) {
    return explicit
  }

  if (normalized === "name" || normalized === "title" || normalized.endsWith("name")) {
    return candidate.label
  }

  if (normalizeFieldName(candidate.ranking.field) === normalized) {
    return candidate.ranking.value
  }

  return undefined
}

function rankedRecordCandidates(
  entries: TextEntry[],
  requiredFields: string[],
  orderField: string,
  constraints: Record<string, string>,
): RecordCandidate[] {
  return entries
    .map((entry) => ({ entry, ranking: rankingValueFromText(orderField, entry.text) }))
    .filter(
      (candidate): candidate is { entry: TextEntry; ranking: RankingValue } =>
        candidate.ranking !== undefined,
    )
    .map((candidate) =>
      recordNearRanking(candidate.entry, candidate.ranking, entries, requiredFields, constraints),
    )
    .filter((candidate): candidate is RecordCandidate => candidate !== undefined)
    .sort((left, right) => right.ranking.numeric - left.ranking.numeric || right.score - left.score)
}

function recordNearRanking(
  rankEntry: TextEntry,
  ranking: RankingValue,
  entries: TextEntry[],
  requiredFields: string[],
  constraints: Record<string, string>,
): RecordCandidate | undefined {
  const neighbors = nearbyEntries(rankEntry, entries)
  const constraintFields = constraintFieldsFromEntries(neighbors, constraints)
  if (!constraintsSatisfied(neighbors, constraintFields, constraints)) {
    return undefined
  }

  const label = likelyLabel(neighbors, rankEntry, constraintFields)
  if (!label) {
    return undefined
  }

  const fields = candidateFields(label, ranking, requiredFields, constraintFields)

  return {
    label,
    fields,
    ranking,
    evidenceText: evidenceText([rankEntry, ...neighbors]),
    score: Object.keys(constraintFields).length * 40 + (hasCoordinates(rankEntry) ? 10 : 0),
  }
}

function candidateFields(
  label: string,
  ranking: RankingValue,
  requiredFields: string[],
  constraintFields: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {
    ...constraintFields,
    name: label,
    title: label,
    [ranking.field]: ranking.value,
  }

  for (const field of requiredFields) {
    const normalized = normalizeFieldName(field)
    if ((normalized.endsWith("name") || normalized === "title") && !fields[field]) {
      fields[field] = label
    }
  }

  return fields
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
          (entry) => entry !== anchor && entry.y !== undefined && Math.abs(entry.y - anchorY) <= 96,
        )

  return nearby.sort(
    (left, right) =>
      Math.abs((left.x ?? 0) - (anchor.x ?? 0)) - Math.abs((right.x ?? 0) - (anchor.x ?? 0)),
  )
}

function likelyLabel(
  entries: TextEntry[],
  rankEntry: TextEntry,
  constraintFields: Record<string, string>,
): string | undefined {
  const ignored = new Set([rankEntry.text, ...Object.values(constraintFields)])

  return entries
    .map((entry) => entry.text.trim())
    .filter((text) => text && !ignored.has(text))
    .filter((text) => !rankingValueFromText("", text))
    .filter((text) => !isChromeOrControlText(text))
    .sort((left, right) => labelScore(right) - labelScore(left))[0]
}

function labelScore(text: string): number {
  let score = 0
  if (text.length > 1 && text.length <= 100) {
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

function requestedRankingField(taskText: string, requiredFields: string[]): string {
  const explicit = taskText.match(/\b(?:compare|sort|order)\s+([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/i)?.[1]
  if (explicit) {
    const normalizedExplicit = normalizeFieldName(explicit)
    const matchingFields = requiredFields.filter((field) => {
      const normalizedField = normalizeFieldName(field)
      return (
        normalizedField === normalizedExplicit ||
        normalizedField.startsWith(normalizedExplicit) ||
        normalizedExplicit.startsWith(normalizedField)
      )
    })
    const matchingField =
      matchingFields.find((field) => {
        const normalizedField = normalizeFieldName(field)
        return (
          isDateField(normalizedField) ||
          isFileSizeField(normalizedField) ||
          isNumberField(normalizedField)
        )
      }) ?? matchingFields[0]

    return matchingField ?? explicit
  }

  return (
    requiredFields.find((field) => {
      const normalized = normalizeFieldName(field)
      return isDateField(normalized) || isFileSizeField(normalized) || isNumberField(normalized)
    }) ?? "rank"
  )
}

function requestedConstraints(taskText: string): Record<string, string> {
  const constraints: Record<string, string> = {}
  const english = taskText.matchAll(
    /\b(?:where|only accept entries where)\s+([a-zA-Z0-9_\-\u4e00-\u9fa5]+)\s+(?:is|=)\s+([^\s,，.;；]+)/gi,
  )

  for (const match of english) {
    if (match[1] && match[2]) {
      constraints[match[1]] = match[2]
    }
  }

  const chinese = taskText.matchAll(
    /(?:其中|只接受|筛选)?\s*([a-zA-Z0-9_\-\u4e00-\u9fa5]+)(?:是|为|=|：|:)\s*([^\s,，.;；]+)/g,
  )
  for (const match of chinese) {
    if (match[1] && match[2] && normalizeFieldName(match[1]).length <= 20) {
      constraints[match[1]] = match[2]
    }
  }

  return constraints
}

function constraintFieldsFromEntries(
  entries: TextEntry[],
  constraints: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {}

  for (const [field, expected] of Object.entries(constraints)) {
    const match = entries.find((entry) => normalize(entry.text).includes(normalize(expected)))
    if (match) {
      fields[field] = match.text
    }
  }

  return fields
}

function constraintsSatisfied(
  entries: TextEntry[],
  fields: Record<string, string>,
  constraints: Record<string, string>,
): boolean {
  for (const [field, expected] of Object.entries(constraints)) {
    const explicit = fields[field]
    const visible = entries.some((entry) => normalize(entry.text).includes(normalize(expected)))
    if (!normalize(explicit).includes(normalize(expected)) && !visible) {
      return false
    }
  }

  return true
}

function rankingValueFromText(field: string, text: string): RankingValue | undefined {
  const normalizedField = normalizeFieldName(field)

  if (isFileSizeField(normalizedField)) {
    return fileSizeRanking(field, text)
  }

  if (isDateField(normalizedField)) {
    return dateRanking(field, text)
  }

  if (isNumberField(normalizedField)) {
    return numberRanking(field, text)
  }

  return (
    dateRanking(field || "date", text) ??
    fileSizeRanking(field || "size", text) ??
    numberRanking(field || "number", text)
  )
}

function dateRanking(field: string, text: string): RankingValue | undefined {
  const value = normalizeDate(text)
  if (!value) {
    return undefined
  }

  return {
    field,
    raw: text,
    value,
    type: "date",
    numeric: Date.parse(value),
  }
}

function fileSizeRanking(field: string, text: string): RankingValue | undefined {
  const match = text.match(FILE_SIZE_PATTERN)
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  const amount = Number(match[1])
  const multiplier = fileSizeMultiplier(match[2])
  if (!Number.isFinite(amount) || multiplier === undefined) {
    return undefined
  }

  return {
    field,
    raw: match[0],
    value: match[0],
    type: "file-size",
    numeric: amount * multiplier,
  }
}

function numberRanking(field: string, text: string): RankingValue | undefined {
  const match = text.match(NUMBER_PATTERN)
  if (!match?.[0]) {
    return undefined
  }

  const numeric = Number(match[0])
  if (!Number.isFinite(numeric)) {
    return undefined
  }

  return {
    field,
    raw: match[0],
    value: match[0],
    type: "number",
    numeric,
  }
}

function fileSizeMultiplier(unit: string): number | undefined {
  const normalized = unit.toLowerCase()
  const units: Record<string, number> = {
    b: 1,
    byte: 1,
    bytes: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
    字节: 1,
    千字节: 1024,
    兆字节: 1024 ** 2,
    吉字节: 1024 ** 3,
  }

  return units[normalized]
}

function isDateField(field: string): boolean {
  return (
    field.includes("date") ||
    field.includes("time") ||
    field.includes("日期") ||
    field.includes("时间") ||
    field.includes("发行")
  )
}

function isFileSizeField(field: string): boolean {
  return field.includes("size") || field.includes("bytes") || field.includes("大小")
}

function isNumberField(field: string): boolean {
  return (
    field.includes("count") ||
    field.includes("number") ||
    field.includes("score") ||
    field.includes("hot") ||
    field.includes("热度") ||
    field.includes("数量")
  )
}

function visibleTextEntries(observation: Observation): TextEntry[] {
  const entries: TextEntry[] = []

  for (const element of axElementSource(observation)) {
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

function axElementSource(observation: Observation): Observation["elements"] {
  if (observation.axElements) {
    return observation.axElements
  }

  return observation.elements.filter((element) => !isVisualTextElement(element))
}

function isVisualTextElement(element: Observation["elements"][number]): boolean {
  return (
    element.metadata?.source === "screenshot-ocr" ||
    element.metadata?.synthetic === true ||
    normalize(element.role).includes("ocr")
  )
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

function evidenceText(entries: TextEntry[]): string[] {
  return Array.from(
    new Set(
      entries
        .map((entry) => entry.text.trim())
        .filter((text) => text && !isChromeOrControlText(text)),
    ),
  ).slice(0, 12)
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
