// PersonaProvider — owns the active persona. One owner, three outputs:
//   · React context ({ persona, def, personas, available, setPersona })
//   · the ui/active-persona signal (menu resolution's pure input)
//   · <html data-persona> + <html data-density> for persona-scoped styling
//     (persona-scoped CSS vars MUST carry :root defaults — see docs/personas.md)
//
// Persistence: `mojo:persona` via client/persist — VALIDATED against the
// defined slugs, so stale/garbage storage never becomes the active persona.
// Availability snap mirrors wmx viewMode: once `me` resolves and at least one
// persona is available, a persona the user doesn't hold snaps to the first
// available one (state-only — the stored choice survives for when grants
// return). Zero-available (authenticated but every gate fails) keeps the
// current defined persona: menus still permission-filter fail-closed, so an
// over-optimistic persona can show at most an empty shell, never a grant.
import {
    createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore,
    type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useMe } from '../client/me';
import { readPersisted, writePersisted } from '../client/persist';
import { setActivePersona } from '../ui/active-persona';
import {
    availablePersonas, getPersona, getPersonas, personasVersion, subscribePersonas,
    type PersonaDef,
} from './registry';
import { personasOwningPath } from './sections';

const PERSONA_KEY = 'mojo:persona';

export interface PersonaContextValue {
    /** Active persona slug — null only when no personas are defined. */
    persona: string | null;
    /** The active persona's definition. */
    def: PersonaDef | null;
    /** Every defined persona (switchers render `available`, not this). */
    personas: readonly PersonaDef[];
    /** Personas the signed-in user may operate as (gates applied). */
    available: PersonaDef[];
    setPersona: (slug: string) => void;
}

const Ctx = createContext<PersonaContextValue | null>(null);

function validSlug(raw: unknown): string | null {
    return typeof raw === 'string' && getPersona(raw) ? raw : null;
}

export function PersonaProvider({ children, fallback }: {
    children: ReactNode;
    /** Preferred initial slug when nothing (valid) is stored. */
    fallback?: string;
}) {
    // Re-render on late definePersonas (HMR, lazy boot order).
    const registryVersion = useSyncExternalStore(subscribePersonas, personasVersion, personasVersion);
    const personas = getPersonas();

    const [persona, setPersonaState] = useState<string | null>(() =>
        readPersisted<string>(PERSONA_KEY, validSlug)
        ?? (fallback != null && getPersona(fallback) ? fallback : null)
        ?? personas[0]?.slug
        ?? null);

    const { data: me } = useMe();
    // registryVersion is a dep so a late definePersonas refreshes availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const available = useMemo(() => availablePersonas(me ?? null), [me, registryVersion]);

    // Snap to a persona the user actually holds once grants are known —
    // convergent effect (mirrors wmx viewMode.tsx): state-only, no persist.
    useEffect(() => {
        if (available.length === 0) return;
        if (!available.some((d) => d.slug === persona)) setPersonaState(available[0]!.slug);
    }, [available, persona]);

    // No-personas boot order: if the registry fills after mount, adopt the
    // stored/fallback/first slug the initializer would have picked.
    useEffect(() => {
        if (persona != null || personas.length === 0) return;
        setPersonaState(
            readPersisted<string>(PERSONA_KEY, validSlug)
            ?? (fallback != null && getPersona(fallback) ? fallback : null)
            ?? personas[0]!.slug,
        );
    }, [persona, personas, fallback]);

    // Apply: the menu-resolution signal + root dataset attributes. SSR-safe.
    useEffect(() => {
        setActivePersona(persona);
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        if (persona == null) {
            delete root.dataset.persona;
            delete root.dataset.density;
        } else {
            root.dataset.persona = persona;
            root.dataset.density = getPersona(persona)?.density ?? 'dense';
        }
    }, [persona]);

    // Unmount-only reset, so a shell without the provider (or a demo page
    // that mounted one) never inherits stale signal/dataset state.
    useEffect(() => () => {
        setActivePersona(null);
        if (typeof document !== 'undefined') {
            delete document.documentElement.dataset.persona;
            delete document.documentElement.dataset.density;
        }
    }, []);

    const value = useMemo<PersonaContextValue>(() => ({
        persona,
        def: persona != null ? getPersona(persona) ?? null : null,
        personas,
        available,
        setPersona: (slug) => {
            if (!getPersona(slug)) {
                console.warn(`setPersona: unknown persona "${slug}" ignored`);
                return;
            }
            writePersisted(PERSONA_KEY, slug);
            setPersonaState(slug);
        },
    }), [persona, personas, available]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePersona(): PersonaContextValue {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('usePersona requires <PersonaProvider>');
    return ctx;
}

/**
 * Convergent route→persona follower (the wmx useLensFollowsRoute pattern):
 * when navigation lands on a route owned by other personas' sections (per
 * personaSectionRoutes/personaSectionsMenu wiring) and the user HOLDS one of
 * the owners, the active persona switches to it. Never navigates, never
 * switches to a persona the user doesn't hold.
 */
export function usePersonaFollowsRoute(): void {
    const { persona, available, setPersona } = usePersona();
    const { pathname } = useLocation();
    useEffect(() => {
        const owners = personasOwningPath(pathname);
        if (owners.length === 0 || (persona != null && owners.includes(persona))) return;
        const target = owners.find((slug) => available.some((d) => d.slug === slug));
        if (target) setPersona(target);
    }, [pathname, persona, available, setPersona]);
}
