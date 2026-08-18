import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/jobs-all')({
  component: JobsAllScreen,
})

type Job = {
  type: string
  id: string
  name: string
  prompt: string
  schedule_display: string
  schedule: unknown
  enabled: boolean
  state: string
  next_run_at: number | null
  last_run_at: number | null
  last_status: string | null
  last_error?: string | null
  no_agent?: boolean
  script?: string | null
  skills?: string[]
  repeat?: unknown
  deliver?: string | null
  origin?: string | null
  turns?: number
  maxTurns?: number
  tokenUsed?: number
  maxTokens?: number
  lastOutput?: string
}

type AgentJobs = {
  id: string
  name: string
  server: string
  type: string
  jobs: Job[]
  error: string | null
}

type JobsResp = {
  ok?: boolean
  updated: number | null
  agents: AgentJobs[]
}

const AGENT_COLORS: Record<string, string> = {
  rena: 'bg-pink-600',
  farrah: 'bg-purple-600',
  nadine: 'bg-teal-600',
  aaron: 'bg-indigo-600',
  dinda: 'bg-orange-600',
}

function parseTs(ts: number | string | null): Date | null {
  if (!ts) return null
  let d: Date
  if (typeof ts === 'string') {
    d = new Date(ts)
  } else {
    // angka: epoch detik (10 digit) atau milidetik (13 digit)
    d = new Date(ts > 1e12 ? ts : ts * 1000)
  }
  return isNaN(d.getTime()) ? null : d
}

function fmtTime(ts: number | string | null): string {
  const d = parseTs(ts)
  if (!d) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtLocal(ts: number | string | null): string {
  const d = parseTs(ts)
  if (!d) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function StateBadge({ job }: { job: Job }) {
  const paused = job.state === 'paused' || !job.enabled
  const cls = paused
    ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
  const label = paused ? '⏸ paused' : job.state === 'running' ? '⚙️ running' : '✅ scheduled'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    hermes: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
    'dinda-schedule': 'bg-orange-500/15 text-orange-500 border-orange-500/30',
    'dinda-autonomous': 'bg-rose-500/15 text-rose-500 border-rose-500/30',
  }
  const label: Record<string, string> = {
    hermes: 'cron',
    'dinda-schedule': 'jadwal',
    'dinda-autonomous': 'otonom',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[type] ?? 'bg-[var(--theme-card2)] text-[var(--theme-muted)] border-[var(--theme-border)]'}`}>
      {label[type] ?? type}
    </span>
  )
}

async function runAction(agent: string, action: string, jobId?: string, payload?: Record<string, unknown>) {
  const res = await fetch('/api/jobs-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, action, jobId, payload }),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
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

function JobFormModal({
  title,
  initial,
  onSubmit,
  onClose,
  dindaMode,
}: {
  title: string
  initial: { name: string; schedule: string; prompt: string; enabled: boolean }
  onSubmit: (v: { name: string; schedule: string; prompt: string; enabled: boolean }) => void
  onClose: () => void
  dindaMode?: boolean
}) {
  const [name, setName] = useState(initial.name)
  const [schedule, setSchedule] = useState(initial.schedule)
  const [prompt, setPrompt] = useState(initial.prompt)
  const [enabled, setEnabled] = useState(initial.enabled)

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--theme-text)]">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
        </div>
        {!dindaMode && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Nama job</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
              placeholder="Contoh: Laporan Harian"
            />
          </label>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">
            {dindaMode ? 'Jadwal (cron)' : 'Jadwal (cron)'}
          </span>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="0 8 * * *  (menit jam tanggal bulan hari)"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">
            {dindaMode ? 'Prompt / tugas untuk agent' : 'Prompt (isi tugas agent)'}
          </span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="Apa yang harus dikerjakan agent saat jadwal tiba…"
          />
        </label>
        {!dindaMode && (
          <label className="mb-4 flex items-center gap-2 text-sm text-[var(--theme-text)]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            Aktif
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">
            Batal
          </button>
          <button
            onClick={() => onSubmit({ name, schedule, prompt, enabled })}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentSection({
  a,
  onAction,
  onEdit,
  onAdd,
  onBulk,
  busy,
}: {
  a: AgentJobs
  onAction: (action: string, job: Job) => void
  onEdit: (job: Job) => void
  onAdd: () => void
  onBulk: (action: 'pause_all' | 'resume_all') => void
  busy: boolean
}) {
  const isDinda = a.type === 'samcoder'
  const activeJobs = a.jobs.filter((j) => j.enabled || j.state === 'running').length

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-full ${AGENT_COLORS[a.id] ?? 'bg-indigo-600'} text-sm font-bold text-white`}>
            {a.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2 font-semibold text-[var(--theme-text)]">
              {a.name}
              <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-muted)]">
                {a.server} · {isDinda ? 'SAMCODER' : 'Hermes'}
              </span>
            </div>
            <div className="text-xs text-[var(--theme-muted)]">
              {a.jobs.length} total · {activeJobs} aktif
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {a.jobs.length > 0 && (
            <>
              <button
                onClick={() => onBulk('pause_all')}
                disabled={busy}
                title={`Pause semua jobs ${a.name}`}
                className="rounded-md border border-amber-500/40 px-2 py-1.5 text-xs text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
              >
                ⏸ semua
              </button>
              <button
                onClick={() => onBulk('resume_all')}
                disabled={busy}
                title={`Resume semua jobs ${a.name}`}
                className="rounded-md border border-emerald-500/40 px-2 py-1.5 text-xs text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
              >
                ▶️ semua
              </button>
            </>
          )}
          <button
            onClick={onAdd}
            disabled={busy}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            ➕ {isDinda ? 'Jadwal' : 'Job'}
          </button>
        </div>
      </div>
      {a.error && (
        <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          ⚠️ {a.error}
        </div>
      )}
      {a.jobs.length === 0 && !a.error && (
        <div className="rounded-lg bg-[var(--theme-card2)] px-3 py-4 text-center text-xs text-[var(--theme-muted)]">
          Belum ada jobs — klik ➕ untuk tambah.
        </div>
      )}
      <div className="space-y-2">
        {a.jobs.map((j) => (
          <div key={`${a.id}-${j.id}`} className="rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-card2)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--theme-text)]">{j.name}</span>
                  <TypeBadge type={j.type} />
                  <StateBadge job={j} />
                </div>
                <div className="mt-1 text-[11px] text-[var(--theme-muted)]">
                  <span className="font-mono">{j.schedule_display || '—'}</span>
                  {j.next_run_at ? ` · next ${fmtTime(j.next_run_at)}` : ''}
                  {j.last_run_at ? ` · last ${fmtLocal(j.last_run_at)}` : ''}
                  {j.last_status ? ` · ${j.last_status}` : ''}
                </div>
                {j.prompt && (
                  <div className="mt-1 line-clamp-2 text-xs text-[var(--theme-muted)]">{j.prompt}</div>
                )}
                {j.last_error && (
                  <div className="mt-1 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400">⚠️ {j.last_error}</div>
                )}
                {j.script && (
                  <div className="mt-1 text-[11px] text-[var(--theme-muted)]">📜 script: {j.script}</div>
                )}
                {j.type === 'dinda-autonomous' && j.turns !== undefined && (
                  <div className="mt-1 text-[11px] text-[var(--theme-muted)]">
                    turn {j.turns}/{j.maxTurns} · token {j.tokenUsed ?? 0}/{j.maxTokens ?? '—'}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {j.type !== 'dinda-autonomous' && (
                  <>
                    <button
                      onClick={() => onEdit(j)}
                      disabled={busy}
                      title="Edit"
                      className="rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-text)] hover:bg-[var(--theme-card)] disabled:opacity-50"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onAction(j.state === 'paused' || !j.enabled ? 'resume' : 'pause', j)}
                      disabled={busy}
                      title={j.state === 'paused' || !j.enabled ? 'Resume' : 'Pause'}
                      className="rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-text)] hover:bg-[var(--theme-card)] disabled:opacity-50"
                    >
                      {j.state === 'paused' || !j.enabled ? '▶️' : '⏸'}
                    </button>
                    <button
                      onClick={() => onAction('run', j)}
                      disabled={busy}
                      title="Jalankan sekarang"
                      className="rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-text)] hover:bg-[var(--theme-card)] disabled:opacity-50"
                    >
                      ⚡
                    </button>
                  </>
                )}
                {j.type === 'dinda-autonomous' && j.state === 'running' && (
                  <button
                    onClick={() => onAction('autonomous_stop', j)}
                    disabled={busy}
                    title="Stop otonom"
                    className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    ⏹
                  </button>
                )}
                {j.type === 'dinda-autonomous' && j.state !== 'running' && (
                  <button
                    onClick={() => onAction('autonomous_resume', j)}
                    disabled={busy}
                    title="Lanjutkan otonom"
                    className="rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-text)] hover:bg-[var(--theme-card)] disabled:opacity-50"
                  >
                    ▶️
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Hapus job "${j.name}" dari agent ${a.name}?`)) onAction('delete', j)
                  }}
                  disabled={busy}
                  title="Hapus"
                  className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function JobsAllScreen() {
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editJob, setEditJob] = useState<{ agent: AgentJobs; job: Job } | null>(null)
  const [addAgent, setAddAgent] = useState<AgentJobs | null>(null)
  const [search, setSearch] = useState('')

  const jobsQuery = useQuery({
    queryKey: ['jobs-all'],
    queryFn: async () => {
      const res = await fetch('/api/jobs-all')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as JobsResp
      return data
    },
    staleTime: 5000,
    refetchInterval: 20000,
  })

  const agents = jobsQuery.data?.agents ?? []
  const q = search.trim().toLowerCase()
  const filteredAgents = q
    ? agents
        .map((a) => ({
          ...a,
          jobs: a.jobs.filter(
            (j) =>
              j.name.toLowerCase().includes(q) ||
              (j.prompt || '').toLowerCase().includes(q) ||
              (j.schedule_display || '').toLowerCase().includes(q),
          ),
        }))
        .filter((a) => a.jobs.length > 0)
    : agents
  const totalJobs = agents.reduce((s, a) => s + a.jobs.length, 0)
  const totalActive = agents.reduce(
    (s, a) => s + a.jobs.filter((j) => j.enabled || j.state === 'running').length,
    0,
  )

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const doAction = async (action: string, job: Job) => {
    if (!jobsQuery.data) return
    const agentId = agents.find((a) => a.jobs.some((j) => j.id === job.id))?.id
    if (!agentId) return
    setBusy(true)
    try {
      const r = await runAction(agentId, action, job.id)
      flash(`✅ ${action} berhasil`)
      void r
      jobsQuery.refetch()
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const submitEdit = async (v: { name: string; schedule: string; prompt: string; enabled: boolean }) => {
    if (!editJob) return
    setBusy(true)
    try {
      const isDindaSchedule = editJob.agent.type === 'samcoder' && editJob.job.type === 'dinda-schedule'
      await runAction(editJob.agent.id, isDindaSchedule ? 'update' : 'update', editJob.job.id, {
        name: v.name || v.schedule,
        schedule: v.schedule,
        prompt: v.prompt,
        enabled: v.enabled,
      })
      flash('✅ Job diperbarui')
      setEditJob(null)
      jobsQuery.refetch()
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const doBulk = async (agentId: string, action: 'pause_all' | 'resume_all') => {
    setBusy(true)
    try {
      const r = await runAction(agentId, action)
      const applied = (r.data as { applied?: number } | undefined)?.applied
      flash(`✅ ${action === 'pause_all' ? 'Pause' : 'Resume'} semua: ${applied ?? 'ok'}`)
      jobsQuery.refetch()
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const submitAdd = async (v: { name: string; schedule: string; prompt: string; enabled: boolean }) => {
    if (!addAgent) return
    setBusy(true)
    try {
      await runAction(addAgent.id, 'create', undefined, {
        name: v.name || v.schedule,
        schedule: v.schedule,
        prompt: v.prompt,
        enabled: v.enabled,
      })
      flash('✅ Job dibuat')
      setAddAgent(null)
      jobsQuery.refetch()
    } catch (e) {
      flash(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Jobs All Agent</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Semua jobs setiap agent — lihat isi & kelola dari satu tempat.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Cari job / prompt / jadwal…"
            className="w-full max-w-sm rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-1.5 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500 sm:w-64"
          />
          <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
            {agents.length} agent
          </span>
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-medium text-emerald-600">
            {totalActive} aktif
          </span>
          <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
            {totalJobs} total
          </span>
          {jobsQuery.data?.updated && (
            <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-muted)]">
              update {fmtTime(jobsQuery.data.updated)}
            </span>
          )}
        </div>
      </div>
      {jobsQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat jobs: {String(jobsQuery.error)}
        </div>
      )}
      <div className="space-y-4">
        {filteredAgents.map((a) => (
          <AgentSection
            key={a.id}
            a={a}
            busy={busy}
            onAction={doAction}
            onEdit={(job) => setEditJob({ agent: a, job })}
            onAdd={() => setAddAgent(a)}
            onBulk={(action) => doBulk(a.id, action)}
          />
        ))}
      </div>
      {agents.length > 0 && filteredAgents.length === 0 && (
        <div className="py-10 text-center text-[var(--theme-muted)]">
          Tidak ada job cocok dengan "{search}".
        </div>
      )}
      {agents.length === 0 && !jobsQuery.isError && (
        <div className="py-10 text-center text-[var(--theme-muted)]">Memuat jobs…</div>
      )}

      {editJob && (
        <JobFormModal
          title={`✏️ Edit — ${editJob.job.name}`}
          initial={{
            name: editJob.job.name,
            schedule:
              typeof editJob.job.schedule_display === 'string' ? editJob.job.schedule_display : '',
            prompt: editJob.job.prompt,
            enabled: editJob.job.enabled,
          }}
          onSubmit={submitEdit}
          onClose={() => setEditJob(null)}
          dindaMode={editJob.agent.type === 'samcoder' && editJob.job.type !== 'dinda-autonomous'}
        />
      )}
      {addAgent && (
        <JobFormModal
          title={`➕ Tambah ${addAgent.type === 'samcoder' ? 'Jadwal' : 'Job'} — ${addAgent.name}`}
          initial={{ name: '', schedule: '', prompt: '', enabled: true }}
          onSubmit={submitAdd}
          onClose={() => setAddAgent(null)}
          dindaMode={addAgent.type === 'samcoder'}
        />
      )}
      <Toast msg={toast} />
    </div>
  )
}
