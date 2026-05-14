import type { TideEvent } from '@/types'

const DMI_BASE =
  'https://dmigw.govcloud.dk/v2/oceanObs/collections/observation/items'
// Esbjerg Havn I — the actively-reporting tide gauge that publishes sea_reg.
// (The user-provided 5904010 does not exist in DMI's station registry.)
const ESBJERG_STATION = '25149'
const PARAMETER = 'sea_reg'

type DmiPeriod = 'latest-hour' | 'latest-day' | 'latest-week'

type DmiFeature = {
  properties: {
    observed: string
    value: number
  }
}

type DmiResponse = {
  features?: DmiFeature[]
}

async function fetchSeaReg(
  period: DmiPeriod,
  limit: number,
): Promise<DmiFeature[]> {
  const url = new URL(DMI_BASE)
  url.searchParams.set('stationId', ESBJERG_STATION)
  url.searchParams.set('parameterId', PARAMETER)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('period', period)

  const apiKey = process.env.DMI_API_KEY
  if (apiKey) url.searchParams.set('api-key', apiKey)

  const res = await fetch(url.toString(), {
    next: { revalidate: 1800 },
  })
  if (!res.ok) {
    throw new Error(`DMI oceanObs ${res.status}: ${res.statusText}`)
  }
  const json = (await res.json()) as DmiResponse
  return json.features ?? []
}

export async function fetchTideEvents(days: number = 2): Promise<TideEvent[]> {
  try {
    const period: DmiPeriod = days <= 1 ? 'latest-day' : 'latest-week'
    const features = await fetchSeaReg(period, 500)
    if (features.length === 0) return []

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const obs = features
      .map((f) => ({
        time: f.properties.observed,
        height: f.properties.value / 100,
      }))
      .filter((o) => Date.parse(o.time) >= cutoff)
      .sort((a, b) => a.time.localeCompare(b.time))

    if (obs.length < 11) return []

    const window = 5
    const events: TideEvent[] = []
    for (let i = window; i < obs.length - window; i++) {
      const center = obs[i].height
      let isHigh = true
      let isLow = true
      for (let j = i - window; j <= i + window; j++) {
        if (j === i) continue
        if (obs[j].height > center) isHigh = false
        if (obs[j].height < center) isLow = false
        if (!isHigh && !isLow) break
      }
      if (isHigh) {
        events.push({ time: obs[i].time, height: center, type: 'high' })
      } else if (isLow) {
        events.push({ time: obs[i].time, height: center, type: 'low' })
      }
    }

    return collapsePlateaus(events)
  } catch (err) {
    console.error('[dmi] fetchTideEvents failed', err)
    return []
  }
}

// The window-based peak detector flags every point of a flat plateau as an
// extremum, producing runs like low/low/low at the same height. Collapse
// consecutive same-type events into the single most-extreme reading so the
// output matches the expected high/low/high/low alternation.
function collapsePlateaus(events: TideEvent[]): TideEvent[] {
  const out: TideEvent[] = []
  for (const e of events) {
    const last = out[out.length - 1]
    if (!last || last.type !== e.type) {
      out.push(e)
      continue
    }
    if (e.type === 'high' && e.height > last.height) {
      out[out.length - 1] = e
    } else if (e.type === 'low' && e.height < last.height) {
      out[out.length - 1] = e
    }
  }
  return out
}

export async function fetchCurrentWaterLevel(): Promise<
  { height: number; trend: 'rising' | 'falling' | 'stable' } | null
> {
  try {
    const features = await fetchSeaReg('latest-hour', 10)
    if (features.length < 2) return null

    const sorted = [...features].sort((a, b) =>
      b.properties.observed.localeCompare(a.properties.observed),
    )
    const newest = sorted[0].properties.value / 100
    const previous = sorted[1].properties.value / 100
    const delta = newest - previous
    const trend: 'rising' | 'falling' | 'stable' =
      Math.abs(delta) < 0.005 ? 'stable' : delta > 0 ? 'rising' : 'falling'

    return { height: newest, trend }
  } catch (err) {
    console.error('[dmi] fetchCurrentWaterLevel failed', err)
    return null
  }
}
