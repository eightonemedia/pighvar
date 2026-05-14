'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/utils/supabase/client'
import type { FishabilityScore, Spot, SpotFeature } from '@/types'

const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-sm text-[#8A8A82]">
      Indlæser kort...
    </div>
  ),
})

type LocalUser = { id: string; name: string }

export default function KortPage() {
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [features, setFeatures] = useState<SpotFeature[]>([])
  const [fishabilityScore, setFishabilityScore] = useState<number | null>(null)
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('pighvar_user')
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored) as LocalUser)
      } catch {
        // The (app) layout already handles malformed user state.
      }
    }

    const supabase = createClient()
    Promise.all([
      supabase.from('spots').select('*').order('sort_order', { ascending: true }),
      supabase.from('spot_features').select('*').eq('active', true),
      fetch('/api/fishability')
        .then((r) => (r.ok ? (r.json() as Promise<FishabilityScore>) : null))
        .catch(() => null),
    ]).then(([spotsRes, featuresRes, fishRes]) => {
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
      if (fishRes && typeof fishRes.score === 'number') {
        setFishabilityScore(fishRes.score)
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
        <Map
          spots={spots}
          features={features}
          fishabilityScore={fishabilityScore}
          currentUser={currentUser}
          center={[55.69, 8.16]}
          zoom={11}
        />
      )}
    </div>
  )
}
