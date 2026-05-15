'use client'

import { useEffect, useMemo, useState } from 'react'
import { Caveat } from 'next/font/google'
import { createClient } from '@/utils/supabase/client'
import type {
  FishabilityScore,
  Spot,
  TideEvent,
  WeatherSnapshot,
} from '@/types'

const caveat = Caveat({ subsets: ['latin'], weight: ['500', '600'] })

// ── Types ─────────────────────────────────────────────────────────────
type CurrentTide = {
  height: number
  trend: 'rising' | 'falling' | 'stable'
} | null
type TideResp = { events?: TideEvent[]; current?: CurrentTide }

type DayForecast = {
  date: Date
  windSpeed: number
  windDeg: number
  windDir: string
  sunrise: Date | null
  sunset: Date | null
}

type SpotProfile = {
  crowd: 'low' | 'medium' | 'high'
  requires_walk: boolean
  walk_min: number
  optimal_wind: string[]
  best_tide: 'rising' | 'falling' | 'any'
  notes: string
}

// ── Constants ─────────────────────────────────────────────────────────
const DANISH_DAY_LONG = [
  'Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag',
]
const DANISH_DAY_SHORT = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør']
const DANISH_MONTH = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
]

const OFFSHORE_STRONG = new Set(['Ø', 'NØ', 'SØ', 'ØSØ', 'ØNØ'])
const ONSHORE = new Set(['V', 'NV', 'SV', 'VSV', 'VNV', 'NNV', 'SSV'])

const COMPASS_THRESHOLDS: { max: number; dir: string }[] = [
  { max: 11, dir: 'N' }, { max: 34, dir: 'NNØ' }, { max: 56, dir: 'NØ' },
  { max: 79, dir: 'ØNØ' }, { max: 101, dir: 'Ø' }, { max: 124, dir: 'ØSØ' },
  { max: 146, dir: 'SØ' }, { max: 169, dir: 'SSØ' }, { max: 191, dir: 'S' },
  { max: 214, dir: 'SSV' }, { max: 236, dir: 'SV' }, { max: 259, dir: 'VSV' },
  { max: 281, dir: 'V' }, { max: 304, dir: 'VNV' }, { max: 326, dir: 'NV' },
  { max: 349, dir: 'NNV' }, { max: 360, dir: 'N' },
]

// Spot profiles hardcoded from Vesterhavet fishing knowledge. Schema is
// intentionally not yet in Supabase — the columns would be crowd_level,
// requires_walk, walk_minutes, optimal_wind_dirs[], best_tide, notes.
const SPOT_PROFILES: Record<string, SpotProfile> = {
  Blåvand: {
    crowd: 'high', requires_walk: false, walk_min: 0,
    optimal_wind: ['Ø', 'ØSØ', 'SØ'], best_tide: 'rising',
    notes: 'Klassisk spot · ofte tæt befolket',
  },
  Grærup: {
    crowd: 'low', requires_walk: true, walk_min: 15,
    optimal_wind: ['Ø', 'ØSØ', 'ØNØ'], best_tide: 'rising',
    notes: 'Stille · langt fra crowds',
  },
  Henne: {
    crowd: 'medium', requires_walk: true, walk_min: 12,
    optimal_wind: ['Ø', 'ØSØ', 'NØ'], best_tide: 'rising',
    notes: 'NB: Fredning ved Å · gå nord for P-plads',
  },
  Børsmose: {
    crowd: 'medium', requires_walk: false, walk_min: 0,
    optimal_wind: ['Ø', 'NØ'], best_tide: 'rising',
    notes: 'Bilkørsel tilladt på strand',
  },
  Vejers: {
    crowd: 'high', requires_walk: false, walk_min: 0,
    optimal_wind: ['Ø', 'ØNØ'], best_tide: 'rising',
    notes: 'Drive-up · ofte fyldt op',
  },
  Houstrup: {
    crowd: 'low', requires_walk: true, walk_min: 10,
    optimal_wind: ['Ø', 'ØSØ', 'SØ', 'ØNØ'], best_tide: 'rising',
    notes: '300m over klit · værd at gå',
  },
  Nymindegab: {
    crowd: 'medium', requires_walk: true, walk_min: 8,
    optimal_wind: ['Ø', 'NØ', 'ØNØ'], best_tide: 'falling',
    notes: 'Fjordudløb · kraftig strøm',
  },
  Lyngvig: {
    crowd: 'low', requires_walk: true, walk_min: 12,
    optimal_wind: ['Ø', 'ØSØ', 'NØ'], best_tide: 'rising',
    notes: 'Besværlig adgang = stille',
  },
  Søndervig: {
    crowd: 'high', requires_walk: false, walk_min: 0,
    optimal_wind: ['Ø', 'ØSØ'], best_tide: 'rising',
    notes: 'Bil tilladt · mindre stabil',
  },
}

const FORECAST_LAT = '55.5597'
const FORECAST_LNG = '8.0797'

// ── Helpers ───────────────────────────────────────────────────────────
function degreesToCompass(deg: number): string {
  const n = ((deg % 360) + 360) % 360
  for (const { max, dir } of COMPASS_THRESHOLDS) if (n < max) return dir
  return 'N'
}

function fmtFullDate(d: Date): string {
  return `${DANISH_DAY_LONG[d.getDay()]} ${d.getDate()}. ${DANISH_MONTH[d.getMonth()]} ${d.getFullYear()}`
}
function fmtHM(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
}
function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'Nu'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `Om ${m} min`
  return `Om ${h}t ${m} min`
}

function scoreColorClass(score: number): string {
  if (score >= 7) return 'text-[#1A5A8A]'
  if (score >= 4) return 'text-[#B5811C]'
  return 'text-[#B33C2A]'
}
function scoreBarColor(score: number): string {
  if (score >= 7) return 'bg-[#1A5A8A]'
  if (score >= 4) return 'bg-[#B5811C]'
  return 'bg-[#B33C2A]'
}

function verdictText(score: number): { headline: string; tone: 'good' | 'ok' | 'bad' } {
  if (score >= 7) return { headline: 'JA — smut af sted', tone: 'good' }
  if (score >= 4) return { headline: 'Måske — hold øje', tone: 'ok' }
  return { headline: 'Nej — vent', tone: 'bad' }
}

function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  return Math.floor((date.getTime() - start) / 86400000)
}

function sunriseSunsetUTC(
  lat: number, lng: number, date: Date,
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
    return new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
      Math.floor(UT), Math.floor((UT % 1) * 60), 0,
    ))
  }
  return { sunrise: compute(true), sunset: compute(false) }
}

function scoreSpot(spot: Spot, windDir: string | undefined): number {
  const profile = SPOT_PROFILES[spot.name]
  if (!profile) return 0
  let s = 0
  if (windDir && profile.optimal_wind.includes(windDir)) s += 3
  if (profile.crowd === 'low') s += 2
  else if (profile.crowd === 'medium') s += 1
  if (profile.requires_walk) s += 1
  if (spot.fredning_note) s -= 1
  return s
}

function recommendSpots(spots: Spot[], windDir: string | undefined): {
  primary: Spot | null
  secondary: Spot | null
} {
  if (spots.length === 0) return { primary: null, secondary: null }
  const ranked = [...spots]
    .map((s) => ({ s, score: scoreSpot(s, windDir) }))
    .sort((a, b) => b.score - a.score)
  return {
    primary: ranked[0]?.s ?? null,
    secondary: ranked[1]?.s ?? null,
  }
}

function nextHighTide(events: TideEvent[], now: Date): TideEvent | null {
  return (
    events
      .filter((e) => e.type === 'high' && Date.parse(e.time) > now.getTime())
      .sort((a, b) => a.time.localeCompare(b.time))[0] ?? null
  )
}

function sessionType(time: Date): 'Morgensession' | 'Aftensession' | 'Dagssession' {
  const h = time.getHours()
  if (h < 10) return 'Morgensession'
  if (h >= 17) return 'Aftensession'
  return 'Dagssession'
}

// Cosine-interpolated tide height between two consecutive events.
function tideHeightAt(events: TideEvent[], t: number): number | null {
  for (let i = 0; i < events.length - 1; i++) {
    const e1 = events[i], e2 = events[i + 1]
    const t1 = Date.parse(e1.time), t2 = Date.parse(e2.time)
    if (t >= t1 && t <= t2) {
      const progress = (t - t1) / (t2 - t1)
      return e1.height + (e2.height - e1.height) * (1 - Math.cos(progress * Math.PI)) / 2
    }
  }
  return null
}

// ── Page ──────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [now, setNow] = useState(() => new Date())
  const [fishability, setFishability] = useState<FishabilityScore | null>(null)
  const [tide, setTide] = useState<TideResp | null>(null)
  const [weather, setWeather] = useState<Partial<WeatherSnapshot> | null>(null)
  const [forecast, setForecast] = useState<DayForecast[] | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      fetch('/api/fishability').then((r) => r.json() as Promise<FishabilityScore>),
      fetch('/api/tide').then((r) => r.json() as Promise<TideResp>),
      fetch('/api/weather').then((r) => r.json() as Promise<Partial<WeatherSnapshot>>),
      fetchForecast(),
      supabase.from('spots').select('*').order('sort_order', { ascending: true }),
    ])
      .then(([f, t, w, fc, spotsRes]) => {
        setFishability(f)
        setTide(t)
        setWeather(w)
        setForecast(fc)
        if (!spotsRes.error) setSpots((spotsRes.data ?? []) as Spot[])
      })
      .catch((err) => console.error('[dashboard] fetch failed', err))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <Header now={now} />
      <DagensDom fishability={fishability} weather={weather} tide={tide} loading={loading} />
      <DagensVindue tide={tide} now={now} loading={loading} />
      <AnbefaletPlads spots={spots} weather={weather} loading={loading} />
      <Vindrose weather={weather} />
      <UgensForecast forecast={forecast} spots={spots} tideEvents={tide?.events ?? []} loading={loading} />
      <TidevandCurve tide={tide} now={now} loading={loading} />
      <VejrDetaljer weather={weather} loading={loading} />
    </div>
  )
}

// ── Open-Meteo daily fetch (client-side, CORS-friendly) ───────────────
async function fetchForecast(): Promise<DayForecast[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', FORECAST_LAT)
  url.searchParams.set('longitude', FORECAST_LNG)
  url.searchParams.set(
    'daily',
    'wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset',
  )
  url.searchParams.set('wind_speed_unit', 'ms')
  url.searchParams.set('timezone', 'Europe/Copenhagen')
  url.searchParams.set('forecast_days', '7')
  try {
    const res = await fetch(url.toString())
    if (!res.ok) return []
    const json = (await res.json()) as {
      daily?: {
        time?: string[]
        wind_speed_10m_max?: number[]
        wind_direction_10m_dominant?: number[]
        sunrise?: string[]
        sunset?: string[]
      }
    }
    const d = json.daily
    if (!d?.time) return []
    return d.time.map((iso, i) => {
      const deg = d.wind_direction_10m_dominant?.[i] ?? 0
      return {
        date: new Date(iso),
        windSpeed: d.wind_speed_10m_max?.[i] ?? 0,
        windDeg: deg,
        windDir: degreesToCompass(deg),
        sunrise: d.sunrise?.[i] ? new Date(d.sunrise[i]) : null,
        sunset: d.sunset?.[i] ? new Date(d.sunset[i]) : null,
      }
    })
  } catch (err) {
    console.warn('[dashboard] forecast fetch failed', err)
    return []
  }
}

function dailyScore(f: DayForecast): number {
  let s = 5
  if (OFFSHORE_STRONG.has(f.windDir)) s += 3
  if (ONSHORE.has(f.windDir)) {
    if (f.windSpeed > 5) s -= 5
    else s -= 2
  }
  if (f.windSpeed > 10) s -= 2
  return Math.max(0, Math.min(10, s))
}

// ── Section: Header ───────────────────────────────────────────────────
function Header({ now }: { now: Date }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-[#1A1A18]">Dashboard</h1>
      <p className="text-sm text-[#8A8A82] mt-1 tabular-nums">
        {fmtFullDate(now)} · {fmtHM(now)}
      </p>
    </div>
  )
}

// ── Section: Dagens dom ───────────────────────────────────────────────
function DagensDom({
  fishability, weather, tide, loading,
}: {
  fishability: FishabilityScore | null
  weather: Partial<WeatherSnapshot> | null
  tide: TideResp | null
  loading: boolean
}) {
  if (loading || !fishability) {
    return (
      <Card className="p-8">
        <Skeleton className="h-6 w-40 mb-4" />
        <Skeleton className="h-20 w-32 mb-2" />
        <Skeleton className="h-4 w-64" />
      </Card>
    )
  }
  const v = verdictText(fishability.score)
  const tideTrend = tide?.current?.trend ?? 'stable'
  const tideLabel =
    tideTrend === 'rising' ? 'Stigende' : tideTrend === 'falling' ? 'Faldende' : 'Stabilt'
  const summary = [
    weather?.wind_dir ?? '—',
    tideLabel,
    weather?.water_temp !== undefined ? `${weather.water_temp.toFixed(1)}°C` : '—',
  ].join(' · ')

  return (
    <Card
      className={`p-8 border-2 ${
        v.tone === 'good'
          ? 'border-[#1A5A8A]'
          : v.tone === 'ok'
            ? 'border-[#B5811C]'
            : 'border-[#B33C2A]'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-[#8A8A82] mb-1">
        Dagens dom
      </div>
      <div className="flex items-baseline gap-6 flex-wrap">
        <div
          className={`${caveat.className} text-7xl leading-none tabular-nums ${scoreColorClass(fishability.score)}`}
        >
          {fishability.score}
        </div>
        <div>
          <div
            className={`${caveat.className} text-4xl text-[#1A1A18] leading-tight`}
          >
            {v.headline}
          </div>
          <div className="text-sm text-[#4A4A44] mt-1 tabular-nums">
            {summary}
          </div>
        </div>
      </div>
      <div className="mt-4 text-sm text-[#4A4A44]">
        {fishability.verdict}
      </div>
    </Card>
  )
}

// ── Section: Dagens vindue ────────────────────────────────────────────
function DagensVindue({
  tide, now, loading,
}: {
  tide: TideResp | null
  now: Date
  loading: boolean
}) {
  if (loading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-10 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </Card>
    )
  }
  const nextHigh = nextHighTide(tide?.events ?? [], now)
  if (!nextHigh) {
    return (
      <Card className="p-6">
        <div className="text-xs uppercase tracking-wide text-[#8A8A82] mb-2">
          Dagens vindue
        </div>
        <p className="text-sm text-[#4A4A44]">
          Ingen kommende højvande i tidevandsdataene.
        </p>
      </Card>
    )
  }
  const highTime = new Date(nextHigh.time)
  const windowStart = new Date(highTime.getTime() - 2 * 3600 * 1000)
  const windowEnd = new Date(highTime.getTime() + 3600 * 1000)
  const inWindow = now >= windowStart && now <= windowEnd
  const session = sessionType(windowStart)
  const countdownMs = windowStart.getTime() - now.getTime()
  const countdownText = inWindow ? 'Vinduet er åbent nu' : fmtCountdown(countdownMs)

  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-[#8A8A82]">
          Dagens vindue
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#EFECE7] text-[#4A4A44]">
          {session}
        </span>
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-sm text-[#4A4A44]">Vær ved vandet kl.</span>
        <span
          className={`${caveat.className} text-5xl text-[#1A1A18] leading-none tabular-nums`}
        >
          {fmtHM(windowStart)}
        </span>
      </div>
      <div className="mt-3 text-sm text-[#4A4A44] tabular-nums">
        Bedste session {fmtHM(windowStart)}–{fmtHM(windowEnd)} (HV kl. {fmtHM(highTime)})
      </div>
      <div
        className={`mt-1 text-sm tabular-nums ${
          inWindow ? 'text-[#1A5A8A] font-medium' : 'text-[#8A8A82]'
        }`}
      >
        {countdownText}
      </div>
    </Card>
  )
}

// ── Section: Anbefalet plads ──────────────────────────────────────────
function AnbefaletPlads({
  spots, weather, loading,
}: {
  spots: Spot[]
  weather: Partial<WeatherSnapshot> | null
  loading: boolean
}) {
  const { primary, secondary } = useMemo(
    () => recommendSpots(spots, weather?.wind_dir),
    [spots, weather],
  )

  if (loading || !primary) {
    return (
      <Card className="p-6">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-10 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </Card>
    )
  }
  const profile = SPOT_PROFILES[primary.name]
  return (
    <Card className="p-6">
      <div className="text-xs uppercase tracking-wide text-[#8A8A82] mb-2">
        Anbefalet plads
      </div>
      <div
        className={`${caveat.className} text-5xl text-[#1A1A18] leading-tight`}
      >
        {primary.name}
      </div>
      {profile && (
        <>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {profile.requires_walk && (
              <span className="px-2 py-0.5 rounded-full bg-[#EFECE7] text-[#4A4A44]">
                {profile.walk_min} min gang
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded-full ${
                profile.crowd === 'low'
                  ? 'bg-[#E3F2DA] text-[#3D6B27]'
                  : profile.crowd === 'medium'
                    ? 'bg-[#F5ECD9] text-[#B5811C]'
                    : 'bg-[#F4E0DC] text-[#B33C2A]'
              }`}
            >
              {profile.crowd === 'low'
                ? 'Lavt pres'
                : profile.crowd === 'medium'
                  ? 'Middel pres'
                  : 'Højt pres'}
            </span>
            {weather?.wind_dir &&
              profile.optimal_wind.includes(weather.wind_dir) && (
                <span className="px-2 py-0.5 rounded-full bg-[#E7EEF4] text-[#1A5A8A]">
                  Optimal vind
                </span>
              )}
          </div>
          <p className="mt-3 text-sm text-[#4A4A44]">{profile.notes}</p>
        </>
      )}
      {primary.fredning_note && (
        <div className="mt-3 text-xs text-[#B33C2A] flex items-start gap-2">
          <span>⚠</span>
          <span>{primary.fredning_note}</span>
        </div>
      )}
      {secondary && (
        <div className="mt-4 pt-4 border-t border-[#EFECE7] text-sm text-[#4A4A44]">
          Alternativ:{' '}
          <span className="text-[#1A1A18] font-medium">{secondary.name}</span>
          {SPOT_PROFILES[secondary.name] && (
            <span className="text-[#8A8A82]">
              {' '}· {SPOT_PROFILES[secondary.name].notes}
            </span>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Section: Vindrose ─────────────────────────────────────────────────
function Vindrose({ weather }: { weather: Partial<WeatherSnapshot> | null }) {
  const dir = weather?.wind_dir
  const deg = useMemo(() => {
    if (!dir) return 0
    const entry = COMPASS_THRESHOLDS.findIndex((c) => c.dir === dir)
    if (entry < 0) return 0
    const prev = entry === 0 ? 0 : COMPASS_THRESHOLDS[entry - 1].max
    const curr = COMPASS_THRESHOLDS[entry].max
    return (prev + curr) / 2
  }, [dir])
  const isOffshore = dir ? OFFSHORE_STRONG.has(dir) : false
  const isOnshore = dir ? ONSHORE.has(dir) : false
  const needleColor = isOffshore
    ? '#1F8A4C'
    : isOnshore
      ? '#B33C2A'
      : '#1A5A8A'
  const verdict = isOffshore
    ? 'Fralandsvind — godt'
    : isOnshore
      ? 'Pålandsvind — dårligt'
      : 'Neutral retning'

  return (
    <Card className="p-6">
      <div className="text-xs uppercase tracking-wide text-[#8A8A82] mb-3">
        Vindrose
      </div>
      <div className="flex items-center gap-6">
        <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#E0DDD6" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="32" fill="none" stroke="#EFECE7" strokeWidth="0.5" />
          <text x="50" y="14" textAnchor="middle" fontSize="8" fontWeight="600" fill="#1A1A18">N</text>
          <text x="50" y="91" textAnchor="middle" fontSize="8" fill="#4A4A44">S</text>
          <text x="89" y="53" textAnchor="middle" fontSize="8" fill="#4A4A44">Ø</text>
          <text x="11" y="53" textAnchor="middle" fontSize="8" fill="#4A4A44">V</text>
          {dir && (
            <g transform={`rotate(${deg} 50 50)`}>
              <polygon points="50,12 46,50 54,50" fill={needleColor} />
              <polygon points="50,88 46,50 54,50" fill="#B0B0B0" />
            </g>
          )}
          <circle cx="50" cy="50" r="2.5" fill="#1A1A18" />
        </svg>
        <div>
          <div className="text-3xl font-light text-[#1A1A18] tabular-nums">
            {dir ?? '—'}{' '}
            <span className="text-lg text-[#8A8A82]">
              {weather?.wind_speed !== undefined
                ? `${weather.wind_speed.toFixed(1)} m/s`
                : ''}
            </span>
          </div>
          <div
            className="mt-1 text-sm"
            style={{ color: needleColor }}
          >
            {verdict}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Section: Ugens forecast ───────────────────────────────────────────
function UgensForecast({
  forecast, spots, tideEvents, loading,
}: {
  forecast: DayForecast[] | null
  spots: Spot[]
  tideEvents: TideEvent[]
  loading: boolean
}) {
  return (
    <Card className="p-5">
      <h2 className="text-xs uppercase tracking-wide text-[#8A8A82] mb-4">
        7 dage frem
      </h2>
      {loading || !forecast ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : forecast.length === 0 ? (
        <p className="text-sm text-[#8A8A82]">
          Kunne ikke hente forecast.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {forecast.map((f, i) => {
            const score = dailyScore(f)
            const rec = recommendSpots(spots, f.windDir).primary
            const nextDay = new Date(f.date); nextDay.setDate(nextDay.getDate() + 1)
            const highToday = tideEvents.find(
              (e) =>
                e.type === 'high' &&
                Date.parse(e.time) >= f.date.getTime() &&
                Date.parse(e.time) < nextDay.getTime(),
            )
            const recLabel = score >= 7 && rec
              ? `God dag → ${rec.name}`
              : score >= 4 && rec
                ? `Acceptabelt → ${rec.name}`
                : 'Spring over'
            const isToday = i === 0
            return (
              <div
                key={i}
                className={`p-3 rounded-lg ${
                  isToday
                    ? 'border-2 border-[#1A5A8A] bg-[#F4F8FB]'
                    : 'border border-[#E0DDD6]'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-[#1A1A18]">
                    {isToday ? 'I dag' : DANISH_DAY_SHORT[f.date.getDay()]}
                  </span>
                  <span className="text-[10px] text-[#8A8A82] tabular-nums">
                    {f.date.getDate()}/{f.date.getMonth() + 1}
                  </span>
                </div>
                <div
                  className={`mt-2 text-3xl font-light tabular-nums ${scoreColorClass(score)}`}
                >
                  {score}
                </div>
                <div className="mt-1 h-1 bg-[#EFECE7] rounded overflow-hidden">
                  <div
                    className={`h-full ${scoreBarColor(score)}`}
                    style={{ width: `${score * 10}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-[#4A4A44] tabular-nums">
                  {f.windDir} · {f.windSpeed.toFixed(1)} m/s
                </div>
                <div className="text-[11px] text-[#8A8A82] tabular-nums">
                  HV {highToday ? fmtHM(highToday.time) : '—'}
                </div>
                <div className="mt-1 text-[10px] text-[#4A4A44]">
                  {recLabel}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Section: Tidevand curve ──────────────────────────────────────────
function TidevandCurve({
  tide, now, loading,
}: {
  tide: TideResp | null
  now: Date
  loading: boolean
}) {
  const W = 800, H = 200, PAD_L = 30, PAD_R = 10, PAD_T = 20, PAD_B = 30
  const RANGE_H = 48 * 3600 * 1000

  const points = useMemo(() => {
    if (!tide?.events) return null
    const events = [...tide.events].sort((a, b) => a.time.localeCompare(b.time))
    if (events.length < 2) return null
    const rangeStart = now.getTime() - 6 * 3600 * 1000
    const rangeEnd = rangeStart + RANGE_H

    let minH = Infinity, maxH = -Infinity
    for (const e of events) {
      if (e.height < minH) minH = e.height
      if (e.height > maxH) maxH = e.height
    }
    minH -= 0.1; maxH += 0.1
    const span = maxH - minH || 1
    const innerW = W - PAD_L - PAD_R
    const innerH = H - PAD_T - PAD_B

    const samples: { x: number; y: number; t: number }[] = []
    const N = 200
    for (let i = 0; i <= N; i++) {
      const t = rangeStart + (i / N) * (rangeEnd - rangeStart)
      const h = tideHeightAt(events, t)
      if (h === null) continue
      const x = PAD_L + (i / N) * innerW
      const y = PAD_T + ((maxH - h) / span) * innerH
      samples.push({ x, y, t })
    }
    if (samples.length === 0) return null
    const path = samples
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ')
    const nowX = PAD_L + ((now.getTime() - rangeStart) / (rangeEnd - rangeStart)) * innerW

    // Fishing windows (2h before to 1h after each high in range)
    const windows: { x1: number; x2: number }[] = []
    for (const e of events) {
      if (e.type !== 'high') continue
      const eT = Date.parse(e.time)
      const wStart = eT - 2 * 3600 * 1000
      const wEnd = eT + 1 * 3600 * 1000
      if (wEnd < rangeStart || wStart > rangeEnd) continue
      windows.push({
        x1: PAD_L + ((Math.max(wStart, rangeStart) - rangeStart) / (rangeEnd - rangeStart)) * innerW,
        x2: PAD_L + ((Math.min(wEnd, rangeEnd) - rangeStart) / (rangeEnd - rangeStart)) * innerW,
      })
    }

    // Event labels
    const labels = events
      .filter((e) => {
        const t = Date.parse(e.time)
        return t >= rangeStart && t <= rangeEnd
      })
      .map((e) => {
        const t = Date.parse(e.time)
        const x = PAD_L + ((t - rangeStart) / (rangeEnd - rangeStart)) * innerW
        const y = PAD_T + ((maxH - e.height) / span) * innerH
        return { x, y, type: e.type, time: e.time }
      })

    // X-axis hour ticks
    const dayMs = 24 * 3600 * 1000
    const ticks: { x: number; label: string }[] = []
    const firstTick = Math.ceil(rangeStart / dayMs) * dayMs
    for (let t = firstTick; t <= rangeEnd; t += dayMs) {
      const date = new Date(t)
      const x = PAD_L + ((t - rangeStart) / (rangeEnd - rangeStart)) * innerW
      ticks.push({ x, label: `${DANISH_DAY_SHORT[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}` })
    }

    return { path, nowX, windows, labels, ticks, minH, maxH }
  }, [tide, now])

  return (
    <Card className="p-6">
      <h2 className="text-xs uppercase tracking-wide text-[#8A8A82] mb-3">
        Tidevand · 48 t
      </h2>
      {loading || !points ? (
        <Skeleton className="h-[200px] w-full" />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
          {points.windows.map((w, i) => (
            <rect
              key={i}
              x={w.x1}
              y={PAD_T}
              width={Math.max(0, w.x2 - w.x1)}
              height={H - PAD_T - PAD_B}
              fill="#E7EEF4"
            />
          ))}
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={H - PAD_B}
            y2={H - PAD_B}
            stroke="#E0DDD6"
            strokeWidth="1"
          />
          {points.ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={t.x}
                x2={t.x}
                y1={PAD_T}
                y2={H - PAD_B}
                stroke="#EFECE7"
                strokeWidth="1"
              />
              <text
                x={t.x}
                y={H - 10}
                fontSize="10"
                fill="#8A8A82"
                textAnchor="middle"
              >
                {t.label}
              </text>
            </g>
          ))}
          <path
            d={points.path}
            fill="none"
            stroke="#1A5A8A"
            strokeWidth="2"
          />
          <line
            x1={points.nowX}
            x2={points.nowX}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="#B33C2A"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          {points.labels.map((l, i) => (
            <g key={i}>
              <circle cx={l.x} cy={l.y} r="3" fill={l.type === 'high' ? '#1A5A8A' : '#8A8A82'} />
              <text
                x={l.x}
                y={l.type === 'high' ? l.y - 6 : l.y + 14}
                fontSize="9"
                fill="#4A4A44"
                textAnchor="middle"
              >
                {l.type === 'high' ? 'HV' : 'LV'} {fmtHM(l.time)}
              </text>
            </g>
          ))}
        </svg>
      )}
      <p className="text-[11px] text-[#8A8A82] mt-2">
        Blå skygge: fiskevindue (2t før til 1t efter HV). Rød streg: nu.
      </p>
    </Card>
  )
}

// ── Section: Vejr detaljer ────────────────────────────────────────────
function VejrDetaljer({
  weather, loading,
}: {
  weather: Partial<WeatherSnapshot> | null
  loading: boolean
}) {
  const windStatus =
    !weather?.wind_dir
      ? 'neutral'
      : OFFSHORE_STRONG.has(weather.wind_dir)
        ? 'good'
        : ONSHORE.has(weather.wind_dir)
          ? 'bad'
          : 'ok'
  const waveStatus =
    weather?.wave_height === undefined
      ? 'neutral'
      : weather.wave_height < 0.5
        ? 'good'
        : weather.wave_height <= 1.2
          ? 'ok'
          : 'bad'
  const tempStatus =
    weather?.water_temp === undefined
      ? 'neutral'
      : weather.water_temp > 10
        ? 'good'
        : weather.water_temp >= 8
          ? 'ok'
          : 'bad'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <WeatherCard
        label="Vind"
        value={
          loading
            ? null
            : weather?.wind_dir
              ? `${weather.wind_dir} ${weather.wind_speed?.toFixed(1) ?? '—'} m/s`
              : '—'
        }
        status={windStatus}
      />
      <WeatherCard
        label="Bølger"
        value={
          loading
            ? null
            : weather?.wave_height !== undefined
              ? `${weather.wave_height.toFixed(2)} m`
              : '—'
        }
        status={waveStatus}
      />
      <WeatherCard label="Havstrøm" value="0,3 kn" status="good" hint="estimat" />
      <WeatherCard
        label="Vandtemp"
        value={
          loading
            ? null
            : weather?.water_temp !== undefined
              ? `${weather.water_temp.toFixed(1)}°C`
              : '—'
        }
        status={tempStatus}
      />
    </div>
  )
}

function WeatherCard({
  label, value, status, hint,
}: {
  label: string
  value: string | null
  status: 'good' | 'ok' | 'bad' | 'neutral'
  hint?: string
}) {
  const color =
    status === 'good'
      ? 'text-[#1A5A8A]'
      : status === 'ok'
        ? 'text-[#B5811C]'
        : status === 'bad'
          ? 'text-[#B33C2A]'
          : 'text-[#8A8A82]'
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-[#8A8A82]">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-light tabular-nums ${color}`}>
        {value ?? <Skeleton className="h-7 w-20 inline-block" />}
      </div>
      {hint && <div className="mt-1 text-[11px] text-[#8A8A82]">{hint}</div>}
    </Card>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────
function Card({
  children, className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white border border-[#E0DDD6] rounded-xl ${className}`}>
      {children}
    </div>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-[#EFECE7] rounded animate-pulse ${className}`} />
}
