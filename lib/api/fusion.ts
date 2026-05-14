import type {
  Factor,
  FishabilityScore,
  TideEvent,
  WeatherSnapshot,
} from '@/types'

const SUN_LAT = 55.69
const SUN_LNG = 8.16

const OFFSHORE_STRONG = new Set(['Ø', 'NØ', 'SØ', 'ØSØ', 'ØNØ'])
const OFFSHORE_WEAK = new Set(['N', 'NNØ', 'S', 'SSØ'])
const ONSHORE = new Set(['V', 'NV', 'SV', 'VSV', 'VNV', 'NNV', 'SSV'])

type CurrentTide = {
  height: number
  trend: 'rising' | 'falling' | 'stable'
} | null

type Sub = { score: number; factor: Factor }

function statusFromScore(s: number): Factor['status'] {
  return s === 2 ? 'good' : s === 1 ? 'ok' : 'bad'
}

function scoreWind(speed: number | undefined, dir: string | undefined): Sub {
  if (!dir && speed === undefined) {
    return { score: 1, factor: { label: 'Vind: ingen data', status: 'neutral' } }
  }
  let s = 1
  if (dir && OFFSHORE_STRONG.has(dir)) s = 2
  else if (dir && OFFSHORE_WEAK.has(dir)) s = 1
  else if (dir && ONSHORE.has(dir)) s = 0
  else s = 1

  const parts = [dir ?? 'vindstille']
  if (speed !== undefined) parts.push(`${speed.toFixed(1)} m/s`)
  return {
    score: s,
    factor: { label: `Vind: ${parts.join(' · ')}`, status: statusFromScore(s) },
  }
}

function scoreTide(events: TideEvent[], current: CurrentTide): Sub {
  if (!current && events.length === 0) {
    return {
      score: 1,
      factor: { label: 'Tidevand: ingen data', status: 'neutral' },
    }
  }

  const now = Date.now()
  const HALF_HOUR = 30 * 60 * 1000
  const TWO_HOURS = 2 * 60 * 60 * 1000
  const ONE_HOUR = 60 * 60 * 1000

  const nearLow = events.find(
    (e) =>
      e.type === 'low' && Math.abs(Date.parse(e.time) - now) < HALF_HOUR,
  )
  if (nearLow) {
    return {
      score: 0,
      factor: { label: 'Tidevand: ved lavvande', status: 'bad' },
    }
  }

  const inWindow = events.some(
    (e) =>
      e.type === 'high' &&
      now >= Date.parse(e.time) - TWO_HOURS &&
      now <= Date.parse(e.time) + ONE_HOUR,
  )
  if (inWindow) {
    return {
      score: 2,
      factor: {
        label: 'Tidevand: i fiskevindue (±høj)',
        status: 'good',
      },
    }
  }

  if (current?.trend === 'rising') {
    return {
      score: 2,
      factor: { label: 'Tidevand: stigende', status: 'good' },
    }
  }
  if (current?.trend === 'falling') {
    return {
      score: 1,
      factor: { label: 'Tidevand: faldende', status: 'ok' },
    }
  }
  return {
    score: 1,
    factor: { label: 'Tidevand: stabilt', status: 'ok' },
  }
}

function scoreWave(height: number | undefined): Sub {
  if (height === undefined) {
    return {
      score: 1,
      factor: { label: 'Bølger: ingen data', status: 'neutral' },
    }
  }
  const h = `${height.toFixed(2)} m`
  if (height < 0.5) {
    return { score: 2, factor: { label: `Bølger: ${h}`, status: 'good' } }
  }
  if (height <= 1.2) {
    return { score: 1, factor: { label: `Bølger: ${h}`, status: 'ok' } }
  }
  return { score: 0, factor: { label: `Bølger: ${h}`, status: 'bad' } }
}

function scoreTemp(temp: number | undefined): Sub {
  if (temp === undefined) {
    return {
      score: 1,
      factor: { label: 'Vandtemp: ingen data', status: 'neutral' },
    }
  }
  const t = `${temp.toFixed(1)}°C`
  if (temp > 10) {
    return { score: 2, factor: { label: `Vandtemp: ${t}`, status: 'good' } }
  }
  if (temp >= 8) {
    return { score: 1, factor: { label: `Vandtemp: ${t}`, status: 'ok' } }
  }
  return { score: 0, factor: { label: `Vandtemp: ${t}`, status: 'bad' } }
}

function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  return Math.floor((date.getTime() - start) / 86400000)
}

// Standard astronomical sunrise/sunset (zenith 90.833°).
// Returns UTC Date objects, or null when the sun never crosses the zenith.
function sunriseSunsetUTC(
  lat: number,
  lng: number,
  date: Date,
): { sunrise: Date | null; sunset: Date | null } {
  const ZENITH = 90.833
  const rad = (d: number) => (d * Math.PI) / 180
  const deg = (r: number) => (r * 180) / Math.PI
  const N = dayOfYearUTC(date)

  const compute = (isRise: boolean): Date | null => {
    const lngHour = lng / 15
    const t = N + ((isRise ? 6 : 18) - lngHour) / 24
    const M = 0.9856 * t - 3.289
    let L = M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634
    L = ((L % 360) + 360) % 360

    let RA = deg(Math.atan(0.91764 * Math.tan(rad(L))))
    RA = ((RA % 360) + 360) % 360
    const Lq = Math.floor(L / 90) * 90
    const RAq = Math.floor(RA / 90) * 90
    RA = (RA + (Lq - RAq)) / 15

    const sinDec = 0.39782 * Math.sin(rad(L))
    const cosDec = Math.cos(Math.asin(sinDec))
    const cosH =
      (Math.cos(rad(ZENITH)) - sinDec * Math.sin(rad(lat))) /
      (cosDec * Math.cos(rad(lat)))
    if (cosH > 1 || cosH < -1) return null

    let H = isRise ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))
    H /= 15

    const T = H + RA - 0.06571 * t - 6.622
    let UT = T - lngHour
    UT = ((UT % 24) + 24) % 24

    const out = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        Math.floor(UT),
        Math.floor((UT % 1) * 60),
        0,
      ),
    )
    return out
  }

  return { sunrise: compute(true), sunset: compute(false) }
}

function scoreSun(now: Date): Sub {
  const { sunrise, sunset } = sunriseSunsetUTC(SUN_LAT, SUN_LNG, now)
  if (!sunrise || !sunset) {
    return {
      score: 0,
      factor: { label: 'Soltid: ukendt', status: 'neutral' },
    }
  }
  const minutes = (a: Date, b: Date) =>
    Math.abs(a.getTime() - b.getTime()) / 60000
  const dRise = minutes(now, sunrise)
  const dSet = minutes(now, sunset)
  const minDist = Math.min(dRise, dSet)
  const which = dRise < dSet ? 'solopgang' : 'solnedgang'

  if (minDist < 60) {
    return {
      score: 2,
      factor: {
        label: `Soltid: ${Math.round(minDist)} min fra ${which}`,
        status: 'good',
      },
    }
  }
  if (minDist < 120) {
    return {
      score: 1,
      factor: {
        label: `Soltid: ${Math.round(minDist)} min fra ${which}`,
        status: 'ok',
      },
    }
  }
  const isDay =
    now.getTime() >= sunrise.getTime() && now.getTime() <= sunset.getTime()
  return {
    score: 0,
    factor: {
      label: isDay ? 'Soltid: midt på dagen' : 'Soltid: mørke',
      status: 'neutral',
    },
  }
}

function verdictFor(score: number): string {
  if (score >= 8) return 'Topsdag — smut af sted nu'
  if (score >= 6) return 'God dag at fiske'
  if (score >= 4) return 'Acceptabelt — hold øje med forholdene'
  if (score >= 2) return 'Dårlig dag'
  return 'Bliv hjemme'
}

export function getFishabilityScore(
  weather: Partial<WeatherSnapshot>,
  tideEvents: TideEvent[],
  current: CurrentTide,
): FishabilityScore {
  const wind = scoreWind(weather.wind_speed, weather.wind_dir)
  const tide = scoreTide(tideEvents, current)
  const wave = scoreWave(weather.wave_height)
  const temp = scoreTemp(weather.water_temp)
  const sun = scoreSun(new Date())

  const stormShutdown =
    !!weather.wind_dir &&
    ONSHORE.has(weather.wind_dir) &&
    (weather.wind_speed ?? 0) > 5

  const total = stormShutdown
    ? 0
    : wind.score + tide.score + wave.score + temp.score + sun.score

  const factors: Factor[] = [
    wind.factor,
    tide.factor,
    wave.factor,
    temp.factor,
    sun.factor,
  ]
  if (stormShutdown) {
    factors.unshift({
      label: `Pålandsvind ${weather.wind_speed?.toFixed(1)} m/s — uegnet til fiskeri`,
      status: 'bad',
    })
  }

  const signals = [
    weather.wind_dir !== undefined || weather.wind_speed !== undefined,
    current !== null || tideEvents.length > 0,
    weather.wave_height !== undefined,
    weather.water_temp !== undefined,
    true,
  ]
  const confidence = signals.filter(Boolean).length / signals.length

  const sources: string[] = []
  if (
    current !== null ||
    tideEvents.length > 0
  ) {
    sources.push('DMI')
  }
  if (
    weather.wind_speed !== undefined ||
    weather.wave_height !== undefined ||
    weather.water_temp !== undefined
  ) {
    sources.push('Open-Meteo')
  }

  return {
    score: total,
    verdict: verdictFor(total),
    factors,
    confidence,
    sources,
  }
}
