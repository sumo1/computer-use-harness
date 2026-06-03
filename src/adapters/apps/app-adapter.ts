import type { Action, ActionResult, Observation } from "../../core/contracts.js"
import type { SemanticHints } from "../../capabilities/capability.js"
import type { UseCase } from "../../usecases/types.js"

/**
 * App-specific adapter interface (new capability-based design).
 *
 * App adapters now only provide semantic hints, not implementation logic.
 * The capability chain decides which technique to use based on these hints.
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
   * Semantic hints for finding UI elements.
   * Maps action descriptions to possible selectors.
   */
  readonly semanticHints?: SemanticHints

  /**
   * Prepare the use case before execution.
   * Called once at the start of the use case run.
   */
  prepareUseCase?(useCase: UseCase): Promise<void>

  /**
   * Bind action input based on use case context.
   * Called for each action before capability chain execution.
   */
  bindActionInput?(useCase: UseCase, action: Action): Action

  /**
   * Verify action result (external verification).
   * Called after action execution.
   */
  verifyAction?(action: Action, observation: Observation): Promise<ActionResult | undefined>
}
