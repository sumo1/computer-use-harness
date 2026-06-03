import type { Action, ActionResult, Observation } from "../core/contracts.js"

/**
 * Semantic hints provided by app adapters.
 * Describes how to find UI elements using different techniques.
 */
export interface SemanticHints {
  [actionKey: string]: {
    ax?: Array<{ role?: string; name?: string; index?: number }>
    coordinate?: Array<{ relative: string; x: number; y: number }>
    vision?: Array<{ text: string; region?: string }>
  }
}

/**
 * Result from a capability execution.
 */
export interface CapabilityResult {
  success: boolean
  element?: Action["element"]
  coordinate?: { x: number; y: number }
  metadata?: Record<string, unknown>
  reason?: string
}

/**
 * A capability represents one technical approach to execute an action.
 *
 * Examples:
 * - AXElementFinder: find elements using AX tree
 * - CoordinateClicker: click at fixed coordinates
 * - ScreenshotVisionFinder: use screenshot + vision to locate targets
 */
export interface Capability {
  /**
   * Capability name for debugging and telemetry.
   */
  readonly name: string

  /**
   * Check if this capability can handle the action.
   *
   * @param action - The action to execute
   * @param observation - Current app state
   * @param hints - Optional semantic hints from app adapter
   */
  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean

  /**
   * Execute the action using this capability.
   *
   * @param action - The action to execute
   * @param observation - Current app state
   * @param hints - Optional semantic hints from app adapter
   */
  execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult>
}
