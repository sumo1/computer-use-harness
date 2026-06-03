import Anthropic from "@anthropic-ai/sdk"
import type { Action, Observation } from "../core/contracts.js"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"
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

    console.log('[ScreenshotVision] Executing with helper:', !!this.helper)

    try {
      const result = this.helper
        ? await this.extractWithScreenshot(action, query)
        : await this.extractWithAXTree(observation, query)

      console.log('[ScreenshotVision] Extraction result:', result)

      return {
        success: true,
        metadata: {
          source: this.helper ? "claude-vision-screenshot" : "claude-vision-ax",
          query,
          result,
        },
      }
    } catch (error) {
      console.error('[ScreenshotVision] Error:', error)
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async extractWithScreenshot(action: Action, query: string): Promise<Record<string, unknown>> {
    if (!this.helper) {
      throw new Error("Helper client not provided")
    }

    // Take screenshot
    const screenshot = await this.helper.screenshot(action.target)

    const prompt = `You are analyzing a QQ Music application window.

Task: ${query}

Look for album information, including album names, release dates, and artist information.

Return ONLY valid JSON (no markdown), for example:
{"albumName": "最伟大的作品", "releaseYear": "2022", "artist": "周杰伦"}

If no clear album information is found, return: {"status": "no_album_info_found", "reason": "describe what you see"}`

    const response = await this.anthropic.messages.create({
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
    })

    const textContent = response.content.find((c) => c.type === "text")
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude")
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response: " + textContent.text.slice(0, 100))
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>
  }

  private async extractWithAXTree(observation: Observation, query: string): Promise<Record<string, unknown>> {
    // Prepare context from observation - include more elements
    const elementList = observation.elements
      .filter((el) => {
        const frame = el.metadata?.frame
        const width = this.isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
        return width > 20 && el.name
      })
      .map((el) => `- ${el.role}: "${el.name}"`)
      .slice(0, 150)
      .join("\n")

    const prompt = `You are analyzing a QQ Music application window showing search results for "周杰伦" (Jay Chou).

Available UI elements from the window:
${elementList}

Task: ${query}

Look for elements that contain album names, particularly recent albums. Common patterns:
- AXLink with album names
- AXStaticText with album titles
- Elements with "专辑" (album) in the name

Based on the elements above, identify Jay Chou's albums and return information about the most recent one.

Return ONLY valid JSON (no markdown), for example:
{"albumName": "最伟大的作品", "releaseInfo": "2022"}

If no clear album information is found, return: {"status": "no_album_info_found", "availableInfo": "describe what you see"}`

    const response = await this.anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const textContent = response.content.find((c) => c.type === "text")
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude")
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response: " + textContent.text.slice(0, 100))
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>
  }

  private stringInput(action: Action, key: string, fallback: string): string {
    const value = action.input?.[key]
    return typeof value === "string" && value.trim() !== "" ? value : fallback
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
