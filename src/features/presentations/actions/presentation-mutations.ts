import { createServerFn } from '@tanstack/react-start'

import { prisma } from '#/db'
import { inngest } from '#/integrations/inngest/client'

import { deriveTitle, requirePresentationUserId } from '../lib/server-helpers'
import {
  createPresentationInputSchema,
  presentationIdInputSchema,
  updatePresentationInputSchema,
} from '../types/schemas'

export const createPresentation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createPresentationInputSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requirePresentationUserId()
    const presentation = await prisma.presentation.create({
      data: {
        userId,
        title: deriveTitle(data.prompt),
        prompt: data.prompt,
        slideCount: data.slideCount,
        style: data.style,
        tone: data.tone,
        layout: data.layout,
        status: 'GENERATING',
      },
    })

    try {
      await inngest.send({
        name: 'presentation/generate',
        data: { presentationId: presentation.id },
      })
    } catch {
      await prisma.presentation.update({
        where: { id: presentation.id },
        data: { status: 'FAILED' },
      })
      throw new Error('Failed to start generation. Please try regenerating.')
    }

    return presentation
  })

export const updatePresentation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => updatePresentationInputSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requirePresentationUserId()
    const { id, ...patch } = data
    const existing = await prisma.presentation.findFirst({
      where: { id, userId },
    })
    if (!existing) throw new Error('Not found')
    const updateData = patch
    return prisma.presentation.update({
      where: { id },
      data: updateData,
    })
  })

export const deletePresentation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => presentationIdInputSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requirePresentationUserId()
    const existing = await prisma.presentation.findFirst({
      where: { id: data.id, userId },
    })
    if (!existing) throw new Error('Not found')
    await prisma.presentation.delete({ where: { id: data.id } })
    return { ok: true as const }
  })

export const regeneratePresentation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => presentationIdInputSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requirePresentationUserId()
    const existing = await prisma.presentation.findFirst({
      where: { id: data.id, userId },
    })
    if (!existing) throw new Error('Not found')

    await prisma.presentation.update({
      where: { id: data.id },
      data: { status: 'GENERATING' },
    })

    try {
      await inngest.send({
        name: 'presentation/generate',
        data: { presentationId: data.id },
      })
    } catch {
      await prisma.presentation.update({
        where: { id: data.id },
        data: { status: 'FAILED' },
      })
      throw new Error('Failed to start regeneration. Please try again.')
    }
  })
