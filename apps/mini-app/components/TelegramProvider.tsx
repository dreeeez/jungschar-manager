'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramContextType {
  user: TelegramUser | null
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
  const [isReady, setIsReady] = useState(false)
  const [initData, setInitData] = useState<string | null>(null)
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp

    if (tg) {
      // Initialize the Mini App
      tg.ready()
      tg.expand()

      // Get user data
      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user)
      }

      // Get init data for validation
      setInitData(tg.initData)

      // Get color scheme
      setColorScheme(tg.colorScheme || 'light')

      // Listen for theme changes
      tg.onEvent('themeChanged', () => {
        setColorScheme(tg.colorScheme || 'light')
      })

      setIsReady(true)
    } else {
      // Development mode without Telegram
      console.log('Running outside Telegram - using mock data')
      setUser({
        id: 123456789,
        first_name: 'Test',
        username: 'testuser',
      })
      setIsReady(true)
    }
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
        tg.showConfirm(message, (confirmed: boolean) => {
          resolve(confirmed)
        })
      } else {
        resolve(confirm(message))
      }
    })
  }

  return (
    <TelegramContext.Provider
      value={{
        user,
        isReady,
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
