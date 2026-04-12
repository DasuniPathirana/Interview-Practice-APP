import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Interview Assistant — Free AI-Powered Interview Coach',
  description: 'Real-time interview question detection and AI-powered answer suggestions. Free, local, and private. Like ParakeetAI but completely free.',
  keywords: 'interview assistant, AI interview, interview practice, coding interview, behavioral interview',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
