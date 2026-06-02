import { randomUUID } from "node:crypto"
import type { ActionKind, PolicyDecision, Target } from "../core/contracts.js"

interface PolicyRequest {
  target: Target
  actionKind: ActionKind
}

interface BlockedTargetRule {
  id: string
  reason: string
  appIds: string[]
  nameTokens: string[]
}

const BLOCKED_TARGET_RULES: BlockedTargetRule[] = [
  {
    id: "blocked.self.terminal",
    reason: "Do not operate the current terminal or shell host.",
    appIds: ["com.apple.Terminal", "com.googlecode.iterm2"],
    nameTokens: ["terminal", "iterm"],
  },
  {
    id: "blocked.agent.host",
    reason: "Do not operate the active agent host application.",
    appIds: [],
    nameTokens: ["claude code", "codex"],
  },
  {
    id: "blocked.system.security",
    reason: "Do not operate macOS security or permission dialogs automatically.",
    appIds: ["com.apple.systempreferences", "com.apple.systemsettings"],
    nameTokens: ["security", "privacy", "system settings", "system preferences"],
  },
]

export function evaluatePolicy(request: PolicyRequest): PolicyDecision {
  const blockedRule = BLOCKED_TARGET_RULES.find((rule) =>
    matchesBlockedTarget(rule, request.target),
  )

  if (blockedRule) {
    return {
      id: `policy_${randomUUID()}`,
      status: "blocked",
      target: request.target,
      reason: blockedRule.reason,
      ruleId: blockedRule.id,
      requiresConfirmation: false,
    }
  }

  return {
    id: `policy_${randomUUID()}`,
    status: "allowed",
    target: request.target,
    reason: `Action '${request.actionKind}' is allowed by the default policy.`,
    requiresConfirmation: false,
  }
}

function matchesBlockedTarget(rule: BlockedTargetRule, target: Target): boolean {
  const targetId = target.id?.toLowerCase()
  const targetName = target.name?.toLowerCase()

  return (
    (targetId !== undefined && rule.appIds.some((appId) => appId.toLowerCase() === targetId)) ||
    (targetName !== undefined && rule.nameTokens.some((token) => targetName.includes(token)))
  )
}
