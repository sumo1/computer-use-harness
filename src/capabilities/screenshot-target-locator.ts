import Anthropic from "@anthropic-ai/sdk"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"
import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Locate a visible click target from a screenshot when AX does not expose it.
 * This is a generic visual fallback for painted tabs, table headers, and list items.
 */
export class ScreenshotTargetLocator implements Capability {
  readonly name = "screenshot-target-locator"
  private readonly anthropic: Anthropic

  constructor(
    apiKey?: string,
    private readonly helper?: MacHelperClient,
  ) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    })
  }

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    if (!this.helper || !canUseVisualTarget(action.kind)) {
      return false
    }

    if (requiresSemanticElementTarget(action)) {
      return false
    }

    return this.targetLabel(action) !== undefined
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const label = this.targetLabel(action)
    if (!label || !this.helper) {
      return {
        success: false,
        reason: "Visual target locator requires a visible named target and helper client.",
      }
    }

    try {
      const screenshot = await this.helper.screenshot(action.target)
      const result = await withTimeout(
        this.locateTarget(screenshot.data, label, this.stringInput(action, "description", "")),
        25_000,
        `Timed out locating visible target '${label}'.`,
      )

      if (!isUsablePoint(result, screenshot.width, screenshot.height)) {
        return {
          success: false,
          reason: `Vision did not return a usable coordinate for '${label}'.`,
          metadata: { result },
        }
      }

      const coordinate = toScreenCoordinate(
        result,
        screenshot.width,
        screenshot.height,
        observation,
      )

      return {
        success: true,
        coordinate,
        metadata: {
          source: "claude-vision-click-target",
          label,
          result,
          coordinateSpace: coordinate.source,
        },
      }
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async locateTarget(
    imageData: string,
    label: string,
    description: string,
  ): Promise<Record<string, unknown>> {
    const prompt = `You are locating a visible UI target in an application screenshot.

Action: ${description}
Target label: ${label}

Find the best visible clickable target matching the label. Prefer tabs, table/list headers, buttons, links, or list items over descriptive body text. If labels include counts or suffixes, such as "${label}43", treat that as a match for "${label}". Avoid unrelated longer labels that merely contain the word, such as detail-field labels.

Return ONLY valid JSON:
{"x": 123, "y": 456, "label": "${label}", "confidence": 0.87}

If no visible clickable target matches, return:
{"status": "target_not_found", "reason": "describe what is visible"}`

    const response = await this.anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imageData,
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

    const textContent = response.content.find((content) => content.type === "text")
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude.")
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error(`No JSON found in visual target response: ${textContent.text.slice(0, 100)}`)
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>
  }

  private targetLabel(action: Action): string | undefined {
    const keyword = this.stringInput(action, "keyword", "")
    if (keyword) {
      return keyword
    }

    const description = this.stringInput(action, "description", "")
    const match = description.match(
      /\b(?:click|hover)\s+(?:tab|button|link|item|row|cell|list)?\s*(?:named|labeled|called)?\s+(.+)$/i,
    )
    return match?.[1]?.trim() || undefined
  }

  private stringInput(action: Action, key: string, fallback: string): string {
    const value = action.input?.[key]
    return typeof value === "string" && value.trim() !== "" ? value : fallback
  }
}

function toScreenCoordinate(
  result: { x: number; y: number },
  screenshotWidth: number,
  screenshotHeight: number,
  observation: Observation,
): { x: number; y: number; source?: string } {
  const windowFrame = findScreenshotWindowFrame(screenshotWidth, screenshotHeight, observation)
  if (!windowFrame) {
    return {
      x: Math.round(result.x),
      y: Math.round(result.y),
      source: "raw-screenshot-coordinate",
    }
  }

  const scaleX = screenshotWidth / windowFrame.width
  const scaleY = screenshotHeight / windowFrame.height

  return {
    x: Math.round(windowFrame.x + result.x / scaleX),
    y: Math.round(windowFrame.y + result.y / scaleY),
    source: "window-relative-screenshot-coordinate",
  }
}

function findScreenshotWindowFrame(
  screenshotWidth: number,
  screenshotHeight: number,
  observation: Observation,
): { x: number; y: number; width: number; height: number } | undefined {
  const windows = observation.elements
    .filter((element) => element.role === "AXWindow")
    .map((element) => element.metadata?.frame)
    .filter(isWindowFrame)

  if (windows.length === 0) {
    return undefined
  }

  const scale =
    typeof observation.coordinateSpace?.scale === "number" && observation.coordinateSpace.scale > 0
      ? observation.coordinateSpace.scale
      : 1

  return windows
    .map((frame) => ({
      frame,
      delta:
        Math.abs(frame.width * scale - screenshotWidth) +
        Math.abs(frame.height * scale - screenshotHeight),
    }))
    .sort((left, right) => left.delta - right.delta)
    .at(0)?.frame
}

function isWindowFrame(
  value: unknown,
): value is { x: number; y: number; width: number; height: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number" &&
    typeof (value as { width?: unknown }).width === "number" &&
    typeof (value as { height?: unknown }).height === "number"
  )
}

function canUseVisualTarget(kind: Action["kind"]): boolean {
  return kind === "click" || kind === "secondary-click" || kind === "hover"
}

function requiresSemanticElementTarget(action: Action): boolean {
  const description = typeof action.input?.description === "string" ? action.input.description : ""
  return /\b(?:click|hover)\s+tab\s+named\b/i.test(description)
}

function isUsablePoint(
  result: Record<string, unknown>,
  width: number,
  height: number,
): result is { x: number; y: number } {
  if (result.status === "target_not_found") {
    return false
  }

  return (
    typeof result.x === "number" &&
    typeof result.y === "number" &&
    Number.isFinite(result.x) &&
    Number.isFinite(result.y) &&
    result.x >= 0 &&
    result.y >= 0 &&
    result.x <= width &&
    result.y <= height
  )
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
