'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const stored = localStorage.getItem('pighvar_user')
    router.push(stored ? '/dashboard' : '/login')
  }, [router])

  return null
}
