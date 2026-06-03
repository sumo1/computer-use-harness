import { AXElementFinder } from "./ax-element-finder.js"
import { CapabilityChain } from "./capability-chain.js"
import { CoordinateClicker } from "./coordinate-clicker.js"
import { FirstResultClicker } from "./first-result-clicker.js"
import { ScreenshotVisionCapability } from "./screenshot-vision.js"
import { TextInputHandler } from "./text-input-handler.js"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"

/**
 * Default capability chain for computer-use actions.
 * Ordered by priority: try specific methods first, then fallbacks.
 */
export function createDefaultCapabilityChain(apiKey?: string, helper?: MacHelperClient): CapabilityChain {
  return new CapabilityChain([
    new ScreenshotVisionCapability(apiKey, helper), // Extract: vision-based with screenshots
    new TextInputHandler(),                          // Type: search inputs
    new AXElementFinder(),                           // Click/Type: AX tree with keyword
    new FirstResultClicker(),                        // Click: first clickable result (fallback)
    new CoordinateClicker(),                         // Click: fixed coordinates (last resort)
  ])
}

export { CapabilityChain } from "./capability-chain.js"
export { AXElementFinder } from "./ax-element-finder.js"
export { CoordinateClicker } from "./coordinate-clicker.js"
export { FirstResultClicker } from "./first-result-clicker.js"
export { ScreenshotVisionCapability } from "./screenshot-vision.js"
export { TextInputHandler } from "./text-input-handler.js"
export type { Capability, CapabilityResult, SemanticHints } from "./capability.js"
