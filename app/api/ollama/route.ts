import { NextResponse } from 'next/server';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

export async function GET() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    
    if (response.ok) {
      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) || [];
      return NextResponse.json({ 
        status: 'connected', 
        models,
        url: OLLAMA_URL,
      });
    }
    
    return NextResponse.json({ status: 'error', message: 'Ollama not responding' });
  } catch {
    return NextResponse.json({ 
      status: 'disconnected', 
      message: 'Ollama is not running. Install from https://ollama.com and run: ollama pull llama3.2' 
    });
  }
}
