import { z } from 'zod'

import { prisma } from '#/db'

import { inngest } from './client'

function buildImageKitUrl(prompt: string, filename: string): string {
  const baseUrl = process.env.IMAGEKIT_BASE_URL!
  const sanitizedPrompt = prompt
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)

  return `${baseUrl}/ik-genimg-prompt-${encodeURIComponent(sanitizedPrompt)}/${filename}.jpg?tr=w-1280,h-720`
}

const slideSchema = z.object({
  title: z.string(),
  content: z.string(),
  notes: z.string().optional(),
  imagePrompt: z.string(),
})

const slidesResponseSchema = z.object({
  slides: z.array(slideSchema),
})

async function generateSlidesViaGemini(prompt: string, systemPrompt: string) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not set')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('Gemini returned empty response: ' + JSON.stringify(data))
  }

  return JSON.parse(text) as unknown
}

export const generatePresentation = inngest.createFunction(
  {
    id: 'generate-presentation',
    retries: 2,
    triggers: [{ event: 'presentation/generate' }],
  },
  async ({ event, step }) => {
    const { presentationId } = event.data as { presentationId: string }

    try {
      const presentation = await step.run('fetch-presentation', async () => {
        const p = await prisma.presentation.findUnique({
          where: { id: presentationId },
        })
        if (!p) throw new Error('Presentation not found')
        return p
      })

      await step.run('mark-generating', async () => {
        await prisma.presentation.update({
          where: { id: presentationId },
          data: { status: 'GENERATING' },
        })
      })

      const { slides } = await step.run('generate-slides-content', async () => {
        const systemPrompt = `You are an expert presentation designer. Given a user's content/prompt, create a compelling presentation.

Style: ${presentation.style}
Tone: ${presentation.tone}
Layout preference: ${presentation.layout}
Number of slides requested: ${presentation.slideCount}

Guidelines:
- Create exactly ${presentation.slideCount} slides
- First slide should be a title slide
- Last slide should be a summary or call-to-action
- Keep content concise and impactful
- For imagePrompt, describe a professional illustration that complements the slide (no text in images)

You MUST respond with a single valid JSON object matching this exact structure (no markdown, no code fences, no extra text):
{
  "slides": [
    {
      "title": "string",
      "content": "string",
      "notes": "string or empty",
      "imagePrompt": "string"
    }
  ]
}`

        const parsed = await generateSlidesViaGemini(presentation.prompt, systemPrompt)
        const validated = slidesResponseSchema.safeParse(parsed)
        if (!validated.success) {
          throw new Error('AI output schema error: ' + validated.error.message)
        }

        return validated.data
      })

      await step.run('delete-old-slides', async () => {
        await prisma.slide.deleteMany({
          where: { presentationId },
        })
      })

      await step.run('create-slides', async () => {
        const data = slides.map((s, i) => ({
          presentationId,
          order: i,
          title: s.title,
          content: s.content,
          notes: s.notes ?? null,
          imagePrompt: s.imagePrompt,
          imageUrl: buildImageKitUrl(s.imagePrompt, `slide-${presentationId}-${i}`),
        }))

        await prisma.slide.createMany({ data })
      })

      await step.run('mark-completed', async () => {
        await prisma.presentation.update({
          where: { id: presentationId },
          data: { status: 'COMPLETED' },
        })
      })

      return { success: true, slideCount: slides.length }
    } catch (err) {
      console.error('[inngest] generatePresentation failed:', err)
      await step.run('mark-failed', async () => {
        await prisma.presentation.update({
          where: { id: presentationId },
          data: { status: 'FAILED' },
        })
      })
      throw err
    }
  },
)

export const helloWorld = inngest.createFunction(
  {
    id: 'hello-world',
    triggers: [{ event: 'test/hello.world' }],
  },
  async ({ event, step }) => {
    await step.sleep('wait-a-moment', '1s')
    return { message: `Hello ${event.data.email}!` }
  },
)
