import { createContext, useContext } from 'react';

/** Internal registration facts for mount-aware links; never an authority decision. */
export interface AdminRouteContextValue { mount: string; paths: readonly string[] }
export const AdminRouteContext = createContext<AdminRouteContextValue | null>(null);
export const useAdminRouteContext = () => useContext(AdminRouteContext);
