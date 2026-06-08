import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Type text into search inputs or text fields.
 * Finds text input elements using AX tree.
 */
export class TextInputHandler implements Capability {
  readonly name = "text-input-handler"

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    if (action.kind !== "type" && action.kind !== "key") {
      return false
    }

    if (action.element) {
      return true
    }

    // Check if we can find a text input element
    const description = this.normalize(this.stringInput(action, "description", ""))
    if (description.includes("search")) {
      return this.findSearchInput(observation) !== undefined
    }

    return false
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    if (action.element) {
      return {
        success: true,
        element: action.element,
        metadata: { source: "action.element" },
      }
    }

    // Find search input
    const description = this.normalize(this.stringInput(action, "description", ""))
    if (description.includes("search")) {
      const element = this.findSearchInput(observation)
      if (element) {
        return {
          success: true,
          element,
          metadata: { source: "search-input-finder" },
        }
      }
    }

    return {
      success: false,
      reason: "No text input element found",
    }
  }

  private findSearchInput(observation: Observation): Action["element"] {
    const candidates = this.visibleNonMenuElements(this.axElementSource(observation))
    const bySearchName = candidates.find((element) => {
      const role = this.semanticRole(element)
      const name = this.normalize(element.name)
      return name.includes("search") || name.includes("搜索") || role.includes("search")
    })

    return (
      bySearchName ?? candidates.find((element) => this.isTextInputRole(this.semanticRole(element)))
    )
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

  private isTextInputRole(role: string): boolean {
    return (
      role.includes("textfield") ||
      role.includes("textbox") ||
      role.includes("textarea") ||
      role.includes("textview") ||
      role.includes("searchfield") ||
      role.includes("文本框")
    )
  }

  private semanticRole(element: Observation["elements"][number]): string {
    return [
      element.role,
      element.metadata?.roleDescription,
      element.metadata?.subrole,
      element.metadata?.axIdentifier,
    ]
      .map((value) => this.normalize(value))
      .filter(Boolean)
      .join(" ")
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

  private axElementSource(observation: Observation): Observation["elements"] {
    if (observation.axElements) {
      return observation.axElements
    }

    return observation.elements.filter((element) => !this.isVisualTextElement(element))
  }

  private isVisualTextElement(element: Observation["elements"][number]): boolean {
    return (
      element.metadata?.source === "screenshot-ocr" ||
      element.metadata?.synthetic === true ||
      this.normalize(element.role).includes("ocr")
    )
  }
}
