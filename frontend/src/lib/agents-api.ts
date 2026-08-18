/**
 * Client-side API helpers for custom agent definitions.
 */
import type { AgentDefinition, CreateAgentInput, UpdateAgentInput } from '@/types/agent'
export type { AgentDefinition, CreateAgentInput, UpdateAgentInput }

export async function fetchAgents(): Promise<AgentDefinition[]> {
  const res = await fetch('/api/agents')
  const data = (await res.json()) as { ok: boolean; agents?: AgentDefinition[]; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to fetch agents')
  return data.agents ?? []
}

export async function fetchAgent(id: string): Promise<AgentDefinition | null> {
  const res = await fetch(`/api/agents/${id}`)
  if (!res.ok) return null
  const data = (await res.json()) as { ok: boolean; agent?: AgentDefinition }
  return data.agent ?? null
}

export async function createAgent(input: CreateAgentInput): Promise<AgentDefinition> {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json()) as { ok: boolean; agent?: AgentDefinition; error?: string }
  if (!data.ok || !data.agent) throw new Error(data.error ?? 'Failed to create agent')
  return data.agent
}

export async function updateAgent(
  id: string,
  updates: UpdateAgentInput,
): Promise<AgentDefinition> {
  const res = await fetch(`/api/agents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  const data = (await res.json()) as { ok: boolean; agent?: AgentDefinition; error?: string }
  if (!data.ok || !data.agent) throw new Error(data.error ?? 'Failed to update agent')
  return data.agent
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' })
  const data = (await res.json()) as { ok: boolean; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to delete agent')
}
