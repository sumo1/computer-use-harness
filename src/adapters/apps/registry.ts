import type { AppAdapter } from "./app-adapter.js"

const adapters = new Map<string, AppAdapter>()

/**
 * Register an app adapter.
 */
export function registerAppAdapter(adapter: AppAdapter): void {
  const normalizedId = adapter.appId.toLowerCase()
  adapters.set(normalizedId, adapter)
}

/**
 * Get app adapter by bundle ID.
 * Returns undefined if no adapter is registered for the app.
 */
export function getAppAdapter(appId: string | undefined): AppAdapter | undefined {
  if (!appId) {
    return undefined
  }
  const normalizedId = appId.toLowerCase()
  return adapters.get(normalizedId)
}

/**
 * List all registered app adapters.
 */
export function listAppAdapters(): AppAdapter[] {
  return Array.from(adapters.values())
}

/**
 * Clear all registered adapters (mainly for testing).
 */
export function clearAppAdapters(): void {
  adapters.clear()
}
