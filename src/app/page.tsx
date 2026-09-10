'use client'

import { useTelegram } from '@/components/TelegramProvider'
import { Avatar, ChevronRight, IconTile, Icons, List, Page, Row } from '@/components/ui'

const NAV = [
  { href: '/calendar', title: 'Kalender', description: 'Termine und Zuweisungen', color: '#2f6fed', icon: Icons.calendar },
  { href: '/helpers', title: 'Helfer', description: 'Registrierte Helfer', color: '#2e9e5b', icon: Icons.users },
  { href: '/parents', title: 'Eltern', description: 'Elterndienst', color: '#d98c1f', icon: Icons.home },
  { href: '/children', title: 'Kinder', description: 'Kinder und Geburtstage', color: '#e05585', icon: Icons.smile },
  { href: '/ideas', title: 'Archiv', description: 'Vergangene Termine', color: '#7b5cd6', icon: Icons.archive },
  { href: '/settings', title: 'Einstellungen', description: 'Sync, Wetter, Bot-Status', color: '#6b7280', icon: Icons.settings },
]

export default function Home() {
  const { helper, user } = useTelegram()
  const name = helper?.name ?? user?.first_name ?? ''
  const firstName = user?.first_name ?? name.split(' ')[0]
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })

  const hero = (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{today}</p>
        <h1 className="mt-1 truncate text-[30px] font-bold leading-none tracking-tight">
          {firstName ? `Hallo, ${firstName}` : 'Jungschar'}
        </h1>
        <div className="mt-2.5 flex items-center gap-2 text-sm text-muted">
          {user?.username && <span className="truncate">@{user.username}</span>}
          {user?.username && helper?.isAdmin && <span className="opacity-50">·</span>}
          {helper?.isAdmin && <span className="font-medium text-accent">Admin</span>}
        </div>
      </div>
      <Avatar src={user?.photo_url} name={name} size={56} />
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
              <p className="text-sm text-muted">{item.description}</p>
            </div>
            <ChevronRight />
          </Row>
        ))}
      </List>
    </Page>
  )
}
