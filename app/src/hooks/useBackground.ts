import { useCallback, useEffect } from "react";
import { usePersistedState } from "./usePersistedState";

export type BackgroundSettings = {
  enabled: boolean;
  url: string | null;
  blur: number;
  opacity: number;
  dim: number;
  /** Opacity of the glass panels while a photo is active (40–95 %). */
  panelAlpha: number;
};

const DEFAULT_BACKGROUND: BackgroundSettings = {
  enabled: false,
  url: null,
  blur: 14,
  opacity: 70,
  dim: 58,
  panelAlpha: 68,
};

const isValidBackground = (value: unknown): value is BackgroundSettings => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BackgroundSettings>;
  return (
    typeof candidate.enabled === "boolean" &&
    (candidate.url === null || typeof candidate.url === "string") &&
    typeof candidate.blur === "number" &&
    typeof candidate.opacity === "number" &&
    typeof candidate.dim === "number" &&
    typeof candidate.panelAlpha === "number"
  );
};

export type BackgroundController = {
  settings: BackgroundSettings;
  set: <K extends keyof BackgroundSettings>(
    key: K,
    value: BackgroundSettings[K],
  ) => void;
  choose: () => Promise<void>;
  clear: () => Promise<void>;
  hasImage: boolean;
};

export function useBackground(): BackgroundController {
  const [settings, setSettings] = usePersistedState<BackgroundSettings>(
    "ui.background",
    DEFAULT_BACKGROUND,
    isValidBackground,
  );

  const set = useCallback(
    <K extends keyof BackgroundSettings>(
      key: K,
      value: BackgroundSettings[K],
    ) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [setSettings],
  );

  const choose = useCallback(async () => {
    const api = window.deepcwDesktop?.background;
    if (!api) return;
    const result = await api.choose();
    if (result) {
      setSettings((current) => ({
        ...current,
        url: result.url,
        enabled: true,
      }));
    }
  }, [setSettings]);

  const clear = useCallback(async () => {
    await window.deepcwDesktop?.background?.clear();
    setSettings((current) => ({ ...current, url: null, enabled: false }));
  }, [setSettings]);

  // Keep the glass panels readable: the user controls how opaque they are while
  // a photo is behind them (the default is a good contrast/detail balance).
  useEffect(() => {
    const root = document.documentElement;
    const hasImage = Boolean(settings.enabled && settings.url);
    root.style.setProperty(
      "--dcw-panel-alpha",
      hasImage ? String(settings.panelAlpha / 100) : "0.62",
    );
    root.style.setProperty(
      "--dcw-dim-alpha",
      String(settings.dim / 100),
    );
  }, [settings.dim, settings.enabled, settings.panelAlpha, settings.url]);

  return {
    settings,
    set,
    choose,
    clear,
    hasImage: Boolean(settings.enabled && settings.url),
  };
}
