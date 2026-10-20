import { useState } from "react";
import {
  Badge,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useI18n, type MessageKey } from "../i18n";
import type { BackgroundController } from "../hooks/useBackground";
import type { RigController } from "../hooks/useRig";
import type { WsjtxController } from "../hooks/useWsjtx";
import type { InferenceBackend } from "../utils/inferenceProtocol";
import type { QualityPreset } from "../quality";
import { DECODE_WINDOW_OPTIONS } from "../const";
import type { Lang } from "../i18n";

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

export type AudioDeviceOption = { id: string; label: string };

export type AudioSettings = {
  inputDevices: AudioDeviceOption[];
  selectedInput: string;
  onSelectInput: (id: string) => void;
  outputDevices: AudioDeviceOption[];
  selectedOutput: string;
  onSelectOutput: (id: string) => void;
  onRefreshDevices: () => void;
  showOutput: boolean;
};

export type SettingsPageProps = {
  onClose: () => void;
  decode: DecodeSettings;
  audio: AudioSettings;
  background: BackgroundController;
  rig: RigController;
  wsjtx: WsjtxController;
  onOpenDataFolder: () => void;
  onResetSettings: () => void;
  version: string;
};

type TabKey =
  | "general"
  | "radio"
  | "audio"
  | "network"
  | "display"
  | "advanced"
  | "about";

const TABS: { key: TabKey; label: MessageKey }[] = [
  { key: "general", label: "settings.tabs.general" },
  { key: "radio", label: "settings.tabs.radio" },
  { key: "audio", label: "settings.tabs.audio" },
  { key: "network", label: "settings.tabs.network" },
  { key: "display", label: "settings.tabs.display" },
  { key: "advanced", label: "settings.tabs.advanced" },
  { key: "about", label: "settings.tabs.about" },
];

const BAUD_RATES = [4800, 9600, 19200, 38400, 57600, 115200];

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: hint ? 2 : 8 }}>
      <div className="dcw-field">
        <div className="dcw-field-label">{label}</div>
        <div className="dcw-field-control">{children}</div>
      </div>
      {hint && (
        <Text size="xs" c="dimmed" pl={217} pb={6}>
          {hint}
        </Text>
      )}
    </div>
  );
}

export function SettingsPage({
  onClose,
  decode,
  audio,
  background,
  rig,
  wsjtx,
  onOpenDataFolder,
  onResetSettings,
  version,
}: SettingsPageProps) {
  const [tab, setTab] = useState<TabKey>("general");
  const { t, lang, setLang } = useI18n();
  const bg = background.settings;
  const [detectError, setDetectError] = useState(false);

  const qualityDescription: MessageKey =
    decode.quality === "custom"
      ? "quality.customDesc"
      : (`quality.${decode.quality}Desc` as MessageKey);

  return (
    <div className="dcw-settings dcw-panel-plain">
      <div className="dcw-settings-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={`dcw-settings-tab ${
              tab === entry.key ? "dcw-settings-tab--active" : ""
            }`}
            onClick={() => setTab(entry.key)}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>

      <div className="dcw-settings-body">
        {tab === "general" && (
          <Stack gap={4}>
            <div className="dcw-subhead">{t("general.section.decode")}</div>
            <Row label={t("general.quality")}>
              <SegmentedControl
                size="xs"
                fullWidth
                value={decode.quality}
                onChange={(value) => decode.setQuality(value as QualityPreset)}
                data={[
                  { value: "high", label: t("quality.high") },
                  { value: "balanced", label: t("quality.balanced") },
                  { value: "fast", label: t("quality.fast") },
                  { value: "custom", label: t("quality.custom") },
                ]}
              />
            </Row>
            <Text size="xs" c="dimmed" pl={217} pb={8}>
              {t(qualityDescription)}
            </Text>

            <Row label={t("general.model")}>
              <NativeSelect
                size="xs"
                data={[
                  { value: "standard", label: t("model.standard") },
                  { value: "tiny", label: t("model.tiny") },
                ]}
                value={decode.model}
                onChange={(event) => {
                  decode.setModel(event.currentTarget.value as InferenceBackend);
                  decode.setQuality("custom");
                }}
              />
            </Row>
            <Row label={t("general.window")}>
              <NativeSelect
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
            </Row>
            <Row label={t("general.bandwidth")}>
              <NativeSelect
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
            </Row>
            <Row label={t("general.cwLang")}>
              <NativeSelect
                size="xs"
                data={[
                  { value: "EN", label: t("lang.english") },
                  { value: "EN/JA", label: t("lang.enJa") },
                ]}
                value={decode.language}
                onChange={(event) =>
                  decode.setLanguage(event.currentTarget.value as "EN" | "EN/JA")
                }
              />
            </Row>

            <div className="dcw-subhead" style={{ marginTop: 16 }}>
              {t("general.section.ui")}
            </div>
            <Row label={t("general.language")}>
              <SegmentedControl
                size="xs"
                value={lang}
                onChange={(value) => setLang(value as Lang)}
                data={[
                  { value: "zh", label: "中文" },
                  { value: "en", label: "English" },
                ]}
              />
            </Row>
            <Row label={t("general.timestamps")}>
              <Switch
                size="xs"
                checked={decode.timestamps}
                onChange={(event) =>
                  decode.setTimestamps(event.currentTarget.checked)
                }
              />
            </Row>
            <Row label={t("general.fontSize")}>
              <Group gap={10} wrap="nowrap">
                <Slider
                  size="xs"
                  style={{ flex: 1 }}
                  min={11}
                  max={28}
                  step={1}
                  value={decode.fontSize}
                  onChange={decode.setFontSize}
                  color="accent"
                />
                <Text size="xs" className="dcw-mono" w={36}>
                  {decode.fontSize}px
                </Text>
              </Group>
            </Row>
            <Text size="xs" c="dimmed" pl={217}>
              {t("general.startStopHint")}
            </Text>
          </Stack>
        )}

        {tab === "radio" && (
          <Stack gap={4}>
            <div className="dcw-subhead">{t("radio.section")}</div>
            <Row label={t("radio.enable")}>
              <Switch
                size="xs"
                checked={rig.config.enabled}
                onChange={(event) =>
                  rig.setConfig({ enabled: event.currentTarget.checked })
                }
              />
            </Row>
            <Row label={t("radio.port")}>
              <Group gap={6} wrap="nowrap">
                <NativeSelect
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
                      : [{ value: "", label: t("radio.noPorts") }]
                  }
                  value={rig.config.path}
                  onChange={(event) =>
                    rig.setConfig({ path: event.currentTarget.value })
                  }
                />
                <Button
                  size="compact-xs"
                  variant="default"
                  onClick={() => void rig.refreshPorts()}
                >
                  {t("common.refresh")}
                </Button>
              </Group>
            </Row>
            <Row label={t("radio.baud")}>
              <NativeSelect
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
            </Row>
            <Row label={t("radio.protocol")}>
              <NativeSelect
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
            </Row>
            <Row label={t("radio.civAddress")}>
              <TextInput
                size="xs"
                value={rig.config.civAddress.toString(16).toUpperCase()}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.currentTarget.value, 16);
                  rig.setConfig({
                    civAddress: Number.isFinite(parsed) ? parsed : 0x94,
                  });
                }}
                disabled={rig.config.protocol !== "icom"}
              />
            </Row>
            <Row label={t("radio.pollMs")}>
              <NumberInput
                size="xs"
                min={200}
                max={5000}
                step={100}
                value={rig.config.pollMs}
                onChange={(value) =>
                  rig.setConfig({ pollMs: Number(value) || 800 })
                }
              />
            </Row>

            <Row label={t("radio.autoDetect")} hint={t("radio.detectHint")}>
              <Group gap={6} wrap="nowrap">
                <Button
                  size="compact-xs"
                  variant="light"
                  color="accent"
                  loading={rig.detecting}
                  onClick={() => {
                    setDetectError(false);
                    void rig.autoDetect().then((found) => {
                      if (!found) setDetectError(true);
                    });
                  }}
                >
                  {rig.detecting ? t("radio.detecting") : t("common.detect")}
                </Button>
                {detectError && (
                  <Text size="xs" c="red.4">
                    {t("radio.detectFailed")}
                  </Text>
                )}
              </Group>
            </Row>

            <Group gap={8} mt={10}>
              {rig.status.connected ? (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => void rig.disconnect()}
                >
                  {t("common.disconnect")}
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="light"
                  color="accent"
                  onClick={() => {
                    rig.setConfig({ enabled: true });
                    void rig.connect();
                  }}
                >
                  {t("common.connect")}
                </Button>
              )}
              <Button
                size="xs"
                variant="default"
                disabled={!rig.status.connected}
                onClick={() => void rig.setMode("CW")}
              >
                {t("radio.setCw")}
              </Button>
              <Button
                size="xs"
                variant={rig.status.ptt ? "filled" : "default"}
                color={rig.status.ptt ? "red" : undefined}
                disabled={!rig.status.connected}
                onClick={() => void rig.setPtt(!rig.status.ptt)}
              >
                {t("radio.tx")}
              </Button>
            </Group>

            <Group gap={8} mt={6}>
              <span
                className={`dcw-led ${
                  rig.status.connected
                    ? "dcw-led--on"
                    : rig.status.error
                      ? "dcw-led--err"
                      : ""
                }`}
              />
              <Text size="xs" c="dimmed">
                {rig.status.connected
                  ? `${rig.status.port} · ${rig.status.mode} · ${(rig.status.frequency ?? 0).toLocaleString("en-US")} Hz`
                  : rig.status.error || t("radio.notConnected")}
              </Text>
            </Group>
          </Stack>
        )}

        {tab === "audio" && (
          <Stack gap={4}>
            <div className="dcw-subhead">{t("settings.tabs.audio")}</div>
            <Row label={t("audio.input")} hint={t("audio.hint")}>
              <Group gap={6} wrap="nowrap">
                <NativeSelect
                  size="xs"
                  style={{ flex: 1 }}
                  data={
                    audio.inputDevices.length > 0
                      ? audio.inputDevices.map((device) => ({
                          value: device.id,
                          label: device.label,
                        }))
                      : [{ value: "", label: t("audio.noDevices") }]
                  }
                  value={audio.selectedInput}
                  onChange={(event) =>
                    audio.onSelectInput(event.currentTarget.value)
                  }
                />
                <Button
                  size="compact-xs"
                  variant="default"
                  onClick={audio.onRefreshDevices}
                >
                  {t("common.refresh")}
                </Button>
              </Group>
            </Row>
            {audio.showOutput && (
              <Row label={t("audio.output")}>
                <NativeSelect
                  size="xs"
                  data={[
                    { value: "", label: t("common.none") },
                    ...audio.outputDevices.map((device) => ({
                      value: device.id,
                      label: device.label,
                    })),
                  ]}
                  value={audio.selectedOutput}
                  onChange={(event) =>
                    audio.onSelectOutput(event.currentTarget.value)
                  }
                />
              </Row>
            )}
          </Stack>
        )}

        {tab === "network" && (
          <Stack gap={4}>
            <div className="dcw-subhead">{t("network.section")}</div>
            <Row label={t("network.enable")}>
              <Switch
                size="xs"
                checked={wsjtx.config.enabled}
                onChange={(event) =>
                  wsjtx.setConfig({ enabled: event.currentTarget.checked })
                }
              />
            </Row>
            <Row label={t("network.host")}>
              <TextInput
                size="xs"
                value={wsjtx.config.host}
                onChange={(event) =>
                  wsjtx.setConfig({ host: event.currentTarget.value })
                }
              />
            </Row>
            <Row label={t("network.port")}>
              <NumberInput
                size="xs"
                min={1}
                max={65535}
                value={wsjtx.config.port}
                onChange={(value) =>
                  wsjtx.setConfig({ port: Number(value) || 2237 })
                }
              />
            </Row>
            <Row label={t("network.broadcast")}>
              <Switch
                size="xs"
                checked={wsjtx.config.broadcast}
                onChange={(event) =>
                  wsjtx.setConfig({ broadcast: event.currentTarget.checked })
                }
              />
            </Row>
            <Group gap={8} mt={10}>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  wsjtx.sendStatus({
                    dialFrequency: rig.status.frequency ?? 0,
                    mode: "CW",
                    decoding: false,
                  })
                }
              >
                {t("network.testStatus")}
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  wsjtx.sendDecode({
                    message: "DEEPCW DESKTOP TEST",
                    deltaFrequency: decode.bandwidth / 2,
                  })
                }
              >
                {t("network.testDecode")}
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt={8}>
              {t("network.hint")}
            </Text>
          </Stack>
        )}

        {tab === "display" && (
          <Stack gap={4}>
            <div className="dcw-subhead">{t("display.section")}</div>
            <Row label={t("display.enable")}>
              <Switch
                size="xs"
                checked={bg.enabled}
                disabled={!bg.url}
                onChange={(event) =>
                  background.set("enabled", event.currentTarget.checked)
                }
              />
            </Row>
            <Row label={t("display.choose")}>
              <Group gap={6}>
                <Button
                  size="compact-xs"
                  variant="light"
                  color="accent"
                  onClick={() => void background.choose()}
                >
                  {t("display.choose")}
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  disabled={!bg.url}
                  onClick={() => void background.clear()}
                >
                  {t("common.remove")}
                </Button>
              </Group>
            </Row>
            <Row label={t("display.blur")}>
              <Group gap={10} wrap="nowrap">
                <Slider
                  size="xs"
                  style={{ flex: 1 }}
                  min={0}
                  max={40}
                  value={bg.blur}
                  onChange={(value) => background.set("blur", value)}
                  disabled={!bg.enabled}
                  color="accent"
                />
                <Text size="xs" className="dcw-mono" w={44}>
                  {bg.blur}px
                </Text>
              </Group>
            </Row>
            <Row label={t("display.opacity")}>
              <Group gap={10} wrap="nowrap">
                <Slider
                  size="xs"
                  style={{ flex: 1 }}
                  min={5}
                  max={100}
                  value={bg.opacity}
                  onChange={(value) => background.set("opacity", value)}
                  disabled={!bg.enabled}
                  color="accent"
                />
                <Text size="xs" className="dcw-mono" w={44}>
                  {bg.opacity}%
                </Text>
              </Group>
            </Row>
            <Row label={t("display.dim")}>
              <Group gap={10} wrap="nowrap">
                <Slider
                  size="xs"
                  style={{ flex: 1 }}
                  min={0}
                  max={90}
                  value={bg.dim}
                  onChange={(value) => background.set("dim", value)}
                  disabled={!bg.enabled}
                  color="accent"
                />
                <Text size="xs" className="dcw-mono" w={44}>
                  {bg.dim}%
                </Text>
              </Group>
            </Row>
            <Row label={t("display.panelOpacity")} hint={t("display.hint")}>
              <Group gap={10} wrap="nowrap">
                <Slider
                  size="xs"
                  style={{ flex: 1 }}
                  min={40}
                  max={100}
                  value={bg.panelAlpha}
                  onChange={(value) => background.set("panelAlpha", value)}
                  disabled={!bg.enabled}
                  color="accent"
                />
                <Text size="xs" className="dcw-mono" w={44}>
                  {bg.panelAlpha}%
                </Text>
              </Group>
            </Row>
          </Stack>
        )}

        {tab === "advanced" && (
          <Stack gap={10}>
            <div className="dcw-subhead">{t("advanced.section")}</div>
            <Group gap={8}>
              <Button size="xs" variant="default" onClick={onOpenDataFolder}>
                {t("advanced.dataFolder")}
              </Button>
              <Button
                size="xs"
                variant="default"
                color="red"
                onClick={onResetSettings}
              >
                {t("advanced.reset")}
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              {t("advanced.resetHint")}
            </Text>
            <Text size="xs" c="dimmed">
              Ctrl+Enter — {t("general.startStop")} · Ctrl+, —{" "}
              {t("common.settings")}
            </Text>
          </Stack>
        )}

        {tab === "about" && (
          <Stack gap={10}>
            <Group gap={10}>
              <Text fw={700} size="lg">
                DeepCW Desktop
              </Text>
              <Badge variant="light" color="accent">
                {t("about.version")} {version}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {t("about.credits")}
            </Text>
            <Text size="xs" c="dimmed">
              web-deep-cw-decoder · deepcw-engine · AGPL-3.0-only
            </Text>
            <Group gap={8}>
              <Badge variant="default" size="sm">
                Offline
              </Badge>
              <Badge variant="default" size="sm">
                Electron
              </Badge>
              <Badge variant="default" size="sm">
                WASM engine
              </Badge>
            </Group>
          </Stack>
        )}
      </div>

      <div className="dcw-settings-footer">
        <Button size="xs" variant="default" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
