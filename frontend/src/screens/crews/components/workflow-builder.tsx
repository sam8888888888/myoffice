'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  ConnectIcon,
  Delete01Icon,
  PlayIcon,
  Share01Icon,
} from '@hugeicons/core-free-icons'
import type { Crew, CrewMember } from '@/lib/crews-api'
import { dispatchTask } from '@/lib/crews-api'
import type { Workflow, WorkflowTask, WorkflowEdge } from '@/lib/workflow-api'
import { clearWorkflow, fetchWorkflow, saveWorkflow } from '@/lib/workflow-api'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

// ─── Canvas constants ─────────────────────────────────────────────────────────

const CW = 1100
const CH = 720
const NODE_W = 176
const NODE_H = 68
const NODE_RX = 8
const PORT_R = 5

type WorkflowTaskStatus = 'idle' | 'running' | 'done' | 'error'

// ─── Layout & graph algorithms ────────────────────────────────────────────────

function buildAdj(tasks: WorkflowTask[], edges: WorkflowEdge[]) {
  const adj = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const t of tasks) { adj.set(t.id, []); indeg.set(t.id, 0) }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }
  return { adj, indeg }
}

/** Kahn BFS topological sort → array of parallel layers */
function topoLayers(tasks: WorkflowTask[], edges: WorkflowEdge[]): string[][] {
  if (tasks.length === 0) return []
  const { adj, indeg } = buildAdj(tasks, edges)
  const layers: string[][] = []
  let frontier = tasks.filter(t => (indeg.get(t.id) ?? 0) === 0).map(t => t.id)
  const placed = new Set<string>()
  while (frontier.length > 0) {
    layers.push(frontier)
    frontier.forEach(id => placed.add(id))
    const next: string[] = []
    for (const id of frontier) {
      for (const succ of adj.get(id) ?? []) {
        const newDeg = (indeg.get(succ) ?? 1) - 1
        indeg.set(succ, newDeg)
        if (newDeg === 0) next.push(succ)
      }
    }
    frontier = next
  }
  // Any nodes not placed (isolated or cycle remnants) go in a final layer
  const unplaced = tasks.filter(t => !placed.has(t.id)).map(t => t.id)
  if (unplaced.length > 0) layers.push(unplaced)
  return layers
}

/** DFS cycle check — used client-side before adding an edge */
function wouldCreateCycle(
  tasks: WorkflowTask[],
  edges: WorkflowEdge[],
  newFrom: string,
  newTo: string,
): boolean {
  const testEdges = [...edges, { from: newFrom, to: newTo }]
  const { adj } = buildAdj(tasks, testEdges)
  const color = new Map<string, number>()
  for (const t of tasks) color.set(t.id, 0)

  function dfs(id: string): boolean {
    color.set(id, 1)
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? 0
      if (c === 1) return true
      if (c === 0 && dfs(next)) return true
    }
    color.set(id, 2)
    return false
  }
  for (const t of tasks) {
    if ((color.get(t.id) ?? 0) === 0 && dfs(t.id)) return true
  }
  return false
}

/** Hierarchical left-to-right layout */
function computeAutoLayout(
  tasks: WorkflowTask[],
  edges: WorkflowEdge[],
): Record<string, { x: number; y: number }> {
  const layers = topoLayers(tasks, edges)
  const COL_W = 220
  const ROW_H = 110
  const MARGIN_X = 60
  const MARGIN_Y = 80
  const positions: Record<string, { x: number; y: number }> = {}
  for (let col = 0; col < layers.length; col++) {
    const layer = layers[col]
    const totalH = layer.length * ROW_H
    const startY = Math.max(MARGIN_Y, (CH - totalH) / 2)
    for (let row = 0; row < layer.length; row++) {
      positions[layer[row]] = {
        x: MARGIN_X + col * COL_W,
        y: startY + row * ROW_H,
      }
    }
  }
  return positions
}

function nextGridPos(count: number): { x: number; y: number } {
  const COLS = 4
  const COL_W = 220
  const ROW_H = 110
  const col = count % COLS
  const row = Math.floor(count / COLS)
  return { x: 60 + col * COL_W, y: 80 + row * ROW_H }
}

// ─── Node status visual palette ───────────────────────────────────────────────

const STATUS_FILL: Record<WorkflowTaskStatus, string> = {
  idle:    'transparent',
  running: 'rgba(34,197,94,0.12)',
  done:    'rgba(99,102,241,0.12)',
  error:   'rgba(239,68,68,0.12)',
}

const STATUS_STROKE: Record<WorkflowTaskStatus, string> = {
  idle:    'var(--theme-border)',
  running: 'rgba(34,197,94,0.7)',
  done:    'rgba(99,102,241,0.7)',
  error:   'rgba(239,68,68,0.7)',
}

// ─── Add / Edit task dialog ───────────────────────────────────────────────────

interface TaskDialogProps {
  title: string
  initial?: Partial<WorkflowTask>
  members: CrewMember[]
  onSubmit: (vals: { label: string; prompt: string; assigneeId: string | null }) => void
  onClose: () => void
}

function TaskDialog({ title, initial, members, onSubmit, onClose }: TaskDialogProps) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [assigneeId, setAssigneeId] = useState<string | null>(initial?.assigneeId ?? null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    onSubmit({ label: label.trim(), prompt: prompt.trim(), assigneeId })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 shadow-xl"
        style={{ background: 'var(--theme-panel, var(--theme-bg))', border: '1px solid var(--theme-border)' }}
      >
        <h2 className="mb-4 text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
          {title}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--theme-muted)' }}>
              Task label *
            </label>
            <input
              autoFocus
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Research competitors"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--theme-muted)' }}>
              Prompt sent to agent
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe what the agent should do…"
              rows={4}
              className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--theme-muted)' }}>
              Assign to
            </label>
            <select
              value={assigneeId ?? ''}
              onChange={e => setAssigneeId(e.target.value || null)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            >
              <option value="">All agents</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.displayName} — {m.roleLabel}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium transition-colors"
              style={{
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-muted)',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!label.trim()}
              className="rounded-lg px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--theme-accent)' }}
            >
              {initial?.label ? 'Update' : 'Add Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main WorkflowBuilder component ──────────────────────────────────────────

interface WorkflowBuilderProps {
  crewId: string
  crew: Crew
  displayMembers: CrewMember[]
}

export function WorkflowBuilder({ crewId, crew, displayMembers }: WorkflowBuilderProps) {
  const queryClient = useQueryClient()

  // ── Canvas state ─────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<WorkflowTask[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [dirty, setDirty] = useState(false)

  // Interaction
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [connectFromId, setConnectFromId] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<WorkflowTask | null>(null)
  const [addingTask, setAddingTask] = useState(false)

  // Pan / zoom
  const [tf, setTf] = useState({ tx: 0, ty: 0, k: 1 })

  // Run state
  const [runState, setRunState] = useState<Record<string, WorkflowTaskStatus>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Pending dispatches: sessionKey → taskId (so SSE can resolve completions)
  const pendingRef = useRef<Map<string, string>>(new Map())
  // Current layers for sequential execution
  const layersRef = useRef<string[][]>([])
  const currentLayerRef = useRef<number>(0)
  const runStateRef = useRef<Record<string, WorkflowTaskStatus>>({})

  // SVG ref for pointer capture & coordinate conversion
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{
    kind: 'node' | 'pan' | null
    taskId: string | null
    startCx: number; startCy: number
    origX: number; origY: number
  }>({ kind: null, taskId: null, startCx: 0, startCy: 0, origX: 0, origY: 0 })

  // ── Data fetching ─────────────────────────────────────────────────────────
  const workflowQuery = useQuery({
    queryKey: ['workflow', crewId],
    queryFn: () => fetchWorkflow(crewId),
  })

  // Populate canvas from server data on load
  useEffect(() => {
    const wf = workflowQuery.data
    if (!wf) return
    const positioned = wf.tasks.map((t, i) => ({
      ...t,
      x: t.x ?? 60 + (i % 4) * 220,
      y: t.y ?? 80 + Math.floor(i / 4) * 110,
    }))
    setTasks(positioned)
    setEdges(wf.edges)
    setDirty(false)
  }, [workflowQuery.data])

  const saveMutation = useMutation({
    mutationFn: () => saveWorkflow(crewId, tasks, edges),
    onSuccess: (wf) => {
      queryClient.setQueryData(['workflow', crewId], wf)
      setDirty(false)
      toast('Workflow saved')
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Save failed', { type: 'error' }),
  })

  const clearMutation = useMutation({
    mutationFn: () => clearWorkflow(crewId),
    onSuccess: () => {
      setTasks([]); setEdges([]); setDirty(false)
      queryClient.setQueryData(['workflow', crewId], null)
      toast('Workflow cleared')
    },
    onError: () => toast('Failed to clear workflow', { type: 'error' }),
  })

  // ── Coordinate helpers ────────────────────────────────────────────────────
  function screenDeltaToSvg(dcx: number, dcy: number) {
    const svg = svgRef.current
    if (!svg) return { dx: 0, dy: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      dx: (dcx / rect.width) * CW,
      dy: (dcy / rect.height) * CH,
    }
  }

  // ── Pointer event handlers ────────────────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const target = e.target as Element

    // Connect mode: click target handling
    if (connectFromId !== null) {
      const nodeEl = target.closest('[data-tid]')
      const toId = nodeEl?.getAttribute('data-tid')
      if (toId && toId !== connectFromId) {
        if (edges.some(ed => ed.from === connectFromId && ed.to === toId)) {
          toast('Connection already exists', { type: 'error' })
        } else if (wouldCreateCycle(tasks, edges, connectFromId, toId)) {
          toast('That would create a cycle', { type: 'error' })
        } else {
          setEdges(prev => [...prev, { from: connectFromId, to: toId }])
          setDirty(true)
        }
      }
      setConnectFromId(null)
      return
    }

    const nodeEl = target.closest('[data-tid]')
    const taskId = nodeEl?.getAttribute('data-tid') ?? null

    if (taskId) {
      const task = tasks.find(t => t.id === taskId)
      if (!task) return
      setSelectedTaskId(taskId)
      drag.current = {
        kind: 'node',
        taskId,
        startCx: e.clientX,
        startCy: e.clientY,
        origX: task.x,
        origY: task.y,
      }
    } else {
      setSelectedTaskId(null)
      drag.current = {
        kind: 'pan',
        taskId: null,
        startCx: e.clientX,
        startCy: e.clientY,
        origX: tf.tx,
        origY: tf.ty,
      }
    }
    ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current
    if (!d.kind) return
    const { dx, dy } = screenDeltaToSvg(
      e.clientX - d.startCx,
      e.clientY - d.startCy,
    )
    if (d.kind === 'node' && d.taskId) {
      setTasks(prev =>
        prev.map(t =>
          t.id === d.taskId
            ? {
                ...t,
                x: Math.max(0, Math.min(CW - NODE_W, d.origX + dx / tf.k)),
                y: Math.max(0, Math.min(CH - NODE_H, d.origY + dy / tf.k)),
              }
            : t,
        ),
      )
    } else if (d.kind === 'pan') {
      setTf(p => ({ ...p, tx: d.origX + dx, ty: d.origY + dy }))
    }
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (drag.current.kind === 'node') setDirty(true)
    drag.current.kind = null
    ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
  }

  // Non-passive wheel zoom
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 0.89
      setTf(p => ({ ...p, k: Math.max(0.2, Math.min(4, p.k * factor)) }))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // ── Escape cancels connect mode ───────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConnectFromId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Task mutations ────────────────────────────────────────────────────────
  function addTask(vals: { label: string; prompt: string; assigneeId: string | null }) {
    const pos = nextGridPos(tasks.length)
    const newTask: WorkflowTask = { id: crypto.randomUUID(), ...vals, ...pos }
    setTasks(prev => [...prev, newTask])
    setDirty(true)
    setAddingTask(false)
  }

  function updateTask(id: string, vals: { label: string; prompt: string; assigneeId: string | null }) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...vals } : t))
    setDirty(true)
    setEditingTask(null)
  }

  function deleteTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id))
    setSelectedTaskId(null)
    setDirty(true)
  }

  function deleteEdge(from: string, to: string) {
    setEdges(prev => prev.filter(e => !(e.from === from && e.to === to)))
    setDirty(true)
  }

  function autoLayout() {
    const positions = computeAutoLayout(tasks, edges)
    setTasks(prev => prev.map(t => ({ ...t, ...(positions[t.id] ?? {}) })))
    setDirty(true)
  }

  // ── Run workflow ──────────────────────────────────────────────────────────
  async function dispatchLayer(layer: string[], status: Record<string, WorkflowTaskStatus>) {
    const nextStatus = { ...status }
    for (const taskId of layer) {
      const task = tasks.find(t => t.id === taskId)
      if (!task) continue
      const target = task.assigneeId ?? 'all'
      const member = task.assigneeId
        ? displayMembers.find(m => m.id === task.assigneeId)
        : null
      // Map each dispatched sessionKey to its taskId
      const sessionKeys: string[] = member
        ? [member.sessionKey]
        : displayMembers.map(m => m.sessionKey)
      for (const sk of sessionKeys) {
        pendingRef.current.set(sk, taskId)
      }
      nextStatus[taskId] = 'running'
      await dispatchTask(crewId, task.prompt || task.label, target)
    }
    setRunState(nextStatus)
    runStateRef.current = nextStatus
  }

  async function startWorkflow() {
    if (tasks.length === 0) { toast('Add tasks first', { type: 'error' }); return }
    const layers = topoLayers(tasks, edges)
    if (layers.length === 0) return
    setRunError(null)
    setIsRunning(true)
    layersRef.current = layers
    currentLayerRef.current = 0
    pendingRef.current = new Map()
    const initialState = Object.fromEntries(tasks.map(t => [t.id, 'idle' as WorkflowTaskStatus]))
    setRunState(initialState)
    runStateRef.current = initialState
    await dispatchLayer(layers[0], initialState)
  }

  // ── SSE listener for run completion events ────────────────────────────────
  useEffect(() => {
    if (!isRunning) return
    const sessionKeys = new Set(displayMembers.map(m => m.sessionKey))
    const es = new EventSource('/api/chat-events')

    function handleRunEnd(e: MessageEvent) {
      try {
        const payload = JSON.parse(e.data as string) as Record<string, unknown>
        const sk = typeof payload.sessionKey === 'string' ? payload.sessionKey : null
        if (!sk || !sessionKeys.has(sk)) return

        const taskId = pendingRef.current.get(sk)
        if (!taskId) return
        pendingRef.current.delete(sk)

        const isError = Boolean(payload.error || payload.errorMessage)
        const nextStatus = { ...runStateRef.current, [taskId]: isError ? 'error' : 'done' as WorkflowTaskStatus }
        setRunState(nextStatus)
        runStateRef.current = nextStatus

        if (isError) {
          const task = tasks.find(t => t.id === taskId)
          setRunError(`Task "${task?.label ?? taskId}" failed`)
          setIsRunning(false)
          es.close()
          return
        }

        // Check if current layer is fully done
        const currentLayer = layersRef.current[currentLayerRef.current] ?? []
        const layerDone = currentLayer.every(id => {
          const s = nextStatus[id]
          return s === 'done' || s === 'error'
        })

        if (!layerDone) return

        // Advance to next layer
        const nextLayerIndex = currentLayerRef.current + 1
        if (nextLayerIndex >= layersRef.current.length) {
          setIsRunning(false)
          toast('Workflow complete!')
          es.close()
          return
        }

        currentLayerRef.current = nextLayerIndex
        void dispatchLayer(layersRef.current[nextLayerIndex], nextStatus)
      } catch {
        /* ignore parse errors */
      }
    }

    es.addEventListener('run_end', handleRunEnd)
    es.addEventListener('done', handleRunEnd)

    return () => es.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, displayMembers, crewId])

  // ── Derived values ────────────────────────────────────────────────────────
  const selectedTask = tasks.find(t => t.id === selectedTaskId) ?? null

  const memberById = useMemo(
    () => Object.fromEntries(displayMembers.map(m => [m.id, m])),
    [displayMembers],
  )

  const zoomBy = (f: number) =>
    setTf(p => ({ ...p, k: Math.max(0.2, Math.min(4, p.k * f)) }))

  // ── Empty state ───────────────────────────────────────────────────────────
  if (workflowQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--theme-muted)' }}>
        Loading workflow…
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--theme-bg)' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4 py-2"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-card)' }}
      >
        <button
          onClick={() => setAddingTask(true)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
          style={{ background: 'var(--theme-accent)', color: '#fff' }}
        >
          <HugeiconsIcon icon={Add01Icon} size={13} />
          Add Task
        </button>

        <button
          onClick={() => setConnectFromId(connectFromId === null ? '' : null)}
          title="Connect two tasks (draw dependency edge)"
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
            connectFromId !== null
              ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]'
              : '',
          )}
          style={
            connectFromId === null
              ? { border: '1px solid var(--theme-border)', color: 'var(--theme-muted)', background: 'var(--theme-card)' }
              : undefined
          }
        >
          <HugeiconsIcon icon={ConnectIcon} size={13} />
          {connectFromId !== null ? (connectFromId ? 'Click target…' : 'Click source…') : 'Connect'}
        </button>

        <button
          onClick={autoLayout}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
          style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-muted)', background: 'var(--theme-card)' }}
        >
          <HugeiconsIcon icon={Share01Icon} size={13} />
          Auto Layout
        </button>

        <div className="mx-1 h-4 w-px" style={{ background: 'var(--theme-border)' }} />

        <button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
          style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)', background: 'var(--theme-card)' }}
        >
          {saveMutation.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>

        <button
          onClick={startWorkflow}
          disabled={isRunning || tasks.length === 0}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--theme-success, #22c55e)', color: '#fff' }}
        >
          <HugeiconsIcon icon={PlayIcon} size={13} />
          {isRunning ? 'Running…' : 'Run Workflow'}
        </button>

        {runError && (
          <span className="text-xs" style={{ color: 'var(--theme-danger)' }}>
            ⚠ {runError}
          </span>
        )}

        {tasks.length > 0 && (
          <button
            onClick={() => { if (window.confirm('Clear the entire workflow?')) clearMutation.mutate() }}
            className="ml-auto rounded-lg p-1.5 transition-colors"
            style={{ color: 'var(--theme-muted)' }}
            title="Clear workflow"
          >
            <HugeiconsIcon icon={Delete01Icon} size={14} />
          </button>
        )}

        {/* Zoom controls */}
        <div className={cn('flex items-center gap-0.5', tasks.length > 0 ? '' : 'ml-auto')}>
          {[
            { label: '+', action: () => zoomBy(1.25) },
            { label: '−', action: () => zoomBy(0.8) },
            { label: '⊙', action: () => setTf({ tx: 0, ty: 0, k: 1 }) },
          ].map(({ label, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex h-6 w-6 items-center justify-center rounded text-xs transition-colors"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-card)',
                color: 'var(--theme-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Canvas area ──────────────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl border"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-card)' }}
            >
              <HugeiconsIcon icon={Share01Icon} size={22} style={{ color: 'var(--theme-muted)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--theme-text)' }}>No tasks yet</p>
            <p className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              Add tasks and draw dependencies to build your workflow.
            </p>
            <button
              onClick={() => setAddingTask(true)}
              className="mt-1 rounded-lg px-4 py-2 text-xs font-medium text-white"
              style={{ background: 'var(--theme-accent)' }}
            >
              Add First Task
            </button>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CW} ${CH}`}
            className="h-full w-full select-none"
            style={{ cursor: connectFromId !== null ? 'crosshair' : 'default' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <defs>
              <marker
                id="wf-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.7)" />
              </marker>
              <marker
                id="wf-arrow-running"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(34,197,94,0.7)" />
              </marker>
            </defs>

            <g transform={`translate(${tf.tx} ${tf.ty}) scale(${tf.k})`}>
              {/* ── Edges ─────────────────────────────────────────────── */}
              {edges.map(edge => {
                const src = tasks.find(t => t.id === edge.from)
                const tgt = tasks.find(t => t.id === edge.to)
                if (!src || !tgt) return null
                const sx = src.x + NODE_W
                const sy = src.y + NODE_H / 2
                const tx = tgt.x
                const ty = tgt.y + NODE_H / 2
                const dx = Math.max(80, Math.abs(tx - sx) * 0.5)
                const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
                const srcStatus = runState[edge.from]
                const isActiveEdge = srcStatus === 'running' || srcStatus === 'done'
                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    {/* Wide invisible hit area for click-to-delete */}
                    <path
                      d={d}
                      stroke="transparent"
                      strokeWidth={16}
                      fill="none"
                      style={{ cursor: 'pointer' }}
                      onClick={() => deleteEdge(edge.from, edge.to)}
                    />
                    <path
                      d={d}
                      stroke={isActiveEdge ? 'rgba(34,197,94,0.55)' : 'rgba(148,163,184,0.4)'}
                      strokeWidth={isActiveEdge ? 2 : 1.5}
                      fill="none"
                      markerEnd={isActiveEdge ? 'url(#wf-arrow-running)' : 'url(#wf-arrow)'}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                )
              })}

              {/* ── Task nodes ──────────────────────────────────────── */}
              {tasks.map(task => {
                const assignee = task.assigneeId ? memberById[task.assigneeId] : null
                const status: WorkflowTaskStatus = runState[task.id] ?? 'idle'
                const isSelected = task.id === selectedTaskId
                const isConnectFrom = task.id === connectFromId
                const label = task.label.length > 22 ? task.label.slice(0, 20) + '…' : task.label
                const assigneeName = assignee
                  ? (assignee.displayName.length > 20 ? assignee.displayName.slice(0, 18) + '…' : assignee.displayName)
                  : 'All agents'

                return (
                  <g
                    key={task.id}
                    data-tid={task.id}
                    transform={`translate(${task.x} ${task.y})`}
                    style={{ cursor: connectFromId !== null ? 'pointer' : 'grab' }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditingTask(task)
                    }}
                  >
                    {/* Selection ring */}
                    {(isSelected || isConnectFrom) && (
                      <rect
                        x={-3} y={-3}
                        width={NODE_W + 6} height={NODE_H + 6}
                        rx={NODE_RX + 2}
                        fill="none"
                        stroke={isConnectFrom ? 'rgba(99,102,241,0.8)' : 'var(--theme-accent)'}
                        strokeWidth={2}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}

                    {/* Status tint */}
                    {status !== 'idle' && (
                      <rect
                        width={NODE_W} height={NODE_H} rx={NODE_RX}
                        fill={STATUS_FILL[status]}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}

                    {/* Main card */}
                    <rect
                      width={NODE_W} height={NODE_H} rx={NODE_RX}
                      fill="var(--theme-card)"
                      stroke={STATUS_STROKE[status]}
                      strokeWidth={status !== 'idle' ? 2 : 1.5}
                    />

                    {/* Task label */}
                    <text
                      x={12} y={24}
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--theme-text)"
                      style={{ pointerEvents: 'none', fontFamily: 'inherit' }}
                    >
                      {label}
                    </text>

                    {/* Assignee */}
                    <text
                      x={12} y={42}
                      fontSize={10}
                      fill="var(--theme-muted)"
                      style={{ pointerEvents: 'none', fontFamily: 'inherit' }}
                    >
                      {assigneeName}
                    </text>

                    {/* Status badge */}
                    {status !== 'idle' && (
                      <text
                        x={12} y={58}
                        fontSize={9}
                        fill={
                          status === 'running' ? 'rgba(34,197,94,0.9)'
                          : status === 'done' ? 'rgba(99,102,241,0.9)'
                          : 'rgba(239,68,68,0.9)'
                        }
                        style={{ pointerEvents: 'none', fontFamily: 'inherit' }}
                      >
                        {status === 'running' ? '● Running' : status === 'done' ? '✓ Done' : '✕ Error'}
                      </text>
                    )}

                    {/* Input port (left) */}
                    <circle
                      cx={0} cy={NODE_H / 2} r={PORT_R}
                      fill="var(--theme-card)"
                      stroke="var(--theme-border)"
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'none' }}
                    />

                    {/* Output port (right) */}
                    <circle
                      cx={NODE_W} cy={NODE_H / 2} r={PORT_R}
                      fill="var(--theme-card)"
                      stroke="var(--theme-border)"
                      strokeWidth={1.5}
                      style={{ pointerEvents: 'none' }}
                    />

                    {/* Connect-mode click hint */}
                    {connectFromId !== null && (
                      <rect
                        width={NODE_W} height={NODE_H} rx={NODE_RX}
                        fill="rgba(99,102,241,0.07)"
                        stroke="rgba(99,102,241,0.4)"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {/* ── Connect-mode instruction banner ──────────────────────────── */}
        {connectFromId !== null && (
          <div
            className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-medium"
            style={{
              background: 'var(--theme-card)',
              border: '1px solid var(--theme-accent)',
              color: 'var(--theme-accent)',
            }}
          >
            {connectFromId
              ? `From "${tasks.find(t => t.id === connectFromId)?.label ?? '…'}" — click the target task. Press Esc to cancel.`
              : 'Click the source task. Press Esc to cancel.'}
          </div>
        )}

        {/* ── Selected task edit panel ──────────────────────────────────── */}
        {selectedTask && !editingTask && (
          <div
            className="absolute right-0 top-0 flex h-full w-64 flex-col border-l"
            style={{ background: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
          >
            <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--theme-border)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--theme-text)' }}>Task</span>
              <button
                onClick={() => setSelectedTaskId(null)}
                className="rounded p-0.5 text-[10px]"
                style={{ color: 'var(--theme-muted)' }}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 p-3">
              <div>
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted)' }}>Label</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>{selectedTask.label}</p>
              </div>
              {selectedTask.prompt && (
                <div>
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted)' }}>Prompt</p>
                  <p className="text-xs whitespace-pre-wrap break-words" style={{ color: 'var(--theme-text)' }}>{selectedTask.prompt}</p>
                </div>
              )}
              <div>
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted)' }}>Assigned to</p>
                <p className="text-xs" style={{ color: 'var(--theme-text)' }}>
                  {selectedTask.assigneeId ? memberById[selectedTask.assigneeId]?.displayName ?? 'Unknown' : 'All agents'}
                </p>
              </div>
              {/* Dependency info */}
              {edges.filter(e => e.to === selectedTask.id).length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted)' }}>Depends on</p>
                  <div className="flex flex-wrap gap-1">
                    {edges.filter(e => e.to === selectedTask.id).map(e => {
                      const src = tasks.find(t => t.id === e.from)
                      return (
                        <span
                          key={e.from}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                          style={{ background: 'var(--theme-hover, var(--theme-card2, var(--theme-bg)))', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
                        >
                          {src?.label ?? e.from}
                          <button
                            onClick={() => deleteEdge(e.from, selectedTask.id)}
                            className="ml-0.5"
                            style={{ color: 'var(--theme-danger)' }}
                            title="Remove dependency"
                          >
                            ×
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* Run status */}
              {runState[selectedTask.id] && runState[selectedTask.id] !== 'idle' && (
                <div>
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--theme-muted)' }}>Status</p>
                  <p className="text-xs font-medium capitalize" style={{
                    color: runState[selectedTask.id] === 'running' ? 'var(--theme-success)'
                      : runState[selectedTask.id] === 'done' ? 'var(--theme-accent)'
                      : 'var(--theme-danger)'
                  }}>
                    {runState[selectedTask.id]}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t p-3" style={{ borderColor: 'var(--theme-border)' }}>
              <button
                onClick={() => setEditingTask(selectedTask)}
                className="w-full rounded-lg border py-1.5 text-xs font-medium transition-colors"
                style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)', background: 'var(--theme-card)' }}
              >
                Edit Task
              </button>
              <button
                onClick={() => {
                  if (connectFromId === null) {
                    setConnectFromId(selectedTask.id)
                  }
                }}
                className="w-full rounded-lg border py-1.5 text-xs font-medium transition-colors"
                style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-muted)', background: 'var(--theme-card)' }}
              >
                <HugeiconsIcon icon={ConnectIcon} size={12} className="mr-1 inline" />
                Connect from here
              </button>
              <button
                onClick={() => deleteTask(selectedTask.id)}
                className="w-full rounded-lg py-1.5 text-xs font-medium transition-colors"
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--theme-danger)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <HugeiconsIcon icon={Delete01Icon} size={12} className="mr-1 inline" />
                Delete Task
              </button>
            </div>
          </div>
        )}

        {/* ── Legend ────────────────────────────────────────────────────── */}
        {tasks.length > 0 && (
          <div
            className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg px-2 py-1.5 text-[10px]"
            style={{ background: 'var(--theme-card)', border: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }}
          >
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_FILL.running, border: '1px solid rgba(34,197,94,0.7)' }} />
              Running
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_FILL.done, border: '1px solid rgba(99,102,241,0.7)' }} />
              Done
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_FILL.error, border: '1px solid rgba(239,68,68,0.7)' }} />
              Error
            </div>
            <div className="mt-0.5 border-t pt-0.5" style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)' }}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} · {edges.length} dep{edges.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      {addingTask && (
        <TaskDialog
          title="Add Task"
          members={displayMembers}
          onSubmit={addTask}
          onClose={() => setAddingTask(false)}
        />
      )}

      {editingTask && (
        <TaskDialog
          title="Edit Task"
          initial={editingTask}
          members={displayMembers}
          onSubmit={(vals) => updateTask(editingTask.id, vals)}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}
