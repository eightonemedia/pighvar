import { NextResponse } from 'next/server'
import {
  fetchCurrentWaterLevel,
  fetchTideEvents,
  projectTideEvents,
} from '@/lib/api/dmi'

export async function GET() {
  try {
    const [observed, current] = await Promise.all([
      fetchTideEvents(2),
      fetchCurrentWaterLevel(),
    ])
    const events = projectTideEvents(observed)
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
