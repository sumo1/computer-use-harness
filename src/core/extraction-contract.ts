import type { Action, JsonObject } from "./contracts.js"

export interface ExtractionContract {
  requiredFields: string[]
}

const FIELD_STOP_WORDS = new Set([
  "and",
  "or",
  "with",
  "json",
  "return",
  "fields",
  "field",
  "relevant",
  "successfully",
])

export function extractionContractFromAction(action: Action): ExtractionContract {
  const explicitFields = action.input?.extractionFields
  if (Array.isArray(explicitFields)) {
    return {
      requiredFields: uniqueFields(
        explicitFields.filter((field): field is string => typeof field === "string"),
      ),
    }
  }

  const description = stringInput(action, "description", "")

  return {
    requiredFields: fieldsFromReturnClause(description),
  }
}

export function missingRequiredFields(payload: JsonObject, contract: ExtractionContract): string[] {
  if (contract.requiredFields.length === 0) {
    return []
  }

  const available = new Set(Object.keys(payload).map(normalizeFieldName))

  return contract.requiredFields.filter((field) => !available.has(normalizeFieldName(field)))
}

export function normalizeFieldName(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "").toLowerCase()
}

function fieldsFromReturnClause(description: string): string[] {
  const match = description.match(/\breturn\s+(.+?)(?:[.;；。]|$)/i)
  const clause = match?.[1]?.trim()
  if (!clause) {
    return []
  }

  return uniqueFields(
    clause
      .split(/[\s,，、]+/)
      .map((field) => field.trim())
      .filter((field) => field.length > 0)
      .filter((field) => !FIELD_STOP_WORDS.has(field.toLowerCase()))
      .filter((field) => /[\p{L}\p{N}]/u.test(field)),
  )
}

function uniqueFields(fields: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const field of fields) {
    const key = normalizeFieldName(field)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(field)
  }

  return result
}

function stringInput(action: Action, key: string, fallback: string): string {
  const value = action.input?.[key]
  return typeof value === "string" && value.trim() !== "" ? value : fallback
}
