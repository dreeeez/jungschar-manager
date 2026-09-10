'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

/** Serverseitig bestätigte Identität (aus /api/auth/me). */
interface Helper {
  helperId: string | null
  telegramUserId: number
  name: string
  isAdmin: boolean
}

type AuthState = 'checking' | 'authorized' | 'denied'

interface TelegramContextType {
  user: TelegramUser | null
  helper: Helper | null
  isReady: boolean
  initData: string | null
  colorScheme: 'light' | 'dark'
  close: () => void
  showAlert: (message: string) => void
  showConfirm: (message: string) => Promise<boolean>
}

const TelegramContext = createContext<TelegramContextType | null>(null)

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [helper, setHelper] = useState<Helper | null>(null)
  const [auth, setAuth] = useState<AuthState>('checking')
  const [denyReason, setDenyReason] = useState<string>('')
  const [initData, setInitData] = useState<string | null>(null)
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp

    if (tg) {
      tg.ready()
      tg.expand()
      if (tg.initDataUnsafe?.user) setUser(tg.initDataUnsafe.user)
      setInitData(tg.initData)
      setColorScheme(tg.colorScheme || 'light')
      tg.onEvent('themeChanged', () => setColorScheme(tg.colorScheme || 'light'))
    }

    // Anmelden: initData einmalig gegen ein Session-Cookie tauschen.
    // Ohne Telegram wird ohne initData angefragt — das gelingt nur lokal
    // mit gesetztem DEV_TELEGRAM_USER_ID, in Production nie.
    const login = async () => {
      try {
        const res = await fetch('/api/auth/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg?.initData ?? null }),
        })

        if (res.ok) {
          const data = await res.json()
          setHelper(data.user)
          setAuth('authorized')
          return
        }

        const err = await res.json().catch(() => ({}))
        setDenyReason(
          err?.message ??
            (res.status === 403
              ? 'Dein Telegram-Konto ist nicht als Helfer registriert.'
              : 'Diese Seite lässt sich nur aus dem Telegram-Bot heraus öffnen.'),
        )
        setAuth('denied')
      } catch {
        setDenyReason('Anmeldung fehlgeschlagen. Bitte später erneut versuchen.')
        setAuth('denied')
      }
    }

    login()
  }, [])

  const close = () => {
    const tg = (window as any).Telegram?.WebApp
    tg?.close()
  }

  const showAlert = (message: string) => {
    const tg = (window as any).Telegram?.WebApp
    if (tg?.showAlert) {
      tg.showAlert(message)
    } else {
      alert(message)
    }
  }

  const showConfirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const tg = (window as any).Telegram?.WebApp
      if (tg?.showConfirm) {
        tg.showConfirm(message, (confirmed: boolean) => resolve(confirmed))
      } else {
        resolve(confirm(message))
      }
    })
  }

  if (auth === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-tg-hint text-sm">Anmeldung läuft …</p>
      </div>
    )
  }

  if (auth === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="mb-2 text-4xl">🔒</p>
          <h1 className="mb-2 text-lg font-semibold">Kein Zugang</h1>
          <p className="text-tg-hint text-sm">{denyReason}</p>
        </div>
      </div>
    )
  }

  // Kinder werden erst gerendert, wenn die Session steht — sonst würden
  // ihre Daten-Abfragen im useEffect gegen ein fehlendes Cookie laufen.
  return (
    <TelegramContext.Provider
      value={{
        user,
        helper,
        isReady: true,
        initData,
        colorScheme,
        close,
        showAlert,
        showConfirm,
      }}
    >
      {children}
    </TelegramContext.Provider>
  )
}

export function useTelegram() {
  const context = useContext(TelegramContext)
  if (!context) {
    throw new Error('useTelegram must be used within a TelegramProvider')
  }
  return context
}
