import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { registerConnection, unregisterConnection, pingConnection } from '@/lib/sseManager'

const prisma = new PrismaClient()

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const { sessionId } = params

  // Verify session exists
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    )
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      registerConnection(sessionId, controller)

      // Send initial connection message
      controller.enqueue(
        `data: ${JSON.stringify({ type: 'connected', message: 'Connected to question stream' })}\n\n`
      )

      // Keep connection alive with pings
      const pingInterval = setInterval(() => {
        pingConnection(sessionId, controller)
      }, 30000)

      // Cleanup on disconnect
      ;(controller as any).onclose = () => {
        clearInterval(pingInterval)
        unregisterConnection(sessionId, controller)
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
