import type { TideEvent, WeatherSnapshot } from '@/types'

export async function fetchTideEvents(): Promise<TideEvent[]> {
  return []
}

export async function fetchWeather(): Promise<Partial<WeatherSnapshot>> {
  return {}
}
