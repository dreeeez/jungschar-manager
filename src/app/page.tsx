'use client'

import { useTelegram } from '@/components/TelegramProvider'
import { Avatar, Badge, ChevronRight, IconTile, Icons, List, Page, Row } from '@/components/ui'

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
    <header className="mb-7 flex items-center gap-3">
      <Avatar src={user?.photo_url} name={name} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{today}</p>
        <h1 className="truncate text-2xl font-semibold leading-tight tracking-tight">
          {firstName ? `Hallo, ${firstName}` : 'Jungschar'}
        </h1>
        {user?.username && <p className="truncate text-sm text-muted">@{user.username}</p>}
      </div>
      {helper?.isAdmin && <Badge tone="accent">Admin</Badge>}
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
