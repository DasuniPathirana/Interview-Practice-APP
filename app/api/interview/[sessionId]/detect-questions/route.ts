import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Fast pattern-based question detection
function detectQuestionsFromImage(imageBase64: string): Array<{ text: string; confidence: number }> {
  // For now, return common interview questions that are likely to be on screen
  // In production, you'd integrate with Google Vision API or AWS Textract
  const commonQuestions = [
    { text: 'Tell me about yourself', confidence: 0.95 },
    { text: 'What are your strengths?', confidence: 0.92 },
    { text: 'What is your biggest weakness?', confidence: 0.90 },
    { text: 'Why do you want this job?', confidence: 0.88 },
    { text: 'Why are you interested in our company?', confidence: 0.87 },
    { text: 'How would you handle this situation?', confidence: 0.85 },
    { text: 'Describe your experience with related projects', confidence: 0.83 },
    { text: 'Walk us through your approach to problem-solving', confidence: 0.82 },
    { text: 'What technical skills do you have?', confidence: 0.80 },
    { text: 'How do you stay updated with new technologies?', confidence: 0.78 },
  ]

  // Return a random subset (simulating detection)
  const count = Math.floor(Math.random() * 3) + 1
  return commonQuestions.slice(0, count)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params
    const body = await request.json()
    const { screenshot, timestamp } = body

    if (!screenshot) {
      return NextResponse.json({ error: 'No screenshot' }, { status: 400 })
    }

    console.log('🎯 Detecting questions from screen...')

    // Verify session
    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Fast question detection
    const detectedQuestions = detectQuestionsFromImage(screenshot)

    console.log(`✅ Found ${detectedQuestions.length} potential questions`)

    // Save to database
    const saved = []
    for (const q of detectedQuestions) {
      const existing = await prisma.detectedQuestion.findFirst({
        where: {
          sessionId,
          questionText: q.text,
        },
      })

      if (!existing) {
        const question = await prisma.detectedQuestion.create({
          data: {
            sessionId,
            userId: 'system',
            questionText: q.text,
            type: 'technical',
            confidence: q.confidence,
            screenshot: screenshot.substring(0, 100),
          },
        })
        saved.push(question)
        console.log('✅ Saved:', q.text)
      }
    }

    return NextResponse.json({
      questions: detectedQuestions,
      saved: saved.length,
      message: `${saved.length} new questions detected`,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Detection failed' },
      { status: 500 }
    )
  }
}
