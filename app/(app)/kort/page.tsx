'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/utils/supabase/client'
import type { Spot } from '@/types'

const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-[#8A8A82]">
      Indlæser kort...
    </div>
  ),
})

export default function KortPage() {
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('spots')
      .select('*')
      .order('sort_order', { ascending: true })
      .then(({ data, error: dbError }) => {
        if (dbError) {
          setError(dbError.message)
          return
        }
        setSpots((data ?? []) as Spot[])
      })
  }, [])

  return (
    <div className="-mx-8 -my-7 h-[calc(100vh-48px)] bg-[#F7F6F3]">
      {error ? (
        <div className="h-full w-full flex items-center justify-center text-sm text-red-600">
          Kunne ikke hente spots: {error}
        </div>
      ) : !spots ? (
        <div className="h-full w-full flex items-center justify-center text-sm text-[#8A8A82]">
          Indlæser kort...
        </div>
      ) : (
        <Map spots={spots} center={[55.69, 8.16]} zoom={11} />
      )}
    </div>
  )
}
