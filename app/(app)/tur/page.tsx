'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createClient } from '@/utils/supabase/client'
import type {
  Catch,
  FishabilityScore,
  Spot,
  Trip,
  WeatherSnapshot,
} from '@/types'

type LocalUser = { id: string; name: string }
type Mode = 'idle' | 'active' | 'stopped'

const BAITS = [
  'Tobis (hel)',
  'Tobis (halv)',
  'Sildestrimmel',
  'Hornfiskestrimmel',
  'Fladfisk bugstykke',
  'GULP Tobis',
  'Blink',
  'Pirk',
  'Andet',
] as const

const STATUS_DOT: Record<'good' | 'ok' | 'bad' | 'neutral', string> = {
  good: 'bg-[#1A5A8A]',
  ok: 'bg-[#B5811C]',
  bad: 'bg-[#B33C2A]',
  neutral: 'bg-[#8A8A82]',
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

function fmtHM(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('da-DK', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

type GeoPoint = { lat: number; lng: number }

export default function TurPage() {
  const [user, setUser] = useState<LocalUser | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [selectedSpotId, setSelectedSpotId] = useState<string>('')
  const [fishability, setFishability] = useState<FishabilityScore | null>(null)

  const [mode, setMode] = useState<Mode>('idle')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [catches, setCatches] = useState<Catch[]>([])
  const [distance, setDistance] = useState(0)
  const [position, setPosition] = useState<GeoPoint | null>(null)
  const lastPosRef = useRef<GeoPoint | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const [now, setNow] = useState(() => new Date())
  const [showCatchForm, setShowCatchForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Catch form fields
  const [cSpecies, setCSpecies] = useState('Pighvar')
  const [cLength, setCLength] = useState('')
  const [cWeight, setCWeight] = useState('')
  const [cBait, setCBait] = useState<(typeof BAITS)[number]>('Tobis (hel)')

  useEffect(() => {
    const stored = localStorage.getItem('pighvar_user')
    if (stored) {
      try {
        setUser(JSON.parse(stored) as LocalUser)
      } catch {
        // layout handles malformed user
      }
    }
  }, [])

  // Initial load: spots + fishability + resume any open trip
  useEffect(() => {
    if (!user) return
    const supabase = createClient()
    Promise.all([
      supabase
        .from('spots')
        .select('*')
        .order('sort_order', { ascending: true }),
      fetch('/api/fishability')
        .then((r) => (r.ok ? (r.json() as Promise<FishabilityScore>) : null))
        .catch(() => null),
      supabase
        .from('trips')
        .select('*')
        .eq('user_id', user.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(async ([spotsRes, fishRes, openTripRes]) => {
      if (!spotsRes.error) {
        const list = (spotsRes.data ?? []) as Spot[]
        setSpots(list)
        if (list.length > 0) setSelectedSpotId(list[0].id)
      }
      if (fishRes) setFishability(fishRes)
      if (!openTripRes.error && openTripRes.data) {
        const open = openTripRes.data as Trip
        setTrip(open)
        setMode('active')
        // Re-fetch catches for this trip
        const cRes = await supabase
          .from('catches')
          .select('*')
          .eq('trip_id', open.id)
          .order('caught_at', { ascending: true })
        if (!cRes.error) setCatches((cRes.data ?? []) as Catch[])
        if (open.distance_m) setDistance(open.distance_m)
        if (open.spot_id) setSelectedSpotId(open.spot_id)
      }
    })
  }, [user])

  // Timer tick while active
  useEffect(() => {
    if (mode !== 'active') return
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [mode])

  // GPS watch while active
  useEffect(() => {
    if (mode !== 'active') return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next: GeoPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }
        setPosition(next)
        const prev = lastPosRef.current
        if (prev) {
          const delta = haversineMeters(prev, next)
          if (delta > 5 && delta < 100) {
            setDistance((d) => d + delta)
          }
        }
        lastPosRef.current = next
      },
      (err) => console.warn('[tur] geolocation error', err),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    )
    watchIdRef.current = id

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      lastPosRef.current = null
    }
  }, [mode])

  async function handleStart() {
    if (!user || !selectedSpotId) return
    setBusy(true)
    setError(null)
    const supabase = createClient()

    // Compose weather snapshot from /api/weather + /api/tide
    let snapshot: WeatherSnapshot | null = null
    try {
      const [w, t] = await Promise.all([
        fetch('/api/weather').then((r) => (r.ok ? r.json() : {})),
        fetch('/api/tide').then((r) => (r.ok ? r.json() : {})),
      ])
      const weather: Partial<WeatherSnapshot> = w
      const tide = t as {
        current?: { height: number; trend: 'rising' | 'falling' | 'stable' }
      }
      snapshot = {
        wind_speed: weather.wind_speed ?? 0,
        wind_dir: weather.wind_dir ?? '',
        wave_height: weather.wave_height ?? 0,
        water_temp: weather.water_temp ?? 0,
        tide_state: tide.current?.trend ?? '',
        tide_height: tide.current?.height ?? 0,
        sources: weather.sources ?? [],
      }
    } catch (err) {
      console.warn('[tur] could not capture weather snapshot', err)
    }

    const { data, error: insertErr } = await supabase
      .from('trips')
      .insert({
        user_id: user.id,
        spot_id: selectedSpotId,
        weather_snapshot: snapshot,
      })
      .select()
      .single()

    setBusy(false)
    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Kunne ikke starte tur')
      return
    }
    setTrip(data as Trip)
    setCatches([])
    setDistance(0)
    setNow(new Date())
    setMode('active')
  }

  async function handleStop() {
    if (!trip) return
    setBusy(true)
    const supabase = createClient()
    const distMeters = Math.round(distance)
    const { error: upErr } = await supabase
      .from('trips')
      .update({
        ended_at: new Date().toISOString(),
        distance_m: distMeters,
      })
      .eq('id', trip.id)
    setBusy(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    setTrip({
      ...trip,
      ended_at: new Date().toISOString(),
      distance_m: distMeters,
    })
    setMode('stopped')
  }

  function handleReset() {
    setMode('idle')
    setTrip(null)
    setCatches([])
    setDistance(0)
    setPosition(null)
    lastPosRef.current = null
    setShowCatchForm(false)
    setError(null)
  }

  async function handleSaveCatch(e: FormEvent) {
    e.preventDefault()
    if (!user || !trip) return
    const length = cLength.trim() ? Number(cLength) : null
    const weight = cWeight.trim() ? Number(cWeight) : null
    if (length !== null && Number.isNaN(length)) return
    if (weight !== null && Number.isNaN(weight)) return

    setBusy(true)
    const supabase = createClient()
    const { data, error: insertErr } = await supabase
      .from('catches')
      .insert({
        trip_id: trip.id,
        user_id: user.id,
        species: cSpecies.trim() || 'Pighvar',
        length_cm: length,
        weight_g: weight,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        bait: cBait,
        caught_at: new Date().toISOString(),
      })
      .select()
      .single()
    setBusy(false)
    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Kunne ikke gemme fangst')
      return
    }
    setCatches((prev) => [...prev, data as Catch])
    setCLength('')
    setCWeight('')
    setCSpecies('Pighvar')
    setShowCatchForm(false)
  }

  const selectedSpot = useMemo(
    () => spots.find((s) => s.id === selectedSpotId) ?? null,
    [spots, selectedSpotId],
  )

  const elapsedSec = useMemo(() => {
    if (!trip) return 0
    const end =
      mode === 'stopped' && trip.ended_at
        ? Date.parse(trip.ended_at)
        : now.getTime()
    return Math.floor((end - Date.parse(trip.started_at)) / 1000)
  }, [trip, now, mode])

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-semibold text-[#1A1A18]">Tur-tracker</h1>
        <p className="text-sm text-[#8A8A82] mt-1">
          GPS · vejr · tidevand logges automatisk
        </p>
      </div>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {mode === 'idle' && (
        <IdleView
          spots={spots}
          selectedSpotId={selectedSpotId}
          onSelect={setSelectedSpotId}
          fishability={fishability}
          onStart={handleStart}
          busy={busy}
        />
      )}

      {mode === 'active' && trip && (
        <ActiveView
          trip={trip}
          spot={selectedSpot}
          elapsedSec={elapsedSec}
          distanceM={distance}
          catches={catches}
          userName={user?.name ?? ''}
          showCatchForm={showCatchForm}
          onOpenCatchForm={() => setShowCatchForm(true)}
          onCancelCatchForm={() => setShowCatchForm(false)}
          onStop={handleStop}
          busy={busy}
          formProps={{
            species: cSpecies,
            setSpecies: setCSpecies,
            length: cLength,
            setLength: setCLength,
            weight: cWeight,
            setWeight: setCWeight,
            bait: cBait,
            setBait: setCBait,
            onSubmit: handleSaveCatch,
          }}
        />
      )}

      {mode === 'stopped' && trip && (
        <StoppedView
          trip={trip}
          spot={selectedSpot}
          elapsedSec={elapsedSec}
          distanceM={trip.distance_m ?? 0}
          catches={catches}
          userName={user?.name ?? ''}
          onReset={handleReset}
        />
      )}
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

function IdleView({
  spots,
  selectedSpotId,
  onSelect,
  fishability,
  onStart,
  busy,
}: {
  spots: Spot[]
  selectedSpotId: string
  onSelect: (id: string) => void
  fishability: FishabilityScore | null
  onStart: () => void
  busy: boolean
}) {
  return (
    <>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44] mb-4">
          Klargør tur
        </h2>
        <label className="text-sm text-[#4A4A44] block mb-2">Spot</label>
        <select
          value={selectedSpotId}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full border border-[#E0DDD6] rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1A1A18]"
        >
          {spots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={onStart}
          disabled={busy || !selectedSpotId}
          className="mt-5 w-full bg-[#1A1A18] text-white py-3 rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50 transition-colors"
        >
          {busy ? 'Starter...' : 'Start fiskeri'}
        </button>
      </Card>

      {fishability && (
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wide text-[#8A8A82] mb-2">
            Forhold lige nu
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className={`text-3xl font-light tabular-nums ${
                fishability.score >= 7
                  ? 'text-[#1A5A8A]'
                  : fishability.score >= 4
                    ? 'text-[#B5811C]'
                    : 'text-[#B33C2A]'
              }`}
            >
              {fishability.score}/10
            </span>
            <span className="text-sm text-[#1A1A18]">
              {fishability.verdict}
            </span>
          </div>
          <ul className="mt-3 space-y-1">
            {fishability.factors.slice(0, 5).map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[f.status]}`}
                />
                <span className="text-[#4A4A44]">{f.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function ActiveView({
  trip,
  spot,
  elapsedSec,
  distanceM,
  catches,
  userName,
  showCatchForm,
  onOpenCatchForm,
  onCancelCatchForm,
  onStop,
  busy,
  formProps,
}: {
  trip: Trip
  spot: Spot | null
  elapsedSec: number
  distanceM: number
  catches: Catch[]
  userName: string
  showCatchForm: boolean
  onOpenCatchForm: () => void
  onCancelCatchForm: () => void
  onStop: () => void
  busy: boolean
  formProps: {
    species: string
    setSpecies: (v: string) => void
    length: string
    setLength: (v: string) => void
    weight: string
    setWeight: (v: string) => void
    bait: (typeof BAITS)[number]
    setBait: (v: (typeof BAITS)[number]) => void
    onSubmit: (e: FormEvent) => void
  }
}) {
  return (
    <>
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="relative flex w-3 h-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1F8A4C] opacity-60" />
            <span className="relative inline-flex w-3 h-3 rounded-full bg-[#1F8A4C]" />
          </span>
          <div className="flex-1">
            <div className="text-base font-medium text-[#1A1A18]">
              {spot?.name ?? '—'}
            </div>
            <div className="text-xs text-[#8A8A82]">
              Startet {fmtHM(trip.started_at)}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4 text-center">
          <Stat label="Tid" value={fmtDuration(elapsedSec)} />
          <Stat label="Afstand" value={`${(distanceM / 1000).toFixed(2)} km`} />
          <Stat label="Fangster" value={String(catches.length)} />
        </div>

        <div className="mt-5 flex gap-2">
          {!showCatchForm && (
            <button
              onClick={onOpenCatchForm}
              className="flex-1 bg-[#1A1A18] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors"
            >
              Log fangst
            </button>
          )}
          <button
            onClick={onStop}
            disabled={busy}
            className="flex-1 border-2 border-[#B33C2A] text-[#B33C2A] py-2.5 rounded-lg text-sm font-medium hover:bg-[#F4E0DC] disabled:opacity-50 transition-colors"
          >
            {busy ? 'Stopper...' : 'Stop tur'}
          </button>
        </div>

        {showCatchForm && (
          <form
            onSubmit={formProps.onSubmit}
            className="mt-5 pt-5 border-t border-[#EFECE7] space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-[#4A4A44] block mb-1">Art</span>
                <input
                  type="text"
                  value={formProps.species}
                  onChange={(e) => formProps.setSpecies(e.target.value)}
                  className="w-full border border-[#E0DDD6] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#1A1A18]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[#4A4A44] block mb-1">Agn</span>
                <select
                  value={formProps.bait}
                  onChange={(e) =>
                    formProps.setBait(
                      e.target.value as (typeof BAITS)[number],
                    )
                  }
                  className="w-full border border-[#E0DDD6] rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-[#1A1A18]"
                >
                  {BAITS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[#4A4A44] block mb-1">
                  Længde (cm)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={formProps.length}
                  onChange={(e) => formProps.setLength(e.target.value)}
                  className="w-full border border-[#E0DDD6] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#1A1A18]"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[#4A4A44] block mb-1">
                  Vægt (gram)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={formProps.weight}
                  onChange={(e) => formProps.setWeight(e.target.value)}
                  className="w-full border border-[#E0DDD6] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#1A1A18]"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelCatchForm}
                className="flex-1 border border-[#E0DDD6] text-[#4A4A44] py-2 rounded text-sm hover:bg-[#F7F6F3] transition-colors"
              >
                Annuller
              </button>
              <button
                type="submit"
                className="flex-1 bg-[#1A1A18] text-white py-2 rounded text-sm font-medium hover:bg-black transition-colors"
              >
                Gem fangst
              </button>
            </div>
          </form>
        )}
      </Card>

      {catches.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44] mb-3">
            Fangster denne tur
          </h2>
          <ul>
            {catches.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-3 py-2 border-t border-[#EFECE7] first:border-t-0 text-sm"
              >
                <span className="text-xs text-[#8A8A82] tabular-nums w-5 text-right">
                  {i + 1}
                </span>
                <span className="font-medium text-[#1A1A18]">{c.species}</span>
                <span className="text-[#4A4A44] tabular-nums">
                  {c.length_cm ? `${c.length_cm} cm` : '—'}
                  {c.weight_g ? ` · ${c.weight_g} g` : ''}
                </span>
                <span className="text-xs text-[#8A8A82]">{c.bait}</span>
                <span className="ml-auto text-xs text-[#8A8A82] tabular-nums">
                  {fmtHM(c.caught_at)} · {userName}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function StoppedView({
  trip,
  spot,
  elapsedSec,
  distanceM,
  catches,
  userName,
  onReset,
}: {
  trip: Trip
  spot: Spot | null
  elapsedSec: number
  distanceM: number
  catches: Catch[]
  userName: string
  onReset: () => void
}) {
  return (
    <>
      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44] mb-2">
          Tur afsluttet
        </h2>
        <div className="text-lg font-medium text-[#1A1A18]">
          {spot?.name ?? '—'}
        </div>
        <div className="text-xs text-[#8A8A82] mb-5">
          {fmtHM(trip.started_at)} – {trip.ended_at ? fmtHM(trip.ended_at) : '—'}
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <Stat label="Varighed" value={fmtDuration(elapsedSec)} />
          <Stat
            label="Afstand"
            value={`${(distanceM / 1000).toFixed(2)} km`}
          />
          <Stat label="Fangster" value={String(catches.length)} />
        </div>

        <button
          onClick={onReset}
          className="mt-6 w-full bg-[#1A1A18] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-black transition-colors"
        >
          Ny tur
        </button>
      </Card>

      {catches.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[#4A4A44] mb-3">
            Fangster
          </h2>
          <ul>
            {catches.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-3 py-2 border-t border-[#EFECE7] first:border-t-0 text-sm"
              >
                <span className="text-xs text-[#8A8A82] tabular-nums w-5 text-right">
                  {i + 1}
                </span>
                <span className="font-medium text-[#1A1A18]">{c.species}</span>
                <span className="text-[#4A4A44] tabular-nums">
                  {c.length_cm ? `${c.length_cm} cm` : '—'}
                  {c.weight_g ? ` · ${c.weight_g} g` : ''}
                </span>
                <span className="text-xs text-[#8A8A82]">{c.bait}</span>
                <span className="ml-auto text-xs text-[#8A8A82] tabular-nums">
                  {fmtHM(c.caught_at)} · {userName}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[#8A8A82]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-light text-[#1A1A18] tabular-nums">
        {value}
      </div>
    </div>
  )
}
