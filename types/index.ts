export type AppUser = {
  id: string
  name: string
  created_at: string
}

export type Spot = {
  id: string
  name: string
  lat: number
  lng: number
  description: string | null
  car_access: boolean
  fredning_note: string | null
  sort_order: number
}

export type Trip = {
  id: string
  user_id: string
  spot_id: string
  started_at: string
  ended_at: string | null
  weather_snapshot: WeatherSnapshot | null
  distance_m: number | null
  notes: string | null
}

export type Catch = {
  id: string
  trip_id: string
  user_id: string
  species: string
  length_cm: number | null
  weight_g: number | null
  lat: number | null
  lng: number | null
  photo_url: string | null
  bait: string | null
  caught_at: string
}

export type SpotFeature = {
  id: string
  spot_id: string
  user_id: string
  type: 'hestehul' | 'revle' | 'prel' | 'aaudlob' | 'andet'
  lat: number
  lng: number
  note: string | null
  date_found: string
  active: boolean
  created_at: string
}

export type ShoppingItem = {
  id: string
  name: string
  category: string
  link: string | null
  bought: boolean
  bought_by_user_id: string | null
  bought_at: string | null
}

export type WeatherSnapshot = {
  wind_speed: number
  wind_dir: string
  wave_height: number
  water_temp: number
  tide_state: string
  tide_height: number
  sources: string[]
}

export type TideEvent = {
  time: string
  height: number
  type: 'high' | 'low'
  projected?: boolean
}

export type FishabilityScore = {
  score: number
  verdict: string
  factors: Factor[]
  confidence: number
  sources: string[]
}

export type Factor = {
  label: string
  status: 'good' | 'ok' | 'bad' | 'neutral'
}
