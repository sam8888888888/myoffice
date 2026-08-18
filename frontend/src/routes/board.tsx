import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useBranding } from '@/hooks/use-branding'

export const Route = createFileRoute('/board')({
  component: BoardScreen,
})

type BoardItem = {
  id: string
  title: string
  desc: string
  agent: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  risk: 'low' | 'medium' | 'high' | 'critical'
  type: string
  status: string
  sla_minutes: number
  tags: string[]
  created_at: string
  updated_at: string
  blocked_reason: string | null
  summary: string | null
  approval_id: string | null
  sla_status: 'ok' | 'expiring' | 'expired' | null
  sla_remaining_min: number | null
  history: Array<{ at: string; by: string; from: string | null; to: string; note: string }>
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  waiting_approval: 'Waiting Approval',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
}

const STATUS_COLOR: Record<string, string> = {
  backlog: 'bg-neutral-500/15 text-neutral-400',
  todo: 'bg-sky-500/15 text-sky-400',
  waiting_approval: 'bg-amber-500/15 text-amber-400',
  in_progress: 'bg-amber-500/15 text-amber-400',
  in_review: 'bg-violet-500/15 text-violet-400',
  done: 'bg-emerald-500/15 text-emerald-400',
  blocked: 'bg-rose-500/15 text-rose-400',
}

const PRIORITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 }
const PRIORITY_COLOR: Record<string, string> = {
  low: 'bg-neutral-500/20 text-neutral-300',
  medium: 'bg-sky-500/20 text-sky-300',
  high: 'bg-amber-500/20 text-amber-300',
  critical: 'bg-rose-500/20 text-rose-300',
}

const AGENTS = ['rena', 'farrah', 'nadine', 'aaron', 'dinda']

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function BoardScreen() {
  const qc = useQueryClient()
  const branding = useBranding()
  const [filter, setFilter] = useState<'all' | 'done'>('all')
  const [selected, setSelected] = useState<BoardItem | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [dragCol, setDragCol] = useState<string | null>(null)

  const boardQuery = useQuery({
    queryKey: ['board'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=board')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return { columns: (data.columns ?? []) as string[], items: (data.items ?? []) as BoardItem[] }
    },
    staleTime: 2000,
    refetchInterval: 8000,
  })

  const statsQuery = useQuery({
    queryKey: ['board-stats'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=board&action=stats')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.stats ?? { totals: {}, per_agent: {} }) as {
        totals: { open: number; done: number; done_7d: number; avg_cycle_min: number | null; sla_hit_rate: number | null }
        per_agent: Record<string, { open: number; done: number; avg_cycle_min: number | null }>
      }
    },
    staleTime: 3000,
    refetchInterval: 15000,
  })

  // Kanban D: rules & templates
  type Rule = { id: string; name: string; schedule: { type: string; minutes?: number; time?: string; days?: number[] }; task: Record<string, unknown>; enabled: boolean; last_run: string | null }
  type Tpl = { id: string; name: string; task: Record<string, unknown> }

  const rulesQuery = useQuery({
    queryKey: ['board-rules'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=board&action=rules')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.rules ?? []) as Rule[]
    },
    staleTime: 3000,
    enabled: showRules,
  })

  const templatesQuery = useQuery({
    queryKey: ['board-templates'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=board&action=templates')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.templates ?? []) as Tpl[]
    },
    staleTime: 3000,
    enabled: showTemplates,
  })

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board'] })
      setShowForm(false)
    },
  })

  const move = useMutation({
    mutationFn: async ({ id, to, note }: { id: string; to: string; note?: string }) => {
      const res = await fetch('/api/office?resource=board&action=move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, to, note, by: 'samian' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/office?resource=board&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board'] }),
  })

  const saveRule = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=board&action=rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-rules'] }),
  })

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/office?resource=board_rules&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-rules'] }),
  })

  const saveTemplate = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=board&action=templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board-templates'] })
      qc.invalidateQueries({ queryKey: ['board'] })
    },
  })

  const applyTemplate = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/office?resource=board&action=templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyId: id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board-templates'] })
      qc.invalidateQueries({ queryKey: ['board'] })
    },
  })

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/office?resource=board_templates&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-templates'] }),
  })

  const columns = boardQuery.data?.columns ?? []
  const items = (boardQuery.data?.items ?? []).filter((i) => (filter === 'done' ? i.status === 'done' : true))

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Task Board</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Kanban antar agent — {branding.name}: assign, SLA, review, selesai dengan ringkasan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRules(true)}
            className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            title="Automation rules — task otomatis terjadwal"
          >
            ⚙ Rules
          </button>
          <button
            onClick={() => setShowTemplates(true)}
            className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            title="Template task siap pakai"
          >
            📋 Templates
          </button>
          <button
            onClick={() => setFilter(filter === 'done' ? 'all' : 'done')}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              filter === 'done' ? 'bg-emerald-600 text-white' : 'text-[var(--theme-muted)]'
            }`}
          >
            {filter === 'done' ? 'Lihat Semua' : 'Done saja'}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + Task Baru
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Buat task baru</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
            <input id="bk-title" placeholder="Judul task…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-5" />
            <input id="bk-desc" placeholder="Deskripsi…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-4" />
            <select id="bk-agent" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="">
              <option value="">Pool (agent mana pun)</option>
              {AGENTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <select id="bk-priority" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select id="bk-risk" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="medium" title="Risiko task — high/critical wajib approval">
              <option value="low">Risk: low</option>
              <option value="medium">Risk: medium</option>
              <option value="high">Risk: high ⚠</option>
              <option value="critical">Risk: critical ⚠</option>
            </select>
            <select id="bk-type" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="task" title="Tipe task — deploy/install/spending dll wajib approval">
              <option value="task">Tipe: task</option>
              <option value="deploy">Tipe: deploy ⚠</option>
              <option value="install">Tipe: install ⚠</option>
              <option value="secret_access">Tipe: secret ⚠</option>
              <option value="spending">Tipe: spending ⚠</option>
              <option value="external_contact">Tipe: contact ⚠</option>
              <option value="content">Tipe: content</option>
              <option value="riset">Tipe: riset</option>
            </select>
            <input id="bk-sla" type="number" defaultValue={1440} min={5} className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" placeholder="SLA menit" />
            <button
              onClick={() =>
                create.mutate({
                  title: (document.getElementById('bk-title') as HTMLInputElement).value,
                  desc: (document.getElementById('bk-desc') as HTMLInputElement).value,
                  agent: (document.getElementById('bk-agent') as HTMLSelectElement).value || null,
                  priority: (document.getElementById('bk-priority') as HTMLSelectElement).value,
                  risk: (document.getElementById('bk-risk') as HTMLSelectElement).value,
                  type: (document.getElementById('bk-type') as HTMLSelectElement).value,
                  sla_minutes: Number((document.getElementById('bk-sla') as HTMLInputElement).value) || 1440,
                  by: 'samian',
                })
              }
              disabled={create.isPending}
              className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 sm:col-span-1"
            >
              {create.isPending ? '…' : 'Buat'}
            </button>
          </div>
        </div>
      )}

      {boardQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat board: {String(boardQuery.error)}
        </div>
      )}

      {/* Kanban C: panel stats */}
      {(() => {
        const t = statsQuery.data?.totals
        const pa = statsQuery.data?.per_agent ?? {}
        const agents = Object.entries(pa).sort((a, b) => (b[1].done + b[1].open) - (a[1].done + a[1].open))
        return (
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">Open / Done</div>
              <div className="mt-1 text-xl font-bold text-[var(--theme-text)]">{t?.open ?? 0} <span className="text-sm font-normal text-[var(--theme-muted)]">/ {t?.done ?? 0}</span></div>
              <div className="mt-0.5 text-[10px] text-[var(--theme-muted)]">Done 7 hari: {t?.done_7d ?? 0}</div>
            </div>
            <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">SLA Hit Rate</div>
              <div className={`mt-1 text-xl font-bold ${(t?.sla_hit_rate ?? 100) >= 80 ? 'text-emerald-400' : (t?.sla_hit_rate ?? 100) >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                {t?.sla_hit_rate != null ? `${t.sla_hit_rate}%` : '—'}
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--theme-muted)]">task selesai tepat waktu</div>
            </div>
            <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">Avg Cycle Time</div>
              <div className="mt-1 text-xl font-bold text-[var(--theme-text)]">
                {t?.avg_cycle_min != null ? `${Math.round(t.avg_cycle_min)}m` : '—'}
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--theme-muted)]">dibuat → selesai</div>
            </div>
            <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">Per Agent</div>
              <div className="mt-1 space-y-0.5">
                {agents.length === 0 && <div className="text-xs text-[var(--theme-muted)]">—</div>}
                {agents.slice(0, 3).map(([aid, d]) => (
                  <div key={aid} className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-12 truncate text-[var(--theme-muted)]">{aid}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--theme-card2)]">
                      <span
                        className="block h-full rounded-full bg-[var(--theme-accent)]"
                        style={{ width: `${Math.min(100, ((d.done + d.open) / Math.max(1, agents[0][1].done + agents[0][1].open)) * 100)}%` }}
                      />
                    </span>
                    <span className="w-8 text-right text-[var(--theme-muted)]">{d.done + d.open}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {columns.map((col) => {
          const colItems = items.filter((i) => i.status === col)
          return (
            <div
              key={col}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain')
                if (id && id !== col) move.mutate({ id, status: col })
              }}
              className={`rounded-xl border p-2 ${
                col === dragCol ? 'border-dashed border-sky-400 bg-sky-500/5' : 'border-[var(--theme-border)] bg-[var(--theme-card)]/60'
              }`}
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-bold uppercase tracking-wide text-[var(--theme-muted)]">
                  {STATUS_LABEL[col] ?? col}
                </span>
                <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)]">
                  {colItems.length}
                </span>
              </div>
              <div className="max-h-[560px] space-y-2 overflow-y-auto p-1">
                {colItems.map((item) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', item.id)
                      setDragCol(col)
                    }}
                    onDragEnd={() => setDragCol(null)}
                    className="cursor-grab rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 active:cursor-grabbing"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_COLOR[item.priority] ?? PRIORITY_COLOR.medium}`}>
                        {item.priority}
                      </span>
                      {(item.risk === 'high' || item.risk === 'critical') && (
                        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">⚠ {item.risk}</span>
                      )}
                      {item.type && item.type !== 'task' && (
                        <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-semibold text-orange-300">{item.type}</span>
                      )}
                      {item.agent ? (
                        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                          {item.agent}
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-500/20 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">pool</span>
                      )}
                      {item.status === 'waiting_approval' && (
                        <a
                          href="/approvals"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/30"
                          title="Lihat approval queue"
                        >
                          🛂 Approval →
                        </a>
                      )}
                      {item.sla_status === 'expired' && (
                        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">SLA ⚠</span>
                      )}
                      {item.sla_status === 'expiring' && (
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">SLA {Math.max(0, Math.round(item.sla_remaining_min ?? 0))}m</span>
                      )}
                    </div>
                    <button
                      onClick={() => setSelected(item)}
                      className="mt-2 block text-left text-sm font-semibold text-[var(--theme-text)] hover:text-[var(--theme-accent)]"
                    >
                      {item.title}
                    </button>
                    {item.desc && <p className="mt-1 line-clamp-2 text-xs text-[var(--theme-muted)]">{item.desc}</p>}
                    {item.blocked_reason && <p className="mt-1 text-xs text-rose-400">⛔ {item.blocked_reason}</p>}
                    {item.summary && <p className="mt-1 text-xs text-emerald-400">✓ {item.summary.slice(0, 80)}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {col !== 'done' && col !== 'blocked' && col !== 'waiting_approval' && (
                        <button
                          onClick={() => move.mutate({ id: item.id, to: 'blocked', note: 'diblokir' })}
                          className="rounded bg-rose-500/15 px-2 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/25"
                        >
                          ⛔
                        </button>
                      )}
                      {col === 'waiting_approval' && (
                        <a
                          href="/approvals"
                          className="rounded bg-amber-500/20 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/30"
                        >
                          🛂 Putuskan →
                        </a>
                      )}
                      {col === 'todo' && (
                        <button
                          onClick={() => move.mutate({ id: item.id, to: 'in_progress' })}
                          className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                        >
                          ▶ Mulai
                        </button>
                      )}
                      {col === 'in_progress' && (
                        <button
                          onClick={() => move.mutate({ id: item.id, to: 'in_review' })}
                          className="rounded bg-violet-500/15 px-2 py-1 text-[10px] font-medium text-violet-300 hover:bg-violet-500/25"
                        >
                          → In Review
                        </button>
                      )}
                      {col === 'in_review' && (
                        <button
                          onClick={() => {
                            const note = prompt('Ringkasan selesai:', '')
                            move.mutate({ id: item.id, to: 'done', note: note ?? undefined })
                          }}
                          className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                        >
                          ✓ Selesai
                        </button>
                      )}
                      {col !== 'todo' && col !== 'in_progress' && col !== 'in_review' && col !== 'done' && col !== 'waiting_approval' && (
                        <button
                          onClick={() => move.mutate({ id: item.id, to: 'todo' })}
                          className="rounded bg-sky-500/15 px-2 py-1 text-[10px] font-medium text-sky-300 hover:bg-sky-500/25"
                        >
                          → To Do
                        </button>
                      )}
                      {col === 'blocked' && (
                        <button
                          onClick={() => move.mutate({ id: item.id, to: 'todo' })}
                          className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                        >
                          ↺ Buka blokir
                        </button>
                      )}
                      <button
                        onClick={() => remove.mutate(item.id)}
                        className="ml-auto rounded bg-neutral-500/10 px-2 py-1 text-[10px] text-[var(--theme-muted)] hover:bg-rose-500/20 hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                {colItems.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-6 text-center text-xs text-[var(--theme-muted)]">
                    Kosong
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowRules(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--theme-text)]">⚙ Automation Rules</h2>
              <button onClick={() => setShowRules(false)} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)]">✕</button>
            </div>
            <p className="mb-3 text-xs text-[var(--theme-muted)]">
              Task dibuat otomatis sesuai jadwal (interval menit atau mingguan jam WIB). Scheduler cek tiap 60 detik.
            </p>
            {/* form rule */}
            <div className="mb-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
              <div className="mb-2 text-sm font-semibold text-[var(--theme-text)]">Rule baru</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                <input id="rl-name" placeholder="Nama rule…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-4" />
                <select id="rl-type" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-2" defaultValue="interval">
                  <option value="interval">Interval</option>
                  <option value="weekly">Mingguan</option>
                </select>
                <input id="rl-min" type="number" defaultValue={1440} min={1} className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-3" title="Interval menit (jika type=interval)" placeholder="menit" />
                <input id="rl-time" defaultValue="08:00" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-3" title="Jam WIB (jika type=weekly)" placeholder="HH:MM" />
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input id="rl-title" placeholder="Judul task otomatis…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" />
                <input id="rl-desc" placeholder="Deskripsi…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" />
                <select id="rl-agent" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="">
                  <option value="">Pool</option>
                  {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select id="rl-priority" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="medium">
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                </select>
                <select id="rl-risk" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="low">
                  <option value="low">Risk: low</option><option value="medium">Risk: medium</option><option value="high">Risk: high</option><option value="critical">Risk: critical</option>
                </select>
                <select id="rl-type2" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="task">
                  <option value="task">task</option><option value="content">content</option><option value="riset">riset</option><option value="deploy">deploy</option><option value="spending">spending</option>
                </select>
                <input id="rl-sla" type="number" defaultValue={1440} min={5} className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" title="SLA menit" />
                <button
                  onClick={() => {
                    const isWeekly = (document.getElementById('rl-type') as HTMLSelectElement).value === 'weekly'
                    saveRule.mutate({
                      name: (document.getElementById('rl-name') as HTMLInputElement).value,
                      schedule: isWeekly
                        ? { type: 'weekly', time: (document.getElementById('rl-time') as HTMLInputElement).value || '08:00', days: [0, 1, 2, 3, 4, 5, 6] }
                        : { type: 'interval', minutes: Number((document.getElementById('rl-min') as HTMLInputElement).value) || 1440 },
                      task: {
                        title: (document.getElementById('rl-title') as HTMLInputElement).value,
                        desc: (document.getElementById('rl-desc') as HTMLInputElement).value,
                        agent: (document.getElementById('rl-agent') as HTMLSelectElement).value || null,
                        priority: (document.getElementById('rl-priority') as HTMLSelectElement).value,
                        risk: (document.getElementById('rl-risk') as HTMLSelectElement).value,
                        type: (document.getElementById('rl-type2') as HTMLSelectElement).value,
                        sla_minutes: Number((document.getElementById('rl-sla') as HTMLInputElement).value) || 1440,
                      },
                    })
                  }}
                  disabled={saveRule.isPending}
                  className="rounded-lg bg-[var(--theme-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saveRule.isPending ? '…' : 'Simpan Rule'}
                </button>
              </div>
            </div>
            {/* list rules */}
            <div className="space-y-2">
              {(rulesQuery.data ?? []).map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${r.enabled ? 'bg-emerald-400' : 'bg-neutral-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--theme-text)]">{r.name}</div>
                    <div className="text-[11px] text-[var(--theme-muted)]">
                      {r.schedule?.type === 'weekly' ? `Mingguan ${r.schedule?.time ?? '08:00'} WIB` : `Tiap ${r.schedule?.minutes ?? 1440} menit`}
                      {' · '}task: {String(r.task?.title ?? '').slice(0, 40)}
                      {r.last_run ? ` · terakhir ${new Date(r.last_run).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                    </div>
                  </div>
                  <button onClick={() => deleteRule.mutate(r.id)} disabled={deleteRule.isPending} className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/25">Hapus</button>
                </div>
              ))}
              {(rulesQuery.data ?? []).length === 0 && <div className="py-6 text-center text-sm text-[var(--theme-muted)]">Belum ada rule.</div>}
            </div>
          </div>
        </div>
      )}

      {showTemplates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowTemplates(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--theme-text)]">📋 Template Task</h2>
              <button onClick={() => setShowTemplates(false)} className="text-[var(--theme-muted)] hover:text-[var(--theme-text)]">✕</button>
            </div>
            <p className="mb-3 text-xs text-[var(--theme-muted)]">Template task siap pakai — satu klik langsung jadi task di board.</p>
            {/* form template */}
            <div className="mb-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
              <div className="mb-2 text-sm font-semibold text-[var(--theme-text)]">Template baru</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                <input id="tp-name" placeholder="Nama template…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-2" />
                <input id="tp-title" placeholder="Judul task…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-4" />
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input id="tp-desc" placeholder="Deskripsi…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" />
                <select id="tp-agent" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="">
                  <option value="">Pool</option>
                  {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select id="tp-priority" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="medium">
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                </select>
                <select id="tp-risk" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="medium">
                  <option value="low">Risk: low</option><option value="medium">Risk: medium</option><option value="high">Risk: high</option><option value="critical">Risk: critical</option>
                </select>
                <select id="tp-type" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="task">
                  <option value="task">task</option><option value="content">content</option><option value="riset">riset</option><option value="deploy">deploy</option><option value="spending">spending</option>
                </select>
                <input id="tp-sla" type="number" defaultValue={1440} min={5} className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]" title="SLA menit" />
                <button
                  onClick={() =>
                    saveTemplate.mutate({
                      name: (document.getElementById('tp-name') as HTMLInputElement).value,
                      task: {
                        title: (document.getElementById('tp-title') as HTMLInputElement).value,
                        desc: (document.getElementById('tp-desc') as HTMLInputElement).value,
                        agent: (document.getElementById('tp-agent') as HTMLSelectElement).value || null,
                        priority: (document.getElementById('tp-priority') as HTMLSelectElement).value,
                        risk: (document.getElementById('tp-risk') as HTMLSelectElement).value,
                        type: (document.getElementById('tp-type') as HTMLSelectElement).value,
                        sla_minutes: Number((document.getElementById('tp-sla') as HTMLInputElement).value) || 1440,
                      },
                    })
                  }
                  disabled={saveTemplate.isPending}
                  className="rounded-lg bg-[var(--theme-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saveTemplate.isPending ? '…' : 'Simpan'}
                </button>
              </div>
            </div>
            {/* list templates */}
            <div className="space-y-2">
              {(templatesQuery.data ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--theme-text)]">{t.name}</div>
                    <div className="text-[11px] text-[var(--theme-muted)]">{String(t.task?.title ?? '')} · agent: {String(t.task?.agent ?? 'pool')} · {String(t.task?.type ?? 'task')}</div>
                  </div>
                  <button
                    onClick={() => applyTemplate.mutate(t.id)}
                    disabled={applyTemplate.isPending}
                    className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
                  >
                    ➕ Apply
                  </button>
                  <button onClick={() => deleteTemplate.mutate(t.id)} disabled={deleteTemplate.isPending} className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/25">Hapus</button>
                </div>
              ))}
              {(templatesQuery.data ?? []).length === 0 && <div className="py-6 text-center text-sm text-[var(--theme-muted)]">Belum ada template.</div>}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[selected.status] ?? ''}`}>
                {STATUS_LABEL[selected.status] ?? selected.status}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_COLOR[selected.priority] ?? ''}`}>
                {selected.priority}
              </span>
              <span className="ml-auto text-xs text-[var(--theme-muted)]">dibuat {fmtTime(selected.created_at)}</span>
            </div>
            <h2 className="text-lg font-bold text-[var(--theme-text)]">{selected.title}</h2>
            {selected.desc && <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--theme-muted)]">{selected.desc}</p>}
            {selected.summary && (
              <div className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
                <span className="font-semibold">Ringkasan:</span> {selected.summary}
              </div>
            )}
            {selected.blocked_reason && (
              <div className="mt-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">
                <span className="font-semibold">Alasan blocked:</span> {selected.blocked_reason}
              </div>
            )}
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">History</div>
              <div className="space-y-1.5">
                {selected.history.map((h, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--theme-muted)]">{fmtTime(h.at)}</span>
                    <span className="text-[var(--theme-text)]">
                      {h.from ? STATUS_LABEL[h.from] ?? h.from : '—'} → {STATUS_LABEL[h.to] ?? h.to}
                    </span>
                    <span className="text-[var(--theme-muted)]">by {h.by}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSelected(null)} className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm text-[var(--theme-muted)]">
                Tutup
              </button>
              <button
                onClick={() => {
                  const note = prompt('Catatan / ringkasan (jika selesai):', selected.status === 'done' ? selected.summary ?? '' : '')
                  if (note === null) return
                  const to = selected.status === 'done' ? 'todo' : 'done'
                  move.mutate({ id: selected.id, to, note })
                  setSelected(null)
                }}
                className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                {selected.status === 'done' ? '↺ Buka lagi' : '✓ Tandai selesai'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
