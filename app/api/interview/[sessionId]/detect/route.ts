import { NextRequest, NextResponse } from 'next/server';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const body = await request.json();
    const { transcript, jobRole } = body;

    if (!transcript || transcript.trim().length < 5) {
      return NextResponse.json({ questions: [] });
    }

    console.log(`🔍 Detecting questions in: "${transcript.substring(0, 100)}..."`);

    // Use Ollama to extract interview questions
    try {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: `You are analyzing a transcript from a job interview for a "${jobRole || 'professional'}" position.

TRANSCRIPT: "${transcript}"

TASK: Extract ONLY the interview questions that the INTERVIEWER is asking. 
- Return each question on its own line
- Clean up the grammar if needed
- If the text is just a statement (not a question), return NONE
- Do NOT make up questions - only extract what's actually being asked
- Include implied questions (e.g. "tell me about yourself" is a question)

QUESTIONS:`,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 300,
            top_p: 0.9,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data = await response.json();
        const responseText = (data.response || '').trim();

        if (!responseText || responseText === 'NONE' || responseText.toLowerCase().includes('no questions')) {
          return NextResponse.json({ questions: [] });
        }

        // Parse questions from response
        const questions = responseText
          .split('\n')
          .map((line: string) => line.replace(/^[\d\-\*\.\)]+\s*/, '').trim()) // Remove numbering
          .filter((line: string) => line.length > 10 && line.length < 300) // Reasonable length
          .filter((line: string) => !line.toLowerCase().startsWith('note')) // Remove notes
          .filter((line: string) => !line.toLowerCase().startsWith('the transcript')) // Remove meta
          .map((q: string) => q.endsWith('?') ? q : q + '?'); // Ensure question mark

        console.log(`✅ Detected ${questions.length} question(s):`, questions);

        return NextResponse.json({ questions });
      }
    } catch (ollamaErr) {
      console.log('Ollama not available, using fallback detection');
    }

    // Fallback: basic pattern matching if Ollama is offline
    const questions = fallbackDetect(transcript);
    return NextResponse.json({ questions });

  } catch (error) {
    console.error('Question detection error:', error);
    return NextResponse.json({ questions: [], error: String(error) }, { status: 500 });
  }
}

function fallbackDetect(text: string): string[] {
  const questions: string[] = [];
  const sentences = text.split(/(?<=[.?!])\s+|(?:,\s*(?=(?:and\s+)?(?:what|why|how|when|where|who|tell|explain|describe|can|could|would|do|does|is|are|have)\s))/i);

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (s.length < 10) continue;
    if (s.endsWith('?')) { questions.push(s); continue; }
    if (/^(what|when|where|why|how|who|which|whose|tell|explain|describe|can|could|would|should|do|does|did|is|are|have|has|will)\s/i.test(s)) {
      questions.push(s.endsWith('?') ? s : s + '?');
    }
  }

  return questions;
}
