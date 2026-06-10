import Anthropic from "@anthropic-ai/sdk"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"
import type { AccessibilityNode, Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Extract information from screen using Claude Vision.
 * Takes screenshot and uses vision model to understand and extract structured data.
 */
export class ScreenshotVisionCapability implements Capability {
  readonly name = "screenshot-vision"
  private anthropic: Anthropic
  private helper?: MacHelperClient

  constructor(apiKey?: string, helper?: MacHelperClient) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    })
    this.helper = helper
  }

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    return action.kind === "extract"
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const query = this.stringInput(action, "query", "")

    if (!query) {
      return {
        success: false,
        reason: "Extract action requires a query",
      }
    }

    try {
      const result = this.helper
        ? await this.extractWithScreenshot(action, observation, query)
        : await this.extractWithAXTree(observation, query)

      return {
        success: true,
        metadata: {
          source: this.helper ? "claude-vision-screenshot" : "claude-vision-ax",
          query,
          result,
        },
      }
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async extractWithScreenshot(
    action: Action,
    observation: Observation,
    query: string,
  ): Promise<Record<string, unknown>> {
    if (!this.helper) {
      throw new Error("Helper client not provided")
    }

    const screenshot = await this.helper.screenshot(action.target)
    const accessibilityContext = this.buildAccessibilityContext(observation)

    const prompt = `You are analyzing an application window.

Task: ${query}

Use both sources of evidence:
1. The screenshot shows the current visual state.
2. The accessibility context may contain visible text, link labels, headings, list items, and hidden-but-associated values such as dates.

Accessibility context:
${accessibilityContext}

Follow the task constraints exactly. Extract only the fields requested by the task. Ignore unrelated controls, navigation labels, decorative content, and stale background text. If the task asks for a ranked answer such as newest, largest, highest, or most popular, compare all visible matching candidates and include the comparison basis in the JSON.

Return ONLY valid JSON (no markdown), for example:
{"name": "example item", "basis": "matched visible field and compared requested ranking value"}

If the required fields are not present in either the screenshot or accessibility context, return: {"status": "insufficient_evidence", "reason": "describe the missing fields and visible candidates"}`

    const response = await withTimeout(
      this.anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshot.data,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
      45_000,
      "Timed out extracting structured data from screenshot.",
    )

    const textContent = response.content.find((c) => c.type === "text")
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude")
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error(`No JSON found in response: ${textContent.text.slice(0, 100)}`)
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>
  }

  private async extractWithAXTree(
    observation: Observation,
    query: string,
  ): Promise<Record<string, unknown>> {
    const accessibilityContext = this.buildAccessibilityContext(observation)

    const prompt = `You are analyzing an application window from accessibility data.

Accessibility context:
${accessibilityContext}

Task: ${query}

Use link labels, headings, static text, row/cell labels, and structured values from the context. Follow the task constraints exactly. Ignore unrelated controls and decorative content. If multiple matching entries are present, compare the field requested by the task, such as date, size, count, or popularity.

Return ONLY valid JSON (no markdown), for example:
{"name": "example item", "basis": "matched visible field and compared requested ranking value"}

If the required fields are not present, return: {"status": "insufficient_evidence", "availableInfo": "describe the missing fields and visible candidates"}`

    const response = await withTimeout(
      this.anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      45_000,
      "Timed out extracting structured data from accessibility context.",
    )

    const textContent = response.content.find((c) => c.type === "text")
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude")
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error(`No JSON found in response: ${textContent.text.slice(0, 100)}`)
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>
  }

  private stringInput(action: Action, key: string, fallback: string): string {
    const value = action.input?.[key]
    return typeof value === "string" && value.trim() !== "" ? value : fallback
  }

  private buildAccessibilityContext(observation: Observation): string {
    const entries = this.namedEntries(observation)
    const visibleEntries = entries.filter((entry) => this.isVisibleFrame(entry.frame, observation))
    const highSignalEntries = visibleEntries
      .filter((entry) => this.isHighSignalEntry(entry))
      .slice(0, 120)
    const dateLikeEntries = visibleEntries
      .filter((entry) => containsDateLikeText(entry.name))
      .map((entry) => `${entry.role}: "${entry.name}"`)
      .slice(0, 40)

    const highSignalText =
      highSignalEntries.length > 0
        ? highSignalEntries.map((entry) => this.formatEntry(entry)).join("\n")
        : "(none)"

    const dateLikeText = unique(dateLikeEntries).join("\n") || "(none)"

    return [
      "High-signal visible entries:",
      highSignalText,
      "",
      "Visible date-like entries:",
      dateLikeText,
    ].join("\n")
  }

  private namedEntries(
    observation: Observation,
  ): Array<{ role: string; name: string; frame?: Record<string, unknown> }> {
    const entries: Array<{ role: string; name: string; frame?: Record<string, unknown> }> = []

    for (const element of this.axElementSource(observation)) {
      if (!element.name) {
        continue
      }
      const frame = this.isRecord(element.metadata?.frame) ? element.metadata.frame : undefined
      entries.push({
        role: element.role ?? "unknown",
        name: element.name,
        frame,
      })
    }

    for (const root of observation.accessibilityTree ?? []) {
      this.collectNamedAccessibilityEntries(root, entries)
    }

    const seen = new Set<string>()
    return entries.filter((entry) => {
      const frame = entry.frame
      const key = [
        entry.role,
        entry.name,
        this.isRecord(frame) ? frame.x : "",
        this.isRecord(frame) ? frame.y : "",
      ].join("|")

      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  private collectNamedAccessibilityEntries(
    node: AccessibilityNode,
    entries: Array<{ role: string; name: string; frame?: Record<string, unknown> }>,
  ): void {
    if (node.name) {
      entries.push({
        role: node.role ?? "unknown",
        name: node.name,
        frame: node.bounds ? { ...node.bounds } : undefined,
      })
    }

    if (!node.children) {
      return
    }

    for (const child of node.children) {
      this.collectNamedAccessibilityEntries(child, entries)
    }
  }

  private isHighSignalEntry(entry: { role: string; name: string }): boolean {
    const role = entry.role.toLowerCase()
    const name = entry.name.trim()

    if (!name) {
      return false
    }

    return (
      containsDateLikeText(name) ||
      role.includes("link") ||
      role.includes("button") ||
      role.includes("row") ||
      role.includes("cell") ||
      role.includes("heading") ||
      role.includes("statictext")
    )
  }

  private formatEntry(entry: {
    role: string
    name: string
    frame?: Record<string, unknown>
  }): string {
    const frame = entry.frame
    const position =
      this.isRecord(frame) && typeof frame.x === "number" && typeof frame.y === "number"
        ? ` @(${Math.round(frame.x)},${Math.round(frame.y)})`
        : ""

    return `- ${entry.role}${position}: "${entry.name}"`
  }

  private isVisibleFrame(
    frame: Record<string, unknown> | undefined,
    observation: Observation,
  ): boolean {
    if (!this.isRecord(frame)) {
      return true
    }

    const x = typeof frame.x === "number" ? frame.x : 0
    const y = typeof frame.y === "number" ? frame.y : 0
    const width = typeof frame.width === "number" ? frame.width : 0
    const height = typeof frame.height === "number" ? frame.height : 0
    const screenWidth = observation.coordinateSpace?.screenWidth
    const screenHeight = observation.coordinateSpace?.screenHeight

    if (width <= 0 || height <= 0) {
      return false
    }

    if (typeof screenWidth === "number" && typeof screenHeight === "number") {
      return x + width > 0 && y + height > 0 && x < screenWidth && y < screenHeight
    }

    return true
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
      normalize(element.role).includes("ocr")
    )
  }
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function containsDateLikeText(value: string): boolean {
  return /\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\b/.test(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout)
    }
  })
}
