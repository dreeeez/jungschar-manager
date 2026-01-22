import type { Metadata, Viewport } from 'next'
import { TelegramProvider } from '@/components/TelegramProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Jungschar Admin',
  description: 'Verwaltung für Jungschar-Helfer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="bg-tg-bg text-tg-text min-h-screen">
        <TelegramProvider>
          {children}
        </TelegramProvider>
      </body>
    </html>
  )
}
