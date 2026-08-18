'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  FilterIcon,
  InformationCircleIcon,
  Search01Icon,
  TaskEdit01Icon,
  UserIcon,
  AlertCircleIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEvent {
  seq: number
  sessionKey: string
  runId: string | null
  eventType: string
  payload: Record<string, unknown>
  ts: number
}

interface AuditResponse {
  ok: boolean
  total: number
  sessions: string[]
  events: AuditEvent[]
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchAudit(params: {
  sessionKey?: string
  types: string[]
  since?: number
  until?: number
  limit: number
  offset: number
}): Promise<AuditResponse> {
  const url = new URL('/api/audit/', window.location.origin)
  if (params.sessionKey) url.searchParams.set('sessionKey', params.sessionKey)
  if (params.types.length) url.searchParams.set('types', params.types.join(','))
  if (params.since) url.searchParams.set('since', String(params.since))
  if (params.until) url.searchParams.set('until', String(params.until))
  url.searchParams.set('limit', String(params.limit))
  url.searchParams.set('offset', String(params.offset))

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AuditResponse>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  tool: 'Tool Call',
  user_message: 'User Message',
  approval: 'Approval',
}

const ALL_TYPES = ['tool', 'user_message', 'approval']

const DATE_RANGES = [
  { label: 'Last hour', ms: 60 * 60 * 1000 },
  { label: 'Last 6h', ms: 6 * 60 * 60 * 1000 },
  { label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: 0 },
]

function formatTs(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function truncate(s: string, n = 120): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function shortSession(key: string): string {
  // Show last 12 chars of session key
  return key.length > 16 ? `…${key.slice(-12)}` : key
}

// ─── Event card ──────────────────────────────────────────────────────────────

function ToolEventCard({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false)
  const p = event.payload
  const phase = typeof p.phase === 'string' ? p.phase : 'unknown'
  const name = typeof p.name === 'string' ? p.name : 'unknown'
  const args = p.args
  const result = typeof p.result === 'string' ? p.result : undefined
  const preview = typeof p.preview === 'string' ? p.preview : undefined

  const phaseIcon = phase === 'complete'
    ? CheckmarkCircle01Icon
    : phase === 'error'
      ? AlertCircleIcon
      : TaskEdit01Icon

  const phaseColor =
    phase === 'complete'
      ? 'text-green-400'
      : phase === 'error'
        ? 'text-[var(--theme-danger)]'
        : 'text-[var(--theme-accent)]'

  const argsStr = args
    ? typeof args === 'string'
      ? args
      : JSON.stringify(args, null, 2)
    : undefined

  return (
    <div
      className="group cursor-pointer rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 transition-colors hover:border-[var(--theme-accent)]/30"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 shrink-0', phaseColor)}>
          <HugeiconsIcon icon={phaseIcon} size={16} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-[var(--theme-text)]">
              {name}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-px text-[10px] font-medium border',
                phase === 'complete'
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : phase === 'error'
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : phase === 'start' || phase === 'calling'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-[var(--theme-card2)] text-[var(--theme-muted)] border-[var(--theme-border)]',
              )}
            >
              {phase}
            </span>
          </div>

          {(preview || result) && !expanded && (
            <p className="mt-1 text-xs text-[var(--theme-muted)] line-clamp-1">
              {truncate(preview ?? result ?? '', 140)}
            </p>
          )}

          {expanded && (
            <div className="mt-2 space-y-2">
              {argsStr && (
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--theme-muted)]">
                    Args
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-[var(--theme-card2)] p-2 text-[10px] text-[var(--theme-text)] font-mono whitespace-pre-wrap break-all">
                    {truncate(argsStr, 2000)}
                  </pre>
                </div>
              )}
              {result && (
                <div>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--theme-muted)]">
                    Result
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-[var(--theme-card2)] p-2 text-[10px] text-[var(--theme-text)] font-mono whitespace-pre-wrap break-all">
                    {truncate(result, 2000)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[10px] text-[var(--theme-muted)]">{formatTs(event.ts)}</div>
          <div
            className="mt-0.5 text-[10px] text-[var(--theme-muted)] font-mono"
            title={event.sessionKey}
          >
            {shortSession(event.sessionKey)}
          </div>
        </div>
      </div>
    </div>
  )
}

function UserMessageCard({ event }: { event: AuditEvent }) {
  const p = event.payload
  const msg = p.message && typeof p.message === 'object'
    ? (p.message as Record<string, unknown>)
    : {}
  const text = typeof msg.content === 'string'
    ? msg.content
    : typeof p.text === 'string'
      ? p.text
      : ''

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-[var(--theme-muted)]">
          <HugeiconsIcon icon={UserIcon} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--theme-text)]">User</span>
            <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card2)] px-2 py-px text-[10px] text-[var(--theme-muted)]">
              message
            </span>
          </div>
          {text && (
            <p className="mt-1 text-xs text-[var(--theme-muted)] line-clamp-2">{truncate(text, 200)}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-[var(--theme-muted)]">{formatTs(event.ts)}</div>
          <div className="mt-0.5 text-[10px] text-[var(--theme-muted)] font-mono" title={event.sessionKey}>
            {shortSession(event.sessionKey)}
          </div>
        </div>
      </div>
    </div>
  )
}

function ApprovalCard({ event }: { event: AuditEvent }) {
  const p = event.payload
  const toolName = typeof p.toolName === 'string' ? p.toolName : 'Unknown tool'
  const status = typeof p.status === 'string' ? p.status : 'pending'

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-amber-400">
          <HugeiconsIcon icon={InformationCircleIcon} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--theme-text)]">Approval</span>
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-px text-[10px] text-amber-400">
              {status}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Tool: <span className="font-mono">{toolName}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-[var(--theme-muted)]">{formatTs(event.ts)}</div>
          <div className="mt-0.5 text-[10px] text-[var(--theme-muted)] font-mono" title={event.sessionKey}>
            {shortSession(event.sessionKey)}
          </div>
        </div>
      </div>
    </div>
  )
}

function EventCard({ event }: { event: AuditEvent }) {
  if (event.eventType === 'tool') return <ToolEventCard event={event} />
  if (event.eventType === 'user_message') return <UserMessageCard event={event} />
  if (event.eventType === 'approval') return <ApprovalCard event={event} />
  return null
}

// ─── Main screen ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export function AuditTrailScreen() {
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>(ALL_TYPES)
  const [dateRangeIdx, setDateRangeIdx] = useState(4) // All time
  const [page, setPage] = useState(0)

  const since = DATE_RANGES[dateRangeIdx].ms
    ? Date.now() - DATE_RANGES[dateRangeIdx].ms
    : undefined

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', selectedSession, selectedTypes, dateRangeIdx, page],
    queryFn: () =>
      fetchAudit({
        sessionKey: selectedSession || undefined,
        types: selectedTypes,
        since,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const toggleType = useCallback((t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
    setPage(0)
  }, [])

  const events = data?.events ?? []
  const total = data?.total ?? 0
  const sessions = data?.sessions ?? []
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--theme-border)] px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--theme-text)]">Audit Trail</h1>
            <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
              Timeline of all agent and tool actions across sessions
            </p>
          </div>
          {total > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1 text-xs text-[var(--theme-muted)]">
              <HugeiconsIcon icon={Clock01Icon} size={12} />
              {total.toLocaleString()} events
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* Session filter */}
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon icon={FilterIcon} size={13} className="text-[var(--theme-muted)]" />
            <select
              value={selectedSession}
              onChange={(e) => {
                setSelectedSession(e.target.value)
                setPage(0)
              }}
              className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2.5 py-1 text-xs text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
            >
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s} value={s}>
                  {shortSession(s)}
                </option>
              ))}
            </select>
          </div>

          {/* Event type toggles */}
          <div className="flex items-center gap-1">
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                  selectedTypes.includes(t)
                    ? 'bg-[var(--theme-accent)] text-white border-transparent'
                    : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:border-[var(--theme-accent)]/40 hover:text-[var(--theme-text)]',
                )}
              >
                {EVENT_TYPE_LABELS[t] ?? t}
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1">
            {DATE_RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => {
                  setDateRangeIdx(i)
                  setPage(0)
                }}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors border',
                  dateRangeIdx === i
                    ? 'bg-[var(--theme-card2)] text-[var(--theme-text)] border-[var(--theme-border)]'
                    : 'border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Events list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-[var(--theme-muted)]">
            Loading audit events…
          </div>
        ) : isError ? (
          <div className="flex h-40 items-center justify-center text-sm text-[var(--theme-danger)]">
            Failed to load audit events
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <HugeiconsIcon icon={Search01Icon} size={24} className="text-[var(--theme-muted)]" />
            <p className="text-sm text-[var(--theme-muted)]">No audit events found</p>
            <p className="text-xs text-[var(--theme-muted)]">
              Events are recorded as agents run. Try adjusting the filters or date range.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => (
              <EventCard key={ev.seq} event={ev} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-between border-t border-[var(--theme-border)] px-6 py-3">
          <span className="text-xs text-[var(--theme-muted)]">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-[var(--theme-border)] px-3 py-1 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-[var(--theme-muted)]">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-[var(--theme-border)] px-3 py-1 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
