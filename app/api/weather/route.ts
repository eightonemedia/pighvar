import { NextResponse } from 'next/server'
import { fetchWeatherAndWaves } from '@/lib/api/openmeteo'

export async function GET() {
  try {
    const data = await fetchWeatherAndWaves()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=900',
      },
    })
  } catch (err) {
    console.error('[api/weather] unexpected failure', err)
    return NextResponse.json(
      {},
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      },
    )
  }
}
