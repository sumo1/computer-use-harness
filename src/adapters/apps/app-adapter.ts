import type { Action, ActionResult, Observation } from "../../core/contracts.js"
import type { UseCase } from "../../usecases/types.js"

/**
 * App-specific adapter interface.
 *
 * Each supported app can provide an adapter to customize:
 * - UseCase preparation (e.g., create temp files)
 * - Action input binding (e.g., inject file paths, button names)
 * - Element binding (e.g., find app-specific UI elements)
 * - Action verification (e.g., check file system, external state)
 */
export interface AppAdapter {
  /**
   * App bundle identifier (e.g., "com.sublimetext.4").
   */
  readonly appId: string

  /**
   * Human-readable app name (e.g., "Sublime Text").
   */
  readonly appName: string

  /**
   * Prepare the use case before execution.
   * Called once at the start of the use case run.
   *
   * Use this to create temp files, set up state, etc.
   */
  prepareUseCase?(useCase: UseCase): Promise<void>

  /**
   * Bind action input based on use case context.
   * Called for each action before element binding.
   *
   * Use this to inject file paths, button names, window titles, etc.
   */
  bindActionInput?(useCase: UseCase, action: Action): Action

  /**
   * Bind action element from observation.
   * Called for each action that needs an element (click, type).
   *
   * Use this to find app-specific UI elements based on the observation.
   */
  bindElement?(action: Action, observation: Observation): Action

  /**
   * Verify action result.
   * Called after action execution, before recording the result.
   *
   * Use this to verify file system state, external APIs, etc.
   * Return undefined to skip verification (use default result).
   */
  verifyAction?(action: Action, observation: Observation): Promise<ActionResult | undefined>
}
