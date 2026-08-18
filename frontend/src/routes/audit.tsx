import { createFileRoute } from '@tanstack/react-router'
import { AuditTrailScreen } from '@/screens/audit/audit-trail-screen'

export const Route = createFileRoute('/audit')({
  component: AuditTrailScreen,
})
