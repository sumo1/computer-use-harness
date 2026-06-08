import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Executes actions by trying capabilities in order until one succeeds.
 * Implements automatic fallback strategy.
 */
export class CapabilityChain {
  constructor(private readonly capabilities: Capability[]) {}

  /**
   * Execute action using the first capable handler.
   * Returns the capability result and which capability was used.
   */
  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<{ result: CapabilityResult; usedCapability: string }> {
    const failures: Array<{ capability: string; reason?: string }> = []

    for (const capability of this.capabilities) {
      if (capability.canHandle(action, observation, hints)) {
        const result = await capability.execute(action, observation, hints)
        if (result.success) {
          return {
            result: {
              ...result,
              metadata: {
                ...result.metadata,
                ...(failures.length > 0 ? { fallbackFailures: failures } : {}),
              },
            },
            usedCapability: capability.name,
          }
        }

        failures.push({ capability: capability.name, reason: result.reason })
      }
    }

    return {
      result: {
        success: false,
        reason:
          failures.length > 0
            ? `All capable handlers failed for action kind '${action.kind}'.`
            : `No capability can handle action kind '${action.kind}' with current observation.`,
        metadata: {
          ...(failures.length > 0 ? { fallbackFailures: failures } : {}),
        },
      },
      usedCapability: "none",
    }
  }

  /**
   * List all registered capabilities.
   */
  listCapabilities(): string[] {
    return this.capabilities.map((c) => c.name)
  }
}
