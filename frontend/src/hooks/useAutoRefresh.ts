import { useEffect } from 'react';
import { AUTO_REFRESH_MS } from '../lib/autoRefresh';

export function useAutoRefresh(
  enabled: boolean,
  active: boolean,
  onTick: () => void
) {
  useEffect(() => {
    if (!enabled || !active) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    const start = () => {
      stop();
      timer = setInterval(onTick, AUTO_REFRESH_MS);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        onTick();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, active, onTick]);
}
