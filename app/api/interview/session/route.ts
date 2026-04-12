import { NextRequest, NextResponse } from 'next/server';
import { createSession, getSessions } from '@/lib/database';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, config } = body;

    const session = createSession({
      title: title || 'Interview Practice',
      interviewType: config?.interviewType,
      jobRole: config?.jobRole,
      difficulty: config?.difficulty,
    });

    return NextResponse.json(session);
  } catch (error) {
    console.error('Session creation error:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sessions = getSessions(20);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Session list error:', error);
    return NextResponse.json({ error: 'Failed to get sessions' }, { status: 500 });
  }
}
