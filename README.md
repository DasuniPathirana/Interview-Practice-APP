# Interview Assistant 🎯

Free, local AI-powered interview assistant. Like ParakeetAI but completely free and private.

## Features

- **Real-time audio capture** — Captures interviewer's voice from Zoom/Teams/Meet via screen sharing
- **Question detection** — Automatically detects interview questions using Web Speech API
- **AI answer generation** — Ollama generates professional answers locally (no API keys)
- **Screen text analysis** — OCR reads coding questions from shared screen
- **100% private** — All data stays on your machine
- **Zero cost** — No subscriptions, no API keys, no limits

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Ollama (for AI answers)
# Download from https://ollama.com/download
# Then pull a model:
ollama pull llama3.2

# 3. Start the app
npm run dev
```

Open http://localhost:3000 in **Chrome** or **Edge** (required for Speech Recognition).

## How It Works

1. Click "Start Listening" → Share your meeting window with audio
2. The app captures audio from the meeting and transcribes it in real-time
3. When a question is detected, it appears in the center panel
4. Click any question to see the AI-generated answer on the right
5. Copy answers with one click

## Tech Stack

- **Frontend**: Next.js 14 + React + TailwindCSS
- **Database**: SQLite (better-sqlite3) — zero config, just a file
- **AI**: Ollama (local LLM) — free, no API keys
- **Speech**: Web Speech API — built into Chrome/Edge
- **OCR**: Tesseract.js (optional) — for screen text detection

## Browser Requirements

- **Chrome** or **Edge** (required for Web Speech API)
- When sharing screen, check "Share audio" for meeting audio capture
