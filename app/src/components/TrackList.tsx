import { useEffect, useRef } from "react";
import { Box, Button, Group, Text } from "@mantine/core";
import { useI18n } from "../i18n";
import { HIGHLIGHT_COLORS, highlightText } from "../utils/highlight";
import type { PileupRow } from "../hooks/usePileupDecode";

type TrackListProps = {
  rows: PileupRow[];
  isDecoding: boolean;
  dialHz: number | null;
  canQsy: boolean;
  onQsy: (audioFrequency: number) => void;
  onCopy: (text: string) => void;
  onClearRow: (id: number) => void;
  onClearAll: () => void;
  grow?: boolean;
};

/** Text strip that always keeps the newest characters in view. */
function AutoScrollText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
  }, [text]);

  return (
    <div ref={ref} className="dcw-track-text" title={text}>
      {text
        ? highlightText(text).map((segment, index) => (
            <span
              key={index}
              style={
                segment.kind
                  ? { color: HIGHLIGHT_COLORS[segment.kind], fontWeight: 600 }
                  : undefined
              }
            >
              {segment.text}
            </span>
          ))
        : "…"}
    </div>
  );
}

export function TrackList({
  rows,
  isDecoding,
  dialHz,
  canQsy,
  onQsy,
  onCopy,
  onClearRow,
  onClearAll,
  grow = false,
}: TrackListProps) {
  const { t } = useI18n();

  return (
    <Box
      className="dcw-panel"
      style={{
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        ...(grow ? { flex: 1, minHeight: 0 } : {}),
      }}
    >
      <Group
        justify="space-between"
        px={12}
        py={7}
        style={{ borderBottom: "1px solid var(--dcw-border)", flex: "none" }}
      >
        <Group gap={10}>
          <Text size="sm" fw={700} style={{ letterSpacing: "0.04em" }}>
            {t("tracks.title")}
          </Text>
          <Text size="xs" c="dimmed">
            {rows.filter((row) => row.active).length}
          </Text>
        </Group>
        <Group gap={8}>
          <span className={`dcw-led ${isDecoding ? "dcw-led--on" : ""}`} />
          <Button
            size="compact-xs"
            variant="default"
            onClick={onClearAll}
            disabled={rows.length === 0}
          >
            {t("tracks.clearAll")}
          </Button>
        </Group>
      </Group>

      <Box
        style={{
          overflowY: "auto",
          maxHeight: grow ? undefined : 190,
          flex: grow ? 1 : undefined,
          minHeight: 0,
        }}
      >
        {rows.length === 0 ? (
          <Text size="xs" c="dimmed" p={14}>
            {t("tracks.empty")}
          </Text>
        ) : (
          rows.map((row) => {
            const absolute = dialHz != null ? dialHz + row.frequency : null;
            return (
              <div
                className="dcw-track-row"
                key={row.id}
                style={{ opacity: row.active ? 1 : 0.55 }}
              >
                <Text size="xs" className="dcw-mono" c="blue.3" fw={600}>
                  {row.frequency} Hz
                </Text>
                <Text size="xs" c="dimmed" className="dcw-mono">
                  {absolute != null ? absolute.toLocaleString("en-US") : "—"}
                </Text>
                <AutoScrollText text={row.text} />
                <Group gap={4} wrap="nowrap">
                  <Button
                    size="compact-xs"
                    variant="default"
                    disabled={!canQsy}
                    onClick={() => onQsy(row.frequency)}
                  >
                    {t("tracks.qsy")}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    disabled={!row.text}
                    onClick={() => onCopy(row.text)}
                  >
                    {t("tracks.copy")}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    title={t("tracks.clearRowTip")}
                    aria-label={t("tracks.clearRowTip")}
                    onClick={() => onClearRow(row.id)}
                  >
                    ✕
                  </Button>
                </Group>
              </div>
            );
          })
        )}
      </Box>
    </Box>
  );
}
