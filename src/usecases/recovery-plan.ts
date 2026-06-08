import type { AccessibilityNode, Observation } from "../core/contracts.js"

export interface RecoveryCandidate {
  key: string
  description: string
  score: number
}

interface SemanticTargetSet {
  patterns: string[]
  labels: string[]
}

interface NamedEntry {
  key: string
  role?: string
  roleDescription?: string
  subrole?: string
  identifier?: string
  name: string
  frame?: Record<string, unknown>
}

const SEMANTIC_TARGET_SETS: SemanticTargetSet[] = [
  {
    patterns: ["album", "albums", "专辑"],
    labels: ["专辑", "Albums", "Album"],
  },
  {
    patterns: ["song", "songs", "track", "tracks", "歌曲", "单曲"],
    labels: ["歌曲", "Songs", "Song", "Tracks"],
  },
  {
    patterns: ["artist", "artists", "歌手", "艺人"],
    labels: ["歌手", "Artists", "Artist"],
  },
  {
    patterns: ["playlist", "playlists", "歌单"],
    labels: ["歌单", "Playlists", "Playlist"],
  },
  {
    patterns: ["video", "videos", "mv", "视频"],
    labels: ["视频", "Videos", "Video", "MV"],
  },
]

const GENERIC_NAVIGATION_RECOVERY: RecoveryCandidate[] = [
  {
    key: "navigation:scroll-down",
    description: "scroll down 5",
    score: 45,
  },
  {
    key: "navigation:page-down",
    description: "press key PageDown",
    score: 40,
  },
]

export function extractionRecoveryCandidates(
  originalExtractDescription: string,
  observation: Observation,
  failureText = "",
): RecoveryCandidate[] {
  const excluded = constraintTerms(originalExtractDescription)

  return uniqueCandidates([
    ...semanticNavigationCandidates(originalExtractDescription, observation),
    ...GENERIC_NAVIGATION_RECOVERY,
    ...failureMentionedCandidates(originalExtractDescription, observation, failureText),
    ...rankedExplorationCandidates(observation),
  ])
    .filter((candidate) => !excluded.has(normalize(candidateTargetName(candidate.description))))
    .sort((left, right) => right.score - left.score)
}

function semanticNavigationCandidates(
  description: string,
  observation: Observation,
): RecoveryCandidate[] {
  const normalizedDescription = normalize(navigationIntentText(description))
  const matchingSets = SEMANTIC_TARGET_SETS.filter((set) =>
    set.patterns.some((pattern) => normalizedDescription.includes(normalize(pattern))),
  )

  return matchingSets.flatMap((set) => {
    const candidates = set.labels.map((label, index) => {
      const visible = hasVisibleTabLabel(observation, label)

      return {
        key: `semantic-target:${normalize(set.patterns[0])}`,
        description: `click tab named ${label}`,
        score: visible ? 100 - index : -100,
      }
    })

    return candidates
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 1)
  })
}

function navigationIntentText(description: string): string {
  return description
    .replace(/\bonly\s+accept\b[\s\S]*$/i, "")
    .replace(/\bwhere\b[\s\S]*$/i, "")
    .replace(/\breturn\b[\s\S]*$/i, "")
    .replace(/；[\s\S]*$/i, "")
    .replace(/;[\s\S]*$/i, "")
    .trim()
}

function rankedExplorationCandidates(observation: Observation): RecoveryCandidate[] {
  return namedEntries(observation)
    .filter((entry) => isTrustedVisibleCandidate(entry, observation))
    .filter(isTrustedInteractiveRole)
    .filter((entry) => !isKnownSemanticTabLabel(entry.name))
    .filter(isUsefulExplorationTarget)
    .map((entry) => {
      const name = entry.name

      return {
        key: entry.key,
        description: `click item named ${name}`,
        score: explorationScore(entry),
      }
    })
    .filter((candidate) => candidate.score > 0)
}

function failureMentionedCandidates(
  description: string,
  observation: Observation,
  failureText: string,
): RecoveryCandidate[] {
  if (!failureText) {
    return []
  }

  const excluded = constraintTerms(description)
  const terms = [
    ...quotedCandidateGroups(failureText),
    ...quotedTerms(failureText).map((term) => ({ term, score: 55 })),
  ]
  const visibleTargets = namedEntries(observation)
    .filter((entry) => isTrustedVisibleCandidate(entry, observation))
    .filter(isTrustedInteractiveRole)
    .filter((entry) => !isKnownSemanticTabLabel(entry.name))

  return terms
    .filter(({ term }) => !excluded.has(normalize(term)))
    .filter(({ term }) => isMeaningfulCandidateText(term))
    .filter(({ term }) => !isChromeOrPlaybackLabel(normalize(term)))
    .flatMap(({ term, score }) =>
      visibleTargets
        .filter((entry) => normalize(entry.name).includes(normalize(term)))
        .map((entry) => ({
          key: `failure-candidate:${entry.key}`,
          description: `click item named ${entry.name}`,
          score,
        })),
    )
}

function quotedCandidateGroups(value: string): Array<{ term: string; score: number }> {
  const groups = [
    ...value.matchAll(
      /\b(?:album names?|albums?|candidates?|visible content|visible entries)[^()（）]*[（(]([^()（）]+)[）)]/gi,
    ),
  ]

  return groups.flatMap((match) =>
    candidateGroupTerms(match[1] ?? "").map((term) => ({ term, score: 90 })),
  )
}

function quotedTerms(value: string): string[] {
  return [...value.matchAll(/["'“”‘’《》]([^"'“”‘’《》]+)["'“”‘’《》]/g)].map(
    (match) => match[1]?.trim() ?? "",
  )
}

function candidateGroupTerms(value: string): string[] {
  const quoted = quotedTerms(value)
  const split = value
    .split(/[,，、]/)
    .map((term) => term.replace(/^["'“”‘’《》\s]+|["'“”‘’《》\s]+$/g, ""))
    .filter(Boolean)

  return uniqueStrings([...quoted, ...split])
}

function constraintTerms(description: string): Set<string> {
  const terms = new Set<string>()
  const artist = description.match(/artist\s+is\s+([^\s,，.;；]+)/i)?.[1]
  if (artist) {
    terms.add(normalize(artist))
  }

  const chineseArtist = description.match(/(?:歌手|艺人)(?:是|为|:|：)\s*([^\s,，.;；]+)/)?.[1]
  if (chineseArtist) {
    terms.add(normalize(chineseArtist))
  }

  return terms
}

function candidateTargetName(description: string): string {
  return description.match(/\bnamed\s+(.+)$/i)?.[1]?.trim() ?? ""
}

function explorationScore(element: Pick<NamedEntry, "role" | "name">): number {
  const role = normalize(element.role)
  const name = (element.name ?? "").trim()
  const normalizedName = normalize(name)

  if (!isMeaningfulCandidateText(name) || isChromeOrPlaybackLabel(normalizedName)) {
    return -100
  }

  let score = 0
  if (role.includes("link")) {
    score += 35
  }
  if (role.includes("button")) {
    score += 25
  }
  if (role.includes("row") || role.includes("cell")) {
    score += 25
  }
  if (role.includes("tab") || role.includes("heading")) {
    score += 15
  }
  if (score === 0) {
    return -100
  }

  if (containsDateLikeText(name)) {
    score += 30
  }
  if (looksLikeDetailOrListTarget(normalizedName)) {
    score += 15
  }
  if (name.length > 1 && name.length <= 120) {
    score += 5
  }
  if (normalizedName.includes("播放") || normalizedName.includes("play")) {
    score -= 20
  }

  return score
}

function isUsefulExplorationTarget(entry: NamedEntry): boolean {
  const normalizedName = normalize(entry.name)

  return (
    containsDateLikeText(entry.name) ||
    looksLikeDetailOrListTarget(normalizedName) ||
    isPaginationTarget(normalizedName) ||
    isResultRowRole(entry)
  )
}

function looksLikeDetailOrListTarget(normalizedName: string): boolean {
  return [
    "专辑",
    "album",
    "详情",
    "detail",
    "全部",
    "all",
    "查看全部",
    "view all",
    "列表",
    "list",
    "结果",
    "result",
    "下一",
    "next",
  ].some((token) => normalizedName.includes(token))
}

function isPaginationTarget(normalizedName: string): boolean {
  return ["下一页", "上一页", "page down", "page up", "next page", "previous page"].some((token) =>
    normalizedName.includes(token),
  )
}

function isResultRowRole(entry: NamedEntry): boolean {
  const role = entrySemanticRole(entry)
  return (
    role.includes("row") || role.includes("行") || role.includes("cell") || role.includes("单元格")
  )
}

function isChromeOrPlaybackLabel(normalizedName: string): boolean {
  return [
    "关闭",
    "最小化",
    "全屏",
    "搜索",
    "刷新",
    "上一步",
    "下一步",
    "上一首",
    "下一首",
    "暂停播放",
    "播放列表",
    "评论",
    "更多",
    "更多操作",
    "添加到我喜欢",
    "close",
    "minimize",
    "fullscreen",
    "search",
    "refresh",
    "more",
  ].includes(normalizedName)
}

function isKnownSemanticTabLabel(value: string): boolean {
  const normalized = normalize(value)
  return SEMANTIC_TARGET_SETS.some((set) =>
    set.labels.some((label) => normalize(label) === normalized),
  )
}

function hasVisibleTabLabel(observation: Observation, label: string): boolean {
  const normalizedLabel = normalize(label)

  return namedEntries(observation).some((entry) => {
    const name = normalize(entry.name)
    return (
      (name === normalizedLabel || name === `${normalizedLabel}s`) &&
      isTrustedVisibleCandidate(entry, observation) &&
      isTabControlRole(entry)
    )
  })
}

function namedEntries(observation: Observation): NamedEntry[] {
  const entries: NamedEntry[] = []

  for (const element of observation.elements) {
    if (!element.name) {
      continue
    }

    entries.push({
      key: elementKey("element", element.role, element.name, element.metadata?.frame),
      role: element.role,
      roleDescription:
        typeof element.metadata?.roleDescription === "string"
          ? element.metadata.roleDescription
          : undefined,
      subrole: typeof element.metadata?.subrole === "string" ? element.metadata.subrole : undefined,
      identifier:
        typeof element.metadata?.axIdentifier === "string"
          ? element.metadata.axIdentifier
          : undefined,
      name: element.name,
      frame: isJsonObject(element.metadata?.frame) ? element.metadata.frame : undefined,
    })
  }

  for (const root of observation.accessibilityTree ?? []) {
    collectAccessibilityEntries(root, entries)
  }

  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.key)) {
      return false
    }
    seen.add(entry.key)
    return true
  })
}

function collectAccessibilityEntries(node: AccessibilityNode, entries: NamedEntry[]): void {
  if (node.name) {
    entries.push({
      key: elementKey("tree", node.role, node.name, node.bounds),
      role: node.role,
      roleDescription:
        typeof node.metadata?.roleDescription === "string"
          ? node.metadata.roleDescription
          : undefined,
      subrole: typeof node.metadata?.subrole === "string" ? node.metadata.subrole : undefined,
      identifier:
        typeof node.metadata?.axIdentifier === "string" ? node.metadata.axIdentifier : undefined,
      name: node.name,
      frame: node.bounds ? { ...node.bounds } : undefined,
    })
  }

  for (const child of node.children ?? []) {
    collectAccessibilityEntries(child, entries)
  }
}

function isVisibleFrame(
  frame: Record<string, unknown> | undefined,
  observation: Observation,
): boolean {
  if (!isJsonObject(frame)) {
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

function isTrustedVisibleCandidate(entry: NamedEntry, observation: Observation): boolean {
  return isJsonObject(entry.frame) && isVisibleFrame(entry.frame, observation)
}

function elementKey(
  source: string,
  role: string | undefined,
  name: string | undefined,
  frame: unknown,
): string {
  if (isJsonObject(frame)) {
    return [
      source,
      role ?? "",
      name ?? "",
      frame.x ?? "",
      frame.y ?? "",
      frame.width ?? "",
      frame.height ?? "",
    ].join("|")
  }

  return [source, role ?? "", name ?? ""].join("|")
}

function uniqueCandidates(candidates: RecoveryCandidate[]): RecoveryCandidate[] {
  const byKey = new Map<string, RecoveryCandidate>()

  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key)
    if (!existing || candidate.score > existing.score) {
      byKey.set(candidate.key, candidate)
    }
  }

  return [...byKey.values()]
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function isMeaningfulCandidateText(value: string): boolean {
  const text = value.trim()
  return text.length > 1 && text.length <= 80 && /[\p{L}\p{N}]/u.test(text)
}

function isTabControlRole(role: string | NamedEntry | undefined): boolean {
  const normalizedRole =
    typeof role === "object" && role !== null ? entrySemanticRole(role) : normalize(role)
  return (
    normalizedRole.includes("tab") ||
    normalizedRole.includes("button") ||
    normalizedRole.includes("按钮") ||
    normalizedRole.includes("radio") ||
    normalizedRole.includes("segmented") ||
    normalizedRole.includes("toggle") ||
    normalizedRole.includes("标签")
  )
}

function isTrustedInteractiveRole(entry: NamedEntry): boolean
function isTrustedInteractiveRole(role: string | undefined): boolean
function isTrustedInteractiveRole(value: NamedEntry | string | undefined): boolean {
  const normalizedRole =
    typeof value === "object" && value !== null ? entrySemanticRole(value) : normalize(value)
  return (
    normalizedRole.includes("button") ||
    normalizedRole.includes("按钮") ||
    normalizedRole.includes("link") ||
    normalizedRole.includes("链接") ||
    normalizedRole.includes("row") ||
    normalizedRole.includes("行") ||
    normalizedRole.includes("cell") ||
    normalizedRole.includes("单元格") ||
    isTabControlRole(normalizedRole)
  )
}

function entrySemanticRole(entry: NamedEntry): string {
  return [entry.role, entry.roleDescription, entry.subrole, entry.identifier]
    .map(normalize)
    .filter(Boolean)
    .join(" ")
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function containsDateLikeText(value: string): boolean {
  return /\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b/.test(value)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
