/**
 * Client-side API helpers for workflow management.
 */
import type { Workflow, WorkflowTask, WorkflowEdge } from '@/types/workflow'

export type { Workflow, WorkflowTask, WorkflowEdge }

export async function fetchWorkflow(crewId: string): Promise<Workflow | null> {
  const res = await fetch(`/api/crews/${crewId}/workflow`)
  const data = (await res.json()) as { ok: boolean; workflow?: Workflow | null; error?: string }
  if (!data.ok) throw new Error(data.error ?? 'Failed to fetch workflow')
  return data.workflow ?? null
}

export async function saveWorkflow(
  crewId: string,
  tasks: WorkflowTask[],
  edges: WorkflowEdge[],
): Promise<Workflow> {
  const res = await fetch(`/api/crews/${crewId}/workflow`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks, edges }),
  })
  const data = (await res.json()) as { ok: boolean; workflow?: Workflow; error?: string }
  if (!data.ok || !data.workflow) throw new Error(data.error ?? 'Failed to save workflow')
  return data.workflow
}

export async function clearWorkflow(crewId: string): Promise<void> {
  const res = await fetch(`/api/crews/${crewId}/workflow`, { method: 'DELETE' })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? 'Failed to delete workflow')
  }
}
