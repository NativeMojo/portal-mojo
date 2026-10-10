// Mock wire for django-mojo's rendition options (fileman #7728): the
// `GET /api/fileman/renditions/options` descriptor and the write-time
// validator the server runs on the three FILEMAN_RENDITIONS_* settings.
// Defaults, limits, choices and the error grammar are copied verbatim from
// `mojo/apps/fileman/renderer/{config,image,video,document}.py` so the page
// built against this mock meets the same contract live.
import type { RenditionCategoryKey, RenditionOptions } from '../admin/storage/rendition-settings';

export const RENDITION_CATEGORY_KEYS: Record<RenditionCategoryKey, string> = {
    image: 'FILEMAN_RENDITIONS_IMAGE',
    video: 'FILEMAN_RENDITIONS_VIDEO',
    document: 'FILEMAN_RENDITIONS_DOCUMENT',
};

type Options = Record<string, unknown>;

// renderer.default_renditions, verbatim. Image defaults deliberately carry no
// format/quality: those are renderer class attributes (JPEG / 85).
const DEFAULTS: Record<RenditionCategoryKey, Record<string, Options>> = {
    image: {
        thumbnail: { width: 150, height: 150, mode: 'contain' },
        thumbnail_sm: { width: 32, height: 32, mode: 'contain' },
        thumbnail_md: { width: 64, height: 64, mode: 'contain' },
        thumbnail_lg: { width: 300, height: 300, mode: 'contain' },
        square_sm: { width: 100, height: 100, mode: 'crop' },
    },
    video: {
        video_thumbnail: { width: 300, height: 169, time_offset: '00:00:03', format: 'jpg' },
        thumbnail: { width: 300, height: 169, time_offset: '00:00:03', format: 'jpg' },
        video_preview: { width: 640, height: 360, bitrate: '500k', duration: 10, format: 'mp4', codec: 'h264', audio: true },
        video_mp4: { width: 1280, height: 720, bitrate: '2000k', format: 'mp4', codec: 'h264', audio: true },
        video_webm: { width: 1280, height: 720, bitrate: '2000k', format: 'webm', audio: true },
        video_hevc: { width: 1280, height: 720, format: 'mp4', codec: 'h265', crf: 28, preset: 'medium', audio: true },
    },
    document: {
        document_thumbnail: { width: 300, height: 424, format: 'jpg', page: 1 },
        thumbnail: { width: 200, height: 283, format: 'jpg', page: 1 },
        document_preview: { format: 'pdf', quality: 'medium', max_pages: 20 },
        document_pdf: { format: 'pdf', quality: 'high' },
    },
};

// renderer.default_automatic_roles(): every role unless the renderer opts in.
const AUTOMATIC_DEFAULT: Record<RenditionCategoryKey, string[]> = {
    image: Object.keys(DEFAULTS.image),
    video: ['video_thumbnail', 'thumbnail', 'video_preview'],
    document: Object.keys(DEFAULTS.document),
};

const THUMBNAIL_ROLES: Partial<Record<RenditionCategoryKey, string[]>> = {
    video: ['thumbnail', 'video_thumbnail'],
    document: ['thumbnail', 'document_thumbnail'],
};

export const RENDITION_LIMITS: Record<string, [number, number]> = {
    width: [1, 4096],
    height: [1, 4096],
    quality: [1, 100],
    crf: [18, 51],
    duration: [1, 60],
    max_pages: [1, 200],
    page: [1, 500],
};

type Spec = ['int', string] | ['choice', string[]] | ['bool', null] | ['bitrate', null] | ['time_offset', null];

const IMAGE_MODES = ['contain', 'crop', 'stretch'];
const IMAGE_FORMATS = ['jpeg', 'jpg', 'png', 'webp', 'gif'];
const STILL_FORMATS = ['jpg', 'png'];
const VIDEO_FORMATS = ['mp4', 'webm'];
const VIDEO_CODECS = ['h264', 'h265'];
const VIDEO_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'];
const PDF_QUALITIES = ['low', 'medium', 'high'];

// config.OPTION_SCHEMA, keyed "<category>/<kind>".
const OPTION_SCHEMA: Record<string, Record<string, Spec>> = {
    'image/image': { width: ['int', 'width'], height: ['int', 'height'], mode: ['choice', IMAGE_MODES], format: ['choice', IMAGE_FORMATS], quality: ['int', 'quality'] },
    'video/thumbnail': { width: ['int', 'width'], height: ['int', 'height'], time_offset: ['time_offset', null], format: ['choice', STILL_FORMATS] },
    'video/transcode': { width: ['int', 'width'], height: ['int', 'height'], bitrate: ['bitrate', null], format: ['choice', VIDEO_FORMATS], audio: ['bool', null], duration: ['int', 'duration'], codec: ['choice', VIDEO_CODECS], crf: ['int', 'crf'], preset: ['choice', VIDEO_PRESETS] },
    'document/thumbnail': { width: ['int', 'width'], height: ['int', 'height'], page: ['int', 'page'], format: ['choice', STILL_FORMATS] },
    'document/pdf': { quality: ['choice', PDF_QUALITIES], max_pages: ['int', 'max_pages'] },
};
const MP4_ONLY = ['codec', 'crf', 'preset'];
const BITRATE_RE = /^\d+[kKmM]?$/;
const TIME_OFFSET_RE = /^\d{2}:\d{2}:\d{2}(\.\d+)?$/;

function roleKind(category: RenditionCategoryKey, role: string): string {
    if (category === 'image') return 'image';
    if ((THUMBNAIL_ROLES[category] ?? []).includes(role)) return 'thumbnail';
    return category === 'video' ? 'transcode' : 'pdf';
}

export function renditionCategoryForKey(key: string): RenditionCategoryKey | null {
    const found = (Object.keys(RENDITION_CATEGORY_KEYS) as RenditionCategoryKey[]).find((category) => RENDITION_CATEGORY_KEYS[category] === key);
    return found ?? null;
}

function isInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

function checkOption(where: string, spec: Spec, value: unknown): string | null {
    const [checker, arg] = spec;
    if (checker === 'int') {
        const [low, high] = RENDITION_LIMITS[arg]!;
        if (!isInt(value)) return `${where}: must be a whole number`;
        if (value < low || value > high) return `${where}: must be between ${low} and ${high}`;
    } else if (checker === 'choice') {
        if (typeof value !== 'string' || !arg.includes(value)) return `${where}: must be one of ${arg.join(', ')}`;
    } else if (checker === 'bool') {
        if (typeof value !== 'boolean') return `${where}: must be true or false`;
    } else if (checker === 'bitrate') {
        if (typeof value !== 'string' || !BITRATE_RE.test(value)) return `${where}: must look like 2000k or 2M`;
    } else if (checker === 'time_offset') {
        if (typeof value !== 'string' || !TIME_OFFSET_RE.test(value)) return `${where}: must look like HH:MM:SS`;
    }
    return null;
}

/** The server's write-time validator (`config.validate`): the refusal message, or null when the value is acceptable. */
export function validateRenditionSetting(key: string, raw: unknown): string | null {
    const category = renditionCategoryForKey(key);
    if (!category) return null;
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { return `${key} must be a JSON object`; }
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return `${key} must be a JSON object`;
    const defaults = DEFAULTS[category];
    const valid = Object.keys(defaults).sort().join(', ');
    for (const [role, options] of Object.entries(parsed as Record<string, unknown>)) {
        if (role === '_automatic') {
            if (!Array.isArray(options) || options.some((entry) => typeof entry !== 'string')) return '_automatic: must be a list of role names';
            const unknown = options.find((entry) => !(entry in defaults));
            if (unknown !== undefined) return `_automatic: unknown role ${unknown} (valid: ${valid})`;
            continue;
        }
        if (!(role in defaults)) return `${role}: unknown role (valid: ${valid})`;
        if (options == null || typeof options !== 'object' || Array.isArray(options)) return `${role}: must be an object of options`;
        const schema = OPTION_SCHEMA[`${category}/${roleKind(category, role)}`]!;
        for (const [name, value] of Object.entries(options as Record<string, unknown>)) {
            const where = `${role}.${name}`;
            if (!(name in schema)) return `${where}: unknown option (valid: ${Object.keys(schema).sort().join(', ')})`;
            const problem = checkOption(where, schema[name]!, value);
            if (problem) return problem;
        }
        if ('codec' in schema) {
            const merged = (options as Options).format ?? defaults[role]!.format ?? 'mp4';
            if (merged !== 'mp4') {
                const present = MP4_ONLY.find((name) => name in (options as Options));
                if (present) return `${role}.${present}: only valid when format is mp4`;
            }
        }
    }
    return null;
}

function parseOverride(raw: string | null | undefined): Record<string, unknown> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** `config.describe()` over the mock's global Setting rows (`[key, raw value]`). */
export function describeRenditions(globalRows: Array<{ key: string; value: string }>): RenditionOptions {
    const categories = {} as RenditionOptions['categories'];
    for (const category of Object.keys(DEFAULTS) as RenditionCategoryKey[]) {
        const key = RENDITION_CATEGORY_KEYS[category];
        const defaults = DEFAULTS[category];
        const row = globalRows.find((candidate) => candidate.key === key);
        const override = parseOverride(row?.value);
        const roles: Record<string, Options> = {};
        for (const [role, base] of Object.entries(defaults)) {
            const extra = override[role];
            roles[role] = { ...base, ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra as Options : {}) };
        }
        const automaticOverride = override._automatic;
        const automatic = Array.isArray(automaticOverride)
            ? automaticOverride.filter((role): role is string => typeof role === 'string' && role in defaults)
            : [...AUTOMATIC_DEFAULT[category]];
        const kinds: Record<string, string> = {};
        for (const role of Object.keys(defaults)) kinds[role] = roleKind(category, role);
        const kindList = [...new Set(Object.values(kinds))].sort();
        const fields: Record<string, string[]> = {};
        const choices: Record<string, Record<string, string[]>> = {};
        for (const kind of kindList) {
            const schema = OPTION_SCHEMA[`${category}/${kind}`]!;
            fields[kind] = Object.keys(schema).sort();
            choices[kind] = Object.fromEntries(Object.entries(schema).filter(([, spec]) => spec[0] === 'choice').map(([name, spec]) => [name, [...(spec[1] as string[])]]));
        }
        const limits: Record<string, [number, number]> = {};
        for (const [name, bounds] of Object.entries(RENDITION_LIMITS)) {
            if (kindList.some((kind) => name in OPTION_SCHEMA[`${category}/${kind}`]!)) limits[name] = [...bounds] as [number, number];
        }
        categories[category] = {
            key,
            defaults: Object.fromEntries(Object.entries(defaults).map(([role, base]) => [role, { ...base }])),
            automatic_default: [...AUTOMATIC_DEFAULT[category]],
            override: Object.keys(override).length ? override : null,
            effective: { roles, automatic },
            role_kinds: kinds,
            fields,
            choices,
            limits,
        };
    }
    return { categories, engine: { key: 'FILEMAN_VIDEO_ENGINE', choices: ['ffmpeg'], effective: 'ffmpeg' } };
}
