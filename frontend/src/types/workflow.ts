// Shared type definitions for the Workflow DAG builder.
// These types are used by both the server store and client components.

export type WorkflowTaskStatus = 'idle' | 'running' | 'done' | 'error'

export interface WorkflowTask {
  id: string
  label: string
  prompt: string
  assigneeId: string | null  // CrewMember.id, or null = unassigned (dispatches to 'all')
  x: number                  // canvas position in SVG units (persisted for layout)
  y: number
}

export interface WorkflowEdge {
  from: string  // WorkflowTask.id — must complete before 'to' can run
  to: string    // WorkflowTask.id
}

export interface Workflow {
  id: string
  crewId: string
  tasks: WorkflowTask[]
  edges: WorkflowEdge[]
  createdAt: number
  updatedAt: number
}
