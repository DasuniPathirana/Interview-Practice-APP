import { NextRequest, NextResponse } from 'next/server';
import { saveQuestion } from '@/lib/database';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;
    const body = await request.json();
    const { extractedText, timestamp } = body;

    if (!extractedText || extractedText.length < 10) {
      return NextResponse.json({ detected: false, questions: [] });
    }

    console.log(`📸 Screen text received (${extractedText.length} chars)`);

    // Use local question detection first
    const localQuestions = detectQuestionsLocally(extractedText);

    // Try Ollama for better question extraction
    let aiQuestions: string[] = [];
    try {
      const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: `Analyze this text from a screen during an interview. Extract any interview questions or coding challenges. Return ONLY the questions, one per line. If no questions found, return "NONE".\n\nText:\n${extractedText.substring(0, 2000)}`,
          stream: false,
          options: { temperature: 0.3, num_predict: 200 },
        }),
      });

      if (ollamaResponse.ok) {
        const data = await ollamaResponse.json();
        const response = data.response?.trim() || '';
        if (response && response !== 'NONE') {
          aiQuestions = response
            .split('\n')
            .map((line: string) => line.replace(/^\d+[\.\)]\s*/, '').trim())
            .filter((line: string) => line.length > 10 && line.length < 500);
        }
      }
    } catch (err) {
      console.log('Ollama not available for screen analysis');
    }

    // Merge questions, preferring AI-detected ones
    const allQuestions = [...new Set([...aiQuestions, ...localQuestions])];
    const savedQuestions = [];

    for (const questionText of allQuestions.slice(0, 5)) {
      const saved = saveQuestion({
        sessionId,
        questionText,
        source: 'screen',
        confidence: aiQuestions.includes(questionText) ? 0.9 : 0.7,
      });
      savedQuestions.push(saved);
    }

    return NextResponse.json({
      detected: savedQuestions.length > 0,
      questions: savedQuestions,
      count: savedQuestions.length,
    });
  } catch (error) {
    console.error('Screen analysis error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function detectQuestionsLocally(text: string): string[] {
  const questions: string[] = [];
  const sentences = text
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 500);

  const questionPatterns = [
    /^(what|when|where|why|how|who|which|whose)\s/i,
    /^(can|could|would|should|do|does|did|is|are|have|has|will)\s/i,
    /^(write|implement|create|build|explain|describe|analyze|design|define|discuss|compare|solve)\s/i,
    /\?$/,
  ];

  for (const sentence of sentences) {
    if (questionPatterns.some(p => p.test(sentence))) {
      questions.push(sentence);
    }
  }

  return questions;
}
