import type { Action, Observation } from "../core/contracts.js"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Wait for UI state changes (element appears, text changes, etc.)
 * Handles async loading and timing issues across all apps.
 */
export class WaitForStateCapability implements Capability {
  readonly name = "wait-for-state"
  private helper?: MacHelperClient

  constructor(helper?: MacHelperClient) {
    this.helper = helper
  }

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    // Handle explicit "wait" actions
    if (action.kind === "observe") {
      const description = this.normalize(this.stringInput(action, "description", ""))
      return description.includes("wait") || description.includes("load")
    }
    return false
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const description = this.stringInput(action, "description", "")
    const timeout = Number(action.input?.timeout) || 10000 // 10s default
    const pollInterval = 500 // 500ms

    // Extract wait condition from description
    const condition = this.extractCondition(description)

    try {
      const result = await this.waitForCondition(action, condition, timeout, pollInterval)

      return {
        success: true,
        metadata: {
          source: "wait-for-state",
          condition,
          timeout,
          actualWaitTime: result.waitTime,
        },
      }
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async waitForCondition(
    action: Action,
    condition: WaitCondition,
    timeout: number,
    pollInterval: number,
  ): Promise<{ waitTime: number }> {
    if (!this.helper) {
      throw new Error("Helper client required for WaitForState")
    }

    const startTime = Date.now()
    const endTime = startTime + timeout

    while (Date.now() < endTime) {
      const state = await this.helper.getAppState(action.target)

      if (this.checkCondition(state.observation, condition)) {
        return { waitTime: Date.now() - startTime }
      }

      await this.sleep(pollInterval)
    }

    throw new Error(`Timeout waiting for condition: ${condition.type}`)
  }

  private extractCondition(description: string): WaitCondition {
    const normalized = this.normalize(description)

    // "wait for element X to appear"
    if (normalized.includes("appear") || normalized.includes("show")) {
      const match = description.match(/wait.*?(?:for|until)\s+(.+?)\s+(?:to\s+)?(?:appear|show)/i)
      if (match) {
        return { type: "element-appears", keyword: match[1].trim() }
      }
    }

    // "wait for text X"
    if (normalized.includes("text")) {
      const match = description.match(/wait.*?text\s+(.+?)(?:\s|$)/i)
      if (match) {
        return { type: "text-appears", keyword: match[1].trim() }
      }
    }

    // "wait for results" or "wait for loading"
    if (normalized.includes("result") || normalized.includes("load")) {
      return { type: "element-count-stable", minElements: 5 }
    }

    // Default: wait for any change
    return { type: "state-change" }
  }

  private checkCondition(observation: Observation, condition: WaitCondition): boolean {
    switch (condition.type) {
      case "element-appears":
        return observation.elements.some((el) =>
          this.normalize(el.name).includes(this.normalize(condition.keyword || "")),
        )

      case "text-appears":
        return observation.elements.some(
          (el) =>
            this.normalize(el.name).includes(this.normalize(condition.keyword || "")) ||
            (el.role && this.normalize(el.role).includes("text")),
        )

      case "element-count-stable":
        return observation.elements.length >= (condition.minElements || 5)

      case "state-change":
        return true // Any observation counts as state change

      default:
        return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private stringInput(action: Action, key: string, fallback: string): string {
    const value = action.input?.[key]
    return typeof value === "string" && value.trim() !== "" ? value : fallback
  }

  private normalize(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : ""
  }
}

interface WaitCondition {
  type: "element-appears" | "text-appears" | "element-count-stable" | "state-change"
  keyword?: string
  minElements?: number
}
