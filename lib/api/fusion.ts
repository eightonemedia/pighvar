import type { WeatherSnapshot } from '@/types'

export async function getFusedWeather(): Promise<WeatherSnapshot> {
  return {
    wind_speed: 0,
    wind_dir: '',
    wave_height: 0,
    water_temp: 0,
    tide_state: '',
    tide_height: 0,
    sources: [],
  }
}
