// LocationClient — the six public django-mojo location endpoints behind one
// typed, non-Query transport. The provider session token is deliberately a
// private field: it never enters URL state, form values, storage or results.
import { mojoCall, type FetchOpts } from './client';

export type LocationTransport = (path: string, opts: FetchOpts) => Promise<unknown>;

export interface LocationEndpoints {
    validate: string;
    suggestions: string;
    details: string;
    geocode: string;
    reverseGeocode: string;
    timezone: string;
}

const DEFAULT_ENDPOINTS: LocationEndpoints = {
    validate: '/api/location/address/validate',
    suggestions: '/api/location/address/suggestions',
    details: '/api/location/address/place-details',
    geocode: '/api/location/address/geocode',
    reverseGeocode: '/api/location/address/reverse-geocode',
    timezone: '/api/location/timezone',
};

export interface AddressSuggestion {
    id: string | null;
    place_id: string;
    description: string;
    main_text: string;
    secondary_text: string;
    types: string[];
}

export interface AddressSuggestions {
    success: true;
    data: AddressSuggestion[];
    size: number;
    count: number;
}

export interface AddressDetails {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    state_code?: string;
    postal_code?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
    formatted_address?: string;
    place_id?: string;
}

export interface ValidateAddressInput {
    address1: string;
    address2?: string;
    city?: string;
    state: string;
    postal_code?: string;
    provider?: string;
}

export interface AddressValidation {
    valid?: boolean;
    source?: string;
    standardized_address?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface GeocodeResult {
    success: true;
    latitude: number;
    longitude: number;
    formatted_address: string;
    place_id: string;
    address_components: Record<string, unknown>;
}

export interface ReverseGeocodeResult {
    success: true;
    formatted_address: string;
    place_id: string;
    address_components: Record<string, unknown>;
}

export interface TimezoneResult {
    success: true;
    timezone_id: string;
    timezone_name: string;
    raw_offset: number;
    dst_offset: number;
    total_offset: number;
}

export class StaleLocationRequestError extends Error {
    constructor() {
        super('Location request was superseded');
        this.name = 'StaleLocationRequestError';
    }
}

export function isStaleLocationRequest(error: unknown): error is StaleLocationRequestError {
    return error instanceof StaleLocationRequestError;
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Invalid ${label} response`);
    }
    return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, label: string): string {
    if (typeof body[key] !== 'string') throw new TypeError(`Invalid ${label} response`);
    return body[key] as string;
}

function requiredNumber(body: Record<string, unknown>, key: string, label: string): number {
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key])) {
        throw new TypeError(`Invalid ${label} response`);
    }
    return body[key] as number;
}

function requireSuccess(body: Record<string, unknown>, label: string): void {
    if (body.success !== true) throw new Error(typeof body.error === 'string' ? body.error : `${label} failed`);
}

export class LocationClient {
    #transport: LocationTransport;
    #endpoints: LocationEndpoints;
    #sessionToken: string | null = null;
    #generation = 0;
    #disposed = false;

    constructor(options: { transport?: LocationTransport; endpoints?: Partial<LocationEndpoints> } = {}) {
        this.#transport = options.transport ?? ((path, opts) => mojoCall(path, opts));
        this.#endpoints = { ...DEFAULT_ENDPOINTS, ...options.endpoints };
    }

    /** Invalidate late completions without ending the provider session. */
    cancelPending(): void {
        this.#generation += 1;
    }

    /** Begin a new provider session and invalidate every pending completion. */
    reset(): void {
        this.#sessionToken = null;
        this.#generation += 1;
    }

    /** Upstream changes are a hard boundary: old responses cannot repopulate. */
    replaceTransport(transport: LocationTransport, endpoints: Partial<LocationEndpoints> = {}): void {
        this.reset();
        this.#transport = transport;
        this.#endpoints = { ...DEFAULT_ENDPOINTS, ...endpoints };
        this.#disposed = false;
    }

    dispose(): void {
        this.#disposed = true;
        this.reset();
    }

    async #request(path: string, opts: FetchOpts): Promise<Record<string, unknown>> {
        if (this.#disposed) throw new StaleLocationRequestError();
        const generation = ++this.#generation;
        const result = await this.#transport(path, opts);
        if (this.#disposed || generation !== this.#generation) throw new StaleLocationRequestError();
        return record(result, 'location');
    }

    async validateAddress(input: ValidateAddressInput): Promise<AddressValidation> {
        const body = await this.#request(this.#endpoints.validate, { method: 'POST', body: { ...input } });
        return record(body.data, 'address validation') as AddressValidation;
    }

    async autocomplete(input: string, options: {
        country?: string;
        lat?: number;
        lng?: number;
        radius?: number;
    } = {}): Promise<AddressSuggestions> {
        const query = input.trim();
        if (!query) {
            this.cancelPending();
            return { success: true, data: [], size: 0, count: 0 };
        }
        const params: Record<string, string | number> = {
            input: query,
            country: options.country ?? 'US',
        };
        if (options.lat !== undefined) params.lat = options.lat;
        if (options.lng !== undefined) params.lng = options.lng;
        if (options.radius !== undefined) params.radius = options.radius;
        // Only the backend creates the first token. A returned token is
        // accepted privately and necessarily rides subsequent GETs.
        if (this.#sessionToken) params.session_token = this.#sessionToken;

        const body = await this.#request(this.#endpoints.suggestions, { params });
        requireSuccess(body, 'Address suggestions');
        const token = requiredString(body, 'session_token', 'address suggestions');
        if (!Array.isArray(body.data)) throw new TypeError('Invalid address suggestions response');
        const data = body.data.map((raw) => {
            const item = record(raw, 'address suggestion');
            const placeId = typeof item.place_id === 'string'
                ? item.place_id
                : typeof item.id === 'string' ? item.id : '';
            if (!placeId) throw new TypeError('Invalid address suggestion response');
            return {
                id: typeof item.id === 'string' ? item.id : null,
                place_id: placeId,
                description: typeof item.description === 'string' ? item.description : '',
                main_text: typeof item.main_text === 'string' ? item.main_text : '',
                secondary_text: typeof item.secondary_text === 'string' ? item.secondary_text : '',
                types: Array.isArray(item.types) ? item.types.filter((v): v is string => typeof v === 'string') : [],
            };
        });
        this.#sessionToken = token;
        return {
            success: true,
            data,
            size: typeof body.size === 'number' ? body.size : data.length,
            count: typeof body.count === 'number' ? body.count : data.length,
        };
    }

    async placeDetails(placeId: string): Promise<AddressDetails> {
        const params: Record<string, string> = { place_id: placeId };
        if (this.#sessionToken) params.session_token = this.#sessionToken;
        try {
            const body = await this.#request(this.#endpoints.details, { params });
            requireSuccess(body, 'Place details');
            const details = record(body.address, 'place details') as AddressDetails;
            this.#sessionToken = null;
            return details;
        } catch (error) {
            // A current provider failure ends the session. A stale completion
            // must not erase the token installed by a newer generation.
            if (!isStaleLocationRequest(error)) this.#sessionToken = null;
            throw error;
        }
    }

    async geocode(address: string | Record<string, unknown>): Promise<GeocodeResult> {
        const body = await this.#request(this.#endpoints.geocode, { method: 'POST', body: { address } });
        requireSuccess(body, 'Geocode');
        return {
            success: true,
            latitude: requiredNumber(body, 'latitude', 'geocode'),
            longitude: requiredNumber(body, 'longitude', 'geocode'),
            formatted_address: requiredString(body, 'formatted_address', 'geocode'),
            place_id: requiredString(body, 'place_id', 'geocode'),
            address_components: record(body.address_components, 'geocode'),
        };
    }

    async reverseGeocode(coords: { lat: number; lng: number }): Promise<ReverseGeocodeResult> {
        const body = await this.#request(this.#endpoints.reverseGeocode, { params: coords });
        requireSuccess(body, 'Reverse geocode');
        return {
            success: true,
            formatted_address: requiredString(body, 'formatted_address', 'reverse geocode'),
            place_id: requiredString(body, 'place_id', 'reverse geocode'),
            address_components: record(body.address_components, 'reverse geocode'),
        };
    }

    async timezone(coords: { lat: number; lng: number; timestamp?: number }): Promise<TimezoneResult> {
        const body = await this.#request(this.#endpoints.timezone, { params: coords });
        requireSuccess(body, 'Timezone');
        return {
            success: true,
            timezone_id: requiredString(body, 'timezone_id', 'timezone'),
            timezone_name: requiredString(body, 'timezone_name', 'timezone'),
            raw_offset: requiredNumber(body, 'raw_offset', 'timezone'),
            dst_offset: requiredNumber(body, 'dst_offset', 'timezone'),
            total_offset: requiredNumber(body, 'total_offset', 'timezone'),
        };
    }
}
