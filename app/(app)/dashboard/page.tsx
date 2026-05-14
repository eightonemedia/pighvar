'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type {
  Factor,
  FishabilityScore,
  Spot,
  TideEvent,
  WeatherSnapshot,
} from '@/types'

type CurrentTide = {
  height: number
  trend: 'rising' | 'falling' | 'stable'
} | null

type TideResp = { events?: TideEvent[]; current?: CurrentTide }

const DANISH_DAY_LONG = [
  'Søndag',
  'Mandag',
  'Tirsdag',
  'Onsdag',
  'Torsdag',
  'Fredag',
  'Lørdag',
]
const DANISH_DAY_SHORT = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør']
const DANISH_MONTH = [
  'januar',
  'februar',
  'marts',
  'april',
  'maj',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'december',
]

function fmtFullDate(d: Date): string {
  return `${DANISH_DAY_LONG[d.getDay()]} ${d.getDate()}. ${DANISH_MONTH[d.getMonth()]} ${d.getFullYear()}`
}

function fmtHM(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('da-DK', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000)
}

const OFFSHORE_STRONG = new Set(['Ø', 'NØ', 'SØ', 'ØSØ', 'ØNØ'])
const ONSHORE = new Set(['V', 'NV', 'SV', 'VSV', 'VNV', 'NNV', 'SSV'])

type Status = 'good' | 'ok' | 'bad' | 'neutral'

function statusForWind(speed: number | undefined, dir: string | undefined): Status {
  if (!dir && speed === undefined) return 'neutral'
  if (dir && OFFSHORE_STRONG.has(dir)) return 'good'
  if (dir && ONSHORE.has(dir)) return 'bad'
  return 'ok'
}

function statusForWave(h: number | undefined): Status {
  if (h === undefined) return 'neutral'
  if (h < 0.5) return 'good'
  if (h <= 1.2) return 'ok'
  return 'bad'
}

function statusForTemp(t: number | undefined): Status {
  if (t === undefined) return 'neutral'
  if (t > 10) return 'good'
  if (t >= 8) return 'ok'
  return 'bad'
}

const STATUS_TEXT: Record<Status, string> = {
  good: 'text-[#1A5A8A]',
  ok: 'text-[#B5811C]',
  bad: 'text-[#B33C2A]',
  neutral: 'text-[#8A8A82]',
}

const STATUS_DOT: Record<Status, string> = {
  good: 'bg-[#1A5A8A]',
  ok: 'bg-[#B5811C]',
  bad: 'bg-[#B33C2A]',
  neutral: 'bg-[#8A8A82]',
}

const STATUS_TAG: Record<Status, string> = {
  good: 'bg-[#E7EEF4] text-[#1A5A8A]',
  ok: 'bg-[#F5ECD9] text-[#B5811C]',
  bad: 'bg-[#F4E0DC] text-[#B33C2A]',
  neutral: 'bg-[#EFECE7] text-[#4A4A44]',
}

function scoreColor(score: number): string {
  if (score >= 7) return 'text-[#1A5A8A]'
  if (score >= 4) return 'text-[#B5811C]'
  return 'text-[#B33C2A]'
}

function scoreBarColor(score: number): string {
  if (score >= 7) return 'bg-[#1A5A8A]'
  if (score >= 4) return 'bg-[#B5811C]'
  return 'bg-[#B33C2A]'
}

function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  return Math.floor((date.getTime() - start) / 86400000)
}

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
    let L =
      M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634
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
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        Math.floor(UT),
        Math.floor((UT % 1) * 60),
        0,
      ),
    )
  }

  return { sunrise: compute(true), sunset: compute(false) }
}

function moonPhase(date: Date): { name: string; illum: number; emoji: string } {
  const SYNODIC = 29.53058867
  const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0)
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000
  const phase = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC
  const illum = Math.round((0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)) * 100)
  const buckets: { p: number; name: string; emoji: string }[] = [
    { p: 0.0625, name: 'Nymåne', emoji: '🌑' },
    { p: 0.1875, name: 'Tiltagende segl', emoji: '🌒' },
    { p: 0.3125, name: 'Første kvarter', emoji: '🌓' },
    { p: 0.4375, name: 'Tiltagende næsten fuld', emoji: '🌔' },
    { p: 0.5625, name: 'Fuldmåne', emoji: '🌕' },
    { p: 0.6875, name: 'Aftagende næsten fuld', emoji: '🌖' },
    { p: 0.8125, name: 'Sidste kvarter', emoji: '🌗' },
    { p: 0.9375, name: 'Aftagende segl', emoji: '🌘' },
  ]
  for (const b of buckets) {
    if (phase < b.p) return { name: b.name, illum, emoji: b.emoji }
  }
  return { name: 'Nymåne', illum, emoji: '🌑' }
}

const SUN_LAT = 55.69
const SUN_LNG = 8.16

// Per-day fishability scores for the next 7 days (today + 6).
// Real forecast wiring lands when a multi-day weather endpoint exists.
const WEEK_FORECAST: { score: number; wind: string; speed: number }[] = [
  { score: 8, wind: 'Ø', speed: 4 },
  { score: 9, wind: 'NØ', speed: 5 },
  { score: 5, wind: 'V', speed: 4 },
  { score: 3, wind: 'V', speed: 7 },
  { score: 6, wind: 'SV', speed: 4 },
  { score: 8, wind: 'Ø', speed: 3 },
  { score: 9, wind: 'NØ', speed: 4 },
]

const SPOT_SCORES: Record<string, number> = {
  Blåvand: 7,
  Grærup: 7,
  Henne: 6,
  Børsmose: 7,
  Vejers: 7,
  Houstrup: 8,
  Nymindegab: 9,
  Lyngvig: 6,
  Søndervig: 7,
}

export default function DashboardPage() {
  const [now, setNow] = useState<Date>(() => new Date())
  const [fishability, setFishability] = useState<FishabilityScore | null>(null)
  const [tide, setTide] = useState<TideResp | null>(null)
  const [weather, setWeather] = useState<Partial<WeatherSnapshot> | null>(null)
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
      fetch('/api/weather').then(
        (r) => r.json() as Promise<Partial<WeatherSnapshot>>,
      ),
      supabase
        .from('spots')
        .select('*')
        .order('sort_order', { ascending: true }),
    ])
      .then(([f, t, w, spotsRes]) => {
        setFishability(f)
        setTide(t)
        setWeather(w)
        if (!spotsRes.error) setSpots((spotsRes.data ?? []) as Spot[])
      })
      .catch((err) => console.error('[dashboard] fetch failed', err))
      .finally(() => setLoading(false))
  }, [])

  const sun = useMemo(() => sunriseSunsetUTC(SUN_LAT, SUN_LNG, now), [now])
  const moon = useMemo(() => moonPhase(now), [now])

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <Header now={now} />
      <FishabilityCard data={fishability} loading={loading} />
      <WeekStrip now={now} tideEvents={tide?.events ?? []} loading={loading} />
      <SunRow sunrise={sun.sunrise} sunset={sun.sunset} moon={moon} />
      <WeatherRow weather={weather} loading={loading} />
      <TideSection tide={tide} loading={loading} now={now} />
      <BestSpotCard weather={weather} fishability={fishability} />
      <SpotsGrid spots={spots} loading={loading} />
    </div>
  )
}

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

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-white border border-[#E0DDD6] rounded-xl ${className}`}
    >
      {children}
    </div>
  )
}

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-[#EFECE7] rounded animate-pulse ${className}`} />
}

function FishabilityCard({
  data,
  loading,
}: {
  data: FishabilityScore | null
  loading: boolean
}) {
  if (loading || !data) {
    return (
      <Card className="p-6">
        <div className="flex gap-6 items-start">
          <Skeleton className="h-20 w-28" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </Card>
    )
  }
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44]">
          Fiskbarhedsindeks
        </h2>
        <div className="flex gap-1 items-center text-xs text-[#8A8A82]">
          <ConfidenceDots value={data.confidence} />
          <span>
            {Math.round(data.confidence * 100)}% sikker
          </span>
        </div>
      </div>
      <div className="flex items-baseline gap-4 mt-2">
        <div
          className={`text-7xl font-light leading-none tabular-nums ${scoreColor(data.score)}`}
        >
          {data.score}
        </div>
        <div className="text-base font-medium text-[#1A1A18]">
          {data.verdict}
        </div>
      </div>
      <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {data.factors.map((f, i) => (
          <FactorRow key={i} factor={f} />
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {data.sources.map((s) => (
          <span
            key={s}
            className="px-2 py-0.5 text-xs bg-[#EFECE7] text-[#4A4A44] rounded-full"
          >
            {s}
          </span>
        ))}
      </div>
    </Card>
  )
}

function FactorRow({ factor }: { factor: Factor }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[factor.status]}`}
      />
      <span className="text-[#1A1A18]">{factor.label}</span>
    </li>
  )
}

function ConfidenceDots({ value }: { value: number }) {
  const filled = Math.round(value * 5)
  return (
    <div className="flex gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i < filled ? 'bg-[#1A5A8A]' : 'bg-[#E0DDD6]'
          }`}
        />
      ))}
    </div>
  )
}

function WeekStrip({
  now,
  tideEvents,
  loading,
}: {
  now: Date
  tideEvents: TideEvent[]
  loading: boolean
}) {
  const days = useMemo(() => {
    const base = new Date(now)
    base.setHours(0, 0, 0, 0)
    return WEEK_FORECAST.map((forecast, idx) => {
      const date = new Date(base)
      date.setDate(date.getDate() + idx)
      const nextDay = new Date(date)
      nextDay.setDate(nextDay.getDate() + 1)
      const high = tideEvents.find(
        (e) =>
          e.type === 'high' &&
          Date.parse(e.time) >= date.getTime() &&
          Date.parse(e.time) < nextDay.getTime(),
      )
      return {
        date,
        score: forecast.score,
        wind: forecast.wind,
        speed: forecast.speed,
        high,
        isToday: idx === 0,
      }
    })
  }, [now, tideEvents])

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44] mb-4">
        Ugeoversigt
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {days.map((d, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${
              d.isToday
                ? 'border-2 border-[#1A5A8A] bg-[#F4F8FB]'
                : 'border border-[#E0DDD6]'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-[#1A1A18]">
                {d.isToday ? 'I dag' : DANISH_DAY_SHORT[d.date.getDay()]}
              </span>
              <span className="text-[10px] text-[#8A8A82] tabular-nums">
                {d.date.getDate()}/{d.date.getMonth() + 1}
              </span>
            </div>
            <div
              className={`mt-2 text-3xl font-light tabular-nums ${scoreColor(d.score)}`}
            >
              {d.score}
            </div>
            <div className="mt-2 h-1 bg-[#EFECE7] rounded overflow-hidden">
              <div
                className={`h-full ${scoreBarColor(d.score)}`}
                style={{ width: `${d.score * 10}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-[#4A4A44] tabular-nums">
              {d.wind} · {d.speed} m/s
            </div>
            <div className="text-[11px] text-[#8A8A82] tabular-nums">
              HV {loading ? '—' : d.high ? fmtHM(d.high.time) : '—'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SunRow({
  sunrise,
  sunset,
  moon,
}: {
  sunrise: Date | null
  sunset: Date | null
  moon: { name: string; illum: number; emoji: string }
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <SunCard
        label="Solopgang"
        time={sunrise}
        window="±1 t. gylden time"
      />
      <SunCard label="Solnedgang" time={sunset} window="±1 t. gylden time" />
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wide text-[#8A8A82]">
          Månefase
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-3xl">{moon.emoji}</span>
          <div>
            <div className="text-lg text-[#1A1A18]">{moon.name}</div>
            <div className="text-xs text-[#8A8A82]">
              {moon.illum}% oplyst
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function SunCard({
  label,
  time,
  window,
}: {
  label: string
  time: Date | null
  window: string
}) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-[#8A8A82]">
        {label}
      </div>
      <div className="mt-2 text-3xl font-light text-[#1A1A18] tabular-nums">
        {time ? fmtHM(time) : '—'}
      </div>
      {time && (
        <div className="mt-1 text-xs text-[#8A8A82] tabular-nums">
          Vindue {fmtHM(addMinutes(time, -60))} – {fmtHM(addMinutes(time, 60))}
        </div>
      )}
      <div className="mt-2 text-[11px] text-[#8A8A82]">{window}</div>
    </Card>
  )
}

function WeatherRow({
  weather,
  loading,
}: {
  weather: Partial<WeatherSnapshot> | null
  loading: boolean
}) {
  const windStatus = statusForWind(weather?.wind_speed, weather?.wind_dir)
  const waveStatus = statusForWave(weather?.wave_height)
  const tempStatus = statusForTemp(weather?.water_temp)

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
      <WeatherCard
        label="Havstrøm"
        value="0,3 kn"
        status="good"
        hint="estimat"
      />
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
  label,
  value,
  status,
  hint,
}: {
  label: string
  value: string | null
  status: Status
  hint?: string
}) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-[#8A8A82]">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-light tabular-nums ${STATUS_TEXT[status]}`}
      >
        {value ?? <Skeleton className="h-7 w-20 inline-block" />}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-[#8A8A82]">{hint}</div>
      )}
    </Card>
  )
}

function TideSection({
  tide,
  loading,
  now,
}: {
  tide: TideResp | null
  loading: boolean
  now: Date
}) {
  // DMI oceanObs gives observations (past), not a forecast. Show every event
  // we have in chronological order and mark already-passed rows visually so
  // the table doesn't claim "no data" when 8 historical events are loaded.
  const events = useMemo(() => {
    if (!tide?.events) return []
    return [...tide.events].sort((a, b) => a.time.localeCompare(b.time))
  }, [tide])

  const trendArrow =
    tide?.current?.trend === 'rising'
      ? '↑'
      : tide?.current?.trend === 'falling'
        ? '↓'
        : '→'
  const trendText =
    tide?.current?.trend === 'rising'
      ? 'stigende'
      : tide?.current?.trend === 'falling'
        ? 'faldende'
        : 'stabilt'

  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44]">
          Tidevand · Esbjerg Havn
        </h2>
        {tide?.current && (
          <div className="text-sm text-[#1A1A18] tabular-nums">
            <span className="font-medium">
              {tide.current.height.toFixed(2)} m
            </span>
            <span className="text-[#8A8A82] ml-2">
              {trendArrow} {trendText}
            </span>
          </div>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-[#8A8A82]">
          Ingen tidevandsdata tilgængelig.
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[#8A8A82] text-xs uppercase tracking-wide">
                <th className="text-left font-medium py-2">Dag</th>
                <th className="text-left font-medium py-2">Tidspunkt</th>
                <th className="text-right font-medium py-2">Vandstand</th>
                <th className="text-left font-medium py-2 pl-4">Type</th>
                <th className="text-left font-medium py-2">Fiskevindue</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const t = new Date(e.time)
                const isHigh = e.type === 'high'
                const isPast = t.getTime() < now.getTime()
                return (
                  <tr
                    key={e.time}
                    className={`border-t border-[#EFECE7] ${
                      isHigh ? 'bg-[#F4F8FB]' : ''
                    } ${isPast ? 'opacity-50' : ''}`}
                  >
                    <td className="py-2 text-[#4A4A44]">
                      {DANISH_DAY_SHORT[t.getDay()]} {t.getDate()}/
                      {t.getMonth() + 1}
                    </td>
                    <td className="py-2 text-[#1A1A18] tabular-nums">
                      {fmtHM(t)}
                    </td>
                    <td className="py-2 text-right text-[#1A1A18] tabular-nums">
                      {e.height >= 0 ? '+' : ''}
                      {e.height.toFixed(2)} m
                    </td>
                    <td
                      className={`py-2 pl-4 ${
                        isHigh
                          ? 'text-[#1A5A8A] font-medium'
                          : 'text-[#8A8A82]'
                      }`}
                    >
                      {isHigh ? 'Højvande' : 'Lavvande'}
                    </td>
                    <td className="py-2 text-xs text-[#8A8A82] tabular-nums">
                      {isHigh
                        ? `${fmtHM(addMinutes(t, -120))} – ${fmtHM(addMinutes(t, 60))}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-[#8A8A82] mt-3">
            Kilde: DMI oceanObs · observationer fra Esbjerg Havn I. Prognose
            kommer senere — dæmpede rækker er allerede passeret.
          </p>
        </>
      )}
    </Card>
  )
}

function BestSpotCard({
  weather,
  fishability,
}: {
  weather: Partial<WeatherSnapshot> | null
  fishability: FishabilityScore | null
}) {
  const windStatus = statusForWind(weather?.wind_speed, weather?.wind_dir)
  const waveStatus = statusForWave(weather?.wave_height)
  const tempStatus = statusForTemp(weather?.water_temp)
  const score = fishability?.score ?? 0

  const config =
    score >= 7
      ? {
          border: 'border-[#1F8A4C] border-2',
          headline: 'Bedste spot: Nymindegab',
          subtitle: 'Fjordudløb · kraftig strøm',
        }
      : score >= 4
        ? {
            border: 'border-[#B5811C] border-2',
            headline: 'Acceptabelt — vælg med omhu',
            subtitle: 'Tjek vinden mod den specifikke spot',
          }
        : {
            border: 'border-[#B33C2A] border-2',
            headline: 'Dårlige forhold — overvej at vente',
            subtitle: 'Indeks er kritisk lavt lige nu',
          }

  return (
    <Card className={`p-6 ${config.border}`}>
      <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44]">
        Vi smutter ud nu
      </h2>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-xl font-semibold text-[#1A1A18]">
          {config.headline}
        </span>
        <span className="text-sm text-[#8A8A82]">{config.subtitle}</span>
        <span
          className={`ml-auto text-3xl font-light tabular-nums ${scoreColor(score)}`}
        >
          {fishability ? score : '—'}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {weather?.wind_dir && (
          <span
            className={`px-2.5 py-1 text-xs rounded-full ${STATUS_TAG[windStatus]}`}
          >
            Vind {weather.wind_dir} {weather.wind_speed?.toFixed(1)} m/s
          </span>
        )}
        {weather?.wave_height !== undefined && (
          <span
            className={`px-2.5 py-1 text-xs rounded-full ${STATUS_TAG[waveStatus]}`}
          >
            Bølger {weather.wave_height.toFixed(2)} m
          </span>
        )}
        {weather?.water_temp !== undefined && (
          <span
            className={`px-2.5 py-1 text-xs rounded-full ${STATUS_TAG[tempStatus]}`}
          >
            Vand {weather.water_temp.toFixed(1)}°C
          </span>
        )}
        {fishability && (
          <span className="px-2.5 py-1 text-xs rounded-full bg-[#EFECE7] text-[#4A4A44]">
            Indeks {fishability.score}/10
          </span>
        )}
      </div>
    </Card>
  )
}

function SpotsGrid({
  spots,
  loading,
}: {
  spots: Spot[]
  loading: boolean
}) {
  return (
    <div>
      <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44] mb-3">
        Spots · dagsscore
      </h2>
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-3 w-full mb-3" />
              <Skeleton className="h-1.5 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {spots.map((s) => {
            const score = SPOT_SCORES[s.name] ?? 5
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-medium text-[#1A1A18]">{s.name}</h3>
                  <span
                    className={`text-2xl font-light tabular-nums ${scoreColor(score)}`}
                  >
                    {score}
                  </span>
                </div>
                <p className="text-xs text-[#8A8A82] mt-1 line-clamp-2">
                  {s.description ?? '—'}
                </p>
                <div className="mt-3 h-1 bg-[#EFECE7] rounded overflow-hidden">
                  <div
                    className={`h-full ${scoreBarColor(score)}`}
                    style={{ width: `${score * 10}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-[#8A8A82]">
                  {s.car_access
                    ? 'Bilkørsel tilladt'
                    : 'Gåafstand fra P-plads'}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
