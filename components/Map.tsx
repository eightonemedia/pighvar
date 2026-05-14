'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Spot, SpotFeature } from '@/types'

type Props = {
  spots: Spot[]
  features?: SpotFeature[]
  center: [number, number]
  zoom: number
}

const FEATURE_LABELS: Record<SpotFeature['type'], string> = {
  hestehul: 'Hestehul',
  revle: 'Revle',
  prel: 'Prel',
  aaudlob: 'Åudløb',
  andet: 'Andet',
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

function spotPopupHtml(spot: Spot): string {
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

function featurePopupHtml(f: SpotFeature): string {
  const heading =
    f.type === 'hestehul'
      ? `<div style="font-weight:600;font-size:13px;color:#E8820C;">🔱 Hestehul</div>`
      : `<div style="font-weight:600;font-size:13px;color:#1A1A18;">${esc(FEATURE_LABELS[f.type])}</div>`

  const note = f.note
    ? `<div style="color:#4A4A44;margin-top:4px;font-size:12px;line-height:1.4;">${esc(f.note)}</div>`
    : ''
  const date = `<div style="color:#8A8A82;margin-top:6px;font-size:11px;">Fundet: ${esc(f.date_found)}</div>`

  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:180px;">
      ${heading}
      ${note}
      ${date}
    </div>
  `
}

const featureIcon = () =>
  L.divIcon({
    html: '<div style="width:12px;height:12px;background:#E8820C;transform:rotate(45deg);border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.2);"></div>',
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })

export default function Map({ spots, features, center, zoom }: Props) {
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
        .bindPopup(spotPopupHtml(spot))
    })

    if (features && features.length > 0) {
      features.forEach((feature) => {
        L.marker([feature.lat, feature.lng], { icon: featureIcon() })
          .addTo(map)
          .bindPopup(featurePopupHtml(feature))
      })
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [spots, features, center, zoom])

  return <div ref={containerRef} className="w-full h-full" />
}
