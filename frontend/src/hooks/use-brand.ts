import { useQuery } from '@tanstack/react-query'

export type BrandInfo = { name: string; logo: string }

/** Branding white label — dari env MYOFFICE_BRAND_NAME / MYOFFICE_BRAND_LOGO. */
export function useBrand() {
  return useQuery({
    queryKey: ['brand'],
    queryFn: async (): Promise<BrandInfo> => {
      try {
        const res = await fetch('/api/brand')
        const j = await res.json()
        return { name: j.name || 'MyOffice', logo: j.logo || '/favicon.svg' }
      } catch {
        return { name: 'MyOffice', logo: '/favicon.svg' }
      }
    },
    staleTime: 60000,
  })
}
