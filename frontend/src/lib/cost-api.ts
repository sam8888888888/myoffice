/**
 * Client-side API helpers for crew cost/token tracking.
 */
import type { CrewUsage } from '@/types/cost'
import type { QueryClient } from '@tanstack/react-query'
export type { CrewUsage, MemberUsage } from '@/types/cost'

export async function fetchCrewUsage(crewId: string): Promise<CrewUsage | null> {
  const res = await fetch(`/api/crews/${crewId}/usage`)
  const data = (await res.json()) as { ok: boolean; usage?: CrewUsage | null; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to fetch usage')
  return data.usage ?? null
}

export async function recordMemberUsage(
  crewId: string,
  payload: {
    sessionKey: string
    displayName: string
    model: string | null
    inputTokens: number
    outputTokens: number
  },
): Promise<CrewUsage> {
  const res = await fetch(`/api/crews/${crewId}/usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json()) as { ok: boolean; usage?: CrewUsage; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to record usage')
  return data.usage!
}

export async function resetUsage(crewId: string): Promise<void> {
  const res = await fetch(`/api/crews/${crewId}/usage`, { method: 'DELETE' })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to reset usage')
}

/**
 * Fetches token counts from the Hermes context-usage endpoint for a member
 * session, then POSTs them to the crew usage store, and invalidates the
 * crew-usage query to trigger a re-render on the Usage tab.
 *
 * Called from the SSE `done` event handler in crew-detail-screen.tsx.
 */
export async function fetchAndRecordUsage(
  crewId: string,
  member: { sessionKey: string; displayName: string; model: string | null },
  queryClient: QueryClient,
): Promise<void> {
  try {
    const res = await fetch(
      `/api/context-usage?sessionId=${encodeURIComponent(member.sessionKey)}`,
    )
    if (!res.ok) return
    const data = (await res.json()) as {
      ok: boolean
      model?: string
      inputTokens?: number
      outputTokens?: number
    }
    if (!data.ok) return

    const inputTokens = data.inputTokens ?? 0
    const outputTokens = data.outputTokens ?? 0
    // Only record if we actually got token data
    if (inputTokens === 0 && outputTokens === 0) return

    await recordMemberUsage(crewId, {
      sessionKey: member.sessionKey,
      displayName: member.displayName,
      model: data.model ?? member.model,
      inputTokens,
      outputTokens,
    })
    void queryClient.invalidateQueries({ queryKey: ['crew-usage', crewId] })
  } catch {
    // Non-critical — usage tracking failure should not surface as an error
  }
}
