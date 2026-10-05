'use client'

import { useEffect, useState } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Avatar, ChevronRight, IconTile, Icons, List, PAGE_COLORS, Page, Row } from '@/components/ui'

const NAV = [
  { href: '/calendar', title: 'Kalender', description: 'Termine und Zuweisungen', color: PAGE_COLORS.calendar, icon: Icons.calendar },
  { href: '/helpers', title: 'Helfer', description: 'Registrierte Helfer', color: PAGE_COLORS.helpers, icon: Icons.users },
  { href: '/parents', title: 'Eltern', description: 'Elterndienst', color: PAGE_COLORS.parents, icon: Icons.home },
  { href: '/children', title: 'Kinder', description: 'Kinder und Geburtstage', color: PAGE_COLORS.children, icon: Icons.smile },
  { href: '/ideas', title: 'Archiv', description: 'Vergangene Termine', color: PAGE_COLORS.archive, icon: Icons.archive },
  { href: '/pool', title: 'Ideenpool', description: 'Was wir mal machen könnten', color: PAGE_COLORS.pool, icon: Icons.bulb },
  { href: '/status', title: 'Bot-Status', description: 'Health, nächste Nachricht, Pings', color: PAGE_COLORS.status, icon: Icons.activity },
  { href: '/feedback', title: 'Feedback', description: 'Meldungen aus /bug', color: PAGE_COLORS.status, icon: Icons.bulb },
  { href: '/settings', title: 'Einstellungen', description: 'Termin-Sync, Wetter', color: PAGE_COLORS.settings, icon: Icons.settings },
]

export default function Home() {
  const { helper, user } = useTelegram()
  const [openFeedback, setOpenFeedback] = useState<number | null>(null)
  const name = helper?.name ?? user?.first_name ?? ''

  // Zahl der offenen /bug-Meldungen in der Feedback-Zeile.
  useEffect(() => {
    ;(supabase as any)
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .is('done_at', null)
      .then(({ count }: any) => setOpenFeedback(typeof count === 'number' ? count : null))
      .catch(() => {})
  }, [])
  const firstName = user?.first_name ?? name.split(' ')[0]
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })

  const hero = (
    <header className="mb-6 flex items-center gap-4">
      <Avatar src={user?.photo_url} name={name} size={60} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{today}</p>
        <h1 className="mt-0.5 truncate text-[28px] font-bold leading-tight tracking-tight">
          {firstName ? `Hallo, ${firstName}` : 'Jungschar'}
        </h1>
        <div className="flex items-center gap-2 text-sm text-muted">
          {user?.username && <span className="truncate">@{user.username}</span>}
          {user?.username && helper?.isAdmin && <span className="opacity-50">·</span>}
          {helper?.isAdmin && <span className="font-medium text-accent">Admin</span>}
        </div>
      </div>
    </header>
  )

  return (
    <Page title="Jungschar" hero={hero}>
      <List>
        {NAV.map((item) => (
          <Row key={item.href} href={item.href}>
            <IconTile color={item.color}>{item.icon()}</IconTile>
            <div className="flex-1">
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-muted">
                {item.href === '/feedback' && openFeedback ? `${openFeedback} offen · ` : ''}
                {item.description}
              </p>
            </div>
            <ChevronRight />
          </Row>
        ))}
      </List>
    </Page>
  )
}
