import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Click the first clickable result in a search results area.
 * Used when keyword-based finding fails (e.g., elements have no name).
 */
export class FirstResultClicker implements Capability {
  readonly name = "first-result-clicker"

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    if (action.kind !== "click" && action.kind !== "secondary-click") {
      return false
    }

    const description = this.normalize(this.stringInput(action, "description", ""))

    // Only handle "click result" actions
    if (!description.includes("result")) {
      return false
    }

    // Find first clickable row/cell
    return this.findFirstClickableResult(observation.elements) !== undefined
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const element = this.findFirstClickableResult(observation.elements)

    if (element) {
      return {
        success: true,
        element,
        metadata: { source: "first-clickable-result", reason: "keyword-based-finding-failed" },
      }
    }

    return {
      success: false,
      reason: "No clickable result found in observation",
    }
  }

  private findFirstClickableResult(elements: Observation["elements"]): Action["element"] {
    const candidates = this.visibleNonMenuElements(elements)

    // Find first Row or Cell (typical search result structure)
    return candidates.find((element) => {
      const role = this.normalize(element.role)
      return role.includes("row") || role.includes("cell")
    })
  }

  private visibleNonMenuElements(elements: Observation["elements"]) {
    return elements.filter((element) => {
      const role = this.normalize(element.role)
      const frame = element.metadata?.frame
      const width = this.isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
      const height = this.isRecord(frame) && typeof frame.height === "number" ? frame.height : 0

      return !role.includes("menu") && width > 0 && height > 0
    })
  }

  private stringInput(action: Action, key: string, fallback: string): string {
    const value = action.input?.[key]
    return typeof value === "string" && value.trim() !== "" ? value : fallback
  }

  private normalize(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : ""
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
