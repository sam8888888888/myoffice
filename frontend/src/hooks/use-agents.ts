import { useQuery } from '@tanstack/react-query'

export type AgentInfo = { id: string; name: string; role?: string; avatar?: string }

/** Daftar agent dari backend (org.json) — dinamis per klien white label. */
export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async (): Promise<AgentInfo[]> => {
      const res = await fetch('/api/office?resource=org')
      const j = await res.json()
      return (j.agents ?? []) as AgentInfo[]
    },
    staleTime: 30000,
    refetchInterval: 60000,
  })
}
