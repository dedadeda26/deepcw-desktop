import { useCallback, useEffect } from "react";
import { usePersistedState } from "./usePersistedState";
import type {
  DeepCWWsjtxConfig,
  DeepCWWsjtxDecode,
  DeepCWWsjtxStatus,
} from "../deepcw-desktop";

const DEFAULT_CONFIG: DeepCWWsjtxConfig = {
  enabled: false,
  host: "127.0.0.1",
  port: 2237,
  broadcast: false,
};

const isValidWsjtxConfig = (value: unknown): value is DeepCWWsjtxConfig => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DeepCWWsjtxConfig>;
  return (
    typeof candidate.enabled === "boolean" &&
    typeof candidate.host === "string" &&
    typeof candidate.port === "number"
  );
};

export type WsjtxController = {
  config: DeepCWWsjtxConfig;
  setConfig: (patch: Partial<DeepCWWsjtxConfig>) => void;
  sendStatus: (status: DeepCWWsjtxStatus) => void;
  sendDecode: (decode: DeepCWWsjtxDecode) => void;
  sendClear: () => void;
  sendHeartbeat: () => void;
};

export function useWsjtx(): WsjtxController {
  const [config, setConfigState] = usePersistedState<DeepCWWsjtxConfig>(
    "udp.config",
    DEFAULT_CONFIG,
    isValidWsjtxConfig,
  );

  useEffect(() => {
    void window.deepcwDesktop?.wsjtx.configure(config);
  }, [config]);

  useEffect(() => {
    if (!config.enabled) return;
    void window.deepcwDesktop?.wsjtx.send("heartbeat");
    void window.deepcwDesktop?.wsjtx.send("status", {
      dialFrequency: 0,
      mode: "CW",
      decoding: false,
    });
  }, [config.enabled]);

  const setConfig = useCallback(
    (patch: Partial<DeepCWWsjtxConfig>) => {
      setConfigState((current) => ({ ...current, ...patch }));
    },
    [setConfigState],
  );

  const sendStatus = useCallback((status: DeepCWWsjtxStatus) => {
    void window.deepcwDesktop?.wsjtx.send("status", status);
  }, []);

  const sendDecode = useCallback((decode: DeepCWWsjtxDecode) => {
    void window.deepcwDesktop?.wsjtx.send("decode", decode);
  }, []);

  const sendClear = useCallback(() => {
    void window.deepcwDesktop?.wsjtx.send("clear");
  }, []);

  const sendHeartbeat = useCallback(() => {
    void window.deepcwDesktop?.wsjtx.send("heartbeat");
  }, []);

  return { config, setConfig, sendStatus, sendDecode, sendClear, sendHeartbeat };
}
