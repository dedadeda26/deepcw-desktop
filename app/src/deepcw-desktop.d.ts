export {};

export type DeepCWDesktopInfo = {
  version: string;
  isPackaged: boolean;
  platform: string;
};

export type DeepCWOpenedAudioFile = {
  name: string;
  path: string;
  data: ArrayBuffer;
};

export type DeepCWMenuAction =
  | "clear"
  | "copy"
  | "save"
  | "open-file"
  | "toggle-decode"
  | "settings"
  | "top-on"
  | "top-off";

export type DeepCWSerialPort = {
  path: string;
  manufacturer: string;
  description: string;
};

export type DeepCWRigConfig = {
  enabled: boolean;
  path: string;
  baudRate: number;
  protocol: "kenwood" | "yaesu" | "icom";
  civAddress: number;
  pollMs: number;
};

export type DeepCWRigStatus = {
  connected: boolean;
  frequency: number | null;
  mode: string;
  error: string | null;
  port: string;
  protocol: string;
  ptt: boolean;
};

export type DeepCWWsjtxConfig = {
  enabled: boolean;
  host: string;
  port: number;
  broadcast: boolean;
};

export type DeepCWWsjtxDecode = {
  message: string;
  deltaFrequency: number;
  time?: number;
  snr?: number;
  mode?: string;
};

export type DeepCWWsjtxStatus = {
  dialFrequency: number;
  mode?: string;
  rxDF?: number;
  txDF?: number;
  decoding?: boolean;
  transmitting?: boolean;
  deCall?: string;
  deGrid?: string;
  subMode?: string;
  fastMode?: boolean;
};

export type DeepCWBackgroundResult = {
  url: string;
  mime: string;
  source: string;
};

export type DeepCWRigAutoDetectResult =
  | {
      config: DeepCWRigConfig;
      status: DeepCWRigStatus;
    }
  | { error: string }
  | null;

export type DeepCWDesktopApi = {
  isDesktop: true;
  info: () => Promise<DeepCWDesktopInfo>;
  saveTextFile: (text: string, defaultName?: string) => Promise<string | null>;
  openAudioFile: () => Promise<DeepCWOpenedAudioFile | null>;
  copyText: (text: string) => Promise<boolean>;
  setAlwaysOnTop: (value: boolean) => Promise<boolean>;
  setAwake: (value: boolean) => Promise<boolean>;
  openDataFolder: () => Promise<string>;
  setLanguage: (lang: "zh" | "en") => void;
  onMenuAction: (callback: (action: DeepCWMenuAction) => void) => () => void;
  radio: {
    listPorts: () => Promise<DeepCWSerialPort[]>;
    connect: (config: DeepCWRigConfig) => Promise<DeepCWRigStatus>;
    disconnect: () => Promise<DeepCWRigStatus>;
    status: () => Promise<DeepCWRigStatus>;
    setFrequency: (hz: number) => Promise<DeepCWRigStatus>;
    setMode: (mode: string) => Promise<DeepCWRigStatus>;
    setPtt: (on: boolean) => Promise<DeepCWRigStatus>;
    autoDetect: () => Promise<DeepCWRigAutoDetectResult>;
    onStatus: (callback: (status: DeepCWRigStatus) => void) => () => void;
  };
  wsjtx: {
    configure: (config: DeepCWWsjtxConfig) => Promise<DeepCWWsjtxConfig>;
    send: (
      type: "status" | "decode" | "clear" | "heartbeat" | "close",
      payload?: DeepCWWsjtxStatus | DeepCWWsjtxDecode,
    ) => Promise<boolean>;
  };
  background: {
    choose: () => Promise<DeepCWBackgroundResult | null>;
    clear: () => Promise<boolean>;
  };
};

declare global {
  interface Window {
    deepcwDesktop?: DeepCWDesktopApi;
  }
}
