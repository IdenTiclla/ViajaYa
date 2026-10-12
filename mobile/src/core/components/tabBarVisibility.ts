/**
 * Lets a screen inside a tab take the whole window (no bottom bar), like the location gate.
 * A counter instead of a flag so two overlapping full-screen views can never leave the bar hidden.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

type TabBarVisibility = {
  hiders: number;
  hide: () => void;
  show: () => void;
};

export const useTabBarVisibility = create<TabBarVisibility>((set) => ({
  hiders: 0,
  hide: () => set((state) => ({ hiders: state.hiders + 1 })),
  show: () => set((state) => ({ hiders: Math.max(0, state.hiders - 1) })),
}));

/** True while any screen asked for full screen. */
export function useTabBarHidden(): boolean {
  return useTabBarVisibility((state) => state.hiders > 0);
}

/** Hides the bottom bar while `hidden` is true and the caller is mounted. */
export function useHideTabBar(hidden: boolean): void {
  useEffect(() => {
    if (!hidden) return;
    const { hide, show } = useTabBarVisibility.getState();
    hide();
    return show;
  }, [hidden]);
}
