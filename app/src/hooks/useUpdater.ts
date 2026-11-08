import { useCallback, useEffect, useState } from "react";
import type { DeepCWUpdateStatus } from "../deepcw-desktop";

const FALLBACK: DeepCWUpdateStatus = {
  enabled: false,
  phase: "idle",
  currentVersion: "",
  availableVersion: null,
  percent: 0,
  error: null,
};

/**
 * Mirrors the main-process auto-updater state into React. All the work
 * (checking, downloading, installing) happens in the main process; this hook
 * only reflects it and exposes the triggering calls.
 */
export function useUpdater() {
  const api =
    typeof window === "undefined" ? undefined : window.deepcwDesktop?.updater;
  const [status, setStatus] = useState<DeepCWUpdateStatus>(FALLBACK);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void api
      .status()
      .then((next) => {
        if (!cancelled && next) setStatus(next);
      })
      .catch(() => undefined);

    const unsubscribe = api.onStatus((next) => {
      if (next) setStatus(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const check = useCallback(() => {
    void api?.check().catch(() => undefined);
  }, [api]);

  const download = useCallback(() => {
    void api?.download().catch(() => undefined);
  }, [api]);

  const install = useCallback(() => {
    void api?.install().catch(() => undefined);
  }, [api]);

  const openReleases = useCallback(() => {
    void api?.openReleases().catch(() => undefined);
  }, [api]);

  return {
    status,
    available: Boolean(api),
    check,
    download,
    install,
    openReleases,
  };
}
