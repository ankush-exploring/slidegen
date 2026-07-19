import { inngest } from '#/integrations/inngest/client'
import { generatePresentation, helloWorld } from '#/integrations/inngest/functions'
import { createFileRoute } from '@tanstack/react-router'

import { serve } from 'inngest/edge'

const handler = serve({
  client: inngest,
  functions: [helloWorld, generatePresentation],
})

export const Route = createFileRoute('/api/inngest')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => handler(request),
      POST: async ({ request }: { request: Request }) => handler(request),
      PUT: async ({ request }: { request: Request }) => handler(request),
    },
  },
})