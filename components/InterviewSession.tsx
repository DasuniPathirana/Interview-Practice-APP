'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface InterviewSessionProps {
  sessionId: string
  config: any
  onEndSession: () => void
}

interface QuestionItem {
  id: string
  text: string
  time: string
  answer?: string
  answerLoading?: boolean
  model?: string
}

export default function InterviewSession({ sessionId, config, onEndSession }: InterviewSessionProps) {
  const [isListening, setIsListening] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [transcriptLines, setTranscriptLines] = useState<Array<{ text: string; time: string; source: string }>>([])
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [captureMode, setCaptureMode] = useState<'idle' | 'tab-audio' | 'mic-only'>('idle')
  const [whisperStatus, setWhisperStatus] = useState<string>('idle')

  const recognitionRef = useRef<any>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const questionsEndRef = useRef<HTMLDivElement>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const isListeningRef = useRef(false)
  const audioChunksRef = useRef<Blob[]>([])
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const questionsRef = useRef<QuestionItem[]>([])
  const detectingRef = useRef(false)

  useEffect(() => { isListeningRef.current = isListening }, [isListening])
  useEffect(() => { questionsRef.current = questions }, [questions])

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => setElapsedTime(t => t + 1), 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  useEffect(() => { questionsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [questions])
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcriptLines, liveText])

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  // --- AI answer ---
  const getAIAnswer = useCallback(async (qId: string, questionText: string) => {
    try {
      const res = await fetch(`/api/interview/${sessionId}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText, context: config }),
      })
      if (res.ok) {
        const data = await res.json()
        setQuestions(prev => prev.map(q => q.id === qId ? { ...q, answer: data.answer, answerLoading: false, model: data.model } : q))
      } else {
        setQuestions(prev => prev.map(q => q.id === qId ? { ...q, answerLoading: false, answer: 'Failed to generate answer.' } : q))
      }
    } catch {
      setQuestions(prev => prev.map(q => q.id === qId ? { ...q, answerLoading: false, answer: 'Error connecting.' } : q))
    }
  }, [sessionId, config])

  // --- Use Ollama to detect questions from transcript (much more accurate than regex) ---
  const detectQuestions = useCallback(async (transcript: string) => {
    if (!transcript?.trim() || transcript.trim().length < 10) return
    if (detectingRef.current) return // Prevent concurrent detection calls

    detectingRef.current = true
    try {
      const res = await fetch(`/api/interview/${sessionId}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcript.trim(), jobRole: config?.jobRole }),
      })

      if (!res.ok) return

      const data = await res.json()
      const detectedQuestions: string[] = data.questions || []

      for (const qText of detectedQuestions) {
        // Deduplicate against existing questions
        const lower = qText.toLowerCase()
        const isDuplicate = questionsRef.current.some(existing =>
          wordOverlap(existing.text.toLowerCase(), lower) > 0.45
        )

        if (!isDuplicate) {
          const qId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const newQ: QuestionItem = {
            id: qId,
            text: qText,
            time: new Date().toLocaleTimeString(),
            answerLoading: true,
          }
          console.log(`❓ Question: "${qText}"`)
          setQuestions(prev => [...prev, newQ])
          setActiveQuestionId(qId)
          getAIAnswer(qId, qText)
        }
      }
    } catch (err) {
      console.warn('Detection failed:', err)
    } finally {
      detectingRef.current = false
    }
  }, [sessionId, config, getAIAnswer])

  // --- Send audio for transcription ---
  const sendAudioForTranscription = useCallback(async () => {
    if (audioChunksRef.current.length === 0) return

    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' })
    audioChunksRef.current = []

    if (blob.size < 5000) return

    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(blob)
      })

      setWhisperStatus('transcribing...')

      const res = await fetch(`/api/interview/${sessionId}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64 }),
      })

      if (res.ok) {
        const data = await res.json()
        setWhisperStatus('ready')

        if (data.text?.trim()) {
          const text = data.text.trim()
          console.log(`📝 Whisper: "${text}"`)

          setTranscriptLines(prev => [...prev, {
            text,
            time: new Date().toLocaleTimeString(),
            source: 'whisper',
          }])

          // Send to Ollama for question detection
          detectQuestions(text)
        }
      } else {
        setWhisperStatus('ready')
      }
    } catch {
      setWhisperStatus('error')
    }
  }, [sessionId, detectQuestions])

  // --- Audio level meter ---
  const startAudioMeter = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const buf = new Uint8Array(analyser.frequencyBinCount)
      const update = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(buf)
        setAudioLevel(buf.reduce((s, v) => s + v, 0) / buf.length / 255)
        animFrameRef.current = requestAnimationFrame(update)
      }
      update()
    } catch {}
  }, [])

  // --- Start recording ---
  const startRecording = useCallback((stream: MediaStream) => {
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) return false

    try {
      const audioStream = new MediaStream(audioTracks)
      const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      // Record in 5-second slices for better Whisper accuracy
      recorder.start(5000)
      mediaRecorderRef.current = recorder

      // Send for transcription every 6 seconds
      sendIntervalRef.current = setInterval(sendAudioForTranscription, 6000)

      startAudioMeter(audioStream)
      return true
    } catch { return false }
  }, [sendAudioForTranscription, startAudioMeter])

  // --- Start listening ---
  const startListening = useCallback(async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Use Chrome or Edge.'); return }

    let hasTabAudio = false
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      screenStreamRef.current = stream
      setIsScreenSharing(true)
      hasTabAudio = startRecording(stream)
      setCaptureMode(hasTabAudio ? 'tab-audio' : 'mic-only')
      stream.getVideoTracks()[0].onended = () => stopListening()
    } catch {
      setCaptureMode('mic-only')
    }

    // Speech recognition (microphone as supplementary source)
    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => { setIsListening(true); isListeningRef.current = true }

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) {
          const text = r[0].transcript.trim()
          if (text && text.split(/\s+/).length >= 3) {
            setTranscriptLines(prev => [...prev, { text, time: new Date().toLocaleTimeString(), source: 'mic' }])
            // Also send mic transcript for question detection
            detectQuestions(text)
          }
          setLiveText('')
        } else {
          interim += r[0].transcript
        }
      }
      if (interim) setLiveText(interim)
    }

    recognition.onerror = () => {}

    recognition.onend = () => {
      if (isListeningRef.current) {
        setTimeout(() => {
          if (isListeningRef.current && recognitionRef.current) {
            try { recognitionRef.current.start() } catch {
              setTimeout(() => {
                if (isListeningRef.current && recognitionRef.current) {
                  try { recognitionRef.current.start() } catch {}
                }
              }, 1500)
            }
          }
        }, 300)
      }
    }

    recognitionRef.current = recognition
    try { recognition.start() } catch {}
  }, [detectQuestions, startRecording])

  // --- Stop ---
  const stopListening = useCallback(() => {
    isListeningRef.current = false
    setIsListening(false)
    setCaptureMode('idle')

    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {}; recognitionRef.current = null }
    if (mediaRecorderRef.current) { try { mediaRecorderRef.current.stop() } catch {}; mediaRecorderRef.current = null }
    if (sendIntervalRef.current) { clearInterval(sendIntervalRef.current); sendIntervalRef.current = null }
    if (audioContextRef.current) { try { audioContextRef.current.close() } catch {}; audioContextRef.current = null; analyserRef.current = null }
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach(t => t.stop()); screenStreamRef.current = null; setIsScreenSharing(false) }

    sendAudioForTranscription()
    setAudioLevel(0)
    setWhisperStatus('idle')
  }, [sendAudioForTranscription])

  const copyAnswer = (text: string, qId: string) => {
    navigator.clipboard.writeText(text)
    setCopied(qId)
    setTimeout(() => setCopied(null), 2000)
  }

  const activeQuestion = questions.find(q => q.id === activeQuestionId)

  return (
    <div className="w-full h-full flex">
      {/* Left Panel */}
      <div className="w-80 flex-shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)' }}>
        {/* Header */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold gradient-text">Live Session</h2>
            <span className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>{formatTime(elapsedTime)}</span>
          </div>
          <span className="status-badge" style={{ background: 'rgba(167,139,250,0.1)', color: 'var(--accent-purple)', border: '1px solid rgba(167,139,250,0.2)', fontSize: '11px' }}>
            {config?.jobRole || 'Interview'}
          </span>
        </div>

        {/* Controls */}
        <div className="px-5 py-4 space-y-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          {!isListening ? (
            <button onClick={startListening} className="btn btn-primary w-full py-3" id="start-btn">🎤 Start Listening</button>
          ) : (
            <button onClick={stopListening} className="btn btn-danger w-full py-3 pulse-ring" id="stop-btn">
              <span className="live-dot"></span> Listening...
            </button>
          )}
          <button onClick={() => setShowEndConfirm(true)} className="btn btn-ghost w-full" id="end-btn">End Session</button>
        </div>

        {/* Status */}
        <div className="px-5 py-3 space-y-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <StatusRow label="Audio" active={isListening} activeText="On" inactiveText="Off" />
          <StatusRow label="Screen" active={isScreenSharing} activeText="Sharing" inactiveText="Off" />
          <StatusRow label="Questions" active={questions.length > 0} activeText={`${questions.length}`} inactiveText="0" />

          {isListening && (
            <div className="mt-2 space-y-2">
              <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: 'rgba(34,211,238,0.05)' }}>
                {captureMode === 'tab-audio' ? (
                  <span style={{ color: 'var(--accent-green)' }}>✅ Tab audio → Whisper → Ollama detection</span>
                ) : (
                  <span style={{ color: 'var(--accent-orange)' }}>🎙️ Mic only (share tab for better results)</span>
                )}
              </div>

              {captureMode === 'tab-audio' && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Vol:</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(audioLevel * 300, 100)}%`,
                        background: audioLevel > 0.1 ? 'var(--accent-green)' : audioLevel > 0.02 ? 'var(--accent-cyan)' : 'var(--text-muted)',
                        transition: 'width 0.15s ease',
                      }} />
                    </div>
                  </div>
                  {whisperStatus !== 'idle' && whisperStatus !== 'ready' && (
                    <div className="text-xs flex items-center gap-1" style={{ color: 'var(--accent-cyan)' }}>
                      <span className="typing-dot"></span><span className="typing-dot"></span><span className="typing-dot"></span>
                      {whisperStatus}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Live Transcript
          </h4>
          {!isListening && transcriptLines.length === 0 ? (
            <div className="text-xs space-y-2" style={{ color: 'var(--text-muted)' }}>
              <p>Click "Start Listening".</p>
              <p>📌 Share the <strong>browser tab with audio</strong> for best results.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {transcriptLines.map((line, i) => (
                <div key={i} className="fade-in flex items-start gap-1.5">
                  <span className="text-xs flex-shrink-0 mt-0.5" style={{ fontSize: '9px' }}>
                    {line.source === 'whisper' ? '🔊' : '🎙️'}
                  </span>
                  <div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)', marginRight: '4px' }}>{line.time}</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{line.text}</span>
                  </div>
                </div>
              ))}
              {liveText && (
                <p className="text-xs" style={{ color: 'var(--accent-cyan)' }}>
                  {liveText}<span className="inline-block w-1 h-3 ml-0.5 align-middle" style={{ background: 'var(--accent-cyan)', animation: 'live-dot 0.8s ease-in-out infinite' }}></span>
                </p>
              )}
              {isListening && !liveText && transcriptLines.length === 0 && (
                <div className="flex items-center gap-2 py-2">
                  <div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting...</span>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Center — Questions */}
      <div className="flex-1 flex flex-col min-w-0" style={{ borderRight: '1px solid var(--border-color)' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Detected Questions
            {questions.length > 0 && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,211,238,0.1)', color: 'var(--accent-cyan)' }}>{questions.length}</span>
            )}
          </h3>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4">
          {questions.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-4">🎯</div>
              <h4 className="font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>No Questions Yet</h4>
              <p className="text-sm max-w-xs" style={{ color: 'var(--text-muted)' }}>
                {isListening ? 'Listening... Ollama will detect questions from the transcript.' : 'Start listening to detect questions.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map(q => (
                <div key={q.id} className={`question-card cursor-pointer fade-in ${activeQuestionId === q.id ? 'active' : ''}`} onClick={() => setActiveQuestionId(q.id)}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(34,211,238,0.15)' }}>❓</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{q.text}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{q.time}</span>
                        {q.answerLoading ? (
                          <span className="text-xs flex items-center gap-1" style={{ color: 'var(--accent-cyan)' }}>
                            <span className="typing-dot"></span><span className="typing-dot"></span><span className="typing-dot"></span> generating...
                          </span>
                        ) : q.answer ? (
                          <span className="text-xs" style={{ color: 'var(--accent-green)' }}>✓ Ready</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={questionsEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Right — AI Answer */}
      <div className="w-[420px] flex-shrink-0 flex flex-col" style={{ background: 'rgba(0,0,0,0.15)' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <h3 className="font-semibold gradient-text">AI Answer</h3>
        </div>
        <div className="flex-1 overflow-auto px-6 py-6">
          {!activeQuestion ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-4">💡</div>
              <h4 className="font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Select a Question</h4>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Click a question to see the AI answer.</p>
            </div>
          ) : (
            <div className="space-y-5 slide-in-right">
              <div>
                <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>Question</label>
                <div className="question-card active"><p className="text-sm" style={{ color: 'var(--text-primary)' }}>{activeQuestion.text}</p></div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-2 flex justify-between" style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  <span>Suggested Answer</span>
                  {activeQuestion.model && <span className="status-badge" style={{ background: 'rgba(255,255,255,0.05)', fontSize: '9px', textTransform: 'none' }}>{activeQuestion.model}</span>}
                </label>
                {activeQuestion.answerLoading ? (
                  <div className="answer-card flex items-center justify-center py-8">
                    <div className="typing-dot"></div><div className="typing-dot"></div><div className="typing-dot"></div>
                    <span className="ml-2 text-sm" style={{ color: 'var(--text-muted)' }}>Generating...</span>
                  </div>
                ) : activeQuestion.answer ? (
                  <div className="answer-card">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{activeQuestion.answer}</p>
                  </div>
                ) : null}
              </div>
              {activeQuestion.answer && !activeQuestion.answerLoading && (
                <div className="space-y-2">
                  <button onClick={() => copyAnswer(activeQuestion.answer!, activeQuestion.id)} className="btn btn-ghost w-full text-sm">
                    {copied === activeQuestion.id ? '✅ Copied!' : '📋 Copy Answer'}
                  </button>
                  <button onClick={() => {
                    setQuestions(prev => prev.map(q => q.id === activeQuestion.id ? { ...q, answerLoading: true, answer: undefined } : q))
                    getAIAnswer(activeQuestion.id, activeQuestion.text)
                  }} className="btn btn-ghost w-full text-sm">🔄 Regenerate</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* End Confirm */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="glass-card p-8 max-w-sm w-full fade-in text-center">
            <div className="text-4xl mb-4">⏹️</div>
            <h3 className="text-xl font-bold mb-2">End Session?</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>{questions.length} questions · {transcriptLines.length} transcript lines</p>
            <div className="flex gap-3">
              <button onClick={() => setShowEndConfirm(false)} className="btn btn-ghost flex-1">Continue</button>
              <button onClick={() => { stopListening(); onEndSession() }} className="btn btn-danger flex-1">End</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, active, activeText, inactiveText }: { label: string; active: boolean; activeText: string; inactiveText: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className={`status-badge ${active ? 'status-listening' : ''}`} style={!active ? { background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' } : {}}>
        {active && <span className="live-dot-green" style={{ width: '5px', height: '5px' }}></span>}
        {active ? activeText : inactiveText}
      </span>
    </div>
  )
}

function wordOverlap(a: string, b: string): number {
  if (a === b) return 1
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3))
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return intersection / union
}
