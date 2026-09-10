'use client'

import Link from 'next/link'
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

/*
 * Gemeinsame UI-Bausteine der Mini-App: schlicht, monochrom, ohne Emojis.
 * Alle Farben kommen aus den Tokens in globals.css.
 */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

/** Eine Farbe pro Bereich: Kachel auf der Startseite und Akzent der Seite. */
export const PAGE_COLORS = {
  calendar: '#2f6fed',
  helpers: '#2e9e5b',
  parents: '#d98c1f',
  children: '#e05585',
  archive: '#7b5cd6',
  status: '#0f9d9a',
  settings: '#4f6d9a',
} as const

export type PageKey = keyof typeof PAGE_COLORS

function accentStyle(key?: PageKey): CSSProperties | undefined {
  if (!key) return undefined
  const c = PAGE_COLORS[key]
  return {
    '--accent': c,
    '--accent-soft': `color-mix(in srgb, ${c} 14%, transparent)`,
  } as CSSProperties
}

/** Seitenrahmen mit Titel und optionalem Zurück-Link. */
export function Page({
  title,
  back,
  subtitle,
  action,
  hero,
  accent,
  children,
}: {
  title: string
  back?: string
  subtitle?: ReactNode
  action?: ReactNode
  /** Ersetzt den Standard-Header komplett (z.B. Startseite). */
  hero?: ReactNode
  /** Färbt Akzent (Links, Badges, Buttons) dieser Seite. */
  accent?: PageKey
  children: ReactNode
}) {
  return (
    <main className="mx-auto max-w-md px-5 pb-12 pt-8" style={accentStyle(accent)}>
      {back && (
        <Link href={back} className="mb-3 inline-flex items-center gap-0.5 text-sm font-medium text-accent">
          <ChevronLeft />
          Zurück
        </Link>
      )}
      {hero ?? (
        <header className="mb-6 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </main>
  )
}

/** Abschnitt mit kleiner Überschrift. */
export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: string
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('mb-8', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between">
          {title && (
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
          )}
          {action}
        </div>
      )}
      {hint && <p className="mb-3 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  )
}

/** Liste mit Trennlinien. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('card divide-y divide-line overflow-hidden', className)}>{children}</div>
}

/** Freie Karte für Formulare und Textblöcke. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('card p-4', className)}>{children}</div>
}

/** Eine Zeile in der Liste. Als Button, wenn onClick gesetzt ist. */
export function Row({
  children,
  onClick,
  href,
  className,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  href?: string
  className?: string
  disabled?: boolean
}) {
  const base = cx('flex w-full items-center gap-3 px-4 py-3 text-left', className)
  if (href) {
    return (
      <Link href={href} className={cx(base, 'active:opacity-60')}>
        {children}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cx(base, 'active:opacity-60 disabled:opacity-40')}>
        {children}
      </button>
    )
  }
  return <div className={base}>{children}</div>
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  block?: boolean
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-fg shadow-sm',
    secondary: 'bg-card text-accent shadow-sm',
    ghost: 'bg-transparent text-accent',
    danger: 'bg-transparent text-danger',
  }
  const sizes = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-11 px-4 text-[15px]',
  }
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-opacity active:opacity-60 disabled:opacity-40',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

const fieldClass =
  'w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-soft'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldClass, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldClass, 'resize-y', className)} {...rest} />
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs text-muted">{children}</label>
}

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'solid' | 'outline'

/** Kleines Textabzeichen. */
export function Badge({
  children,
  tone = 'neutral',
  onClick,
}: {
  children: ReactNode
  tone?: BadgeTone
  onClick?: () => void
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-bg text-muted',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    solid: 'bg-accent text-accent-fg',
    outline: 'border border-line text-muted',
  }
  const cls = cx('inline-flex h-6 items-center rounded-md px-2 text-xs font-medium', tones[tone])
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(cls, 'active:opacity-60')}>
        {children}
      </button>
    )
  }
  return <span className={cls}>{children}</span>
}

export function Loading({ label = 'Lädt …' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-sm text-muted">{label}</p>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>
}

/** Hinweisbox in gedämpfter Fläche. */
export function Note({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger'
}) {
  const tones = {
    neutral: 'bg-card text-muted shadow-sm',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  }
  return <div className={cx('rounded-xl px-3.5 py-3 text-sm', tones[tone])}>{children}</div>
}

/** Bottom-Sheet. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  locked,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  locked?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => !locked && onClose()}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-bg px-4 pb-8 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} disabled={locked} className="text-sm font-medium text-accent disabled:opacity-40">
            Schließen
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Auswahlzeile mit Häkchen (für Zuweisungen). */
export function CheckRow({
  label,
  checked,
  onClick,
  disabled,
  meta,
}: {
  label: string
  checked: boolean
  onClick: () => void
  disabled?: boolean
  meta?: ReactNode
}) {
  return (
    <Row onClick={onClick} disabled={disabled}>
      <span className={cx('flex-1', checked ? 'font-medium text-accent' : '')}>{label}</span>
      {meta}
      <span
        className={cx(
          'flex h-6 w-6 items-center justify-center rounded-full border-2',
          checked ? 'border-accent bg-accent text-accent-fg' : 'border-line',
        )}
      >
        {checked && <Check />}
      </span>
    </Row>
  )
}

/* Icons: kleine Inline-SVGs, keine Emojis. */

export function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

export function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4 6.3 20.5l1.2-6.4L2.8 9.7l6.4-.8L12 3z" />
    </svg>
  )
}

/** Kompakte Datumskachel: Wochentag über Tag, farbig. */
export function DateTile({ date, tone = 'accent' }: { date: string; tone?: 'accent' | 'muted' }) {
  const d = new Date(date + 'T12:00:00')
  const weekday = d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')
  const month = d.toLocaleDateString('de-DE', { month: 'short' }).replace('.', '')
  return (
    <div
      className={cx(
        'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
        tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-bg text-muted',
      )}
    >
      <span className="text-[10px] font-medium uppercase">{weekday}</span>
      <span className="mt-0.5 text-lg font-semibold">{d.getDate()}</span>
      <span className="text-[10px] uppercase opacity-70">{month}</span>
    </div>
  )
}

/** Farbige Icon-Kachel für die Navigation. */
export function IconTile({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
      style={{ background: color }}
    >
      {children}
    </span>
  )
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Icons = {
  plus: () => (
    <svg {...iconProps} width={16} height={16}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  activity: () => (
    <svg {...iconProps}>
      <path d="M22 12h-4l-3 8-6-16-3 8H2" />
    </svg>
  ),
  calendar: () => (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  ),
  users: () => (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
    </svg>
  ),
  home: () => (
    <svg {...iconProps}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  ),
  smile: () => (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 10h.01M15 10h.01" />
    </svg>
  ),
  archive: () => (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" />
    </svg>
  ),
  settings: () => (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
}

/** Runder Avatar: Telegram-Profilbild, sonst Initialen auf Farbverlauf. */
export function Avatar({ src, name, size = 52 }: { src?: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  const style = { width: size, height: size }
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover shadow-sm" />
  }
  return (
    <span
      style={{ ...style, background: 'linear-gradient(135deg, var(--accent), #7b5cd6)', fontSize: size * 0.36 }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm"
    >
      {initials || '?'}
    </span>
  )
}

/** Kleiner runder Icon-Button für Zeilen-Aktionen (Bearbeiten, Löschen). */
export function IconButton({
  label,
  tone = 'muted',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'muted' | 'danger' | 'accent' }) {
  const tones = { muted: 'text-muted', danger: 'text-danger', accent: 'text-accent' }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg active:opacity-60 disabled:opacity-40',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Zweiteiliger Schieberegler (Segmented Control). value null = nichts gewählt. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cx('inline-flex rounded-lg bg-bg p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              'h-8 rounded-md px-3 text-sm font-medium transition-colors',
              active ? 'bg-card text-accent shadow-sm' : 'text-muted',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Ausklappbarer Bereich, z.B. für "Hinzufügen"-Formulare. Steuerung von außen. */
export function Disclosure({
  label,
  open,
  onOpenChange,
  children,
}: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <div className="mb-6">
      <Button variant={open ? 'ghost' : 'secondary'} block onClick={() => onOpenChange(!open)}>
        {open ? 'Abbrechen' : (
          <span className="inline-flex items-center gap-1.5">
            <Icons.plus />
            {label}
          </span>
        )}
      </Button>
      {open && <div className="card mt-3 p-4">{children}</div>}
    </div>
  )
}

/** Icon-Zeile: kleines farbiges Icon vor gedämpftem Text. */
export function IconLine({ icon, color, children }: { icon: ReactNode; color?: string; children: ReactNode }) {
  return (
    <p className="mt-1 flex items-start gap-2 text-sm text-muted">
      <span className="mt-[3px] shrink-0" style={color ? { color } : undefined}>{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  )
}

const smallIcon = { ...iconProps, width: 14, height: 14 }

export const SmallIcons = {
  users: () => (
    <svg {...smallIcon}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
    </svg>
  ),
  food: () => (
    <svg {...smallIcon}>
      <path d="M5 3v8a3 3 0 0 0 3 3v7M11 3v8a3 3 0 0 1-3 3M5 3v5M8 3v5" />
      <path d="M19 3c-2 1-3 4-3 7v3h3v8" />
    </svg>
  ),
  gift: () => (
    <svg {...smallIcon}>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8h14v-8M12 8v12" />
      <path d="M12 8c-1.5-3-5-3-5-1s3 1 5 1zM12 8c1.5-3 5-3 5-1s-3 1-5 1z" />
    </svg>
  ),
  check: () => (
    <svg {...smallIcon}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  pencil: () => (
    <svg {...iconProps} width={16} height={16}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  trash: () => (
    <svg {...iconProps} width={16} height={16}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  clock: () => (
    <svg {...smallIcon}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  weather: () => (
    <svg {...smallIcon}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.3 12.1 3.5 3.5 0 0 0 7 19z" />
    </svg>
  ),
  send: () => (
    <svg {...smallIcon}>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  ),
}
