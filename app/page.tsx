'use client'

import { useState } from 'react'
import Dashboard from '@/components/Dashboard'
import InterviewSession from '@/components/InterviewSession'

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('')
  const [sessionConfig, setSessionConfig] = useState<any>(null)
  const [error, setError] = useState('')

  const handleStartInterview = async (config: any) => {
    try {
      setError('')
      const res = await fetch('/api/interview/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Interview — ${config.jobRole}`, config }),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const data = await res.json()
      if (!data.id) throw new Error('No session ID')
      setSessionId(data.id)
      setSessionConfig(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <main className="w-full h-screen relative">
      <div className="bg-mesh" />
      {error && (
        <div className="fixed top-4 right-4 z-50 fade-in" style={{ maxWidth: '400px' }}>
          <div className="glass-card p-4" style={{ borderColor: 'rgba(248,113,113,0.3)' }}>
            <div className="flex items-start gap-3">
              <span className="text-red-400 text-lg">⚠️</span>
              <div className="flex-1">
                <p className="text-red-400 font-semibold text-sm">Error</p>
                <p className="text-slate-400 text-xs mt-1">{error}</p>
              </div>
              <button onClick={() => setError('')} className="text-slate-500 hover:text-white text-lg">×</button>
            </div>
          </div>
        </div>
      )}
      {!sessionId ? (
        <Dashboard onStartInterview={handleStartInterview} />
      ) : (
        <InterviewSession
          sessionId={sessionId}
          config={sessionConfig}
          onEndSession={() => { setSessionId(''); setSessionConfig(null) }}
        />
      )}
    </main>
  )
}
