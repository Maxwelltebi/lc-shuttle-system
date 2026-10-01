import { DivIcon } from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import { useMemo } from 'react';
import type { Bus, Stop } from '../../types';
import { MAP_VIEW } from '../../config/stops';
import { DESTINATIONS } from '../../config/destinations';
import styles from './RouteMap.module.css';
import 'leaflet/dist/leaflet.css';

interface RouteMapProps {
  stops: Stop[];
  /** Empty until a driver goes on duty — then one pin per bus. */
  buses: Bus[];
  /** Stop the selected bus is heading to; drawn in amber. */
  nextStopId?: string | null;
  /** Off-loop request destinations (Walmart, station, …). On by default. */
  showDestinations?: boolean;
  className?: string;
}

/**
 * The shared Leaflet map.
 *
 * Plain OpenStreetMap tiles. No API key, no billing account — see README
 * "Map provider". CARTO was removed after it started gating tiles behind
 * an API key.
 */
export function RouteMap({ stops, buses, nextStopId, showDestinations = true, className }: RouteMapProps) {
  /* Dotted line through the stops in loop order, closing back to stop 1.
     Not a driving route — it shows the sequence, which is what the
     designs draw and what a rider needs to understand. */
  const loop = useMemo(() => {
    const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
    if (ordered.length < 2) return [];
    const points = ordered.map((stop) => [stop.lat, stop.lng] as [number, number]);
    return [...points, points[0]];
  }, [stops]);

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
            {/* Vector label stays sharp at any zoom; raster tile text does
                not, which is why zooming in used to turn names to mush. */}
            <Tooltip
              direction="top"
              offset={[0, -18]}
              permanent
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
                  permanent
                  className={styles.destLabel}
                  opacity={1}
                >
                  {place.name}
                </Tooltip>
              </Marker>
            ))
          : null}

        {buses
          .filter((bus) => bus.position)
          .map((bus) => (
            <Marker
              key={bus.id}
              position={[bus.position!.lat, bus.position!.lng]}
              icon={busIcon(bus.label, bus.status === 'live')}
              title={bus.label}
              zIndexOffset={1000}
            />
          ))}
      </MapContainer>
    </div>
  );
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

/**
 * Bus avatar marker: a real bus glyph in a dark (live) or grey (stale)
 * rounded badge with the label beside it — the shape riders expect from
 * modern transport apps, not a bare dot-and-chip.
 */
function busIcon(label: string, live: boolean) {
  const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return new DivIcon({
    className: '',
    html:
      `<span class="${styles.busAvatar} ${live ? styles.busAvatarLive : styles.busAvatarOffline}">` +
      `<svg class="${styles.busGlyph}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<rect x="4" y="3.5" width="16" height="13" rx="2.5"/>` +
      `<path d="M4 10h16"/>` +
      `<circle cx="8" cy="18.5" r="1.6"/><circle cx="16" cy="18.5" r="1.6"/>` +
      `</svg>` +
      `<span class="${styles.busAvatarLabel}">${escaped}</span>` +
      `</span>`,
    iconSize: [0, 0],
    iconAnchor: [28, 20],
  });
}
