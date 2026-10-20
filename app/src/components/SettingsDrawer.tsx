import {
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import type { BackgroundController } from "../hooks/useBackground";
import type { RigController } from "../hooks/useRig";
import type { WsjtxController } from "../hooks/useWsjtx";
import type { InferenceBackend } from "../utils/inferenceProtocol";
import { QUALITY_PRESETS, type QualityPreset } from "../quality";
import { DECODE_WINDOW_OPTIONS } from "../const";

export type DecodeSettings = {
  quality: QualityPreset;
  setQuality: (quality: QualityPreset) => void;
  model: InferenceBackend;
  setModel: (model: InferenceBackend) => void;
  windowSeconds: number;
  setWindowSeconds: (seconds: number) => void;
  bandwidth: number;
  setBandwidth: (bandwidth: number) => void;
  bandwidthOptions: readonly number[];
  language: "EN" | "EN/JA";
  setLanguage: (language: "EN" | "EN/JA") => void;
  timestamps: boolean;
  setTimestamps: (timestamps: boolean) => void;
  fontSize: number;
  setFontSize: (fontSize: number) => void;
};

type SettingsDrawerProps = {
  opened: boolean;
  onClose: () => void;
  decode: DecodeSettings;
  background: BackgroundController;
  rig: RigController;
  wsjtx: WsjtxController;
  version: string;
};

const BAUD_RATES = [4800, 9600, 19200, 38400, 57600, 115200];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={10}>
      <div className="dcw-section-title">{title}</div>
      {children}
    </Stack>
  );
}

function formatHz(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz) || hz <= 0) return "—";
  return hz.toLocaleString("en-US");
}

export function SettingsDrawer({
  opened,
  onClose,
  decode,
  background,
  rig,
  wsjtx,
  version,
}: SettingsDrawerProps) {
  const rigStatus = rig.status;
  const bg = background.settings;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={380}
      title={
        <Group gap={8}>
          <Text fw={700} size="sm" tt="uppercase" style={{ letterSpacing: "0.12em" }}>
            Settings
          </Text>
          <Text size="xs" c="dimmed">
            v{version}
          </Text>
        </Group>
      }
      overlayProps={{ backgroundOpacity: 0.35, blur: 3 }}
    >
      <Stack gap={22} pb={28}>
        <Section title="Decode">
          <SegmentedControl
            size="xs"
            radius="xl"
            fullWidth
            value={decode.quality}
            onChange={(value) => decode.setQuality(value as QualityPreset)}
            data={[
              { value: "high", label: QUALITY_PRESETS.high.label },
              { value: "balanced", label: QUALITY_PRESETS.balanced.label },
              { value: "fast", label: QUALITY_PRESETS.fast.label },
              { value: "custom", label: "Custom" },
            ]}
          />
          <Text size="xs" c="dimmed">
            {decode.quality === "custom"
              ? "Custom model / window combination."
              : QUALITY_PRESETS[decode.quality].description}
          </Text>

          <SimpleGrid cols={2} spacing="sm">
            <NativeSelect
              label="Model"
              size="xs"
              data={[
                { value: "standard", label: "Standard" },
                { value: "tiny", label: "Tiny" },
              ]}
              value={decode.model}
              onChange={(event) => {
                decode.setModel(event.currentTarget.value as InferenceBackend);
                decode.setQuality("custom");
              }}
            />
            <NativeSelect
              label="Window"
              size="xs"
              data={DECODE_WINDOW_OPTIONS.map((seconds) => ({
                value: String(seconds),
                label: `${seconds} s`,
              }))}
              value={String(decode.windowSeconds)}
              onChange={(event) => {
                decode.setWindowSeconds(Number(event.currentTarget.value));
                decode.setQuality("custom");
              }}
            />
            <NativeSelect
              label="Bandwidth"
              size="xs"
              data={decode.bandwidthOptions.map((width) => ({
                value: String(width),
                label: `${width} Hz`,
              }))}
              value={String(decode.bandwidth)}
              onChange={(event) =>
                decode.setBandwidth(Number(event.currentTarget.value))
              }
            />
            <NativeSelect
              label="CW language"
              size="xs"
              data={[
                { value: "EN", label: "English" },
                { value: "EN/JA", label: "EN + JA" },
              ]}
              value={decode.language}
              onChange={(event) =>
                decode.setLanguage(event.currentTarget.value as "EN" | "EN/JA")
              }
            />
          </SimpleGrid>

          <Group justify="space-between">
            <Text size="xs">Timestamps</Text>
            <Switch
              size="xs"
              checked={decode.timestamps}
              onChange={(event) =>
                decode.setTimestamps(event.currentTarget.checked)
              }
            />
          </Group>

          <div>
            <Group justify="space-between" mb={2}>
              <Text size="xs">Transcript font size</Text>
              <Text size="xs" c="dimmed" className="dcw-mono">
                {decode.fontSize}px
              </Text>
            </Group>
            <Slider
              size="xs"
              min={11}
              max={24}
              step={1}
              value={decode.fontSize}
              onChange={decode.setFontSize}
              color="deepcw"
            />
          </div>
        </Section>

        <Divider color="rgba(122,168,255,0.12)" />

        <Section title="Background">
          <Group justify="space-between">
            <Text size="xs">Use background image</Text>
            <Switch
              size="xs"
              checked={bg.enabled}
              disabled={!bg.url}
              onChange={(event) =>
                background.set("enabled", event.currentTarget.checked)
              }
            />
          </Group>

          <Group gap={6}>
            <Button
              size="compact-sm"
              variant="light"
              color="deepcw"
              onClick={() => void background.choose()}
            >
              Choose image…
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              disabled={!bg.url}
              onClick={() => void background.clear()}
            >
              Remove
            </Button>
          </Group>

          <div>
            <Group justify="space-between" mb={2}>
              <Text size="xs">Blur</Text>
              <Text size="xs" c="dimmed" className="dcw-mono">
                {bg.blur}px
              </Text>
            </Group>
            <Slider
              size="xs"
              min={0}
              max={40}
              step={1}
              value={bg.blur}
              onChange={(value) => background.set("blur", value)}
              disabled={!bg.enabled}
              color="deepcw"
            />
          </div>

          <div>
            <Group justify="space-between" mb={2}>
              <Text size="xs">Opacity</Text>
              <Text size="xs" c="dimmed" className="dcw-mono">
                {bg.opacity}%
              </Text>
            </Group>
            <Slider
              size="xs"
              min={5}
              max={100}
              step={1}
              value={bg.opacity}
              onChange={(value) => background.set("opacity", value)}
              disabled={!bg.enabled}
              color="deepcw"
            />
          </div>

          <div>
            <Group justify="space-between" mb={2}>
              <Text size="xs">Dark overlay</Text>
              <Text size="xs" c="dimmed" className="dcw-mono">
                {bg.dim}%
              </Text>
            </Group>
            <Slider
              size="xs"
              min={0}
              max={90}
              step={1}
              value={bg.dim}
              onChange={(value) => background.set("dim", value)}
              disabled={!bg.enabled}
              color="deepcw"
            />
          </div>

          <div>
            <Group justify="space-between" mb={2}>
              <Text size="xs">Panel opacity</Text>
              <Text size="xs" c="dimmed" className="dcw-mono">
                {bg.panelAlpha}%
              </Text>
            </Group>
            <Slider
              size="xs"
              min={40}
              max={95}
              step={1}
              value={bg.panelAlpha}
              onChange={(value) => background.set("panelAlpha", value)}
              disabled={!bg.enabled}
              color="deepcw"
            />
          </div>

          <Text size="xs" c="dimmed">
            Raise the panel opacity if text is hard to read over a busy photo.
          </Text>
        </Section>

        <Divider color="rgba(122,168,255,0.12)" />

        <Section title="Radio control (CAT)">
          <Group justify="space-between">
            <Text size="xs">Enable rig control</Text>
            <Switch
              size="xs"
              checked={rig.config.enabled}
              onChange={(event) =>
                rig.setConfig({ enabled: event.currentTarget.checked })
              }
            />
          </Group>

          <Group gap={6} align="flex-end">
            <NativeSelect
              label="Serial port"
              size="xs"
              style={{ flex: 1 }}
              data={
                rig.ports.length > 0
                  ? rig.ports.map((port) => ({
                      value: port.path,
                      label: port.description
                        ? `${port.path} — ${port.description}`
                        : port.path,
                    }))
                  : [{ value: "", label: "No ports found" }]
              }
              value={rig.config.path}
              onChange={(event) =>
                rig.setConfig({ path: event.currentTarget.value })
              }
            />
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() => void rig.refreshPorts()}
            >
              ↻
            </Button>
          </Group>

          <SimpleGrid cols={2} spacing="sm">
            <NativeSelect
              label="Baud rate"
              size="xs"
              data={BAUD_RATES.map((rate) => ({
                value: String(rate),
                label: String(rate),
              }))}
              value={String(rig.config.baudRate)}
              onChange={(event) =>
                rig.setConfig({ baudRate: Number(event.currentTarget.value) })
              }
            />
            <NativeSelect
              label="Protocol"
              size="xs"
              data={[
                { value: "kenwood", label: "Kenwood / Elecraft" },
                { value: "yaesu", label: "Yaesu" },
                { value: "icom", label: "Icom CI-V" },
              ]}
              value={rig.config.protocol}
              onChange={(event) =>
                rig.setConfig({
                  protocol: event.currentTarget.value as
                    | "kenwood"
                    | "yaesu"
                    | "icom",
                })
              }
            />
            <TextInput
              label="CI-V address"
              size="xs"
              placeholder="94"
              value={rig.config.civAddress.toString(16).toUpperCase()}
              onChange={(event) => {
                const parsed = Number.parseInt(event.currentTarget.value, 16);
                rig.setConfig({
                  civAddress: Number.isFinite(parsed) ? parsed : 0x94,
                });
              }}
              disabled={rig.config.protocol !== "icom"}
            />
            <NumberInput
              label="Poll (ms)"
              size="xs"
              min={200}
              max={5000}
              step={100}
              value={rig.config.pollMs}
              onChange={(value) =>
                rig.setConfig({ pollMs: Number(value) || 800 })
              }
            />
          </SimpleGrid>

          <Group gap={6}>
            {rigStatus.connected ? (
              <Button
                size="compact-sm"
                variant="light"
                color="red"
                onClick={() => void rig.disconnect()}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size="compact-sm"
                variant="light"
                color="deepcw"
                onClick={() => {
                  rig.setConfig({ enabled: true });
                  void rig.connect();
                }}
              >
                Connect
              </Button>
            )}
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              disabled={!rigStatus.connected}
              onClick={() => void rig.setMode("CW")}
            >
              Set CW
            </Button>
            <Button
              size="compact-sm"
              variant={rigStatus.ptt ? "filled" : "subtle"}
              color={rigStatus.ptt ? "red" : "gray"}
              disabled={!rigStatus.connected}
              onClick={() => void rig.setPtt(!rigStatus.ptt)}
            >
              {rigStatus.ptt ? "TX ON" : "TX"}
            </Button>
          </Group>

          <Group gap={6} wrap="nowrap">
            <span
              className={`dcw-led ${
                rigStatus.connected
                  ? "dcw-led--on"
                  : rigStatus.error
                    ? "dcw-led--err"
                    : ""
              }`}
            />
            <Text size="xs" c="dimmed">
              {rigStatus.connected
                ? `${formatHz(rigStatus.frequency)} Hz · ${rigStatus.mode}`
                : rigStatus.error || "Not connected"}
            </Text>
          </Group>
        </Section>

        <Divider color="rgba(122,168,255,0.12)" />

        <Section title="Network (N1MM / WSJT-X)">
          <Group justify="space-between">
            <Text size="xs">Send WSJT-X UDP messages</Text>
            <Switch
              size="xs"
              checked={wsjtx.config.enabled}
              onChange={(event) =>
                wsjtx.setConfig({ enabled: event.currentTarget.checked })
              }
            />
          </Group>

          <SimpleGrid cols={2} spacing="sm">
            <TextInput
              label="Host"
              size="xs"
              value={wsjtx.config.host}
              onChange={(event) =>
                wsjtx.setConfig({ host: event.currentTarget.value })
              }
            />
            <NumberInput
              label="Port"
              size="xs"
              min={1}
              max={65535}
              value={wsjtx.config.port}
              onChange={(value) =>
                wsjtx.setConfig({ port: Number(value) || 2237 })
              }
            />
          </SimpleGrid>

          <Group justify="space-between">
            <Text size="xs">UDP broadcast</Text>
            <Switch
              size="xs"
              checked={wsjtx.config.broadcast}
              onChange={(event) =>
                wsjtx.setConfig({ broadcast: event.currentTarget.checked })
              }
            />
          </Group>

          <Group gap={6}>
            <Button
              size="compact-sm"
              variant="light"
              color="deepcw"
              onClick={() =>
                wsjtx.sendStatus({
                  dialFrequency: rigStatus.frequency ?? 0,
                  mode: "CW",
                  decoding: false,
                })
              }
            >
              Test status
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() =>
                wsjtx.sendDecode({
                  message: "DEEPCW DESKTOP TEST",
                  deltaFrequency: 800,
                })
              }
            >
              Test decode
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            N1MM+ listens on UDP 2237 (WSJT-X broadcast). Status messages carry
            the dial frequency, decode messages carry the audio offset, so spots
            land on the right frequency.
          </Text>
        </Section>

        <Divider color="rgba(122,168,255,0.12)" />

        <Section title="About">
          <Text size="xs" c="dimmed">
            DeepCW Desktop v{version} — local build of the DeepCW neural CW
            decoder. Decoder engine and models © 2026 e04 (AGPL-3.0-only).
          </Text>
          <Group gap={8}>
            <Badge variant="light" color="deepcw">
              Offline
            </Badge>
            <Badge variant="light" color="gray">
              Electron
            </Badge>
            <Badge variant="light" color="gray">
              WASM engine
            </Badge>
          </Group>
        </Section>
      </Stack>
    </Drawer>
  );
}
