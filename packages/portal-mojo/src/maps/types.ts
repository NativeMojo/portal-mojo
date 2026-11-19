import type { ReactNode } from 'react';
import type { StyleSpecification } from 'maplibre-gl';

export type MapTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';
export interface MapMarker<T = unknown> {
    id: string;
    longitude: number;
    latitude: number;
    label: string;
    tone?: MapTone;
    /** Kept in React memory, never sent to the map's worker or tile provider. */
    data?: T;
}
export interface MapView {
    longitude: number;
    latitude: number;
    zoom: number;
}
export interface MapLibreMapProps<T = unknown> {
    /** Required: choose your provider, credentials, attribution and style explicitly. */
    mapStyle: string | StyleSpecification;
    markers: readonly MapMarker<T>[];
    label?: string;
    height?: number | string;
    className?: string;
    initialView?: MapView;
    /** Controlled camera; omit to let the map retain the user's view. */
    view?: MapView;
    onViewChange?: (view: MapView) => void;
    /** Undefined = internal selection; null = controlled, no selection. */
    selectedId?: string | null;
    onSelectionChange?: (id: string | null) => void;
    renderPopup?: (marker: MapMarker<T>) => ReactNode;
    cluster?: boolean;
    /** Fit once at mount, not on each live update. Fit button remains available. */
    fitOnLoad?: boolean;
    loading?: boolean;
    onError?: (error: Error) => void;
}
