import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AgentAvatar } from '@/components/agent-avatar'

export const Route = createFileRoute('/org')({
  component: OrgScreen,
})

type OrgAgent = {
  id: string
  name: string
  role: string
  dept: string
  status?: string
  server?: string
  avatar?: string | null
  currentTask?: string | null
}

type OrgDept = {
  id: string
  name: string
  lead: string
  members: string[]
}

type OrgData = {
  company: string
  human: Array<{ id: string; name: string; role: string; level: number }>
  departments: OrgDept[]
  agents: OrgAgent[]
}

const AGENT_COLOR: Record<string, string> = {
  samian: 'bg-neutral-900 text-white',
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

function OrgScreen() {
  const qc = useQueryClient()
  const [editMode, setEditMode] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<Array<{ version: string; ts: string; size: number }>>([])
  const [versionMsg, setVersionMsg] = useState<string | null>(null)

  const loadVersions = async () => {
    try {
      const res = await fetch('/api/office?resource=versions&resource=org')
      const d = await res.json()
      setVersions(d.versions ?? [])
      setShowVersions(true)
      setVersionMsg(null)
    } catch (e) {
      setVersionMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const doRollback = async (version: string) => {
    if (!confirm('Kembalikan org ke versi ini? State saat ini akan disimpan sebagai versi baru.')) return
    try {
      const res = await fetch('/api/office?resource=rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'org', version }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || 'gagal')
      setVersionMsg('✅ Rollback berhasil')
      setShowVersions(false)
      orgQuery.refetch()
    } catch (e) {
      setVersionMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const [newDeptName, setNewDeptName] = useState('')

  const orgQuery = useQuery({
    queryKey: ['org'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=org')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as OrgData
    },
    staleTime: 5000,
    refetchInterval: editMode ? 60000 : 15000,
  })

  const save = useMutation({
    mutationFn: async (body: { departments: OrgDept[]; agents: OrgAgent[] }) => {
      const res = await fetch('/api/office?resource=org&action=update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org'] })
      setEditMode(false)
    },
  })

  const org = orgQuery.data

  function moveAgent(agentId: string, deptId: string) {
    if (!org) return
    const agent = org.agents.find((a) => a.id === agentId)
    if (!agent) return
    const oldDept = org.departments.find((d) => d.id === agent.dept)
    if (oldDept) oldDept.members = oldDept.members.filter((m) => m !== agentId)
    const newDept = org.departments.find((d) => d.id === deptId)
    if (newDept && !newDept.members.includes(agentId)) newDept.members.push(agentId)
    agent.dept = deptId
    // jika agent jadi di dept baru, dan dia lead di dept lama → hapus lead lama
    if (oldDept && oldDept.lead === agentId) oldDept.lead = oldDept.members[0] ?? ''
    qc.setQueryData(['org'], (old: OrgData | undefined) => (old ? { ...old, agents: [...org.agents], departments: [...org.departments] } : old))
  }

  function setLead(deptId: string, agentId: string) {
    if (!org) return
    const dept = org.departments.find((d) => d.id === deptId)
    if (dept) dept.lead = agentId
    qc.setQueryData(['org'], (old: OrgData | undefined) => (old ? { ...old, departments: [...org.departments] } : old))
  }

  function addDept() {
    if (!org || !newDeptName.trim()) return
    const id = 'dept_' + newDeptName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20)
    org.departments.push({ id, name: newDeptName.trim(), lead: '', members: [] })
    setNewDeptName('')
    qc.setQueryData(['org'], (old: OrgData | undefined) => (old ? { ...old, departments: [...org.departments] } : old))
  }

  function handleSave() {
    if (!org) return
    save.mutate({ departments: org.departments, agents: org.agents })
  }

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Org Chart</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Struktur campuran manusia + agent — {org?.company ?? '…'}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadVersions}
            title="Riwayat versi & rollback"
            className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-medium text-[var(--theme-text-muted)] hover:bg-[var(--theme-hover)]"
          >
            🕘 Versi
          </button>
          {editMode ? (
            <>
              <button
                onClick={() => setEditMode(false)}
                className="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-medium text-[var(--theme-text-muted)] hover:bg-[var(--theme-hover)]"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={save.isPending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {save.isPending ? 'Menyimpan…' : '✓ Simpan perubahan'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              ✏️ Edit org
            </button>
          )}
        </div>
      </div>

      {orgQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat org chart: {String(orgQuery.error)}
        </div>
      )}

      {versionMsg && (
        <div className="mb-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-4 py-3 text-sm text-[var(--theme-text)]">
          {versionMsg}
        </div>
      )}

      {showVersions && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowVersions(false)}>
          <div className="w-full max-w-lg rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--theme-text)]">🕘 Riwayat Versi Org</h3>
              <button onClick={() => setShowVersions(false)} className="rounded-lg px-2 py-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
            </div>
            {versions.length === 0 ? (
              <div className="rounded-lg bg-[var(--theme-card2)] px-3 py-6 text-center text-sm text-[var(--theme-muted)]">
                Belum ada versi tersimpan. Versi dibuat otomatis setiap kali org disimpan.
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {versions
                  .slice()
                  .reverse()
                  .map((v) => (
                    <div key={v.version} className="flex items-center justify-between rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-card2)] px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-[var(--theme-text)]">{v.ts}</span>
                      <button
                        onClick={() => doRollback(v.version)}
                        className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
                      >
                        ↩ Rollback
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {org && (
        <div>
          {/* CEO */}
          <div className="mb-8 flex justify-center">
            {org.human.map((h) => (
              <div
                key={h.id}
                className="flex w-64 flex-col items-center rounded-2xl border-2 border-neutral-900 bg-[var(--theme-card)] p-4 shadow-md"
              >
                <div className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold ${AGENT_COLOR[h.id] ?? 'bg-neutral-900 text-white'}`}>
                  {h.name.charAt(0)}
                </div>
                <div className="mt-2 font-semibold text-[var(--theme-text)]">{h.name}</div>
                <div className="text-xs text-[var(--theme-muted)]">{h.role}</div>
              </div>
            ))}
          </div>

          {/* Departments */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {org.departments.map((dept) => {
              const members = dept.members
                .map((id) => org.agents.find((a) => a.id === id))
                .filter(Boolean) as OrgAgent[]
              return (
                <div
                  key={dept.id}
                  onDragOver={(e) => {
                    if (editMode) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    if (!editMode) return
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    if (id) moveAgent(id, dept.id)
                  }}
                  className={`rounded-xl border p-4 ${editMode ? 'border-dashed border-sky-500/40 bg-[var(--theme-card)]' : 'border-[var(--theme-border)] bg-[var(--theme-card)]'}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[var(--theme-text)]">{dept.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">{dept.id}</span>
                  </div>
                  <div className="space-y-2">
                    {members.map((m) => (
                      <div
                        key={m.id}
                        draggable={editMode}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', m.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        className={`flex items-center gap-3 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-card2)] p-2.5 ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                          <AgentAvatar id={m.id} name={m.name} avatar={m.avatar} size="sm" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--theme-text)]">{m.name}</span>
                            {dept.lead === m.id && (
                              <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                                Lead
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--theme-muted)]">{m.role}</div>
                        </div>
                        {!editMode ? (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${m.status === 'online' ? 'text-emerald-600' : 'text-red-500'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${m.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              {m.status ?? 'offline'}
                            </span>
                            {m.server && <span className="text-[9px] text-[var(--theme-muted)]">{m.server}</span>}
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <select
                              value={m.dept}
                              onChange={(e) => moveAgent(m.id, e.target.value)}
                              className="rounded border border-[var(--theme-input)] bg-[var(--theme-card)] px-1.5 py-1 text-[10px] text-[var(--theme-text)]"
                            >
                              {org.departments.map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                            {dept.lead !== m.id && (
                              <button
                                onClick={() => setLead(dept.id, m.id)}
                                className="rounded bg-neutral-700 px-1.5 py-1 text-[9px] font-medium text-white hover:bg-neutral-600"
                                title="Jadikan Lead"
                              >
                                Lead
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {members.length === 0 && (
                      <div className="py-3 text-center text-[10px] text-[var(--theme-muted)]">Kosong — pindahkan agent ke sini saat mode edit</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Tambah departemen (edit mode) */}
          {editMode && (
            <div className="mt-4 flex gap-2 rounded-xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-card2)] p-3">
              <input
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                placeholder="Nama departemen baru…"
                className="flex-1 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)]"
              />
              <button
                onClick={addDept}
                disabled={!newDeptName.trim()}
                className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                + Departemen
              </button>
            </div>
          )}
        </div>
      )}

      {!org && !orgQuery.isError && <div className="py-10 text-center text-[var(--theme-muted)]">Memuat org chart…</div>}
    </div>
  )
}
