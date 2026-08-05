// ThemeManager port: the preference/resolved two-value model. Preference is
// 'light' | 'dark' | 'system' (persisted); resolved is what's on screen.
// Stamps data-theme on <html>; all tokens key off it (see theme.css).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'mojo:theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function resolve(pref: ThemePref): Resolved {
    return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
}

const ThemeContext = createContext<{ pref: ThemePref; resolved: Resolved; setPref: (p: ThemePref) => void }>({
    pref: 'system',
    resolved: 'light',
    setPref: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [pref, setPrefState] = useState<ThemePref>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
        } catch { return 'system'; }
    });
    const [resolved, setResolved] = useState<Resolved>(() => resolve(pref));

    useEffect(() => {
        const apply = () => setResolved(resolve(pref));
        apply();
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [pref]);

    useEffect(() => {
        document.documentElement.dataset.theme = resolved;
    }, [resolved]);

    const setPref = (p: ThemePref) => {
        setPrefState(p);
        try { localStorage.setItem(STORAGE_KEY, p); } catch { /* private mode */ }
    };

    return <ThemeContext.Provider value={{ pref, resolved, setPref }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    return useContext(ThemeContext);
}
