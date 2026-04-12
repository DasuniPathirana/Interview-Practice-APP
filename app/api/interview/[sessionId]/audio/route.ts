import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { OpenAI } from 'openai'

const prisma = new PrismaClient()
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Connection store for broadcasting
const sseConnections = new Map<string, Set<ReadableStreamDefaultController>>()

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params
    const body = await request.json()
    const { audioData, timestamp } = body

    if (!audioData) {
      return NextResponse.json(
        { error: 'No audio data provided' },
        { status: 400 }
      )
    }

    console.log('🔊 Processing audio chunk...')

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

    try {
      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audioData, 'base64')

      // Create a File object for OpenAI
      const audioFile = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' })

      console.log('📤 Sending to Whisper API...')

      // Use OpenAI Whisper API for transcription
      const transcript = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        language: 'en',
      })

      const text = transcript.text.trim()
      console.log('✅ Transcription:', text)

      if (text.length === 0) {
        return NextResponse.json({ success: true, text: '', detected: false })
      }

      // Check if transcript contains question indicators
      const isQuestion = checkIfQuestion(text)

      if (isQuestion) {
        const confidence = calculateAudioConfidence(text)

        console.log('🎯 Question detected! Confidence:', confidence)

        // Save to database
        const detected = await prisma.detectedQuestion.create({
          data: {
            sessionId,
            userId: 'default-user',
            questionText: text,
            type: 'voice',
            confidence,
            rawAudio: audioData.substring(0, 100), // Store first 100 chars
          },
        })

        // Broadcast to connected clients
        broadcastQuestion(sessionId, detected)

        return NextResponse.json({ success: true, detected: true, question: detected })
      }

      return NextResponse.json({ success: true, text, detected: false })
    } catch (error: any) {
      console.error('❌ Whisper API error:', error.message)
      
      // Fallback: simple pattern matching without API
      const text = fallbackTranscription(audioData)
      if (text && checkIfQuestion(text)) {
        const detected = await prisma.detectedQuestion.create({
          data: {
            sessionId,
            userId: 'default-user',
            questionText: text,
            type: 'voice',
            confidence: 0.7,
            rawAudio: audioData.substring(0, 100),
          },
        })
        broadcastQuestion(sessionId, detected)
        return NextResponse.json({ success: true, detected: true, question: detected })
      }

      return NextResponse.json(
        { error: `Whisper error: ${error.message}`, fallback: true },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('❌ Audio processing error:', error)
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}

function checkIfQuestion(text: string): boolean {
  const lower = text.toLowerCase()
  
  // Question indicators
  const questionPatterns = [
    /\?$/, // Ends with question mark
    /^(what|when|where|why|how|who|which|whose)\s/i,
    /^(can|could|would|should|do|does|did|is|are|am|have|has|will|would|should)\s/i,
    /\b(explain|describe|implement|write|code|define|discuss|analyze|compare|tell|show|give|build|create|design)\b/i,
  ]

  return questionPatterns.some((pattern) => pattern.test(lower))
}

function calculateAudioConfidence(text: string): number {
  const lower = text.toLowerCase()
  let score = 0

  // Length score
  if (text.length > 10 && text.length < 300) score += 0.3
  
  // Question word score
  if (/^(what|how|why|when|where|who|which)\s/i.test(lower)) score += 0.4
  else if (/\?$/.test(text)) score += 0.35
  
  // Auxiliary verb score
  if (/\b(can|could|would|should|do|does|did|is|are|will)\b/i.test(lower)) score += 0.2
  
  // Action verb score
  if (/\b(explain|describe|implement|write|code|define|discuss|analyze)\b/i.test(lower)) score += 0.1

  return Math.min(score, 1.0)
}

function fallbackTranscription(audioData: string): string {
  // Simple mock - in production, use more sophisticated fallback
  try {
    const decoded = atob(audioData)
    // Very basic fallback - just return empty as we can't actually transcribe without API
    return ''
  } catch {
    return ''
  }
}

function broadcastQuestion(sessionId: string, question: any) {
  const connections = sseConnections.get(sessionId)
  if (connections) {
    const message = `data: ${JSON.stringify(question)}\n\n`
    for (const controller of connections) {
      try {
        controller.enqueue(message)
      } catch (error) {
        connections.delete(controller)
      }
    }
  }
}
