import { createContext, useContext, type ReactNode } from "react";
import type { RayucodePlatformAdapter } from "./types.js";

const RayucodePlatformContext = createContext<RayucodePlatformAdapter | null>(null);

export interface RayucodePlatformProviderProps {
  adapter: RayucodePlatformAdapter;
  children: ReactNode;
}

export function RayucodePlatformProvider({
  adapter,
  children,
}: RayucodePlatformProviderProps) {
  return (
    <RayucodePlatformContext.Provider value={adapter}>
      {children}
    </RayucodePlatformContext.Provider>
  );
}

export function useRayucodePlatform(): RayucodePlatformAdapter {
  const ctx = useContext(RayucodePlatformContext);
  if (!ctx) {
    throw new Error(
      "useRayucodePlatform must be called inside <RayucodePlatformProvider adapter={...}>",
    );
  }
  return ctx;
}
