import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAgents } from '@/hooks/use-agents'

export const Route = createFileRoute('/approvals')({
  component: ApprovalsScreen,
})

type Policy = {
  auto_approve_types: string[]
  auto_approve_risks: string[]
  require_approval_risks: string[]
  require_approval_types: string[]
  spend_threshold_usd: number
  note?: string
}

function PolicyCard({ policy }: { policy?: Policy }) {
  if (!policy) return null
  return (
    <div className="mb-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--theme-text)]">⚖️ Approval Policy</span>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">otomatis</span>
      </div>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">{policy.note}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-lg bg-[var(--theme-card2)] px-2.5 py-1 text-[var(--theme-text-muted)]">
          ✅ Auto-approve: {policy.auto_approve_types.join(', ')} · risiko {policy.auto_approve_risks.join(', ')}
        </span>
        <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-amber-600">
          ⛔ Wajib approval: {policy.require_approval_types.join(', ')} · risiko {policy.require_approval_risks.join(', ')}
        </span>
        <span className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-sky-600">
          💰 Spending &gt; ${policy.spend_threshold_usd} wajib approval
        </span>
      </div>
    </div>
  )
}

type Approval = {
  id: string
  agent: string
  type: string
  title: string
  detail: string
  risk: string
  requested_at: string
  sla_minutes: number
  status: 'pending' | 'approved' | 'rejected'
  decided_by: string | null
  decided_at: string | null
  note: string | null
  sla_deadline?: string | null
  sla_remaining_min?: number | null
  sla_status?: 'ok' | 'expiring' | 'expired' | null
}

const RISK_STYLE: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
}

const SLA_STYLE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  expiring: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-primary-100 text-primary-700',
  farrah: 'bg-violet-100 text-violet-700',
  nadine: 'bg-sky-100 text-sky-700',
  aaron: 'bg-emerald-100 text-emerald-700',
  dinda: 'bg-rose-100 text-rose-700',
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

function ApprovalsScreen() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [fAgent, setFAgent] = useState('')
  const [fRisk, setFRisk] = useState('')
  const { data: agents } = useAgents()
  const agentIds = (agents ?? []).map((a) => a.id)

  const approvalsQuery = useQuery({
    queryKey: ['approvals'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=approvals')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.items ?? []) as Array<Approval>
    },
    staleTime: 3000,
    refetchInterval: 10000,
  })

  const policyQuery = useQuery({
    queryKey: ['office-policy'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=policy')
      const j = await res.json()
      return j as Policy
    },
    staleTime: 30000,
  })

  const decide = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: 'approved' | 'rejected'; note?: string }) => {
      const res = await fetch('/api/office?resource=approvals&action=decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, note }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })

  const submit = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/office?resource=approvals&action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })

  const items = approvalsQuery.data ?? []
  const shownBase = tab === 'pending' ? items.filter((i) => i.status === 'pending') : items
  const shown = shownBase.filter(
    (i) => (!fAgent || i.agent === fAgent) && (!fRisk || i.risk === fRisk),
  )
  const pendingCount = items.filter((i) => i.status === 'pending').length

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <PolicyCard policy={policyQuery.data} />
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Approval Queue</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Sentral persetujuan lintas agent — semua minta izin masuk ke satu tempat.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-0.5 text-sm">
            <button
              onClick={() => setTab('pending')}
              className={`rounded-md px-3 py-1.5 font-medium ${
                tab === 'pending' ? 'bg-neutral-900 text-white' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-card2)]'
              }`}
            >
              Pending ({pendingCount})
            </button>
            <button
              onClick={() => setTab('all')}
              className={`rounded-md px-3 py-1.5 font-medium ${
                tab === 'all' ? 'bg-neutral-900 text-white' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-card2)]'
              }`}
            >
              Semua ({items.length})
            </button>
          </div>
          <select
            value={fAgent}
            onChange={(e) => setFAgent(e.target.value)}
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-1.5 text-sm text-[var(--theme-text)]"
          >
            <option value="">Semua Agent</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <select
            value={fRisk}
            onChange={(e) => setFRisk(e.target.value)}
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-1.5 text-sm text-[var(--theme-text)]"
          >
            <option value="">Semua Risiko</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      {/* form submit */}
      <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Simulasi permintaan approval (test)</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
          <select
            id="ap-agent"
            className="rounded-lg border border-[var(--theme-input)] px-3 py-2 text-sm"
            defaultValue="farrah"
          >
            {agentIds.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select id="ap-risk" className="rounded-lg border border-[var(--theme-input)] px-3 py-2 text-sm" defaultValue="medium">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
          <select id="ap-type" className="rounded-lg border border-[var(--theme-input)] px-3 py-2 text-sm" defaultValue="tool_execution">
            <option value="tool_execution">tool execution</option>
            <option value="deploy">deploy</option>
            <option value="install">install</option>
            <option value="secret_access">secret access</option>
            <option value="external_contact">external contact</option>
            <option value="spending">spending</option>
            <option value="other">other</option>
          </select>
          <input
            id="ap-title"
            placeholder="Judul aksi…"
            className="rounded-lg border border-[var(--theme-input)] px-3 py-2 text-sm sm:col-span-2"
          />
          <button
            onClick={() =>
              submit.mutate({
                agent: (document.getElementById('ap-agent') as HTMLSelectElement).value,
                risk: (document.getElementById('ap-risk') as HTMLSelectElement).value,
                type: (document.getElementById('ap-type') as HTMLSelectElement).value,
                title: (document.getElementById('ap-title') as HTMLInputElement).value || 'Aksi tanpa judul',
              })
            }
            disabled={submit.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submit.isPending ? '…' : 'Kirim'}
          </button>
        </div>
      </div>

      {approvalsQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat approvals: {String(approvalsQuery.error)}
        </div>
      )}

      <div className="space-y-3">
        {shown.map((a) => (
          <div key={a.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${AGENT_COLOR[a.agent] ?? 'bg-[var(--theme-card2)] text-[var(--theme-text)]'}`}>
                {a.agent.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-semibold text-[var(--theme-text)]">{a.title}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${RISK_STYLE[a.risk] ?? RISK_STYLE.medium}`}>
                {a.risk}
              </span>
              <span className="rounded-full bg-[var(--theme-card2)] px-2 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">{a.type}</span>
              <span className="ml-auto text-xs text-[var(--theme-muted)]">
                {a.agent} · {fmtTime(a.requested_at)}
              </span>
            </div>
            {a.detail && <p className="mt-2 text-sm text-[var(--theme-text-muted)]">{a.detail}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {a.status === 'pending' ? (
                <>
                  <span className="text-xs text-[var(--theme-text-muted)]">
                    SLA {a.sla_minutes} menit
                    {a.sla_remaining_min != null && (
                      <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SLA_STYLE[a.sla_status ?? 'ok'] ?? SLA_STYLE.ok}`}>
                        {a.sla_status === 'expired'
                          ? `⏰ Lewat SLA ${Math.abs(a.sla_remaining_min).toFixed(0)}m`
                          : a.sla_status === 'expiring'
                            ? `⏳ Sisa ${a.sla_remaining_min.toFixed(0)}m`
                            : `✓ Sisa ${a.sla_remaining_min.toFixed(0)}m`}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <button
                      onClick={() => decide.mutate({ id: a.id, decision: 'approved', note: 'OK' })}
                      disabled={decide.isPending}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => decide.mutate({ id: a.id, decision: 'rejected', note: 'Tolak' })}
                      disabled={decide.isPending}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      ✕ Reject
                    </button>
                  </span>
                </>
              ) : (
                <span className={`text-xs font-medium ${a.status === 'approved' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {a.status.toUpperCase()} oleh {a.decided_by} · {fmtTime(a.decided_at)}
                  {a.note ? ` — ${a.note}` : ''}
                </span>
              )}
            </div>
          </div>
        ))}
        {shown.length === 0 && !approvalsQuery.isError && (
          <div className="py-10 text-center text-[var(--theme-muted)]">
            {tab === 'pending' ? 'Tidak ada approval pending. Semua aman 🎉' : 'Belum ada approval.'}
          </div>
        )}
      </div>
    </div>
  )
}
