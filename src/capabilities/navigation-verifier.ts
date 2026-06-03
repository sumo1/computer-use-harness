import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Verify navigation success and detect wrong pages.
 * Helps ensure multi-step navigation reaches the intended destination.
 */
export class NavigationVerifierCapability implements Capability {
  readonly name = "navigation-verifier"

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    // Handle "verify" or "check" actions
    if (action.kind === "observe") {
      const description = this.normalize(this.stringInput(action, "description", ""))
      return description.includes("verify") || description.includes("check")
    }
    return false
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const description = this.stringInput(action, "description", "")
    const expectedKeywords = this.extractExpectedKeywords(description)

    const verification = this.verifyNavigation(observation, expectedKeywords)

    return {
      success: verification.matched,
      metadata: {
        source: "navigation-verifier",
        expectedKeywords,
        foundKeywords: verification.foundKeywords,
        confidence: verification.confidence,
      },
      reason: verification.matched ? undefined : verification.reason,
    }
  }

  private verifyNavigation(
    observation: Observation,
    expectedKeywords: string[],
  ): NavigationVerification {
    if (expectedKeywords.length === 0) {
      return {
        matched: true,
        confidence: 1.0,
        foundKeywords: [],
      }
    }

    const foundKeywords: string[] = []
    const elementTexts = observation.elements
      .map((el) => this.normalize(el.name))
      .filter((name) => name.length > 0)

    for (const keyword of expectedKeywords) {
      const normalized = this.normalize(keyword)
      if (elementTexts.some((text) => text.includes(normalized))) {
        foundKeywords.push(keyword)
      }
    }

    const confidence = foundKeywords.length / expectedKeywords.length

    if (confidence >= 0.5) {
      return {
        matched: true,
        confidence,
        foundKeywords,
      }
    }

    return {
      matched: false,
      confidence,
      foundKeywords,
      reason: `Expected keywords not found: ${expectedKeywords.filter((k) => !foundKeywords.includes(k)).join(", ")}`,
    }
  }

  private extractExpectedKeywords(description: string): string[] {
    const keywords: string[] = []

    // "verify we are on X page"
    const pageMatch = description.match(/(?:on|at)\s+(.+?)\s+page/i)
    if (pageMatch) {
      keywords.push(pageMatch[1].trim())
    }

    // "verify X is visible"
    const visibleMatch = description.match(/verify\s+(.+?)\s+(?:is|are)\s+visible/i)
    if (visibleMatch) {
      keywords.push(visibleMatch[1].trim())
    }

    // "check for X"
    const checkMatch = description.match(/check\s+for\s+(.+?)(?:\s|$)/i)
    if (checkMatch) {
      keywords.push(checkMatch[1].trim())
    }

    return keywords
  }

  private stringInput(action: Action, key: string, fallback: string): string {
    const value = action.input?.[key]
    return typeof value === "string" && value.trim() !== "" ? value : fallback
  }

  private normalize(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : ""
  }
}

interface NavigationVerification {
  matched: boolean
  confidence: number
  foundKeywords: string[]
  reason?: string
}
