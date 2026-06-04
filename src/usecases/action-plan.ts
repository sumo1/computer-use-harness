import type { Action, ActionKind, Target, TraceEvent } from "../core/contracts.js"
import type { UseCase } from "./types.js"

const ACTION_KIND_PATTERNS: Array<{ token: string; kind: ActionKind }> = [
  { token: "extract", kind: "extract" },
  { token: "set value", kind: "type" },
  { token: "type", kind: "type" },
  { token: "right click", kind: "secondary-click" },
  { token: "right-click", kind: "secondary-click" },
  { token: "secondary click", kind: "secondary-click" },
  { token: "secondary-click", kind: "secondary-click" },
  { token: "context menu", kind: "secondary-click" },
  { token: "hover", kind: "hover" },
  { token: "mouse over", kind: "hover" },
  { token: "drag", kind: "drag" },
  { token: "click", kind: "click" },
  { token: "press key", kind: "key" },
  { token: "scroll", kind: "scroll" },
  { token: "open", kind: "open" },
  { token: "policy", kind: "policy-check" },
  { token: "permission", kind: "policy-check" },
]

export function appendTraceEvent(
  trace: TraceEvent[],
  event: Omit<TraceEvent, "index" | "timestamp"> & Partial<Pick<TraceEvent, "timestamp">>,
): void {
  trace.push({
    ...event,
    index: trace.length,
    timestamp: event.timestamp ?? traceTimestamp(),
  })
}

export function traceTimestamp(): string {
  return new Date().toISOString()
}

export function createUseCaseTarget(useCase: UseCase): Target {
  if (useCase.target) {
    return useCase.target
  }

  if (useCase.id === "UC-060") {
    return {
      kind: "app",
      id: "com.apple.Terminal",
      name: "Terminal",
      platform: "macos",
    }
  }

  return {
    kind: useCase.requires?.services?.includes("browser-harness") ? "browser" : "app",
    id: useCase.id,
    name: useCase.title,
    platform: normalizePlatform(useCase.requires?.platform),
  }
}

export function createUseCaseAction(
  caseId: string,
  stepIndex: number,
  description: string,
  target: Target,
  adapter: Action["adapter"],
): Action {
  return {
    id: `${caseId}:step:${stepIndex}`,
    kind: inferActionKind(description),
    target,
    adapter,
    input: createActionInput(description),
  }
}

function normalizePlatform(platform: string | undefined): Target["platform"] {
  return platform === "macos" ? "macos" : "any"
}

function inferActionKind(description: string): ActionKind {
  const normalized = description.toLowerCase()
  const match = ACTION_KIND_PATTERNS.find((entry) => normalized.includes(entry.token))
  return match?.kind ?? "observe"
}

function createActionInput(description: string): Action["input"] {
  return {
    description,
    ...typeTextInput(description),
    ...keyInput(description),
    ...scrollInput(description),
    ...dragInput(description),
    ...coordinateInput(description),
    ...verificationInput(description),
    ...retryInput(description),
    ...findResultInput(description),
    ...namedClickInput(description),
    ...extractInput(description),
  }
}

function typeTextInput(description: string): Record<string, string> {
  const match = description.match(/\btype\s+(.+?)(?:\s+into\b|$)/i)
  return match?.[1] ? { text: match[1].trim() } : {}
}

function keyInput(description: string): Record<string, string> {
  const match = description.match(/\bpress key\s+(\S+)/i)
  return match?.[1] ? { key: match[1].trim() } : {}
}

function scrollInput(description: string): Record<string, string | number> {
  const direction = description.match(/\bscroll\s+(up|down|left|right)\b/i)?.[1]?.toLowerCase()
  const amount = description.match(/\bscroll\b.*?\b(\d+(?:\.\d+)?)\b/i)?.[1]

  return {
    ...(direction ? { direction } : {}),
    ...(amount ? { amount: Number(amount) } : {}),
  }
}

function coordinateInput(description: string): Record<string, number> {
  if (inferActionKind(description) === "drag") {
    return {}
  }

  // Match patterns like "at 100, 200" or "x: 100, y: 200" or "coordinates 100, 200".
  const xyPattern = /(?:at|coordinates?)\s*(?:\()?(\d+)\s*,\s*(\d+)(?:\))?/i
  const explicitPattern = /x:\s*(\d+)\s*,?\s*y:\s*(\d+)/i

  let match = description.match(xyPattern) ?? description.match(explicitPattern)

  if (match?.[1] && match?.[2]) {
    return {
      x: Number(match[1]),
      y: Number(match[2]),
    }
  }

  return {}
}

function dragInput(description: string): Record<string, number> {
  // Match patterns like "from 100, 200 to 300, 400" or "fromX: 100, fromY: 200, toX: 300, toY: 400"
  const fromToPattern = /from\s*(?:\()?(\d+)\s*,\s*(\d+)(?:\))?\s*to\s*(?:\()?(\d+)\s*,\s*(\d+)(?:\))?/i
  const explicitPattern = /fromX:\s*(\d+)\s*,?\s*fromY:\s*(\d+)\s*,?\s*toX:\s*(\d+)\s*,?\s*toY:\s*(\d+)/i
  const deltaPattern = /(?:by|delta)\s*(?:\()?(-?\d+)\s*,\s*(-?\d+)(?:\))?/i

  let match = description.match(fromToPattern) ?? description.match(explicitPattern)

  if (match?.[1] && match?.[2] && match?.[3] && match?.[4]) {
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      toX: Number(match[3]),
      toY: Number(match[4]),
    }
  }

  // Check for delta pattern (e.g., "drag by 50, 100")
  const deltaMatch = description.match(deltaPattern)
  if (deltaMatch?.[1] && deltaMatch?.[2]) {
    return {
      deltaX: Number(deltaMatch[1]),
      deltaY: Number(deltaMatch[2]),
    }
  }

  return {}
}

function verificationInput(description: string): Record<string, boolean | number> {
  const normalized = description.toLowerCase()
  const shouldWaitForChange =
    normalized.includes("wait for state change") ||
    normalized.includes("wait until state changes") ||
    normalized.includes("verify state change")

  const timeoutMatch = description.match(/\btimeout\s+(\d+(?:\.\d+)?)\s*(ms|s)?\b/i)
  const timeoutMs = timeoutMatch?.[1]
    ? Number(timeoutMatch[1]) * (timeoutMatch[2]?.toLowerCase() === "s" ? 1000 : 1)
    : undefined

  return {
    ...(shouldWaitForChange ? { waitForStateChange: true } : {}),
    ...(timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
  }
}

function retryInput(description: string): Record<string, number> {
  const match = description.match(/\bretr(?:y|ies)\s+(\d+)\b/i)
  const retries = match?.[1] ? Number(match[1]) : undefined

  return retries !== undefined && Number.isInteger(retries) && retries > 0 ? { retries } : {}
}

function findResultInput(description: string): Record<string, string> {
  // Match "click result named X" or "find result named X"
  const match = description.match(/\b(?:click|find) result (?:named |containing )?(.+)$/i)
  return match?.[1] ? { keyword: match[1].trim() } : {}
}

function namedClickInput(description: string): Record<string, string> {
  const match = description.match(/\bclick\s+(?:tab|button|link|item)\s+named\s+(.+)$/i)
  return match?.[1] ? { keyword: match[1].trim() } : {}
}

function extractInput(description: string): Record<string, string> {
  // Match "extract <something> information"
  const match = description.match(/\bextract\s+(.+)$/i)
  if (match?.[1]) {
    return { query: `Extract ${match[1].trim()}. Return JSON with relevant fields.` }
  }
  return {}
}
