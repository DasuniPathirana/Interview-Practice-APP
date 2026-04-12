import { NextRequest, NextResponse } from 'next/server';
import { saveQuestion, saveAnswer } from '@/lib/database';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;
    const body = await request.json();
    const { question, source, confidence, context } = body;

    if (!question) {
      return NextResponse.json({ error: 'No question provided' }, { status: 400 });
    }

    // Save the question to DB
    const savedQuestion = saveQuestion({
      sessionId,
      questionText: question,
      source: source || 'voice',
      confidence: confidence || 0.8,
    });

    // Build prompt for Ollama
    const systemPrompt = `You are an expert interview coach. The candidate is in a ${context?.interviewType || 'behavioral'} interview for a ${context?.jobRole || 'Software Engineer'} position. 
Give a concise, professional, and impressive answer to the interview question. 
Keep answers 3-5 sentences long. Be specific with examples where appropriate.
Do NOT start with "Great question" or similar filler. Jump straight into the answer.`;

    const prompt = `Interview Question: "${question}"\n\nProvide a strong, concise answer:`;

    // Try Ollama for AI answer
    try {
      const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: prompt,
          system: systemPrompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            num_predict: 300,
          },
        }),
      });

      if (ollamaResponse.ok) {
        const data = await ollamaResponse.json();
        const answerText = data.response?.trim() || '';

        if (answerText) {
          // Save answer to DB
          saveAnswer({
            questionId: savedQuestion.id,
            sessionId,
            answerText,
            model: OLLAMA_MODEL,
          });

          return NextResponse.json({
            questionId: savedQuestion.id,
            question,
            answer: answerText,
            model: OLLAMA_MODEL,
            source: 'ollama',
            timestamp: new Date().toISOString(),
          });
        }
      }

      // If Ollama fails, use fallback
      throw new Error('Ollama response empty');
    } catch (ollamaError) {
      console.warn('Ollama not available, using fallback answers:', (ollamaError as Error).message);

      // Smart fallback answers
      const fallbackAnswer = getFallbackAnswer(question, context);

      saveAnswer({
        questionId: savedQuestion.id,
        sessionId,
        answerText: fallbackAnswer,
        model: 'fallback',
      });

      return NextResponse.json({
        questionId: savedQuestion.id,
        question,
        answer: fallbackAnswer,
        model: 'fallback',
        source: 'fallback',
        note: 'Ollama not available. Install Ollama and run: ollama pull llama3.2',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Suggest API error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function getFallbackAnswer(question: string, context?: any): string {
  const q = question.toLowerCase();

  // Pattern-based smart fallback answers
  if (q.includes('tell me about yourself') || q.includes('introduce yourself')) {
    return `I'm a ${context?.jobRole || 'Software Engineer'} with a strong track record of delivering impactful projects. I specialize in building scalable, well-architected systems and thrive in collaborative environments. My approach combines technical depth with clear communication, which has consistently helped me drive projects from concept to production. I'm particularly excited about this opportunity because it aligns with my passion for solving complex problems with elegant solutions.`;
  }

  if (q.includes('strength')) {
    return `My core strength is systematic problem-solving — I break down complex challenges into manageable pieces and tackle them methodically. I've consistently delivered projects ahead of schedule by identifying critical path items early and addressing risks proactively. I also bring strong communication skills that help bridge the gap between technical and non-technical stakeholders, ensuring everyone stays aligned on goals and progress.`;
  }

  if (q.includes('weakness')) {
    return `I've historically been overly thorough in code reviews, which sometimes slowed team velocity. I recognized this pattern and developed a tiered review approach — catching critical issues immediately while tracking style improvements for later. This balanced thoroughness with speed and actually improved our team's code quality metrics while keeping our delivery pace strong.`;
  }

  if (q.includes('why') && (q.includes('company') || q.includes('job') || q.includes('role') || q.includes('position'))) {
    return `What draws me to this role is the intersection of challenging technical problems and meaningful impact. Your team is working on problems that require both engineering excellence and creative thinking, which is exactly where I thrive. I've researched your tech stack and engineering culture, and I see strong alignment with my experience and career goals. I want to contribute to a team where I can both leverage my strengths and continue growing.`;
  }

  if (q.includes('conflict') || q.includes('disagree')) {
    return `When I encounter disagreements, I focus on understanding the underlying goals rather than positions. In a recent situation, a teammate and I had different architectural approaches. Instead of debating in abstract, I proposed we evaluate both against specific criteria — performance, maintainability, and timeline. This data-driven approach led us to a hybrid solution that was actually better than either original proposal. The key was separating the problem from the person and focusing on shared objectives.`;
  }

  if (q.includes('challenge') || q.includes('difficult') || q.includes('problem you solved')) {
    return `I tackled a critical performance bottleneck where our API response times had degraded to 8+ seconds under load. Through systematic profiling, I identified cascading N+1 database queries and inefficient serialization. I implemented query batching, added strategic caching, and optimized our data layer. This reduced response times to under 200ms and improved system throughput by 10x. The experience reinforced my belief in measurement-driven optimization over premature guessing.`;
  }

  if (q.includes('system design') || q.includes('architect') || q.includes('design a')) {
    return `I'd approach this with a focus on scalability, reliability, and simplicity. First, I'd clarify requirements and identify our primary access patterns. For the core architecture, I'd consider a service-oriented design with clear domain boundaries, event-driven communication where appropriate, and a data layer optimized for our read/write ratio. I'd build in observability from day one with structured logging, metrics, and distributed tracing. For scaling, I'd start with horizontal scaling behind a load balancer and plan for database partitioning strategies as data grows.`;
  }

  if (q.includes('code') || q.includes('algorithm') || q.includes('implement') || q.includes('function') || q.includes('write a')) {
    return `I'd start by clarifying the input constraints and expected output format. Then I'd think through the approach — identifying the optimal data structure and time/space complexity tradeoffs. I'd write clean, readable code with meaningful variable names, handle edge cases explicitly, and add comments for non-obvious logic. After the initial implementation, I'd walk through test cases including edge cases like empty inputs, single elements, and boundary values. Finally, I'd discuss potential optimizations and alternative approaches.`;
  }

  if (q.includes('leadership') || q.includes('lead') || q.includes('mentor')) {
    return `I lead by creating clarity and empowering my team to do their best work. This means setting clear objectives, removing blockers proactively, and creating a safe environment for technical experimentation. I've mentored junior developers by pairing on complex problems, conducting focused code reviews, and gradually increasing their ownership of critical systems. The result was measurable — team velocity increased 40% over six months while quality metrics improved.`;
  }

  // Generic technical/general answer
  return `That's an important consideration in this role. My approach involves thorough analysis of the problem space, leveraging proven patterns while remaining open to innovative solutions. I prioritize clear communication, systematic execution, and continuous learning. I'd be happy to discuss specific examples from my experience that demonstrate how I've handled similar situations effectively, including measurable outcomes and lessons learned.`;
}
