import type { WeatherSnapshot } from '@/types'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine'
const BLAAVAND_LAT = '55.5597'
const BLAAVAND_LNG = '8.0797'

const COMPASS_THRESHOLDS: { max: number; dir: string }[] = [
  { max: 11, dir: 'N' },
  { max: 34, dir: 'NNØ' },
  { max: 56, dir: 'NØ' },
  { max: 79, dir: 'ØNØ' },
  { max: 101, dir: 'Ø' },
  { max: 124, dir: 'ØSØ' },
  { max: 146, dir: 'SØ' },
  { max: 169, dir: 'SSØ' },
  { max: 191, dir: 'S' },
  { max: 214, dir: 'SSV' },
  { max: 236, dir: 'SV' },
  { max: 259, dir: 'VSV' },
  { max: 281, dir: 'V' },
  { max: 304, dir: 'VNV' },
  { max: 326, dir: 'NV' },
  { max: 349, dir: 'NNV' },
  { max: 360, dir: 'N' },
]

export function degreesToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360
  for (const { max, dir } of COMPASS_THRESHOLDS) {
    if (normalized < max) return dir
  }
  return 'N'
}

type ForecastResponse = {
  current?: {
    wind_speed_10m?: number
    wind_direction_10m?: number
  }
}

type MarineResponse = {
  current?: {
    wave_height?: number
    sea_surface_temperature?: number
  }
}

export async function fetchWeatherAndWaves(): Promise<Partial<WeatherSnapshot>> {
  try {
    const forecastUrl = new URL(FORECAST_URL)
    forecastUrl.searchParams.set('latitude', BLAAVAND_LAT)
    forecastUrl.searchParams.set('longitude', BLAAVAND_LNG)
    forecastUrl.searchParams.set('current', 'wind_speed_10m,wind_direction_10m')
    forecastUrl.searchParams.set('wind_speed_unit', 'ms')

    const marineUrl = new URL(MARINE_URL)
    marineUrl.searchParams.set('latitude', BLAAVAND_LAT)
    marineUrl.searchParams.set('longitude', BLAAVAND_LNG)
    marineUrl.searchParams.set('current', 'wave_height,sea_surface_temperature')

    const [forecastRes, marineRes] = await Promise.all([
      fetch(forecastUrl.toString(), { next: { revalidate: 900 } }),
      fetch(marineUrl.toString(), { next: { revalidate: 900 } }),
    ])

    if (!forecastRes.ok) {
      throw new Error(`forecast ${forecastRes.status}: ${forecastRes.statusText}`)
    }
    if (!marineRes.ok) {
      throw new Error(`marine ${marineRes.status}: ${marineRes.statusText}`)
    }

    const forecast = (await forecastRes.json()) as ForecastResponse
    const marine = (await marineRes.json()) as MarineResponse

    const result: Partial<WeatherSnapshot> = { sources: ['Open-Meteo'] }

    if (typeof forecast.current?.wind_speed_10m === 'number') {
      result.wind_speed = forecast.current.wind_speed_10m
    }
    if (typeof forecast.current?.wind_direction_10m === 'number') {
      result.wind_dir = degreesToCompass(forecast.current.wind_direction_10m)
    }
    if (typeof marine.current?.wave_height === 'number') {
      result.wave_height = marine.current.wave_height
    }
    if (typeof marine.current?.sea_surface_temperature === 'number') {
      result.water_temp = marine.current.sea_surface_temperature
    }

    return result
  } catch (err) {
    console.error('[openmeteo] fetchWeatherAndWaves failed', err)
    return {}
  }
}
