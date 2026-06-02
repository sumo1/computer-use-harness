import type { AppCapability } from "../core/contracts.js"

const APP_CAPABILITIES: AppCapability[] = [
  {
    appId: "com.apple.Terminal",
    displayName: "Terminal",
    aliases: ["terminal", "iterm", "iterm2"],
    supportLevel: "blocked",
    adapters: [],
    fallback: ["blocked"],
    requiredPermissions: [],
  },
  {
    appId: "com.apple.Safari",
    displayName: "Safari",
    aliases: ["safari"],
    supportLevel: "custom",
    adapters: ["browser-harness"],
    fallback: ["custom", "generic", "screen"],
    requiredPermissions: [],
  },
  {
    appId: "com.google.Chrome",
    displayName: "Google Chrome",
    aliases: ["chrome", "google chrome"],
    supportLevel: "custom",
    adapters: ["browser-harness"],
    fallback: ["custom", "generic", "screen"],
    requiredPermissions: [],
  },
  {
    appId: "com.jetbrains.intellij",
    displayName: "IntelliJ IDEA",
    aliases: ["idea", "intellij", "intellij idea"],
    supportLevel: "automation",
    adapters: ["app-specific", "mac-helper"],
    fallback: ["automation", "generic", "screen"],
    requiredPermissions: ["accessibility"],
  },
  {
    appId: "com.apple.finder",
    displayName: "Finder",
    aliases: ["finder"],
    supportLevel: "generic",
    adapters: ["mac-helper"],
    fallback: ["generic", "screen"],
    requiredPermissions: ["accessibility"],
  },
]

export function listAppCapabilities(): AppCapability[] {
  return APP_CAPABILITIES
}

export function findAppCapability(appName: string): AppCapability | undefined {
  const normalized = normalizeAppName(appName)

  return APP_CAPABILITIES.find(
    (capability) =>
      normalizeAppName(capability.appId) === normalized ||
      normalizeAppName(capability.displayName) === normalized ||
      capability.aliases?.some((alias) => normalizeAppName(alias) === normalized),
  )
}

function normalizeAppName(value: string): string {
  return value.trim().toLowerCase()
}
