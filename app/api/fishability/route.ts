import { NextResponse } from 'next/server'
import { getFishabilityScore } from '@/lib/api/fusion'
import type { FishabilityScore, TideEvent, WeatherSnapshot } from '@/types'

type TideResponse = {
  events?: TideEvent[]
  current?: { height: number; trend: 'rising' | 'falling' | 'stable' } | null
}

const fallback: FishabilityScore = {
  score: 0,
  verdict: 'Bliv hjemme',
  factors: [{ label: 'Ingen data tilgængelig', status: 'neutral' }],
  confidence: 0,
  sources: [],
}

export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin
    const [tideRes, weatherRes] = await Promise.all([
      fetch(`${origin}/api/tide`, { next: { revalidate: 900 } }),
      fetch(`${origin}/api/weather`, { next: { revalidate: 900 } }),
    ])

    const tideData = (tideRes.ok ? await tideRes.json() : {}) as TideResponse
    const weatherData = (weatherRes.ok
      ? await weatherRes.json()
      : {}) as Partial<WeatherSnapshot>

    const score = getFishabilityScore(
      weatherData,
      tideData.events ?? [],
      tideData.current ?? null,
    )

    return NextResponse.json(score, {
      headers: {
        'Cache-Control': 'public, max-age=900',
      },
    })
  } catch (err) {
    console.error('[api/fishability] failed', err)
    return NextResponse.json(fallback, {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    })
  }
}
