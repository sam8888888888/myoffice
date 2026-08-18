import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/tickets')({
  component: TicketsScreen,
})

type TimelineEntry = { ts: string; action: string; by: string; note: string }

type Ticket = {
  id: string
  title: string
  description: string
  priority: 'high' | 'normal' | 'low'
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  agent: string | null
  deadline: string | null
  created_by: string
  created_at: string
  assigned_at: string | null
  completed_at: string | null
  sla_status: 'ok' | 'expiring' | 'expired' | null
  timeline: TimelineEntry[]
}

type TicketsResp = { ok?: boolean; items: Ticket[]; total?: number; offset?: number; limit?: number }
type FleetResp = { ok?: boolean; agents: Array<{ id: string; name: string }> }
type StatsRow = {
  agent: string
  assigned: number
  done: number
  cancelled: number
  open: number
  in_progress: number
  avg_hours: number | null
}

const PRIORITY_STYLE: Record<string, string> = {
  high: 'bg-red-500/15 text-red-500 border-red-500/30',
  normal: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  low: 'bg-[var(--theme-card2)] text-[var(--theme-muted)] border-[var(--theme-border)]',
}
const PRIORITY_LABEL: Record<string, string> = { high: '🔴 tinggi', normal: '🔵 normal', low: '🟢 rendah' }

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-[var(--theme-card2)] text-[var(--theme-text-muted)] border-[var(--theme-border)]',
  in_progress: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  done: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  cancelled: 'bg-red-500/15 text-red-500 border-red-500/30',
}
const STATUS_LABEL: Record<string, string> = {
  open: '📝 terbuka',
  in_progress: '🔧 dikerjakan',
  done: '✅ selesai',
  cancelled: '❌ batal',
}

function fmtDT(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  const isErr = msg.startsWith('⚠️')
  return (
    <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg ${isErr ? 'border-red-500/40 bg-red-950 text-red-200' : 'border-emerald-500/40 bg-emerald-950 text-emerald-200'}`}>
      {msg}
    </div>
  )
}

async function officePost(body: Record<string, unknown>) {
  const res = await fetch('/api/office?resource=tickets&action=action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json()
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
  return d
}

function TicketFormModal({
  agents,
  onSubmit,
  onClose,
}: {
  agents: Array<{ id: string; name: string }>
  onSubmit: (v: { title: string; description: string; priority: string; deadline: string; agent: string }) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('normal')
  const [deadline, setDeadline] = useState('')
  const [agent, setAgent] = useState('')

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--theme-text)]">🎫 Tiket Baru</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Judul *</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="Contoh: Riset kompetitor produk X"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Deskripsi</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="Detail pekerjaan…"
          />
        </label>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Prioritas</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            >
              <option value="high">🔴 Tinggi</option>
              <option value="normal">🔵 Normal</option>
              <option value="low">🟢 Rendah</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Deadline</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </label>
        </div>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Langsung assign ke agent (opsional)</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
            <option value="">— Biarkan di antrian —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">Batal</button>
          <button
            onClick={() => onSubmit({ title, description, priority, deadline, agent })}
            disabled={!title.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Buat Tiket
          </button>
        </div>
      </div>
    </div>
  )
}

function TicketDetail({
  t,
  agents,
  onAction,
  onEditTicket,
  onClose,
}: {
  t: Ticket
  agents: Array<{ id: string; name: string }>
  onAction: (action: string, note?: string, agent?: string) => void
  onEditTicket: () => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--theme-text)]">{t.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full border px-2 py-0.5 font-medium ${PRIORITY_STYLE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
              <span className={`rounded-full border px-2 py-0.5 font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
              {t.agent && <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 font-medium text-[var(--theme-text)]">👤 {t.agent}</span>}
              {t.sla_status && (
                <span className={`rounded-full border px-2 py-0.5 font-medium ${t.sla_status === 'expired' ? 'border-red-500/40 bg-red-500/10 text-red-400' : t.sla_status === 'expiring' ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'}`}>
                  ⏰ {t.sla_status}
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-[var(--theme-muted)]">
              dibuat {fmtDT(t.created_at)} · deadline {fmtDT(t.deadline)} · by {t.created_by}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
        </div>
        {t.description && <div className="mb-3 rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">{t.description}</div>}

        <div className="mb-3 flex flex-wrap gap-1.5">
          <button onClick={onEditTicket} className="rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✏️ Edit</button>
          {t.status === 'open' && (
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  onAction('assign', undefined, e.target.value)
                  e.target.value = ''
                }
              }}
              className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-2 py-1.5 text-xs text-[var(--theme-text)]"
            >
              <option value="">👤 Assign ke…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          {t.status === 'in_progress' && (
            <>
              <button onClick={() => onAction('status', undefined, undefined, 'done')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">✅ Selesai</button>
              <button onClick={() => onAction('unassign')} className="rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">↩ Lepas</button>
            </>
          )}
          {t.status !== 'cancelled' && t.status !== 'done' && (
            <button onClick={() => onAction('status', undefined, undefined, 'cancelled')} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">❌ Batal</button>
          )}
          {t.status === 'done' && (
            <button onClick={() => onAction('status', undefined, undefined, 'open')} className="rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">↩ Buka lagi</button>
          )}
          {(t.status === 'done' || t.status === 'cancelled') && (
            <button onClick={() => onAction('archive')} className="rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">🗑 Arsip</button>
          )}
        </div>

        <div className="mb-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="Catatan perkembangan…"
          />
          <button onClick={() => { onAction('note', note); setNote('') }} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500">Tambah</button>
        </div>

        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg bg-[var(--theme-card2)] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-muted)]">Riwayat</div>
          {t.timeline.map((e, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="shrink-0 font-mono text-[10px] text-[var(--theme-muted)]">{fmtDT(e.ts)}</span>
              <span className="shrink-0 font-medium text-[var(--theme-text)]">{e.by}</span>
              <span className="shrink-0 text-[var(--theme-muted)]">{e.action}</span>
              <span className="truncate text-[var(--theme-text-muted)]">{e.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EditTicketModal({
  t,
  onSubmit,
  onClose,
}: {
  t: Ticket
  onSubmit: (v: { title: string; description: string; priority: string; deadline: string }) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(t.title)
  const [description, setDescription] = useState(t.description || '')
  const [priority, setPriority] = useState(t.priority)
  const [deadline, setDeadline] = useState(t.deadline ? t.deadline.slice(0, 16) : '')

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--theme-text)]">✏️ Edit Tiket</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Judul *</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Deskripsi</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
          />
        </label>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Prioritas</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
              <option value="high">🔴 Tinggi</option>
              <option value="normal">🔵 Normal</option>
              <option value="low">🟢 Rendah</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Deadline</span>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">Batal</button>
          <button
            onClick={() => onSubmit({ title, description, priority, deadline })}
            disabled={!title.trim()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}

function TicketsScreen() {
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<Ticket | null>(null)
  const [editTicket, setEditTicket] = useState<Ticket | null>(null)
  const [filter, setFilter] = useState<'all' | Ticket['status']>('all')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const ticketsQuery = useQuery({
    queryKey: ['tickets', offset],
    queryFn: async () => {
      const res = await fetch(`/api/office?resource=tickets&limit=50&offset=${offset}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = (await res.json()) as TicketsResp
      return d
    },
    staleTime: 5000,
    refetchInterval: 15000,
  })

  const statsQuery = useQuery({
    queryKey: ['tickets-stats'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=tickets/stats')
      const d = await res.json()
      return (d.rows ?? []) as StatsRow[]
    },
    staleTime: 10000,
    refetchInterval: 30000,
  })

  const fleetQuery = useQuery({
    queryKey: ['fleet'],
    queryFn: async () => {
      const res = await fetch('/api/fleet')
      const d = (await res.json()) as FleetResp
      return (d.agents ?? []) as Array<{ id: string; name: string }>
    },
    staleTime: 60000,
  })

  const ticketsData = ticketsQuery.data
  const tickets = ticketsData?.items ?? []
  const totalTickets = ticketsData?.total ?? tickets.length
  const agents = fleetQuery.data ?? []
  const q = search.trim().toLowerCase()
  const shown = tickets.filter((t) => {
    if (filter !== 'all' && t.status !== filter) return false
    if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false
    return true
  })
  const counts = {
    open: tickets.filter((t) => t.status === 'open').length,
    in_progress: tickets.filter((t) => t.status === 'in_progress').length,
    done: tickets.filter((t) => t.status === 'done').length,
  }
  const statsRows = statsQuery.data ?? []

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const doAction = async (action: string, note?: string, agent?: string, status?: string) => {
    if (!detail) return
    try {
      await officePost({ id: detail.id, action, note: note || '', agent: agent || '', status: status || '' })
      flash(`✅ ${action} berhasil`)
      ticketsQuery.refetch()
      statsQuery.refetch()
      if (action === 'archive') setDetail(null)
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const saveEdit = async (v: { title: string; description: string; priority: string; deadline: string }) => {
    if (!editTicket) return
    try {
      await officePost({
        id: editTicket.id,
        action: 'edit',
        title: v.title,
        description: v.description,
        priority: v.priority,
        deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
      })
      flash('✅ Tiket diperbarui')
      setEditTicket(null)
      ticketsQuery.refetch()
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const createTicket = async (v: { title: string; description: string; priority: string; deadline: string; agent: string }) => {
    try {
      const res = await fetch('/api/office?resource=tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: v.title,
          description: v.description,
          priority: v.priority,
          deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
          agent: v.agent || null,
          created_by: 'samian',
        }),
      })
      const d = await res.json()
      if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`)
      flash('✅ Tiket dibuat')
      setShowForm(false)
      ticketsQuery.refetch()
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">🎫 Ticketing</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Antrian kerja untuk agent — buat, ambil, kerjakan, selesaikan.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          ➕ Tiket Baru
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Cari tiket…"
          className="w-full max-w-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-1.5 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
        />
        {(['all', 'open', 'in_progress', 'done', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 font-medium capitalize ${
              filter === s ? 'bg-[var(--theme-accent)] text-white' : 'bg-[var(--theme-card2)] text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]'
            }`}
          >
            {s === 'all' ? `Semua (${totalTickets})` : `${STATUS_LABEL[s].split(' ')[1] ?? s} (${counts[s as keyof typeof counts] ?? 0})`}
          </button>
        ))}
      </div>

      {statsRows.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {statsRows.map((r) => (
            <div key={r.agent} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
              <div className="text-xs font-semibold text-[var(--theme-muted)]">{r.agent}</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-lg font-bold text-[var(--theme-text)]">{r.done}</span>
                <span className="text-[10px] text-[var(--theme-muted)]">selesai</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[var(--theme-muted)]">
                <span>📋 {r.assigned} ditugaskan</span>
                <span>🔧 {r.in_progress} proses</span>
                {r.avg_hours !== null && <span>⏱ {r.avg_hours} jam/tiket</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {ticketsQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat tiket: {String(ticketsQuery.error)}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((t) => (
          <button
            key={t.id}
            onClick={() => setDetail(t)}
            className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-left transition-colors hover:bg-[var(--theme-card2)]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${PRIORITY_STYLE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
              {t.agent && <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-text)]">👤 {t.agent}</span>}
              {t.sla_status && t.sla_status !== 'ok' && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${t.sla_status === 'expired' ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-amber-500/40 bg-amber-500/10 text-amber-500'}`}>
                  ⏰ {t.sla_status}
                </span>
              )}
              <span className="ml-auto text-[10px] text-[var(--theme-muted)]">{fmtDT(t.created_at)}</span>
            </div>
            <div className="mt-1.5 text-sm font-medium text-[var(--theme-text)]">{t.title}</div>
            {t.description && <div className="mt-0.5 line-clamp-1 text-xs text-[var(--theme-muted)]">{t.description}</div>}
          </button>
        ))}
        {shown.length === 0 && !ticketsQuery.isError && (
          <div className="py-10 text-center text-[var(--theme-muted)]">Belum ada tiket — klik ➕ Tiket Baru.</div>
        )}
      </div>

      {shown.length > 0 && offset + shown.length < totalTickets && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setOffset((o) => o + 50)}
            className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]"
          >
            Muat lebih ({offset + shown.length}/{totalTickets})
          </button>
        </div>
      )}

      {showForm && <TicketFormModal agents={agents} onSubmit={createTicket} onClose={() => setShowForm(false)} />}
      {detail && (
        <TicketDetail
          t={detail}
          agents={agents}
          onClose={() => setDetail(null)}
          onAction={(action, note, agent, status) => void doAction(action, note, agent, status)}
          onEditTicket={() => {
            setEditTicket(detail)
            setDetail(null)
          }}
        />
      )}
      {editTicket && (
        <EditTicketModal
          t={editTicket}
          onSubmit={saveEdit}
          onClose={() => setEditTicket(null)}
        />
      )}
      <Toast msg={toast} />
    </div>
  )
}
