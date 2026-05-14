'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { createClient } from '@/utils/supabase/client'
import type { Spot, SpotFeature } from '@/types'

type LocalUser = { id: string; name: string }

type Props = {
  spots: Spot[]
  features?: SpotFeature[]
  fishabilityScore: number | null
  currentUser: LocalUser | null
  center: [number, number]
  zoom: number
}

const FEATURE_LABELS: Record<SpotFeature['type'], string> = {
  hestehul: 'Hestehul',
  revle: 'Revle',
  prel: 'Prælrende',
  aaudlob: 'Å-udløb',
  andet: 'Andet',
}

const FREDNING_HENNE: [number, number][] = [
  [55.6267, 8.1089],
  [55.6367, 8.1089],
  [55.6367, 8.12],
  [55.6267, 8.12],
]

// EMODnet open data, no auth. The gtk geoserver has continental coverage;
// the geus geoserver carries Danish-specific seabed layers if gtk turns up
// blank over our stretch — swap the URL/LAYER constants to fall back.
const EMODNET_SEABED_URL = 'https://drive.emodnet-geology.eu/geoserver/gtk/wms'
const EMODNET_SEABED_LAYER = 'seabed_substrate_250k'
const EMODNET_BATHY_URL = 'https://ows.emodnet-bathymetry.eu/wms'
const EMODNET_BATHY_LAYER = 'emodnet:mean_rainbowcolour'

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

function scoreColorHex(score: number): string {
  if (score >= 7) return '#1A5A8A'
  if (score >= 4) return '#B5811C'
  return '#B33C2A'
}

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function findNearestSpot(spots: Spot[], lat: number, lng: number): Spot | null {
  if (spots.length === 0) return null
  let best = spots[0]
  let bestDist = distanceMeters(lat, lng, best.lat, best.lng)
  for (let i = 1; i < spots.length; i++) {
    const d = distanceMeters(lat, lng, spots[i].lat, spots[i].lng)
    if (d < bestDist) {
      bestDist = d
      best = spots[i]
    }
  }
  return best
}

function injectPulseCSS() {
  if (document.getElementById('gps-pulse-styles')) return
  const style = document.createElement('style')
  style.id = 'gps-pulse-styles'
  style.textContent = `
    @keyframes gps-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.4; transform: scale(1.4); }
    }
    .gps-pulse {
      animation: gps-pulse 2s infinite;
      transform-origin: center;
      transform-box: fill-box;
    }
  `
  document.head.appendChild(style)
}

function spotPopupHtml(spot: Spot, score: number | null): string {
  const desc = spot.description
    ? `<div style="color:#4A4A44;margin-top:2px;font-size:12px;">${esc(spot.description)}</div>`
    : ''
  const fredning = spot.fredning_note
    ? `<div style="color:#b91c1c;margin-top:8px;font-size:11px;line-height:1.4;"><strong>⚠ Fredning:</strong> ${esc(spot.fredning_note)}</div>`
    : ''
  const car = spot.car_access
    ? `<div style="color:#16a34a;margin-top:6px;font-size:11px;">🚗 Bilkørsel tilladt</div>`
    : `<div style="color:#6b7280;margin-top:6px;font-size:11px;">Gåafstand fra P-plads</div>`

  const fishRow =
    score !== null
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #EFECE7;font-size:12px;color:#4A4A44;">Fiskbarhed i dag: <strong style="color:${scoreColorHex(score)};">${score}/10</strong></div>`
      : ''

  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:200px;">
      <div style="font-weight:600;font-size:14px;color:#1A1A18;">${esc(spot.name)}</div>
      ${desc}
      ${fredning}
      ${car}
      ${fishRow}
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
      ${heading}${note}${date}
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

function buildAddFeatureForm(
  onSave: (type: SpotFeature['type'], note: string) => Promise<void>,
  onCancel: () => void,
): HTMLDivElement {
  const div = document.createElement('div')
  div.style.cssText =
    'font-family:Inter,system-ui,sans-serif;min-width:220px;'
  div.innerHTML = `
    <div style="font-weight:600;font-size:13px;color:#1A1A18;margin-bottom:8px;">Tilføj her?</div>
    <select id="feat-type" style="width:100%;padding:5px 6px;font-size:12px;border:1px solid #E0DDD6;border-radius:4px;margin-bottom:6px;background:white;">
      <option value="hestehul">Hestehul</option>
      <option value="revle">Revle</option>
      <option value="prel">Prælrende</option>
      <option value="aaudlob">Å-udløb</option>
      <option value="andet">Andet</option>
    </select>
    <input type="text" id="feat-note" placeholder="Note (valgfri)" style="width:100%;padding:5px 6px;font-size:12px;border:1px solid #E0DDD6;border-radius:4px;margin-bottom:8px;box-sizing:border-box;" />
    <div style="display:flex;gap:6px;">
      <button id="feat-cancel" style="flex:1;padding:6px;font-size:12px;background:#fff;color:#4A4A44;border:1px solid #E0DDD6;border-radius:4px;cursor:pointer;">Annuller</button>
      <button id="feat-save" style="flex:1;padding:6px;font-size:12px;background:#1A1A18;color:#fff;border:none;border-radius:4px;cursor:pointer;">Gem</button>
    </div>
  `
  const saveBtn = div.querySelector<HTMLButtonElement>('#feat-save')!
  const cancelBtn = div.querySelector<HTMLButtonElement>('#feat-cancel')!
  saveBtn.addEventListener('click', async () => {
    const type = div.querySelector<HTMLSelectElement>('#feat-type')!
      .value as SpotFeature['type']
    const note = div.querySelector<HTMLInputElement>('#feat-note')!.value.trim()
    saveBtn.disabled = true
    saveBtn.textContent = 'Gemmer...'
    await onSave(type, note)
  })
  cancelBtn.addEventListener('click', onCancel)
  return div
}

type BaseMode = 'vejkort' | 'sokort' | 'luftfoto'

function buildLayerPanel(handlers: {
  onBaseChange: (mode: BaseMode) => void
  onBathymetry: (on: boolean) => void
  onSeabed: (on: boolean) => void
  onFeatures: (on: boolean) => void
}): HTMLDivElement {
  const div = L.DomUtil.create('div')
  div.style.cssText =
    'background:#fff;padding:8px 10px;font-family:Inter,system-ui,sans-serif;font-size:12px;border:1px solid #E0DDD6;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.08);min-width:140px;'
  div.innerHTML = `
    <div style="font-weight:600;color:#1A1A18;margin-bottom:4px;">Kort</div>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px;color:#1A1A18;"><input type="radio" name="basemap" id="base-vejkort" style="cursor:pointer;"> Vejkort</label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px;color:#1A1A18;"><input type="radio" name="basemap" id="base-sokort" checked style="cursor:pointer;"> Søkort</label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px;color:#1A1A18;"><input type="radio" name="basemap" id="base-luftfoto" style="cursor:pointer;"> Luftfoto</label>
    <div style="border-top:1px solid #EFECE7;margin:6px -4px;"></div>
    <div style="font-weight:600;color:#1A1A18;margin-bottom:4px;">Lag</div>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px;color:#1A1A18;"><input type="checkbox" id="lyr-bathy" style="cursor:pointer;"> Dybdekort</label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:3px;color:#1A1A18;"><input type="checkbox" id="lyr-seabed" checked style="cursor:pointer;"> Bundtype</label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:#1A1A18;"><input type="checkbox" id="lyr-features" checked style="cursor:pointer;"> Hestehuller</label>
  `
  L.DomEvent.disableClickPropagation(div)
  L.DomEvent.disableScrollPropagation(div)

  const vejkort = div.querySelector<HTMLInputElement>('#base-vejkort')!
  const sokort = div.querySelector<HTMLInputElement>('#base-sokort')!
  const luftfoto = div.querySelector<HTMLInputElement>('#base-luftfoto')!
  vejkort.addEventListener('change', () => {
    if (vejkort.checked) handlers.onBaseChange('vejkort')
  })
  sokort.addEventListener('change', () => {
    if (sokort.checked) handlers.onBaseChange('sokort')
  })
  luftfoto.addEventListener('change', () => {
    if (luftfoto.checked) handlers.onBaseChange('luftfoto')
  })

  div
    .querySelector<HTMLInputElement>('#lyr-bathy')!
    .addEventListener('change', (e) =>
      handlers.onBathymetry((e.target as HTMLInputElement).checked),
    )
  div
    .querySelector<HTMLInputElement>('#lyr-seabed')!
    .addEventListener('change', (e) =>
      handlers.onSeabed((e.target as HTMLInputElement).checked),
    )
  div
    .querySelector<HTMLInputElement>('#lyr-features')!
    .addEventListener('change', (e) =>
      handlers.onFeatures((e.target as HTMLInputElement).checked),
    )
  return div
}

export default function Map({
  spots,
  features = [],
  fishabilityScore,
  currentUser,
  center,
  zoom,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    injectPulseCSS()

    const map = L.map(containerRef.current).setView(center, zoom)
    mapRef.current = map

    const osmLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      },
    )
    const seamarkLayer = L.tileLayer(
      'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
      {
        attribution: '© OpenSeaMap contributors',
        maxZoom: 19,
      },
    )
    const depthWmsLayer = L.tileLayer.wms(
      'https://www.geoseaportal.de/wss/service/NAUTHIS_Hydrography/guest',
      {
        layers: 'NAUTHIS_Hydrography',
        format: 'image/png',
        transparent: true,
        opacity: 0.6,
        attribution: '© BSH GeoSeaPortal',
      },
    )
    const esriImageryLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '© Esri World Imagery',
        maxZoom: 19,
      },
    )
    const bathymetryLayer = L.tileLayer.wms(EMODNET_BATHY_URL, {
      layers: EMODNET_BATHY_LAYER,
      format: 'image/png',
      transparent: true,
      opacity: 0.5,
      version: '1.3.0',
      attribution: '© EMODnet Bathymetry',
    })
    bathymetryLayer.on('tileerror', (e) =>
      console.warn('[map] EMODnet bathymetry tile error', e),
    )

    // Default base: Søkort — OpenSeaMap seamark tiles + BSH depth WMS, paired
    // with the Bundtype overlay below for the ideal pighvar-hunting view.
    // Vejkort and Luftfoto are alternative bases switchable from the panel.
    seamarkLayer.addTo(map)
    depthWmsLayer.addTo(map)

    const seabedLayer = L.tileLayer.wms(EMODNET_SEABED_URL, {
      layers: EMODNET_SEABED_LAYER,
      format: 'image/png',
      transparent: true,
      opacity: 0.5,
      version: '1.3.0',
      attribution: '© EMODnet Geology',
    })
    seabedLayer.on('tileerror', (e) =>
      console.warn('[map] EMODnet seabed tile error', e),
    )
    seabedLayer.addTo(map)

    L.polygon(FREDNING_HENNE, {
      color: '#b91c1c',
      fillColor: '#b91c1c',
      fillOpacity: 0.08,
      weight: 2,
      dashArray: '6 4',
    })
      .addTo(map)
      .bindPopup(
        '<div style="font-family:Inter,system-ui,sans-serif;min-width:200px;"><div style="font-weight:600;color:#b91c1c;font-size:13px;">⚠ Fredningsbælte · Henne Å</div><div style="color:#4A4A44;margin-top:4px;font-size:12px;line-height:1.4;">Helårsfredning. Hele strækningen 2,2 km syd for P-plads.</div></div>',
      )

    spots.forEach((spot) => {
      L.circleMarker([spot.lat, spot.lng], {
        radius: 8,
        fillColor: '#1A5A8A',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup(spotPopupHtml(spot, fishabilityScore))
    })

    const featuresGroup = L.layerGroup<L.Marker>()
    features.forEach((feature) => {
      L.marker([feature.lat, feature.lng], { icon: featureIcon() })
        .bindPopup(featurePopupHtml(feature))
        .addTo(featuresGroup)
    })
    featuresGroup.addTo(map)

    let gpsMarker: L.CircleMarker | null = null
    let accuracyCircle: L.Circle | null = null
    let watchId: number | null = null
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords
          if (!gpsMarker) {
            gpsMarker = L.circleMarker([latitude, longitude], {
              radius: 8,
              fillColor: '#1A5A8A',
              color: '#ffffff',
              weight: 2,
              fillOpacity: 0.9,
              className: 'gps-pulse',
            })
              .addTo(map)
              .bindPopup('Du er her')
            accuracyCircle = L.circle([latitude, longitude], {
              radius: accuracy,
              color: '#1A5A8A',
              fillColor: '#1A5A8A',
              fillOpacity: 0.05,
              weight: 1,
            }).addTo(map)
          } else {
            gpsMarker.setLatLng([latitude, longitude])
            accuracyCircle?.setLatLng([latitude, longitude])
            accuracyCircle?.setRadius(accuracy)
          }
        },
        (err) => console.warn('[map] geolocation error', err),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
      )
    }

    let addMode = false
    let addButtonEl: HTMLDivElement | null = null

    const setAddMode = (on: boolean) => {
      addMode = on && currentUser !== null
      if (addButtonEl) {
        if (addMode) {
          addButtonEl.style.background = '#1A5A8A'
          addButtonEl.style.color = '#fff'
          addButtonEl.style.borderColor = '#1A5A8A'
        } else {
          addButtonEl.style.background = '#fff'
          addButtonEl.style.color = '#1A1A18'
          addButtonEl.style.borderColor = '#E0DDD6'
        }
      }
      map.getContainer().style.cursor = addMode ? 'crosshair' : ''
    }

    const AddFeatureControl = L.Control.extend({
      onAdd: () => {
        const btn = L.DomUtil.create('div') as HTMLDivElement
        btn.style.cssText =
          'background:#fff;color:#1A1A18;padding:6px 10px;font-family:Inter,system-ui,sans-serif;font-size:12px;font-weight:500;border:1px solid #E0DDD6;border-radius:6px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.08);user-select:none;'
        btn.textContent = '＋ Tilføj feature'
        btn.title = currentUser
          ? 'Slå tilstand til og klik på kortet'
          : 'Log ind for at tilføje'
        L.DomEvent.disableClickPropagation(btn)
        btn.addEventListener('click', () => {
          if (!currentUser) return
          setAddMode(!addMode)
        })
        addButtonEl = btn
        return btn
      },
    })
    new AddFeatureControl({ position: 'topleft' }).addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!addMode || !currentUser) return
      const { lat, lng } = e.latlng

      const popup = L.popup({ closeButton: true, autoClose: true })
      const form = buildAddFeatureForm(
        async (type, note) => {
          const nearest = findNearestSpot(spots, lat, lng)
          const supabase = createClient()
          const { data, error } = await supabase
            .from('spot_features')
            .insert({
              type,
              lat,
              lng,
              note: note || null,
              user_id: currentUser.id,
              spot_id: nearest?.id ?? null,
              date_found: new Date().toISOString().slice(0, 10),
              active: true,
            })
            .select()
            .single()
          if (error || !data) {
            console.error('[map] insert feature failed', error)
            map.closePopup(popup)
            setAddMode(false)
            return
          }
          const newFeature = data as SpotFeature
          L.marker([newFeature.lat, newFeature.lng], { icon: featureIcon() })
            .bindPopup(featurePopupHtml(newFeature))
            .addTo(featuresGroup)
          map.closePopup(popup)
          setAddMode(false)
        },
        () => {
          map.closePopup(popup)
          setAddMode(false)
        },
      )
      popup.setLatLng(e.latlng).setContent(form).openOn(map)
    })

    // Legend tracks which raster overlays are visible and renders the matching
    // colour key. Both off → control hides itself so it doesn't obscure the
    // bottom-left corner of the map.
    let bundtypeOn = true
    let dybdekortOn = false
    let legendEl: HTMLDivElement | null = null

    const swatch = (color: string, label: string) =>
      `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="width:10px;height:10px;background:${color};border:1px solid rgba(0,0,0,0.12);display:inline-block;flex-shrink:0;"></span><span>${label}</span></div>`

    const renderLegend = () => {
      if (!legendEl) return
      if (!bundtypeOn && !dybdekortOn) {
        legendEl.style.display = 'none'
        return
      }
      legendEl.style.display = ''
      const parts: string[] = []
      if (bundtypeOn) {
        parts.push('<div style="font-weight:600;margin-bottom:3px;">Bundtype</div>')
        parts.push(swatch('#F2D98F', 'Sand · pighvar habitat'))
        parts.push(swatch('#B5651D', 'Groft sand · grus'))
        parts.push(swatch('#9FC9E0', 'Mudder · finsand'))
        parts.push(swatch('#D8D8D2', 'Ikke kortlagt'))
      }
      if (bundtypeOn && dybdekortOn) {
        parts.push('<div style="border-top:1px solid #EFECE7;margin:6px -4px;"></div>')
      }
      if (dybdekortOn) {
        parts.push('<div style="font-weight:600;margin-bottom:3px;">Dybde</div>')
        parts.push(swatch('#D44A3D', 'Lavt (<5m) — brændingszone'))
        parts.push(swatch('#E89C4E', 'Middel (5-20m)'))
        parts.push(swatch('#6B3D8A', 'Dybt (>20m)'))
      }
      legendEl.innerHTML = parts.join('')
    }

    const LegendControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div') as HTMLDivElement
        div.style.cssText =
          'background:#fff;padding:8px 10px;font-family:Inter,system-ui,sans-serif;font-size:11px;color:#1A1A18;border:1px solid #E0DDD6;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.08);min-width:160px;'
        L.DomEvent.disableClickPropagation(div)
        legendEl = div
        renderLegend()
        return div
      },
    })
    new LegendControl({ position: 'bottomleft' }).addTo(map)

    const LayerControl = L.Control.extend({
      onAdd: () =>
        buildLayerPanel({
          onBaseChange: (mode) => {
            map.removeLayer(osmLayer)
            map.removeLayer(seamarkLayer)
            map.removeLayer(depthWmsLayer)
            map.removeLayer(esriImageryLayer)
            if (mode === 'vejkort') {
              osmLayer.addTo(map)
            } else if (mode === 'sokort') {
              seamarkLayer.addTo(map)
              depthWmsLayer.addTo(map)
            } else {
              esriImageryLayer.addTo(map)
            }
          },
          onBathymetry: (on) => {
            dybdekortOn = on
            if (on) bathymetryLayer.addTo(map)
            else map.removeLayer(bathymetryLayer)
            renderLegend()
          },
          onSeabed: (on) => {
            bundtypeOn = on
            if (on) seabedLayer.addTo(map)
            else map.removeLayer(seabedLayer)
            renderLegend()
          },
          onFeatures: (on) =>
            on ? featuresGroup.addTo(map) : map.removeLayer(featuresGroup),
        }),
    })
    const layerCtrl = new LayerControl({ position: 'topright' })
    layerCtrl.addTo(map)

    return () => {
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId)
      }
      map.remove()
      mapRef.current = null
    }
  }, [spots, features, center, zoom, fishabilityScore, currentUser])

  return <div ref={containerRef} className="w-full h-full" />
}
