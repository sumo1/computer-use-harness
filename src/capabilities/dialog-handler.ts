import type { Action, Observation } from "../core/contracts.js"
import type { Capability, CapabilityResult, SemanticHints } from "./capability.js"

/**
 * Automatically detect and handle system dialogs.
 * Reduces app-specific dialog handling code.
 */
export class DialogHandlerCapability implements Capability {
  readonly name = "dialog-handler"

  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean {
    // Auto-detect dialogs when observing
    if (action.kind === "observe" || action.kind === "click") {
      return this.detectDialog(observation) !== null
    }
    return false
  }

  async execute(
    action: Action,
    observation: Observation,
    hints?: SemanticHints,
  ): Promise<CapabilityResult> {
    const dialog = this.detectDialog(observation)

    if (!dialog) {
      return {
        success: false,
        reason: "No dialog detected",
      }
    }

    // Auto-handle common dialogs
    const handler = this.getAutoHandler(dialog)

    if (handler) {
      return {
        success: true,
        element: handler.button,
        metadata: {
          source: "dialog-handler",
          dialogType: dialog.type,
          action: handler.action,
          autoHandled: true,
        },
      }
    }

    // Dialog detected but needs user decision
    return {
      success: true,
      metadata: {
        source: "dialog-handler",
        dialogType: dialog.type,
        buttons: dialog.buttons.map((b) => b?.name || ""),
        autoHandled: false,
        needsUserDecision: true,
      },
    }
  }

  private detectDialog(observation: Observation): Dialog | null {
    const windows = observation.elements.filter((el) => this.normalize(el.role) === "window")

    for (const window of windows) {
      // Find buttons in this window
      const buttons = observation.elements.filter(
        (el) =>
          this.normalize(el.role) === "button" &&
          el.metadata?.window === window.id,
      )

      if (buttons.length === 0) continue

      const buttonNames = buttons.map((b) => this.normalize(b.name || ""))

      // Common dialog patterns
      if (this.matchesPattern(buttonNames, ["ok"])) {
        return { type: "alert", buttons, window }
      }

      if (this.matchesPattern(buttonNames, ["ok", "cancel"])) {
        return { type: "confirmation", buttons, window }
      }

      if (this.matchesPattern(buttonNames, ["save", "cancel", "don't save"])) {
        return { type: "save-changes", buttons, window }
      }

      if (this.matchesPattern(buttonNames, ["cancel"]) && this.normalize(window.name).includes("registration")) {
        return { type: "registration", buttons, window }
      }

      // Generic dialog: small window with 1-3 buttons
      if (buttons.length >= 1 && buttons.length <= 3) {
        const frame = window.metadata?.frame
        if (
          this.isRecord(frame) &&
          typeof frame.width === "number" &&
          typeof frame.height === "number"
        ) {
          if (frame.width < 600 && frame.height < 400) {
            return { type: "generic", buttons, window }
          }
        }
      }
    }

    return null
  }

  private getAutoHandler(dialog: Dialog): { button: Action["element"]; action: string } | null {
    const buttonNames = dialog.buttons.map((b) => this.normalize(b?.name))

    switch (dialog.type) {
      case "registration":
        // Auto-dismiss registration dialogs
        const cancelButton = dialog.buttons.find((b) => this.normalize(b?.name) === "cancel")
        if (cancelButton) {
          return { button: cancelButton, action: "dismiss-registration" }
        }
        break

      case "alert":
        // Auto-click OK on alerts
        const okButton = dialog.buttons.find((b) => this.normalize(b?.name) === "ok")
        if (okButton) {
          return { button: okButton, action: "acknowledge-alert" }
        }
        break

      // Other dialog types: ask user
      default:
        return null
    }

    return null
  }

  private matchesPattern(buttonNames: string[], pattern: string[]): boolean {
    if (buttonNames.length !== pattern.length) return false
    return pattern.every((expected) => buttonNames.some((actual) => actual.includes(expected)))
  }

  private normalize(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : ""
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}

interface Dialog {
  type: "alert" | "confirmation" | "save-changes" | "registration" | "generic"
  buttons: Action["element"][]
  window: Action["element"]
}
