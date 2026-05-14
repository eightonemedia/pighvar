'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

type User = { id: string; name: string }

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/kort', label: 'Kort' },
  { href: '/tur', label: 'Tur-tracker' },
  { href: '/log', label: 'Fangstlog' },
  { href: '/saeson', label: 'Sæson & viden' },
  { href: '/indkob', label: 'Indkøbsliste' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('pighvar_user')
    if (!stored) {
      router.push('/login')
      return
    }
    try {
      const parsed = JSON.parse(stored) as User
      if (!parsed?.id || !parsed?.name) throw new Error('invalid user')
      setUser(parsed)
      setHydrated(true)
    } catch {
      localStorage.removeItem('pighvar_user')
      router.push('/login')
    }
  }, [router])

  function handleLogout() {
    localStorage.removeItem('pighvar_user')
    router.push('/login')
  }

  if (!hydrated || !user) return null

  return (
    <div className={`${inter.className} h-screen flex flex-col bg-[#F7F6F3] text-[#1A1A18]`}>
      <header className="h-12 shrink-0 bg-white border-b border-[#E0DDD6] flex items-center justify-between px-6">
        <span className="font-semibold text-[#1A1A18]">Pighvar · Vestkysten</span>
        <span className="text-sm text-[#8A8A82]">Blåvand–Nymindegab</span>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#1A1A18] text-white text-xs flex items-center justify-center font-medium">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm text-[#1A1A18]">{user.name}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-[#4A4A44] hover:text-[#1A1A18] transition-colors"
          >
            Log ud
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-48 shrink-0 bg-white border-r border-[#E0DDD6] py-4">
          {navItems.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block py-2 text-sm border-l-2 transition-colors ${
                  active
                    ? 'bg-[#F0EEE9] border-[#1A1A18] font-medium text-[#1A1A18] pl-[14px] pr-4'
                    : 'border-transparent text-[#4A4A44] hover:bg-[#F7F6F3] pl-[14px] pr-4'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <main className="flex-1 overflow-y-auto px-8 py-7">{children}</main>
      </div>
    </div>
  )
}
