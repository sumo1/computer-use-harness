import type { Action, ElementRef, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Find elements using AX tree.
 * Works when elements have meaningful role/name attributes.
 */
export class AXElementFinder implements Capability {
  readonly name = "ax-element-finder"

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    if (!canUseElementTarget(action.kind)) {
      return false
    }

    // If action already has element, use it
    if (action.element) {
      return true
    }

    // Check if we can find element by keyword
    const keyword = stringInput(action, "keyword", "")
    if (keyword && this.findByKeyword(observation.elements, keyword, action)) {
      return true
    }

    // Check if semantic hints provide AX selector
    if (hints) {
      const actionKey = this.getActionKey(action)
      const axHints = hints[actionKey]?.ax
      if (axHints && axHints.length > 0) {
        return this.findByHints(observation.elements, axHints) !== undefined
      }
    }

    return false
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    // Use existing element if available
    if (action.element) {
      return {
        success: true,
        element: action.element,
        metadata: { source: "action.element" },
      }
    }

    // Try keyword-based finding
    const keyword = stringInput(action, "keyword", "")
    if (keyword) {
      const element = this.findByKeyword(observation.elements, keyword, action)
      if (element) {
        return {
          success: true,
          element,
          metadata: { source: "keyword", keyword },
        }
      }
    }

    // Try semantic hints
    if (hints) {
      const actionKey = this.getActionKey(action)
      const axHints = hints[actionKey]?.ax
      if (axHints) {
        const element = this.findByHints(observation.elements, axHints)
        if (element) {
          return {
            success: true,
            element,
            metadata: { source: "semantic-hints", actionKey },
          }
        }
      }
    }

    return {
      success: false,
      reason: "No AX element found matching keyword or hints",
    }
  }

  private findByKeyword(elements: ElementRef[], keyword: string, action: Action): ElementRef | undefined {
    const normalizedKeyword = normalize(keyword)
    if (!normalizedKeyword) {
      return undefined
    }

    const visibleCandidates = this.visibleNonMenuElements(elements)
    const candidates = this.rankCandidates(visibleCandidates, normalizedKeyword, action)

    return (
      candidates.find((element) => this.isPressableRole(normalize(element.role))) ??
      candidates.find((element) => normalize(element.role) !== "statictext") ??
      candidates[0]
    )
  }

  private findByHints(
    elements: ElementRef[],
    hints: Array<{ role?: string; name?: string; index?: number }>,
  ): ElementRef | undefined {
    for (const hint of hints) {
      const candidates = this.visibleNonMenuElements(elements).filter((element) => {
        if (hint.role && normalize(element.role) !== normalize(hint.role)) {
          return false
        }
        if (hint.name && normalize(element.name) !== normalize(hint.name)) {
          return false
        }
        return true
      })

      if (candidates.length > 0) {
        const index = hint.index ?? 0
        return candidates[index]
      }
    }

    return undefined
  }

  private visibleNonMenuElements(elements: ElementRef[]): ElementRef[] {
    return elements.filter((element) => {
      const role = normalize(element.role)
      const frame = element.metadata?.frame
      const width = isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
      const height = isRecord(frame) && typeof frame.height === "number" ? frame.height : 0

      return !role.includes("menu") && width > 0 && height > 0
    })
  }

  private isPressableRole(role: string): boolean {
    return role.includes("button") || role.includes("row") || role.includes("cell") || role.includes("link")
  }

  private rankCandidates(elements: ElementRef[], keyword: string, action: Action): ElementRef[] {
    const namedTab = normalize(stringInput(action, "description", "")).includes("click tab named")
    const exact = elements.filter((element) => normalize(element.name) === keyword)
    if (exact.length > 0) {
      return exact
    }

    const tabLike = namedTab
      ? elements.filter((element) => {
          const name = normalize(element.name)
          return name.startsWith(keyword) && !name.endsWith("信息")
        })
      : []
    if (tabLike.length > 0) {
      return tabLike
    }

    return elements.filter((element) => normalize(element.name).includes(keyword))
  }

  private getActionKey(action: Action): string {
    const description = stringInput(action, "description", "")
    return normalize(description)
  }
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

function canUseElementTarget(kind: Action["kind"]): boolean {
  return kind === "click" || kind === "secondary-click" || kind === "hover" || kind === "drag" || kind === "type"
}
