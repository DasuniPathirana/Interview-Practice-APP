'use client'

import { useState, useEffect } from 'react'

interface DashboardProps {
  onStartInterview: (config: any) => void
}

export default function Dashboard({ onStartInterview }: DashboardProps) {
  const [jobTitle, setJobTitle] = useState('')
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    checkOllama()
  }, [])

  const checkOllama = async () => {
    try {
      const res = await fetch('/api/ollama')
      const data = await res.json()
      setOllamaStatus(data.status === 'connected' ? 'connected' : 'disconnected')
      setOllamaModels(data.models || [])
    } catch {
      setOllamaStatus('disconnected')
    }
  }

  const handleStart = () => {
    if (!jobTitle.trim()) return
    setStarting(true)
    onStartInterview({ jobRole: jobTitle.trim() })
  }

  return (
    <div className="w-full h-full flex flex-col overflow-auto">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))' }}>
            🎯
          </div>
          <div>
            <h1 className="text-xl font-bold gradient-text">Interview Assistant</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>AI-Powered • Free • Private</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {ollamaStatus === 'checking' ? (
            <span className="status-badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>⏳ Checking Ollama...</span>
          ) : ollamaStatus === 'connected' ? (
            <span className="status-badge status-connected">
              <span className="live-dot-green"></span> Ollama Connected ({ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''})
            </span>
          ) : (
            <span className="status-badge status-disconnected">⚠️ Ollama Offline</span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto flex items-center justify-center">
        <div className="max-w-lg w-full px-8 py-10">

          {/* Hero + Input */}
          <div className="glass-card glow-cyan p-10 text-center fade-in">
            <div className="text-5xl mb-4">🎤</div>
            <h2 className="text-3xl font-bold mb-3 gradient-text">Interview Coach</h2>
            <p className="text-base mb-8" style={{ color: 'var(--text-secondary)' }}>
              Enter your job title to start. The AI will listen to your interview and suggest answers in real-time.
            </p>

            <div className="space-y-4">
              <div className="text-left">
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  What position are you interviewing for?
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                  placeholder="e.g. Software Engineer, Product Manager, Data Analyst..."
                  className="w-full px-4 py-3 rounded-xl text-base outline-none transition"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  autoFocus
                  id="job-title-input"
                />
              </div>

              <button
                onClick={handleStart}
                disabled={!jobTitle.trim() || starting}
                className="btn btn-primary w-full text-base py-3"
                style={{ opacity: jobTitle.trim() ? 1 : 0.5 }}
                id="start-session-btn"
              >
                {starting ? '⏳ Starting...' : '🚀 Start Interview Session'}
              </button>
            </div>
          </div>

          {/* Ollama warning */}
          {ollamaStatus === 'disconnected' && (
            <div className="glass-card p-5 mt-6 fade-in" style={{ borderColor: 'rgba(251,191,36,0.3)' }}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <h4 className="font-semibold text-amber-400 mb-1">Setup Ollama for AI Answers</h4>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Works without Ollama (fallback answers), but for real AI:
                  </p>
                  <div className="mt-3 p-3 rounded-lg text-sm font-mono" style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--accent-cyan)' }}>
                    <p>1. Install → <a href="https://ollama.com/download" target="_blank" className="underline hover:text-white">ollama.com/download</a></p>
                    <p className="mt-1">2. Run → <span className="text-white">ollama pull llama3.1:8b</span></p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* How it works - minimal */}
          <div className="mt-6 text-center">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Share your screen tab with audio → AI transcribes → questions detected → answers generated
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
