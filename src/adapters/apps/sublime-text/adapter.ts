import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Action, ActionResult, Observation } from "../../../core/contracts.js"
import { ActionErrorCode } from "../../../core/errors.js"
import type { UseCase } from "../../../usecases/types.js"
import type { AppAdapter } from "../app-adapter.js"

const SUBLIME_TEXT_APP_ID = "com.sublimetext.4"
const SUBLIME_TEXT_USE_CASE_ID = "UC-110"
const SUBLIME_TEXT_SENTINEL = "computer-use-harness: uc-110"
const SUBLIME_TEXT_SAVE_PATH = join(tmpdir(), "computer-use-harness", "uc-110.txt")

export const sublimeTextAdapter: AppAdapter = {
  appId: SUBLIME_TEXT_APP_ID,
  appName: "Sublime Text",

  async prepareUseCase(useCase: UseCase): Promise<void> {
    if (useCase.id !== SUBLIME_TEXT_USE_CASE_ID) {
      return
    }

    await mkdir(dirname(SUBLIME_TEXT_SAVE_PATH), { recursive: true })
    await writeFile(SUBLIME_TEXT_SAVE_PATH, "", "utf8")
  },

  bindActionInput(useCase: UseCase, action: Action): Action {
    if (useCase.id !== SUBLIME_TEXT_USE_CASE_ID) {
      return action
    }

    const description = normalize(action.input?.description)
    const input = { ...(action.input ?? {}) }

    if (action.kind === "open") {
      input.filePath = SUBLIME_TEXT_SAVE_PATH
    }

    if (action.kind === "type") {
      input.text = SUBLIME_TEXT_SENTINEL
    }

    if (description.includes("verify saved file content")) {
      input.filePath = SUBLIME_TEXT_SAVE_PATH
      input.expectedText = SUBLIME_TEXT_SENTINEL
    }

    if (description.includes("dismiss registration dialog")) {
      input.buttonName = "Cancel"
    }

    if (description.includes("focus document window")) {
      input.windowTitle = "uc-110.txt"
    }

    return {
      ...action,
      input,
    }
  },

  bindElement(action: Action, observation: Observation): Action {
    const description = normalize(action.input?.description)

    // Type into document: use window as element placeholder
    if (action.kind === "type") {
      const docWindow = findWindowByTitle(observation.elements, "uc-110.txt")
      if (docWindow) {
        return {
          ...action,
          element: docWindow,
          input: {
            ...(action.input ?? {}),
            elementBinding: "sublime-text-window",
          },
        }
      }
      return action
    }

    if (action.kind !== "click") {
      return action
    }

    // Dismiss registration dialog
    if (description.includes("dismiss registration dialog")) {
      const cancelButton = findButton(observation.elements, "Cancel")
      if (cancelButton) {
        return {
          ...action,
          element: cancelButton,
          input: {
            ...(action.input ?? {}),
            elementBinding: "sublime-cancel-button",
          },
        }
      }
      return action
    }

    // Focus document window
    if (description.includes("focus document window")) {
      const docWindow = findWindowByTitle(observation.elements, "uc-110.txt")
      if (docWindow) {
        return {
          ...action,
          element: docWindow,
          input: {
            ...(action.input ?? {}),
            elementBinding: "sublime-document-window",
          },
        }
      }
      return action
    }

    return action
  },

  async verifyAction(action: Action, observation: Observation): Promise<ActionResult | undefined> {
    if (!isFileVerificationStep(action)) {
      return undefined
    }

    const filePath = stringInput(action, "filePath", SUBLIME_TEXT_SAVE_PATH)
    const expectedText = stringInput(action, "expectedText", SUBLIME_TEXT_SENTINEL)

    try {
      const content = await readFile(filePath, "utf8")
      if (content === expectedText) {
        return {
          actionId: action.id,
          ok: true,
          status: "passed",
          adapter: "mac-helper",
          observation,
          metadata: {
            helperMethod: "file-system-verifier",
            verifier: "sublime-text-file-content",
            filePath,
            expectedText,
          },
        }
      }

      return failedFileVerification(action, observation, {
        filePath,
        expectedText,
        actualText: content.slice(0, 200),
      })
    } catch (error) {
      return failedFileVerification(action, observation, {
        filePath,
        expectedText,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
}

function isFileVerificationStep(action: Action): boolean {
  const description = normalize(action.input?.description)
  return description.includes("verify saved file content")
}

function failedFileVerification(
  action: Action,
  observation: Observation,
  details: Record<string, string>,
): ActionResult {
  return {
    actionId: action.id,
    ok: false,
    status: "failed",
    adapter: "mac-helper",
    observation,
    metadata: {
      helperMethod: "file-system-verifier",
      verifier: "sublime-text-file-content",
      verificationId: `verify_${randomUUID()}`,
    },
    error: {
      code: ActionErrorCode.ACTION_FAILED,
      message: "Sublime Text file verifier did not confirm the expected file content.",
      details,
    },
  }
}

function findButton(elements: Observation["elements"], buttonName: string): Action["element"] {
  const normalizedName = normalize(buttonName)
  const visibleElements = elements.filter((el) => {
    const role = normalize(el.role)
    const frame = el.metadata?.frame
    const width = isRecord(frame) && typeof frame.width === "number" ? frame.width : 0
    const height = isRecord(frame) && typeof frame.height === "number" ? frame.height : 0
    return !role.includes("menu") && width > 0 && height > 0
  })

  return visibleElements.find((element) => {
    const role = normalize(element.role)
    const name = normalize(element.name)
    return role.includes("button") && name === normalizedName
  })
}

function findWindowByTitle(elements: Observation["elements"], titlePart: string): Action["element"] {
  const normalizedTitle = normalize(titlePart)
  return elements.find((element) => {
    const role = normalize(element.role)
    const name = normalize(element.name)
    return role.includes("window") && name.includes(normalizedTitle)
  })
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
