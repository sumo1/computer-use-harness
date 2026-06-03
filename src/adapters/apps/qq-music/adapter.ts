import type { Action, Observation } from "../../../core/contracts.js"
import type { SemanticHints } from "../../../capabilities/capability.js"
import type { UseCase } from "../../../usecases/types.js"
import type { AppAdapter } from "../app-adapter.js"

const QQ_MUSIC_APP_ID = "com.tencent.qqmusicmac"

const semanticHints: SemanticHints = {
  "click result": {
    // Coordinate fallback for "Play All" button
    coordinate: [{ relative: "搜索", x: 41, y: 208 }],
  },
}

export const qqMusicAdapter: AppAdapter = {
  appId: QQ_MUSIC_APP_ID,
  appName: "QQ音乐",
  semanticHints,
}
