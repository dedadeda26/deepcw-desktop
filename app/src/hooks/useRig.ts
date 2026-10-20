import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistedState } from "./usePersistedState";

export type RigConfig = {
  enabled: boolean;
  path: string;
  baudRate: number;
  protocol: "kenwood" | "yaesu" | "icom";
  civAddress: number;
  pollMs: number;
};

export type RigStatus = {
  connected: boolean;
  frequency: number | null;
  mode: string;
  error: string | null;
  port: string;
  protocol: string;
  ptt: boolean;
};

const DEFAULT_CONFIG: RigConfig = {
  enabled: false,
  path: "",
  baudRate: 19200,
  protocol: "kenwood",
  civAddress: 0x94,
  pollMs: 800,
};

const DEFAULT_STATUS: RigStatus = {
  connected: false,
  frequency: null,
  mode: "CW",
  error: null,
  port: "",
  protocol: "kenwood",
  ptt: false,
};

const isValidRigConfig = (value: unknown): value is RigConfig => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RigConfig>;
  return (
    typeof candidate.enabled === "boolean" &&
    typeof candidate.path === "string" &&
    typeof candidate.baudRate === "number" &&
    (candidate.protocol === "kenwood" ||
      candidate.protocol === "yaesu" ||
      candidate.protocol === "icom")
  );
};

export type RigController = {
  config: RigConfig;
  setConfig: (patch: Partial<RigConfig>) => void;
  status: RigStatus;
  ports: { path: string; manufacturer: string; description: string }[];
  refreshPorts: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setFrequency: (hz: number) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  setPtt: (on: boolean) => Promise<void>;
  detecting: boolean;
  autoDetect: () => Promise<boolean>;
};

export function useRig(): RigController {
  const [config, setConfigState] = usePersistedState<RigConfig>(
    "rig.config",
    DEFAULT_CONFIG,
    isValidRigConfig,
  );
  const [status, setStatus] = useState<RigStatus>(DEFAULT_STATUS);
  const [ports, setPorts] = useState<
    { path: string; manufacturer: string; description: string }[]
  >([]);
  const autoConnectedRef = useRef(false);

  const setConfig = useCallback(
    (patch: Partial<RigConfig>) => {
      setConfigState((current) => ({ ...current, ...patch }));
    },
    [setConfigState],
  );

  const refreshPorts = useCallback(async () => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    try {
      const list = await api.listPorts();
      setPorts(list);
    } catch {
      setPorts([]);
    }
  }, []);

  useEffect(() => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    const unsubscribe = api.onStatus((next) => setStatus(next));
    return unsubscribe;
  }, []);

  useEffect(() => {
    void refreshPorts();
  }, [refreshPorts]);

  const connect = useCallback(async () => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    try {
      const next = await api.connect(config);
      setStatus(next);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        connected: false,
        error: error instanceof Error ? error.message : "CAT connect failed",
      }));
    }
  }, [config]);

  const disconnect = useCallback(async () => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    try {
      setStatus(await api.disconnect());
    } catch {
      /* ignore */
    }
  }, []);

  // Reconnect automatically on start-up when CAT was enabled last time.
  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;
    if (config.enabled && config.path) {
      void connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFrequency = useCallback(async (hz: number) => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    try {
      setStatus(await api.setFrequency(hz));
    } catch {
      /* ignore */
    }
  }, []);

  const setMode = useCallback(async (mode: string) => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    try {
      setStatus(await api.setMode(mode));
    } catch {
      /* ignore */
    }
  }, []);

  const setPtt = useCallback(async (on: boolean) => {
    const api = window.deepcwDesktop?.radio;
    if (!api) return;
    try {
      setStatus(await api.setPtt(on));
    } catch {
      /* ignore */
    }
  }, []);

  const [detecting, setDetecting] = useState(false);

  const autoDetect = useCallback(async () => {
    const api = window.deepcwDesktop?.radio;
    if (!api?.autoDetect) return false;
    setDetecting(true);
    try {
      const result = await api.autoDetect();
      if (result && "config" in result) {
        setConfigState(result.config);
        const next = await api.connect(result.config);
        setStatus(next);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setDetecting(false);
    }
  }, [setConfigState]);

  return {
    config,
    setConfig,
    status,
    ports,
    refreshPorts,
    connect,
    disconnect,
    setFrequency,
    setMode,
    setPtt,
    detecting,
    autoDetect,
  };
}
