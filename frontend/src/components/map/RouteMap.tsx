import { DivIcon } from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { useEffect, useMemo } from 'react';
import type { Bus, Stop } from '../../types';
import { MAP_VIEW } from '../../config/stops';
import { DESTINATIONS } from '../../config/destinations';
import styles from './RouteMap.module.css';
import 'leaflet/dist/leaflet.css';

export interface MapFocus {
  lat: number;
  lng: number;
}

interface RouteMapProps {
  stops: Stop[];
  /** Empty until a driver goes on duty — then one pin per bus. */
  buses: Bus[];
  /** Stop the selected bus is heading to; drawn in blue. */
  nextStopId?: string | null;
  /** Off-loop request destinations (Walmart, station, …). On by default. */
  showDestinations?: boolean;
  /** Vector name labels above stop pins. Off on the student home screen,
      where the trip card already names the stops and a clean map is wanted. */
  showStopLabels?: boolean;
  /** The rider's own pickup point, drawn as a blue pin with pulse rings. */
  userPoint?: MapFocus | null;
  /** Point the map flies to when `recenterSignal` changes. */
  focusPoint?: MapFocus | null;
  /** Increment to fly the map back to `focusPoint` (or the route bounds). */
  recenterSignal?: number;
  className?: string;
}

/**
 * The shared Leaflet map.
 *
 * Plain OpenStreetMap tiles. No API key, no billing account — see README
 * "Map provider". CARTO was removed after it started gating tiles behind
 * an API key.
 */
export function RouteMap({
  stops,
  buses,
  nextStopId,
  showDestinations = true,
  showStopLabels = true,
  userPoint = null,
  focusPoint = null,
  recenterSignal = 0,
  className,
}: RouteMapProps) {
  /* Dotted line through the stops in loop order, closing back to stop 1.
     Not a driving route — it shows the sequence, which is what the
     designs draw and what a rider needs to understand. */
  const loop = useMemo(() => {
    const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
    if (ordered.length < 2) return [];
    const points = ordered.map((stop) => [stop.lat, stop.lng] as [number, number]);
    return [...points, points[0]];
  }, [stops]);

  const routeBounds = useMemo(() => {
    const pts: Array<[number, number]> = stops.map((s) => [s.lat, s.lng]);
    for (const b of buses) {
      if (b.position) pts.push([b.position.lat, b.position.lng]);
    }
    if (userPoint) pts.push([userPoint.lat, userPoint.lng]);
    return pts;
  }, [stops, buses, userPoint]);

  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <MapContainer
        center={MAP_VIEW.center}
        zoom={MAP_VIEW.zoom}
        maxBounds={MAP_VIEW.maxBounds}
        maxBoundsViscosity={1}
        minZoom={11}
        maxZoom={19}
        className={styles.map}
        zoomControl
        scrollWheelZoom
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
          maxNativeZoom={19}
          tileSize={256}
          zoomOffset={0}
          detectRetina
          updateWhenIdle={false}
          keepBuffer={4}
        />

        <MapController
          focusPoint={focusPoint}
          routeBounds={routeBounds}
          recenterSignal={recenterSignal}
        />

        <Polyline
          positions={loop}
          pathOptions={{
            color: '#8c95a6',
            weight: 2,
            dashArray: '2 6',
            opacity: 0.9,
          }}
        />

        {stops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lng]}
            icon={stopIcon(stop.sequence, stop.id === nextStopId)}
            title={stop.name}
          >
            <Tooltip
              direction="top"
              offset={[0, -18]}
              permanent={showStopLabels}
              className={styles.stopLabel}
              opacity={1}
            >
              {stop.name}
            </Tooltip>
          </Marker>
        ))}

        {showDestinations
          ? DESTINATIONS.map((place) => (
              <Marker
                key={place.id}
                position={[place.lat, place.lng]}
                icon={destinationIcon()}
                title={`${place.name} — ${place.address}`}
              >
                <Tooltip
                  direction="top"
                  offset={[0, -14]}
                  permanent={showStopLabels}
                  className={styles.destLabel}
                  opacity={1}
                >
                  {place.name}
                </Tooltip>
              </Marker>
            ))
          : null}

        {userPoint ? (
          <Marker
            position={[userPoint.lat, userPoint.lng]}
            icon={userIcon()}
            title="Your location"
            zIndexOffset={900}
            interactive={false}
          />
        ) : null}

        {buses
          .filter((bus) => bus.position)
          .map((bus) => (
            <Marker
              key={bus.id}
              position={[bus.position!.lat, bus.position!.lng]}
              icon={busIcon(bus.status === 'live')}
              title={bus.label}
              zIndexOffset={1000}
            />
          ))}
      </MapContainer>
    </div>
  );
}

/** Flies back to the rider's pickup (or the whole route) on demand. */
function MapController({
  focusPoint,
  routeBounds,
  recenterSignal,
}: {
  focusPoint: MapFocus | null;
  routeBounds: Array<[number, number]>;
  recenterSignal: number;
}) {
  const map = useMap();
  const first = recenterSignal === 0;
  useEffect(() => {
    if (first) return;
    if (focusPoint) {
      map.flyTo([focusPoint.lat, focusPoint.lng], Math.max(map.getZoom(), 15), {
        duration: 0.8,
      });
    } else if (routeBounds.length > 1) {
      map.flyToBounds(routeBounds, { padding: [48, 48], duration: 0.8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal]);
  return null;
}

/** Numbered circle for a stop. */
function stopIcon(sequence: number, isNext: boolean) {
  return new DivIcon({
    className: '',
    html: `<span class="${styles.stopMarker} ${isNext ? styles.stopMarkerNext : ''}">${sequence}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Small diamond for an off-loop request destination. */
function destinationIcon() {
  return new DivIcon({
    className: '',
    html: `<span class="${styles.destMarker}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/** The rider's own position: blue pin over a dot with pulse rings. */
function userIcon() {
  return new DivIcon({
    className: '',
    html:
      `<span class="${styles.userPin}">` +
      `<span class="${styles.userRing} ${styles.userRingA}"></span>` +
      `<span class="${styles.userRing} ${styles.userRingB}"></span>` +
      `<span class="${styles.userDot}"></span>` +
      `<svg class="${styles.userPinGlyph}" viewBox="0 0 24 32" aria-hidden="true">` +
      `<path d="M12 1a10 10 0 0 0-10 10c0 7.5 10 20 10 20s10-12.5 10-20A10 10 0 0 0 12 1Z" fill="#1d4ed8" stroke="#ffffff" stroke-width="2"/>` +
      `<circle cx="12" cy="11" r="3.5" fill="#ffffff"/>` +
      `</svg>` +
      `</span>`,
    iconSize: [72, 72],
    iconAnchor: [36, 52],
  });
}

/**
 * Shuttle marker: a white side-view bus with a blue window band, drawn to
 * read as a vehicle at a glance. Liveness is shown by the corner dot and
 * by the status cards below the map, not by recoloring the whole bus.
 */
function busIcon(live: boolean) {
  return new DivIcon({
    className: '',
    html:
      `<span class="${styles.shuttle}">` +
      `<svg class="${styles.shuttleGlyph}" viewBox="0 0 64 40" aria-hidden="true">` +
      `<ellipse cx="32" cy="35" rx="24" ry="3" fill="rgba(15,23,42,0.18)"/>` +
      `<rect x="6" y="7" width="52" height="20" rx="5" fill="#ffffff" stroke="#1e3a8a" stroke-width="1.6"/>` +
      `<rect x="10" y="10" width="32" height="8" rx="2" fill="#1d4ed8"/>` +
      `<path d="M44 10h7l3 8h-10Z" fill="#1d4ed8"/>` +
      `<rect x="6" y="20" width="52" height="3" fill="#1d4ed8"/>` +
      `<text x="26" y="16.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="6" font-weight="bold" fill="#ffffff">LC</text>` +
      `<circle cx="19" cy="28" r="4.6" fill="#0f172a"/><circle cx="19" cy="28" r="1.8" fill="#94a3b8"/>` +
      `<circle cx="47" cy="28" r="4.6" fill="#0f172a"/><circle cx="47" cy="28" r="1.8" fill="#94a3b8"/>` +
      `</svg>` +
      `<span class="${styles.shuttleDot} ${live ? styles.shuttleDotLive : styles.shuttleDotOffline}"></span>` +
      `</span>`,
    iconSize: [64, 40],
    iconAnchor: [32, 20],
  });
}
