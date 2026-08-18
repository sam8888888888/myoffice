/**
 * Agent Personas — Agent resmi MyOffice (SAM Group).
 * Id & nama SINKRON dengan fleet_aggregator.py + org.json:
 * rena, farrah, nadine, aaron, dinda.
 * JANGAN tambah nama lain — semua agent harus kompak.
 */

export type AgentPersona = {
  name: string
  role: string
  emoji: string
  color: string // Tailwind color class
  specialties: Array<string>
}

/** Default persona pool — assigned round-robin or by task matching */
export const AGENT_PERSONAS: Array<AgentPersona> = [
  {
    name: 'Rena',
    role: 'Koordinasi & Operasional',
    emoji: '🧭',
    color: 'text-pink-400',
    specialties: ['koordinasi', 'operasional', 'komunikasi', 'orchestrasi'],
  },
  {
    name: 'Farrah',
    role: 'Ops & Bisnis',
    emoji: '💼',
    color: 'text-amber-400',
    specialties: ['bisnis', 'ops', 'billing', 'laporan'],
  },
  {
    name: 'Nadine',
    role: 'Proyek FindBuyer',
    emoji: '🎯',
    color: 'text-emerald-400',
    specialties: ['findbuyer', 'riset', 'buyer', 'proyek'],
  },
  {
    name: 'Aaron',
    role: 'Audit & Security',
    emoji: '🛡️',
    color: 'text-sky-400',
    specialties: ['security', 'audit', 'pentest', 'hardening'],
  },
  {
    name: 'Dinda',
    role: 'Development & Automation (SAMCODER)',
    emoji: '⚙️',
    color: 'text-violet-400',
    specialties: ['development', 'automation', 'coding', 'samcoder'],
  },
]
