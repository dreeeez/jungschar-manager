'use client'

import { useTelegram } from '@/components/TelegramProvider'
import Link from 'next/link'

export default function Home() {
  const { user, isReady } = useTelegram()

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tg-button" />
      </div>
    )
  }

  return (
    <main className="p-4 safe-area-top safe-area-bottom">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Jungschar Admin</h1>
        <p className="text-tg-hint">Hallo, {user?.first_name}!</p>
      </div>

      <div className="grid gap-4">
        <NavCard
          href="/helpers"
          icon="👥"
          title="Helfer"
          description="Helfer verwalten"
        />
        <NavCard
          href="/calendar"
          icon="📅"
          title="Kalender"
          description="Termine & Zuweisungen"
        />
        <NavCard
          href="/parents"
          icon="👨‍👩‍👧"
          title="Eltern"
          description="Elterndienst verwalten"
        />
        <NavCard
          href="/children"
          icon="🧒"
          title="Kinder"
          description="Kinder & Geburtstage"
        />
        <NavCard
          href="/settings"
          icon="⚙️"
          title="Einstellungen"
          description="ICS-Upload, Wetter-Ort"
        />
      </div>
    </main>
  )
}

function NavCard({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: string
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 p-4 bg-tg-secondary-bg rounded-xl active:opacity-70 transition-opacity"
    >
      <span className="text-3xl">{icon}</span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-tg-hint">{description}</p>
      </div>
      <span className="ml-auto text-tg-hint">→</span>
    </Link>
  )
}
