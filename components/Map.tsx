'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Spot } from '@/types'

type Props = {
  spots: Spot[]
  center: [number, number]
  zoom: number
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return map[c]!
  })
}

function popupHtml(spot: Spot): string {
  const desc = spot.description
    ? `<div style="color:#4A4A44;margin-top:2px;font-size:12px;">${esc(spot.description)}</div>`
    : ''
  const fredning = spot.fredning_note
    ? `<div style="color:#b91c1c;margin-top:8px;font-size:11px;line-height:1.4;"><strong>⚠ Fredning:</strong> ${esc(spot.fredning_note)}</div>`
    : ''
  const car = spot.car_access
    ? `<div style="color:#16a34a;margin-top:6px;font-size:11px;">🚗 Bilkørsel tilladt</div>`
    : `<div style="color:#6b7280;margin-top:6px;font-size:11px;">Gåafstand fra P-plads</div>`

  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:200px;">
      <div style="font-weight:600;font-size:14px;color:#1A1A18;">${esc(spot.name)}</div>
      ${desc}
      ${fredning}
      ${car}
    </div>
  `
}

export default function Map({ spots, center, zoom }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current).setView(center, zoom)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      attribution: '© OpenSeaMap contributors',
      maxZoom: 19,
    }).addTo(map)

    spots.forEach((spot) => {
      L.circleMarker([spot.lat, spot.lng], {
        radius: 8,
        fillColor: '#1A5A8A',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup(popupHtml(spot))
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [spots, center, zoom])

  return <div ref={containerRef} className="w-full h-full" />
}
