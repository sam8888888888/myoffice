import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAgents } from '@/hooks/use-agents'

export const Route = createFileRoute('/control')({
  component: ControlScreen,
})

type Controls = {
  global_paused: boolean
  global_reason: string | null
  agents: Record<string, { paused: boolean; reason: string; by: string; at: string }>
}

type Vacation = {
  id: string
  agent: string
  type: string
  reason: string
  start: string
  end: string
  status: 'active' | 'ended'
  created_at: string
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

export function ControlScreen() {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [agentPause, setAgentPause] = useState<Record<string, string>>({})
  const { data: agents } = useAgents()
  const agentIds = (agents ?? []).map((a) => a.id)

  const controlsQuery = useQuery({
    queryKey: ['controls'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=controls')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as Controls
    },
    staleTime: 3000,
    refetchInterval: 10000,
  })

  const vacationQuery = useQuery({
    queryKey: ['vacation'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=vacation')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.items ?? []) as Array<Vacation>
    },
    staleTime: 3000,
    refetchInterval: 10000,
  })

  const capsQuery = useQuery({
    queryKey: ['office-caps'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=caps')
      const data = await res.json()
      return data as { auto_pause: boolean; global_budget_usd: number; agent_caps: Record<string, number> }
    },
    staleTime: 10000,
    refetchInterval: 30000,
  })
  const caps = capsQuery.data

  const capsMut = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=caps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['office-caps'] }),
  })

  const globalPause = useMutation({
    mutationFn: async ({ paused }: { paused: boolean }) => {
      const res = await fetch('/api/office?resource=controls&action=global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused, reason: reason || 'Emergency global' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['controls'] }),
  })

  const agentPauseMut = useMutation({
    mutationFn: async ({ agent, paused }: { agent: string; paused: boolean }) => {
      const res = await fetch('/api/office?resource=controls&action=agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, paused, reason: agentPause[agent] || 'Instruksi Papi' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['controls'] }),
  })

  const submitVacation = useMutation({
    mutationFn: async (body: Record<string, string>) => {
      const res = await fetch('/api/office?resource=vacation&action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vacation'] }),
  })

  const endVacation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/office?resource=vacation&action=end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vacation'] }),
  })

  const controls = controlsQuery.data
  const vacations = vacationQuery.data ?? []
  const pausedAgents = Object.entries(controls?.agents ?? {}).filter(([, v]) => v.paused)

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Control Center</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Kill-switch global, pause/resume per agent, dan cuti. Approval dari agent yang di-pause otomatis ditolak.
        </p>
      </div>

      {/* Global kill-switch */}
      <div className={`mb-5 rounded-xl border p-4 ${controls?.global_paused ? 'border-red-300 bg-red-50/30' : 'border-[var(--theme-border)] bg-[var(--theme-card)]'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-[var(--theme-text)]">
              {controls?.global_paused ? '🚨 GLOBAL PAUSED' : 'Emergency Kill-Switch Global'}
            </div>
            <div className="text-xs text-[var(--theme-muted)]">
              {controls?.global_paused ? `Alasan: ${controls.global_reason}` : 'Hentikan semua agent (soft pause — approval & tugas baru ditahan, proses gateway TIDAK dimatikan otomatis).'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Alasan…"
              className="w-56 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
            <button
              onClick={() => globalPause.mutate({ paused: !controls?.global_paused })}
              disabled={globalPause.isPending}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${controls?.global_paused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {controls?.global_paused ? '▶ Resume semua' : '⏸ Pause semua'}
            </button>
          </div>
        </div>
      </div>

      {/* Per-agent */}
      <div className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--theme-text)]">Per Agent</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agentIds.map((agent) => {
            const paused = !!controls?.agents?.[agent]?.paused
            const cap = caps?.agent_caps?.[agent]
            return (
              <div key={agent} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${AGENT_COLOR[agent] ?? 'bg-neutral-500 text-white'}`}>
                    {agent.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium capitalize text-[var(--theme-text)]">{agent}</div>
                    <div className={`text-[10px] font-medium ${paused ? 'text-red-500' : 'text-emerald-600'}`}>
                      {paused ? '⏸ Paused' : '● Aktif'}
                    </div>
                    {typeof cap === 'number' && (
                      <div className="text-[10px] text-[var(--theme-muted)]">Cap: ${cap}/bln</div>
                    )}
                  </div>
                  <button
                    onClick={() => agentPauseMut.mutate({ agent, paused: !paused })}
                    disabled={agentPauseMut.isPending}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${paused ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                  >
                    {paused ? 'Resume' : 'Pause'}
                  </button>
                </div>
                {paused && (
                  <div className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                    {controls?.agents?.[agent]?.reason} · {fmtTime(controls?.agents?.[agent]?.at ?? null)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Credit caps & auto-pause */}
      <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--theme-text)]">💰 Credit Caps</h2>
            <div className="text-xs text-[var(--theme-muted)]">
              Budget global ${caps?.global_budget_usd ?? '—'}/bln — agent yang over cap otomatis di-pause oleh sistem.
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--theme-text-muted)]">
            <input
              type="checkbox"
              checked={!!caps?.auto_pause}
              onChange={(e) => capsMut.mutate({ auto_pause: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
            Auto-pause saat over cap
          </label>
        </div>
      </div>

      {/* Cuti / pause terencana */}
      <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Cuti / Pause Terencana (wajib alasan)</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          <select id="vc-agent" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="nadine">
            {agentIds.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select id="vc-type" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" defaultValue="cuti">
            <option value="cuti">cuti</option>
            <option value="pause">pause</option>
          </select>
          <input id="vc-start" placeholder="Mulai (YYYY-MM-DD)" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-2" />
          <input id="vc-end" placeholder="Selesai" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
          <input id="vc-reason" placeholder="Alasan (wajib)…" className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
          <button
            onClick={() =>
              submitVacation.mutate({
                agent: (document.getElementById('vc-agent') as HTMLSelectElement).value,
                type: (document.getElementById('vc-type') as HTMLSelectElement).value,
                start: (document.getElementById('vc-start') as HTMLInputElement).value,
                end: (document.getElementById('vc-end') as HTMLInputElement).value,
                reason: (document.getElementById('vc-reason') as HTMLInputElement).value,
              })
            }
            disabled={submitVacation.isPending}
            className="rounded-lg bg-[var(--theme-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Ajukan
          </button>
        </div>
        {submitVacation.isError && (
          <div className="mt-2 text-xs text-red-600">{String(submitVacation.error)}</div>
        )}
        <div className="mt-3 space-y-2">
          {vacations.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--theme-card2)] px-3 py-2 text-xs">
              <span className="font-medium capitalize text-[var(--theme-text)]">{v.agent}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${v.type === 'cuti' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>{v.type}</span>
              <span className="text-[var(--theme-text-muted)]">{v.start} → {v.end}</span>
              <span className="text-[var(--theme-muted)]">{v.reason}</span>
              <span className={`ml-auto font-medium ${v.status === 'active' ? 'text-amber-600' : 'text-emerald-600'}`}>{v.status}</span>
              {v.status === 'active' && (
                <button
                  onClick={() => endVacation.mutate(v.id)}
                  className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-700"
                >
                  ✓ Selesai
                </button>
              )}
            </div>
          ))}
          {vacations.length === 0 && <div className="text-xs text-[var(--theme-muted)]">Belum ada cuti/pause terencana.</div>}
        </div>
      </div>

      {/* Log pause aktif */}
      {pausedAgents.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-red-700">⏸ Agent sedang di-pause</h2>
          {pausedAgents.map(([agent, v]) => (
            <div key={agent} className="text-xs text-red-700">
              <span className="font-medium capitalize">{agent}</span> — {v.reason} ({fmtTime(v.at)})
            </div>
          ))}
        </div>
      )}

      {/* Geofence aksi berisiko */}
      <GeofencePanel />
    </div>
  )
}

function GeofencePanel() {
  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState('00-23')
  const [ips, setIps] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/office?resource=geofence')
      const d = await res.json()
      setEnabled(!!d.enabled)
      setHours(d.allowed_hours || '00-23')
      setIps((d.allowed_ips || []).join('\n'))
    } catch (e) {
      setMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    try {
      const res = await fetch('/api/office?resource=geofence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          allowed_hours: hours,
          allowed_ips: ips.split('\n').map((s) => s.trim()).filter(Boolean),
        }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || 'gagal')
      setMsg('✅ Geofence tersimpan')
    } catch (e) {
      setMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">📍 Geofence Aksi Berisiko</h2>
          <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
            Aksi deploy/install/secret/spending &amp; risiko high di luar jam/IP izin → tidak auto-approve, wajib manual.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--theme-text)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Aktif
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">Jam izin (WIB, format 08-17)</span>
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="08-17"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--theme-muted)]">IP publik yang diizinkan (satu per baris, kosong = semua)</span>
          <textarea
            value={ips}
            onChange={(e) => setIps(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none focus:border-sky-500"
            placeholder="0.0.0.0"
          />
        </label>
      </div>
      {msg && <div className="mt-2 text-xs text-[var(--theme-text)]">{msg}</div>}
      <button
        onClick={save}
        className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        💾 Simpan Geofence
      </button>
    </div>
  )
}
