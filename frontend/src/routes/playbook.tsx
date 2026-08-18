import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/playbook')({
  component: PlaybookScreen,
})

type Rule = { id: string; name: string; enabled: boolean; trigger: Record<string, unknown>; action: Record<string, unknown> }

const TRIG_LABEL: Record<string, string> = {
  spend_pct: '💰 Spend ≥ %',
  agent_error_count: '🚨 Agent tidak sehat ≥ N',
  schedule: '📅 Jadwal (HH:MM * * DOW)',
}
const ACT_LABEL: Record<string, string> = { telegram: '📋 Notif Telegram', pause: '⏸ Pause agent', report: '📄 Generate laporan' }

function PlaybookScreen() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [tType, setTType] = useState('spend_pct')
  const [tVal, setTVal] = useState('80')
  const [aType, setAType] = useState('telegram')
  const [aVal, setAVal] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['playbook'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=playbook')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return ((await res.json()).rules ?? []) as Rule[]
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const trigger = tType === 'schedule' ? { type: 'schedule', cron: tVal } : tType === 'spend_pct' ? { type: 'spend_pct', gte: Number(tVal) } : { type: 'agent_error_count', gte: Number(tVal) }
      const action = aType === 'pause' ? { type: 'pause', agent: aVal } : aType === 'report' ? { type: 'report', kind: aVal || 'kpi' } : { type: 'telegram' }
      const res = await fetch('/api/office?resource=playbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, trigger, action }) })
      if (!res.ok) throw new Error(((await res.json()).error) ?? `HTTP ${res.status}`)
    },
    onSuccess: () => { setMsg('Rule dibuat'); setName(''); qc.invalidateQueries({ queryKey: ['playbook'] }); setTimeout(() => setMsg(null), 3000) },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Gagal'),
  })

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/office?resource=playbook&action=delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playbook'] }),
  })

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=playbook&action=run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    onSuccess: () => { setMsg('Playbook dijalankan'); setTimeout(() => setMsg(null), 3000) },
  })

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">📋 Playbook</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">Automation rules: spend tinggi, agent tidak sehat, laporan terjadwal</p>
        </div>
        <button onClick={() => runNow.mutate()} className="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-text)] hover:bg-[var(--theme-card2)]">▶ Jalankan Sekarang</button>
      </div>
      {msg && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{msg}</div>}
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Rules Aktif ({q.data?.length ?? 0})</h2>
          <div className="space-y-2">
            {(q.data ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-[var(--theme-text)]">{r.name}</div>
                  <div className="text-[11px] text-[var(--theme-muted)]">
                    {TRIG_LABEL[r.trigger.type] ?? r.trigger.type} · {ACT_LABEL[r.action.type] ?? r.action.type}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'}`}>{r.enabled ? 'AKTIF' : 'OFF'}</span>
                  <button onClick={() => del.mutate(r.id)} className="rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10">Hapus</button>
                </div>
              </div>
            ))}
            {!q.data?.length && <div className="py-4 text-center text-sm text-[var(--theme-muted)]">Belum ada rule — tambah di kanan.</div>}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Tambah Rule</h2>
          <div className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama rule (mis. Alert spend tinggi)" className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
            <select value={tType} onChange={(e) => setTType(e.target.value)} className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
              <option value="spend_pct">💰 Spend ≥ %</option>
              <option value="agent_error_count">🚨 Agent tidak sehat ≥ N</option>
              <option value="schedule">📅 Jadwal (HH:MM * * DOW)</option>
            </select>
            <input value={tVal} onChange={(e) => setTVal(e.target.value)} placeholder={tType === 'schedule' ? 'Contoh: 17:00 * * 5 (Jumat 17:00)' : 'Nilai ambang (mis. 80)'} className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
            <select value={aType} onChange={(e) => setAType(e.target.value)} className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
              <option value="telegram">📋 Notif Telegram</option>
              <option value="pause">⏸ Pause agent</option>
              <option value="report">📄 Generate laporan</option>
            </select>
            {aType === 'pause' && <input value={aVal} onChange={(e) => setAVal(e.target.value)} placeholder="Agent yang di-pause (mis. nadine)" className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />}
            {aType === 'report' && <input value={aVal} onChange={(e) => setAVal(e.target.value)} placeholder="Jenis laporan: kpi / payroll / health" className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />}
            <button onClick={() => create.mutate()} disabled={!name || create.isPending} className="w-full rounded-lg bg-accent-500 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-40">＋ Buat Rule</button>
          </div>
        </div>
      </div>
    </div>
  )
}
