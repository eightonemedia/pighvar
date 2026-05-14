import { NextResponse } from 'next/server'
import { fetchTideEvents, fetchCurrentWaterLevel } from '@/lib/api/dmi'

export async function GET() {
  try {
    const [events, current] = await Promise.all([
      fetchTideEvents(2),
      fetchCurrentWaterLevel(),
    ])
    return NextResponse.json(
      { events, current },
      {
        headers: {
          'Cache-Control': 'public, max-age=1800',
        },
      },
    )
  } catch (err) {
    console.error('[api/tide] unexpected failure', err)
    return NextResponse.json(
      { events: [], current: null },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      },
    )
  }
}
