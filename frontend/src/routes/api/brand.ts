import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/brand')({
  server: {
    handlers: {
      GET: async () => {
        return json({
          name: process.env.MYOFFICE_BRAND_NAME || 'MyOffice',
          logo: process.env.MYOFFICE_BRAND_LOGO || '/favicon.svg',
        })
      },
    },
  },
})
