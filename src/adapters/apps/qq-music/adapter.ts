import { randomUUID } from "node:crypto"
import type { Action, ActionResult, ElementRef, Observation } from "../../../core/contracts.js"
import { ActionErrorCode } from "../../../core/errors.js"
import type { UseCase } from "../../../usecases/types.js"
import type { AppAdapter } from "../app-adapter.js"

const QQ_MUSIC_APP_ID = "com.tencent.qqmusicmac"
const QQ_MUSIC_USE_CASE_ID = "UC-100"

export const qqMusicAdapter: AppAdapter = {
  appId: QQ_MUSIC_APP_ID,
  appName: "QQ音乐",

  bindElement(action: Action, observation: Observation): Action {
    if (action.kind !== "click" && action.kind !== "type") {
      return action
    }

    const description = normalize(stringInput(action, "description", ""))

    // Search all play point (fixed coordinate)
    if (action.kind === "click") {
      const point = searchAllPlayPoint(observation)
      if (point) {
        return {
          ...action,
          input: {
            ...(action.input ?? {}),
            ...point,
            elementBinding: "qqmusic-search-all-play",
          },
        }
      }
    }

    // Search input or playable duck
    const element =
      action.kind === "type" ? findSearchInput(observation.elements) : findPlayableDuck(observation.elements)

    if (!element) {
      return action
    }

    return {
      ...action,
      element,
      input: {
        ...(action.input ?? {}),
        elementBinding: description.includes("search") ? "search-input" : "playable-result",
      },
    }
  },

  async verifyAction(action: Action, observation: Observation): Promise<ActionResult | undefined> {
    if (!isPlaybackVerificationStep(action)) {
      return undefined
    }

    const duckSong = observation.elements
      .map((element) => element.name)
      .find((name) => normalize(name).includes("歌曲名") && normalize(name).includes("鸭子"))
    const isPlaying = observation.elements.some((element) => normalize(element.name).includes("暂停"))

    if (duckSong && isPlaying) {
      return undefined
    }

    return {
      actionId: action.id,
      ok: false,
      status: "failed",
      adapter: "mac-helper",
      observation,
      metadata: {
        helperMethod: "getAppState",
        verifier: "qqmusic-duck-playback",
      },
      error: {
        code: ActionErrorCode.ACTION_FAILED,
        message: "QQ Music playback verifier did not confirm Duck playback.",
        details: {
          song: duckSong ?? "missing",
          playbackState: isPlaying ? "playing" : "not-playing",
        },
      },
    }
  },
}

function isPlaybackVerificationStep(action: Action): boolean {
  const description = normalize(stringInput(action, "description", ""))
  return description.includes("read app state again")
}

function searchAllPlayPoint(observation: Observation): { x: number; y: number } | undefined {
  const visibleElements = observation.elements.filter((el) => {
    const role = normalize(el.role)
    const frame = el.metadata?.frame
    const width = isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
    const height = isRecord(frame) && typeof frame.height === "number" ? frame.height : 0
    return !role.includes("menu") && width > 0 && height > 0
  })

  const panel = visibleElements.find((element) => {
    const roleDescription = normalize(stringMetadata(element, "roleDescription"))
    return normalize(element.name) === "搜索" && roleDescription.includes("面板")
  })

  const frame = panel?.metadata?.frame
  if (!isRecord(frame) || typeof frame.x !== "number" || typeof frame.y !== "number") {
    return undefined
  }

  return {
    x: frame.x + 41,
    y: frame.y + 208,
  }
}

function findSearchInput(elements: ElementRef[]): ElementRef | undefined {
  const candidates = visibleNonMenuElements(elements)
  const bySearchName = candidates.find((element) => {
    const role = normalize(element.role)
    const name = normalize(element.name)
    return name.includes("search") || name.includes("搜索") || role.includes("search")
  })

  return bySearchName ?? candidates.find((element) => isTextInputRole(normalize(element.role)))
}

function findPlayableDuck(elements: ElementRef[]): ElementRef | undefined {
  const namedDuck = visibleNonMenuElements(elements).filter((element) => normalize(element.name).includes("鸭子"))
  return (
    namedDuck.find((element) => isPressableRole(normalize(element.role))) ??
    namedDuck.find((element) => normalize(element.role) !== "statictext") ??
    namedDuck[0]
  )
}

function visibleNonMenuElements(elements: ElementRef[]): ElementRef[] {
  return elements.filter((element) => {
    const role = normalize(element.role)
    const frame = element.metadata?.frame
    const width = isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
    const height = isRecord(frame) && typeof frame.height === "number" ? frame.height : 0

    return !role.includes("menu") && width > 0 && height > 0
  })
}

function isTextInputRole(role: string): boolean {
  return (
    role.includes("textfield") ||
    role.includes("textbox") ||
    role.includes("textarea") ||
    role.includes("textview") ||
    role.includes("searchfield")
  )
}

function isPressableRole(role: string): boolean {
  return role.includes("button") || role.includes("row") || role.includes("cell") || role.includes("link")
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function stringMetadata(element: ElementRef, key: string): string | undefined {
  const value = element.metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
