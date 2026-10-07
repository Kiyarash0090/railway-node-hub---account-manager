import { useCallback, useRef } from 'react';
import { HubTab } from '../context/HubContext';

export const MOBILE_NAV_TABS: readonly HubTab[] = ['dashboard', 'nodes', 'metrics', 'accounts'] as const;

interface UseMobileSwipeOptions {
  tabs?: readonly HubTab[];
  activeTab: HubTab;
  onTabChange: (tab: HubTab) => void;
  disabled?: boolean;
}

interface TouchPoint {
  x: number;
  y: number;
  time: number;
  ignored: boolean;
}

/**
 * Detects fluid horizontal finger swipes between tabs on mobile devices.
 * Respects RTL layout (Persian):
 * - Swipe to Left (deltaX < 0): advances to next tab on the left (e.g. dashboard -> nodes -> metrics -> accounts)
 * - Swipe to Right (deltaX > 0): returns to previous tab on the right (e.g. accounts -> metrics -> nodes -> dashboard)
 * Safely ignores vertical scrolling and interactions inside scrollable carousels/inputs.
 */
export function useMobileSwipe({
  tabs = MOBILE_NAV_TABS,
  activeTab,
  onTabChange,
  disabled = false,
}: UseMobileSwipeOptions) {
  const startRef = useRef<TouchPoint | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || e.touches.length !== 1) {
        startRef.current = null;
        return;
      }

      const touch = e.touches[0];
      const target = e.target as HTMLElement | null;

      // Ignore if user touches an interactive control or scrollable container
      const scrollable = target?.closest('.overflow-x-auto, .overflow-x-scroll') as HTMLElement | null;
      const isScrollContainer = scrollable && scrollable.scrollWidth > scrollable.clientWidth + 5;

      const ignored = Boolean(
        target?.closest(
          'input, textarea, select, pre, code, [data-no-swipe], [role="dialog"], [role="slider"]'
        ) || isScrollContainer
      );

      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
        ignored,
      };
    },
    [disabled]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!startRef.current || startRef.current.ignored || disabled) {
        startRef.current = null;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startRef.current.x;
      const deltaY = touch.clientY - startRef.current.y;
      const elapsed = Date.now() - startRef.current.time;
      startRef.current = null;

      // Minimum swipe distance (48px), max duration (500ms), and must be predominantly horizontal
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX < 48 || absX < absY * 1.35 || elapsed > 550) {
        return;
      }

      const currentIndex = tabs.indexOf(activeTab);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;

      // RTL rules:
      // deltaX < 0 => finger moved left => navigate to tab to the left (next index)
      // deltaX > 0 => finger moved right => navigate to tab to the right (previous index)
      if (deltaX < 0 && currentIndex < tabs.length - 1) {
        nextIndex = currentIndex + 1;
      } else if (deltaX > 0 && currentIndex > 0) {
        nextIndex = currentIndex - 1;
      }

      if (nextIndex !== currentIndex) {
        // Optional subtle haptic feedback for supported mobile devices
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try {
            navigator.vibrate(10);
          } catch (err) {}
        }
        onTabChange(tabs[nextIndex]);
      }
    },
    [tabs, activeTab, onTabChange, disabled]
  );

  return {
    onTouchStart,
    onTouchEnd,
  };
}
