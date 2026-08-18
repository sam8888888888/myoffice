/**
 * Execution Approvals Store
 *
 * Manages pending dangerous-command approval requests from the Hermes agent.
 * In-memory Map keyed by entry id, persisted to sessionStorage so approvals
 * survive soft navigations but clear when the tab closes (stale approvals
 * would block an already-resolved agent turn).
 */

const STORAGE_KEY = 'hermes-studio:approvals'

export interface ApprovalRequest {
  id: string
  sessionKey: string
  command: string
  timestamp: number
  status: 'pending' | 'approved' | 'denied' | 'always-allowed'
  approvalId?: string
  agentId?: string
  agentName?: string
  action?: string
  context?: string
  source?: string
  resolvedAt?: number
}

// In-memory store — source of truth for the current page session
const _store = new Map<string, ApprovalRequest>()
let _hydrated = false

function _hydrate(): void {
  if (_hydrated || typeof window === 'undefined') return
  _hydrated = true
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Array<ApprovalRequest>
    if (!Array.isArray(parsed)) return
    for (const entry of parsed) {
      if (entry?.id) _store.set(entry.id, entry)
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
  }
}

function _persist(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([..._store.values()]))
  } catch {
    // quota exceeded — not critical
  }
}

export function addApproval(
  payload: Record<string, unknown>,
): ApprovalRequest | null {
  _hydrate()

  const approvalId =
    typeof payload.approvalId === 'string' && payload.approvalId.trim()
      ? payload.approvalId.trim()
      : typeof payload.id === 'string' && payload.id.trim()
        ? payload.id.trim()
        : null

  // Dedup: skip if we already have a pending entry for this approvalId
  if (approvalId) {
    for (const entry of _store.values()) {
      if (entry.approvalId === approvalId && entry.status === 'pending') {
        return entry
      }
    }
  }

  const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const actionValue = payload.action ?? payload.tool ?? payload.command
  const action =
    typeof actionValue === 'string'
      ? actionValue
      : actionValue
        ? JSON.stringify(actionValue)
        : 'Tool call requires approval'

  const contextValue = payload.context ?? payload.input ?? payload.args
  const context =
    typeof contextValue === 'string'
      ? contextValue
      : contextValue
        ? JSON.stringify(contextValue)
        : ''

  const agentNameValue = payload.agentName ?? payload.agent ?? payload.source
  const agentName =
    typeof agentNameValue === 'string' && agentNameValue.trim()
      ? agentNameValue.trim()
      : 'Agent'

  const agentIdValue = payload.agentId ?? payload.sessionKey ?? payload.source
  const agentId =
    typeof agentIdValue === 'string' && agentIdValue.trim()
      ? agentIdValue.trim()
      : 'hermes'

  const sessionKey =
    typeof payload.sessionKey === 'string' ? payload.sessionKey : 'unknown'

  const entry: ApprovalRequest = {
    id,
    sessionKey,
    command: action,
    timestamp: Date.now(),
    status: 'pending',
    approvalId: approvalId ?? undefined,
    agentId,
    agentName,
    action,
    context,
    source: typeof payload.source === 'string' ? payload.source : 'hermes',
  }

  _store.set(id, entry)
  _persist()
  return entry
}

export function loadApprovals(): Array<ApprovalRequest> {
  _hydrate()
  return [..._store.values()]
}

export function saveApprovals(approvals?: Array<ApprovalRequest>): void {
  if (!approvals) return
  _store.clear()
  for (const entry of approvals) {
    if (entry?.id) _store.set(entry.id, entry)
  }
  _persist()
}

export function respondToApproval(
  id: string,
  status: 'approved' | 'denied' | 'always-allowed',
): void {
  _hydrate()
  const entry = _store.get(id)
  if (!entry) return
  _store.set(id, { ...entry, status, resolvedAt: Date.now() })
  _persist()
}

export function getPendingApprovals(): Array<ApprovalRequest> {
  _hydrate()
  return [..._store.values()].filter((e) => e.status === 'pending')
}

export function clearResolvedApprovals(): void {
  _hydrate()
  for (const [id, entry] of _store.entries()) {
    if (entry.status !== 'pending') _store.delete(id)
  }
  _persist()
}
