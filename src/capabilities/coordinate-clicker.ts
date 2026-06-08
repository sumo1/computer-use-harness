import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Click at fixed coordinates.
 * Used when AX tree doesn't expose the target element.
 */
export class CoordinateClicker implements Capability {
  readonly name = "coordinate-clicker"

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    if (!canUseCoordinateTarget(action.kind)) {
      return false
    }

    if (requiresSemanticElementTarget(action)) {
      return false
    }

    // Check if action already has coordinates
    if (typeof action.input?.x === "number" && typeof action.input?.y === "number") {
      return true
    }

    // Check if semantic hints provide coordinates
    if (hints) {
      const actionKey = this.getActionKey(action)
      const coordHints = hints[actionKey]?.coordinate
      if (coordHints && coordHints.length > 0) {
        const coord = this.resolveCoordinate(coordHints[0], observation)
        return coord !== undefined
      }
    }

    return false
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    // Use existing coordinates if available
    if (typeof action.input?.x === "number" && typeof action.input?.y === "number") {
      return {
        success: true,
        coordinate: { x: action.input.x, y: action.input.y },
        metadata: { source: "action.input" },
      }
    }

    // Try semantic hints
    if (hints) {
      const actionKey = this.getActionKey(action)
      const coordHints = hints[actionKey]?.coordinate
      if (coordHints) {
        for (const hint of coordHints) {
          const coord = this.resolveCoordinate(hint, observation)
          if (coord) {
            return {
              success: true,
              coordinate: coord,
              metadata: { source: "semantic-hints", actionKey, relative: hint.relative },
            }
          }
        }
      }
    }

    return {
      success: false,
      reason: "No coordinate available for click action",
    }
  }

  private resolveCoordinate(
    hint: { relative: string; x: number; y: number },
    observation: Observation,
  ): { x: number; y: number } | undefined {
    // Simple case: relative to a named element
    const refElement = observation.elements
      .filter((el: { name?: string }) => normalize(el.name).includes(normalize(hint.relative)))
      .sort((left, right) => frameArea(right.metadata?.frame) - frameArea(left.metadata?.frame))[0]

    if (refElement) {
      const frame = refElement.metadata?.frame
      if (isRecord(frame) && typeof frame.x === "number" && typeof frame.y === "number") {
        return {
          x: frame.x + hint.x,
          y: frame.y + hint.y,
        }
      }
    }

    // Future: support other relative strategies (screen, window, etc.)
    return undefined
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

function frameArea(value: unknown): number {
  if (!isRecord(value) || typeof value.width !== "number" || typeof value.height !== "number") {
    return 0
  }

  return value.width * value.height
}

function requiresSemanticElementTarget(action: Action): boolean {
  const description = stringInput(action, "description", "")
  return /\b(?:click|hover)\s+tab\s+named\b/i.test(description)
}

function canUseCoordinateTarget(kind: Action["kind"]): boolean {
  return kind === "click" || kind === "secondary-click" || kind === "hover" || kind === "drag"
}
