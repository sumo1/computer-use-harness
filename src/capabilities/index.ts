import { AXElementFinder } from "./ax-element-finder.js"
import { CapabilityChain } from "./capability-chain.js"
import { CoordinateClicker } from "./coordinate-clicker.js"
import { DialogHandlerCapability } from "./dialog-handler.js"
import { FirstResultClicker } from "./first-result-clicker.js"
import { NavigationVerifierCapability } from "./navigation-verifier.js"
import { ScreenshotVisionCapability } from "./screenshot-vision.js"
import { TextInputHandler } from "./text-input-handler.js"
import { WaitForStateCapability } from "./wait-for-state.js"
import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"

/**
 * Default capability chain for computer-use actions.
 * Ordered by priority: try specific methods first, then fallbacks.
 */
export function createDefaultCapabilityChain(apiKey?: string, helper?: MacHelperClient): CapabilityChain {
  return new CapabilityChain([
    new WaitForStateCapability(helper),              // Wait: state changes, loading
    new NavigationVerifierCapability(),              // Verify: navigation success
    new DialogHandlerCapability(),                   // Handle: system dialogs
    new ScreenshotVisionCapability(apiKey, helper),  // Extract: vision-based with screenshots
    new TextInputHandler(),                          // Type: search inputs
    new AXElementFinder(),                           // Click/Type: AX tree with keyword
    new FirstResultClicker(),                        // Click: first clickable result (fallback)
    new CoordinateClicker(),                         // Click: fixed coordinates (last resort)
  ])
}

export { CapabilityChain } from "./capability-chain.js"
export { AXElementFinder } from "./ax-element-finder.js"
export { CoordinateClicker } from "./coordinate-clicker.js"
export { DialogHandlerCapability } from "./dialog-handler.js"
export { FirstResultClicker } from "./first-result-clicker.js"
export { NavigationVerifierCapability } from "./navigation-verifier.js"
export { ScreenshotVisionCapability } from "./screenshot-vision.js"
export { TextInputHandler } from "./text-input-handler.js"
export { WaitForStateCapability } from "./wait-for-state.js"
export type { Capability, CapabilityResult, SemanticHints } from "./capability.js"
