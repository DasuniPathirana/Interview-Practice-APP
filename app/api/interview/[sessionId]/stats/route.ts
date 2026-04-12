import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        detectedQuestions: true,
      },
    })

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Calculate statistics
    const questions = session.detectedQuestions
    const voiceQuestions = questions.filter((q) => q.type === 'voice')
    const technicalQuestions = questions.filter((q) => q.type === 'technical')
    const screenQuestions = questions.filter((q) => q.type === 'screen')

    const avgConfidence =
      questions.length > 0
        ? questions.reduce((sum, q) => sum + q.confidence, 0) / questions.length
        : 0

    const sessionDuration = session.endedAt
      ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
      : new Date().getTime() - new Date(session.startedAt).getTime()

    return NextResponse.json({
      sessionId: session.id,
      title: session.title,
      status: session.status,
      totalQuestions: questions.length,
      voiceQuestions: voiceQuestions.length,
      technicalQuestions: technicalQuestions.length,
      screenQuestions: screenQuestions.length,
      avgConfidence,
      sessionDuration: sessionDuration / 1000, // Convert to seconds
      questions: questions.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ),
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    })
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}
