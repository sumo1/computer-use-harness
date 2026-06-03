import type { Action, ActionKind, Target, TraceEvent } from "../core/contracts.js"
import type { UseCase } from "./types.js"

const ACTION_KIND_PATTERNS: Array<{ token: string; kind: ActionKind }> = [
  { token: "extract", kind: "extract" },
  { token: "set value", kind: "type" },
  { token: "type", kind: "type" },
  { token: "click", kind: "click" },
  { token: "press key", kind: "key" },
  { token: "scroll", kind: "scroll" },
  { token: "open", kind: "open" },
  { token: "policy", kind: "policy-check" },
  { token: "permission", kind: "policy-check" },
]

export function appendTraceEvent(trace: TraceEvent[], event: Omit<TraceEvent, "index">): void {
  trace.push({
    ...event,
    index: trace.length,
  })
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
    ...findResultInput(description),
    ...extractInput(description),
  }
}

function typeTextInput(description: string): Record<string, string> {
  const match = description.match(/\btype\s+(.+?)(?:\s+into\b|$)/i)
  return match?.[1] ? { text: match[1].trim() } : {}
}

function keyInput(description: string): Record<string, string> {
  const match = description.match(/\bpress key\s+(.+)$/i)
  return match?.[1] ? { key: match[1].trim() } : {}
}

function findResultInput(description: string): Record<string, string> {
  // Match "click result named X" or "find result named X"
  const match = description.match(/\b(?:click|find) result (?:named |containing )?(.+)$/i)
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
