import { DivIcon } from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer } from 'react-leaflet';
import { useMemo } from 'react';
import type { Bus, Stop } from '../../types';
import { MAP_VIEW } from '../../config/stops';
import styles from './RouteMap.module.css';
import 'leaflet/dist/leaflet.css';

interface RouteMapProps {
  stops: Stop[];
  /** Empty until a driver goes on duty — then one pin per bus. */
  buses: Bus[];
  /** Stop the selected bus is heading to; drawn in amber. */
  nextStopId?: string | null;
  className?: string;
}

/**
 * The shared Leaflet map.
 *
 * CARTO tiles over OpenStreetMap data, matching the attribution in the
 * designs. No API key, no billing account — see README "Map provider".
 */
export function RouteMap({ stops, buses, nextStopId, className }: RouteMapProps) {
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
        minZoom={12}
        className={styles.map}
        zoomControl
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
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
          />
        ))}

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

/** Labelled chip for a bus, greyed when its last ping is stale. */
function busIcon(label: string, live: boolean) {
  return new DivIcon({
    className: '',
    html: `<span class="${styles.busMarker} ${live ? '' : styles.busMarkerOffline}">
             <span class="${styles.busDot} ${live ? '' : styles.busDotOffline}"></span>${label}
           </span>`,
    iconSize: [0, 0],
    iconAnchor: [40, 14],
  });
}
