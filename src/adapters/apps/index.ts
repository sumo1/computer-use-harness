import { registerAppAdapter } from "./registry.js"
import { qqMusicAdapter } from "./qq-music/adapter.js"
import { sublimeTextAdapter } from "./sublime-text/adapter.js"

// Register all app adapters
registerAppAdapter(qqMusicAdapter)
registerAppAdapter(sublimeTextAdapter)
