import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'NOC Orchestrator',
  description: 'Firmware lifecycle and orchestration platform',
  icons: {
    icon: '/brand/noc-orchestrator-icon.png',
    shortcut: '/brand/noc-orchestrator-icon.png',
    apple: '/brand/noc-orchestrator-icon.png',
  },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
