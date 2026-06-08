import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import YAML from "yaml"
import type { TargetKind } from "../core/contracts.js"
import type { UseCase, UseCaseDryRunItem, UseCaseGoal, UseCaseListItem } from "./types.js"

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
    goal: useCase.goal,
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
  const goal = readGoal(raw.goal)
  const steps = readStringArray(raw, "steps")
  const success = readStringArray(raw, "success")
  const requires = readRequirements(raw.requires)

  return { id, title, target, requires, goal, steps, success }
}

function readGoal(raw: unknown): UseCaseGoal | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error("goal must be an object when provided")
  }

  const mode = readString(raw, "mode")
  if (mode !== "target") {
    throw new Error("goal.mode must be target")
  }

  const entity = readString(raw, "entity")
  const query = readString(raw, "query")
  const constraints = readStringMap(raw.constraints, "goal.constraints")
  const navigation = readGoalNavigation(raw.navigation)
  const coverage = readGoalCoverage(raw.coverage)
  const orderBy = readGoalOrder(raw.orderBy)
  const requiredFields = readStringArray(raw, "requiredFields")
  const confirmation = readConfirmation(optionalString(raw.confirmation))
  const maxIterations = readPositiveInteger(raw.maxIterations, "goal.maxIterations")

  return {
    mode,
    entity,
    query,
    constraints,
    navigation,
    coverage,
    orderBy,
    requiredFields,
    confirmation,
    maxIterations,
  }
}

function readGoalNavigation(raw: unknown): UseCaseGoal["navigation"] {
  if (raw === undefined) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error("goal.navigation must be an object when provided")
  }

  return {
    semanticTabs: optionalStringArray(raw.semanticTabs),
  }
}

function readGoalCoverage(raw: unknown): UseCaseGoal["coverage"] {
  if (raw === undefined) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error("goal.coverage must be an object when provided")
  }

  const strategy = readString(raw, "strategy")
  if (strategy !== "visible" && strategy !== "scroll-until-stable") {
    throw new Error("goal.coverage.strategy must be visible or scroll-until-stable")
  }

  return {
    strategy,
    maxScans: readPositiveInteger(raw.maxScans, "goal.coverage.maxScans"),
    maxScrolls: readPositiveInteger(raw.maxScrolls, "goal.coverage.maxScrolls"),
    stableObservations: readPositiveInteger(
      raw.stableObservations,
      "goal.coverage.stableObservations",
    ),
    minObservations: readPositiveInteger(raw.minObservations, "goal.coverage.minObservations"),
  }
}

function readGoalOrder(raw: unknown): UseCaseGoal["orderBy"] {
  if (raw === undefined) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error("goal.orderBy must be an object when provided")
  }

  const field = readString(raw, "field")
  const direction = readString(raw, "direction")
  if (direction !== "asc" && direction !== "desc") {
    throw new Error("goal.orderBy.direction must be asc or desc")
  }

  return { field, direction }
}

function readStringMap(raw: unknown, fieldName: string): Record<string, string> | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!isRecord(raw)) {
    throw new Error(`${fieldName} must be an object when provided`)
  }

  const entries = Object.entries(raw)
  if (entries.some(([, value]) => typeof value !== "string")) {
    throw new Error(`${fieldName} values must be strings`)
  }

  return Object.fromEntries(entries) as Record<string, string>
}

function readConfirmation(value: string | undefined): UseCaseGoal["confirmation"] {
  if (value === undefined) {
    return undefined
  }
  if (value !== "list" && value !== "detail") {
    throw new Error("goal.confirmation must be list or detail")
  }
  return value
}

function readPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`)
  }
  return value
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
