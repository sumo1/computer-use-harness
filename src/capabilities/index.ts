import type { MacHelperClient } from "../adapters/mac/helper-protocol.js"
import { AXElementFinder } from "./ax-element-finder.js"
import { AXStructuredExtractor } from "./ax-structured-extractor.js"
import { CapabilityChain } from "./capability-chain.js"
import { CoordinateClicker } from "./coordinate-clicker.js"
import { DialogHandlerCapability } from "./dialog-handler.js"
import { FirstResultClicker } from "./first-result-clicker.js"
import { NavigationVerifierCapability } from "./navigation-verifier.js"
import { ScreenshotTargetLocator } from "./screenshot-target-locator.js"
import { ScreenshotVisionCapability } from "./screenshot-vision.js"
import { TextInputHandler } from "./text-input-handler.js"
import { WaitForStateCapability } from "./wait-for-state.js"

/**
 * Default capability chain for computer-use actions.
 * Ordered by priority: try specific methods first, then fallbacks.
 */
export function createDefaultCapabilityChain(
  apiKey?: string,
  helper?: MacHelperClient,
): CapabilityChain {
  return new CapabilityChain([
    new WaitForStateCapability(helper), // Wait: state changes, loading
    new NavigationVerifierCapability(), // Verify: navigation success
    new DialogHandlerCapability(), // Handle: system dialogs
    new AXStructuredExtractor(), // Extract: deterministic AX records
    new ScreenshotVisionCapability(apiKey, helper), // Extract: vision-based with screenshots
    new TextInputHandler(), // Type: search inputs
    new AXElementFinder(), // Click/Type: AX tree with keyword
    new ScreenshotTargetLocator(apiKey, helper), // Click: visible painted UI fallback
    new FirstResultClicker(), // Click: first clickable result (fallback)
    new CoordinateClicker(), // Click: fixed coordinates (last resort)
  ])
}

export { CapabilityChain } from "./capability-chain.js"
export { AXElementFinder } from "./ax-element-finder.js"
export { AXStructuredExtractor } from "./ax-structured-extractor.js"
export { CoordinateClicker } from "./coordinate-clicker.js"
export { DialogHandlerCapability } from "./dialog-handler.js"
export { FirstResultClicker } from "./first-result-clicker.js"
export { NavigationVerifierCapability } from "./navigation-verifier.js"
export { ScreenshotVisionCapability } from "./screenshot-vision.js"
export { ScreenshotTargetLocator } from "./screenshot-target-locator.js"
export { TextInputHandler } from "./text-input-handler.js"
export { WaitForStateCapability } from "./wait-for-state.js"
export type { Capability, CapabilityResult, SemanticHints } from "./capability.js"
