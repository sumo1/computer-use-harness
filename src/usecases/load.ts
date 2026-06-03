import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import YAML from "yaml"
import type { TargetKind } from "../core/contracts.js"
import type { UseCase, UseCaseDryRunItem, UseCaseListItem } from "./types.js"

const DEFAULT_USECASE_PATH = "usecases/cases.yaml"

export async function loadUseCases(path = DEFAULT_USECASE_PATH): Promise<UseCase[]> {
  const content = await readFile(resolve(process.cwd(), path), "utf8")
  const parsed = YAML.parse(content)

  if (!Array.isArray(parsed)) {
    throw new Error("use case file must contain a YAML array")
  }

  return parsed.map(validateUseCase)
}

export function toListItem(useCase: UseCase): UseCaseListItem {
  return {
    id: useCase.id,
    title: useCase.title,
    requires: useCase.requires ?? {},
  }
}

export function toDryRunItem(useCase: UseCase): UseCaseDryRunItem {
  return {
    id: useCase.id,
    title: useCase.title,
    target: useCase.target,
    requires: useCase.requires ?? {},
    steps: useCase.steps,
    success: useCase.success,
  }
}

function validateUseCase(raw: unknown): UseCase {
  if (!isRecord(raw)) {
    throw new Error("use case entry must be an object")
  }

  const id = readString(raw, "id")
  const title = readString(raw, "title")
  const target = readTarget(raw.target)
  const steps = readStringArray(raw, "steps")
  const success = readStringArray(raw, "success")
  const requires = readRequirements(raw.requires)

  return { id, title, target, requires, steps, success }
}

function readTarget(raw: unknown) {
  if (raw === undefined) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error("target must be an object when provided")
  }

  const kind = readTargetKind(raw.kind)

  return {
    kind,
    id: optionalString(raw.id),
    name: optionalString(raw.name),
    platform: normalizeTargetPlatform(optionalString(raw.platform)),
  }
}

function readTargetKind(value: unknown): TargetKind {
  if (value === "app" || value === "browser" || value === "screen") {
    return value
  }

  throw new Error("target.kind must be app, browser, or screen")
}

function readRequirements(raw: unknown) {
  if (raw === undefined) {
    return {}
  }
  if (!isRecord(raw)) {
    throw new Error("requires must be an object when provided")
  }

  return {
    platform: optionalString(raw.platform),
    permissions: optionalStringArray(raw.permissions),
    services: optionalStringArray(raw.services),
  }
}

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string`)
  }
  return value
}

function readStringArray(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${key} must be an array of strings`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("optional string array field must contain only strings")
  }
  return value
}

function normalizeTargetPlatform(platform: string | undefined): "any" | "macos" | undefined {
  if (platform === undefined) {
    return undefined
  }
  if (platform !== "any" && platform !== "macos") {
    throw new Error("target.platform must be any or macos")
  }
  return platform
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
