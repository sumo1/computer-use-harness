import type { CommandErrorCode } from "./errors.js"

export interface CommandResult<T extends object = object> {
  ok: boolean
  command: string
  data?: T
  error?: CommandError
}

export interface CommandError {
  code: CommandErrorCode
  message: string
  details?: Record<string, unknown>
}

export function ok<T extends object>(command: string, data: T): CommandResult<T> {
  return { ok: true, command, data }
}

export function fail(
  command: string,
  code: CommandErrorCode,
  message: string,
  details?: Record<string, unknown>,
): CommandResult {
  return {
    ok: false,
    command,
    error: { code, message, details },
  }
}
