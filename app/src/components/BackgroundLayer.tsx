import type { BackgroundSettings } from "../hooks/useBackground";

type BackgroundLayerProps = {
  settings: BackgroundSettings;
};

/**
 * Background photo rendered inside the app shell (absolutely positioned behind
 * the panels). Keeping it in the same stacking context as the UI means the
 * translucent panels composite against it correctly.
 */
export function BackgroundLayer({ settings }: BackgroundLayerProps) {
  if (!settings.enabled || !settings.url) {
    return null;
  }

  return (
    <>
      <div
        className="dcw-bg-layer"
        style={{ opacity: settings.opacity / 100 }}
        aria-hidden="true"
      >
        <img
          src={settings.url}
          alt=""
          draggable={false}
          style={{
            filter: `blur(${settings.blur}px) saturate(118%)`,
          }}
        />
      </div>
      <div className="dcw-bg-dim" aria-hidden="true" />
    </>
  );
}
