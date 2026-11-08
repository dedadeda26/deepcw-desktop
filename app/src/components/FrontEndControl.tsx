import { useEffect, useRef, useState } from "react";
import { Box, Group, SegmentedControl, Stack, Switch, Text, Tooltip } from "@mantine/core";
import { MAX_FREQ_HZ, MIN_FREQ_HZ } from "../const";
import { useI18n, type MessageKey } from "../i18n";
import type {
  FrontEndProfileName,
  FrontEndSettings,
  FrontEndStatus,
} from "../utils/cwFilter";

type FrontEndControlProps = {
  settings: FrontEndSettings;
  onChange: (patch: Partial<FrontEndSettings>) => void;
  status: FrontEndStatus;
  filterFreq: number;
  filterWidth: number;
  minFreqHz?: number;
  maxFreqHz?: number;
};

/**
 * Compact passband picture: the decode band selected on the waterfall (faint)
 * and the passband the front end actually opened around the tracked tone.
 */
function FilterShape({
  status,
  filterFreq,
  filterWidth,
  minFreqHz,
  maxFreqHz,
}: {
  status: FrontEndStatus;
  filterFreq: number;
  filterWidth: number;
  minFreqHz: number;
  maxFreqHz: number;
}) {
  const width = 64;
  const height = 24;
  const pad = 1;
  const inner = width - pad * 2;
  const toX = (hz: number) =>
    pad +
    ((Math.min(Math.max(hz, minFreqHz), maxFreqHz) - minFreqHz) /
      (maxFreqHz - minFreqHz)) *
      inner;

  const bandLow = toX(filterFreq - filterWidth / 2);
  const bandHigh = toX(filterFreq + filterWidth / 2);

  const locked = status.locked && status.toneHz > 0;
  const engaged = status.mix > 0.05;
  // `bandHz` is the full bandwidth reported by the front end.
  const half = Math.max(28, status.bandHz) / 2;
  const passLow = toX(status.toneHz - half);
  const passHigh = toX(status.toneHz + half);
  const toneX = toX(status.toneHz);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", flex: "none" }}
      aria-hidden
    >
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={3}
        fill="#0b0f14"
        stroke="rgba(255,255,255,0.10)"
      />
      <rect
        x={bandLow}
        y={2}
        width={Math.max(1, bandHigh - bandLow)}
        height={height - 4}
        fill="rgba(92,139,255,0.14)"
      />
      {locked ? (
        <>
          <rect
            x={passLow}
            y={4}
            width={Math.max(1.5, passHigh - passLow)}
            height={height - 8}
            rx={1.5}
            fill={engaged ? "rgba(92,139,255,0.6)" : "rgba(92,139,255,0.10)"}
            stroke="rgba(146,178,255,0.95)"
            strokeWidth={1}
            strokeDasharray={engaged ? undefined : "2 2"}
          />
          <line
            x1={toneX}
            y1={3}
            x2={toneX}
            y2={height - 3}
            stroke="#e6eeff"
            strokeWidth={1}
          />
        </>
      ) : (
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke="rgba(146,178,255,0.3)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      )}
    </svg>
  );
}

export function FrontEndControl({
  settings,
  onChange,
  status,
  filterFreq,
  filterWidth,
  minFreqHz = MIN_FREQ_HZ,
  maxFreqHz = MAX_FREQ_HZ,
}: FrontEndControlProps) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!opened) return;
    const onPointerDown = (event: PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) setOpened(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpened(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [opened]);

  const bypassing = settings.enabled && status.mix <= 0.05;
  const statusText = !settings.enabled
    ? t("filter.statusIdle")
    : status.locked
      ? `${Math.round(status.toneHz)} Hz · ${Math.round(status.wpm)} WPM${
          bypassing ? ` · ${t("filter.statusBypass")}` : ""
        }`
      : t("filter.statusAcquiring");

  const rows: [keyof FrontEndSettings, MessageKey][] = [
    ["autoBand", "filter.autoBand"],
    ["followSelection", "filter.followSelection"],
    ["humEnabled", "filter.hum"],
    ["notchEnabled", "filter.notch"],
    ["forceEngage", "filter.force"],
  ];

  return (
    <div className="dcw-filter-wrap" ref={wrapRef}>
      <Group gap={0} wrap="nowrap" className={`dcw-filter-toggle ${settings.enabled ? "dcw-filter-toggle--on" : ""}`}>
        <button
          type="button"
          className="dcw-filter-btn"
          onClick={() => onChange({ enabled: !settings.enabled })}
          title={t("filter.toggleTip")}
        >
          DSP
        </button>
        <button
          type="button"
          className={`dcw-filter-caret ${opened ? "dcw-filter-caret--open" : ""}`}
          onClick={() => setOpened((value) => !value)}
          title={t("filter.optionsTip")}
          aria-label={t("filter.section")}
          aria-expanded={opened}
        >
          <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M2 4.2 6 8.2l4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </Group>

      {settings.enabled && (
        <Tooltip label={t("filter.shapeTip")} withArrow openDelay={400}>
          <Box className="dcw-filter-shape">
            <FilterShape
              status={status}
              filterFreq={filterFreq}
              filterWidth={filterWidth}
              minFreqHz={minFreqHz}
              maxFreqHz={maxFreqHz}
            />
          </Box>
        </Tooltip>
      )}

      {settings.enabled && (
        <span
          className={`dcw-filter-status ${bypassing ? "dcw-filter-status--dim" : ""}`}
          title={t("filter.shapeTip")}
        >
          {statusText}
        </span>
      )}

      {opened && (
        <div className="dcw-filter-menu">
          <Stack gap={8}>
            <Group justify="space-between" gap={8} wrap="nowrap">
              <Text size="xs" fw={700} className="dcw-label">
                {t("filter.section")}
              </Text>
              <Switch
                size="xs"
                checked={settings.enabled}
                onChange={(event) =>
                  onChange({ enabled: event.currentTarget.checked })
                }
                label={t("filter.enableShort")}
                labelPosition="left"
                styles={{ label: { fontSize: 12 } }}
              />
            </Group>

            <div>
              <Text size="xs" c="dimmed" mb={4}>
                {t("filter.strength")}
              </Text>
              <SegmentedControl
                size="xs"
                fullWidth
                disabled={!settings.enabled}
                value={settings.profile}
                onChange={(value) =>
                  onChange({ profile: value as FrontEndProfileName })
                }
                data={[
                  { value: "mild", label: t("filter.strengthMild") },
                  { value: "normal", label: t("filter.strengthNormal") },
                  { value: "aggressive", label: t("filter.strengthAggressive") },
                ]}
              />
            </div>

            <Stack gap={6}>
              {rows.map(([key, label]) => (
                <Switch
                  key={key}
                  size="xs"
                  disabled={!settings.enabled}
                  checked={Boolean(settings[key])}
                  onChange={(event) =>
                    onChange({ [key]: event.currentTarget.checked })
                  }
                  label={t(label)}
                  styles={{ label: { fontSize: 12 } }}
                />
              ))}
            </Stack>

            <Text size="xs" c="dimmed">
              {t("filter.hint")}
            </Text>
          </Stack>
        </div>
      )}
    </div>
  );
}
