import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Action, ActionResult, Observation } from "../../../core/contracts.js"
import type { SemanticHints } from "../../../capabilities/capability.js"
import { ActionErrorCode } from "../../../core/errors.js"
import type { UseCase } from "../../../usecases/types.js"
import type { AppAdapter } from "../app-adapter.js"

const SUBLIME_TEXT_APP_ID = "com.sublimetext.4"
const SUBLIME_TEXT_USE_CASE_ID = "UC-110"
const SUBLIME_TEXT_SENTINEL = "computer-use-harness: uc-110"
const SUBLIME_TEXT_SAVE_PATH = join(tmpdir(), "computer-use-harness", "uc-110.txt")

const semanticHints: SemanticHints = {
  "dismiss registration dialog": {
    ax: [{ role: "AXButton", name: "Cancel" }],
  },
  "focus document window": {
    ax: [{ role: "AXWindow", name: "uc-110.txt" }],
  },
  "type computer-use-harness: uc-110 into document": {
    ax: [{ role: "AXWindow", name: "uc-110.txt" }],
  },
}

export const sublimeTextAdapter: AppAdapter = {
  appId: SUBLIME_TEXT_APP_ID,
  appName: "Sublime Text",
  semanticHints,

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

    return {
      ...action,
      input,
    }
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

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}
