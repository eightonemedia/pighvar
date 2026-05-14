'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { WeatherSnapshot } from '@/types'

type CatchRow = {
  id: string
  trip_id: string | null
  user_id: string | null
  species: string
  length_cm: number | null
  weight_g: number | null
  lat: number | null
  lng: number | null
  photo_url: string | null
  bait: string | null
  caught_at: string
  trips: {
    id: string
    weather_snapshot: WeatherSnapshot | null
    spots: { name: string } | null
  } | null
  users: { name: string } | null
}

const DANISH_DAY_SHORT = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør']

function fmtDate(d: string): string {
  const date = new Date(d)
  return `${DANISH_DAY_SHORT[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`
}

function fmtHM(d: string): string {
  return new Date(d).toLocaleTimeString('da-DK', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeOfDay(d: string): string {
  const h = new Date(d).getHours()
  if (h >= 4 && h < 7) return 'Morgen'
  if (h >= 7 && h < 19) return 'Dag'
  if (h >= 19 && h < 22) return 'Aften'
  return 'Nat'
}

export default function LogPage() {
  const [rows, setRows] = useState<CatchRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('catches')
      .select(
        `*,
         trips ( id, weather_snapshot, spots ( name ) ),
         users ( name )`,
      )
      .order('caught_at', { ascending: false })
      .then(({ data, error: dbErr }) => {
        if (dbErr) {
          setError(dbErr.message)
          return
        }
        setRows((data ?? []) as unknown as CatchRow[])
      })
  }, [])

  const stats = useMemo(() => {
    if (!rows || rows.length === 0) return null

    let biggest = rows[0]
    let heaviest = rows[0]
    for (const r of rows) {
      if ((r.length_cm ?? 0) > (biggest.length_cm ?? 0)) biggest = r
      if ((r.weight_g ?? 0) > (heaviest.weight_g ?? 0)) heaviest = r
    }

    const spotCounts = new Map<string, number>()
    for (const r of rows) {
      const name = r.trips?.spots?.name
      if (name) spotCounts.set(name, (spotCounts.get(name) ?? 0) + 1)
    }
    let bestSpot: { name: string; count: number } | null = null
    for (const [name, count] of spotCounts) {
      if (!bestSpot || count > bestSpot.count) bestSpot = { name, count }
    }

    return {
      total: rows.length,
      biggestLength: biggest.length_cm,
      heaviestWeight: heaviest.weight_g,
      bestSpot,
    }
  }, [rows])

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-semibold text-[#1A1A18]">Fangstlog</h1>
        <p className="text-sm text-[#8A8A82] mt-1">
          Alle registrerede fangster
        </p>
      </div>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {!error && rows === null && (
        <Card className="p-6">
          <p className="text-sm text-[#8A8A82]">Indlæser...</p>
        </Card>
      )}

      {rows !== null && rows.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-[#8A8A82]">
            Ingen fangster endnu — start en tur!
          </p>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Fangster i alt" value={String(stats.total)} />
          <StatCard
            label="Største længde"
            value={stats.biggestLength ? `${stats.biggestLength} cm` : '—'}
          />
          <StatCard
            label="Tungeste vægt"
            value={stats.heaviestWeight ? `${stats.heaviestWeight} g` : '—'}
          />
          <StatCard
            label="Bedste spot"
            value={
              stats.bestSpot
                ? `${stats.bestSpot.name} · ${stats.bestSpot.count}`
                : '—'
            }
          />
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F7F6F3] text-[#8A8A82] text-xs uppercase tracking-wide">
                <tr>
                  <Th>Dato</Th>
                  <Th>Art</Th>
                  <Th align="right">Mål</Th>
                  <Th align="right">Vægt</Th>
                  <Th>Agn</Th>
                  <Th>Spot</Th>
                  <Th>Vind</Th>
                  <Th>Tidevand</Th>
                  <Th>Sol</Th>
                  <Th>Fanget af</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const w = r.trips?.weather_snapshot
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-[#EFECE7] hover:bg-[#F7F6F3]"
                    >
                      <Td>
                        <div className="text-[#1A1A18]">{fmtDate(r.caught_at)}</div>
                        <div className="text-xs text-[#8A8A82] tabular-nums">
                          {fmtHM(r.caught_at)}
                        </div>
                      </Td>
                      <Td>
                        <span className="font-medium text-[#1A1A18]">
                          {r.species}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="tabular-nums">
                          {r.length_cm ? `${r.length_cm} cm` : '—'}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="tabular-nums">
                          {r.weight_g ? `${r.weight_g} g` : '—'}
                        </span>
                      </Td>
                      <Td>{r.bait ?? '—'}</Td>
                      <Td>{r.trips?.spots?.name ?? '—'}</Td>
                      <Td>
                        {w?.wind_dir
                          ? `${w.wind_dir} ${w.wind_speed?.toFixed?.(1) ?? '—'} m/s`
                          : '—'}
                      </Td>
                      <Td>{w?.tide_state ?? '—'}</Td>
                      <Td>{timeOfDay(r.caught_at)}</Td>
                      <Td>{r.users?.name ?? '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-[#8A8A82]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-light text-[#1A1A18] tabular-nums">
        {value}
      </div>
    </Card>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`font-medium py-2 px-3 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <td
      className={`py-2 px-3 text-[#4A4A44] ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  )
}
