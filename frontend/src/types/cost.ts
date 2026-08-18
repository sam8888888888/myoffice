/**
 * Cost/token tracking types — per-crew and per-member usage aggregates.
 */

/** Token counts and cost for a single crew member's session. */
export interface MemberUsage {
  sessionKey: string
  /** Snapshot of member.displayName at record time */
  displayName: string
  /** Model string from Hermes session or member config */
  model: string | null
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  lastUpdatedAt: number
}

/** Aggregate usage for an entire crew. */
export interface CrewUsage {
  crewId: string
  /** Keyed by sessionKey */
  members: Record<string, MemberUsage>
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCostUsd: number
  lastUpdatedAt: number
}

/** Shape of .runtime/costs.json */
export interface CostStoreData {
  crews: Record<string, CrewUsage>
}
