'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/utils/supabase/client'
import type { Spot, SpotFeature } from '@/types'

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
  const [features, setFeatures] = useState<SpotFeature[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('spots').select('*').order('sort_order', { ascending: true }),
      supabase.from('spot_features').select('*').eq('active', true),
    ]).then(([spotsRes, featuresRes]) => {
      if (spotsRes.error) {
        setError(spotsRes.error.message)
        return
      }
      setSpots((spotsRes.data ?? []) as Spot[])
      // spot_features table may not exist yet (migration 002 must be run);
      // failures here are non-fatal — just render the map without features.
      if (!featuresRes.error) {
        setFeatures((featuresRes.data ?? []) as SpotFeature[])
      }
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
        <Map spots={spots} features={features} center={[55.69, 8.16]} zoom={11} />
      )}
    </div>
  )
}
