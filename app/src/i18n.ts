import { useSyncExternalStore } from "react";

export type Lang = "zh" | "en";

export type MessageKey =
  | "app.name"
  | "app.tagline"
  | "common.ok"
  | "common.cancel"
  | "common.close"
  | "common.settings"
  | "common.save"
  | "common.copy"
  | "common.clear"
  | "common.file"
  | "common.remove"
  | "common.refresh"
  | "common.connect"
  | "common.disconnect"
  | "common.none"
  | "common.on"
  | "common.off"
  | "common.idle"
  | "common.loading"
  | "common.receiving"
  | "common.custom"
  | "common.reset"
  | "common.detect"
  | "common.detected"
  | "common.copyDone"
  | "header.dial"
  | "header.audio"
  | "header.sig"
  | "header.qsy"
  | "header.qsyTip"
  | "header.language"
  | "main.start"
  | "main.stop"
  | "main.noInputTitle"
  | "main.noInputHint"
  | "main.placeholder"
  | "main.fileLabel"
  | "main.savedLabel"
  | "main.qualityLabel"
  | "toolbar.clearTip"
  | "toolbar.copyTip"
  | "toolbar.saveTip"
  | "toolbar.fileTip"
  | "toolbar.fontDown"
  | "toolbar.fontUp"
  | "toolbar.tsTip"
  | "toolbar.topTip"
  | "mode.normal"
  | "mode.pileup"
  | "mode.benchmark"
  | "tracks.title"
  | "tracks.empty"
  | "tracks.qsy"
  | "tracks.copy"
  | "tracks.clear"
  | "tracks.clearAll"
  | "tracks.clearRowTip"
  | "tracks.frequency"
  | "settings.title"
  | "settings.tabs.general"
  | "settings.tabs.radio"
  | "settings.tabs.audio"
  | "settings.tabs.network"
  | "settings.tabs.display"
  | "settings.tabs.advanced"
  | "settings.tabs.about"
  | "general.section.decode"
  | "general.quality"
  | "general.model"
  | "general.window"
  | "general.bandwidth"
  | "general.cwLang"
  | "general.timestamps"
  | "general.fontSize"
  | "general.section.ui"
  | "general.language"
  | "general.startStop"
  | "general.startStopHint"
  | "quality.high"
  | "quality.balanced"
  | "quality.fast"
  | "quality.custom"
  | "quality.highDesc"
  | "quality.balancedDesc"
  | "quality.fastDesc"
  | "quality.customDesc"
  | "model.standard"
  | "model.tiny"
  | "lang.english"
  | "lang.enJa"
  | "radio.section"
  | "radio.enable"
  | "radio.port"
  | "radio.baud"
  | "radio.protocol"
  | "radio.civAddress"
  | "radio.pollMs"
  | "radio.autoDetect"
  | "radio.detecting"
  | "radio.setCw"
  | "radio.tx"
  | "radio.status"
  | "radio.notConnected"
  | "radio.noPorts"
  | "radio.off"
  | "radio.detectFailed"
  | "radio.detectHint"
  | "audio.input"
  | "audio.output"
  | "audio.noDevices"
  | "audio.hint"
  | "network.section"
  | "network.enable"
  | "network.host"
  | "network.port"
  | "network.broadcast"
  | "network.testStatus"
  | "network.testDecode"
  | "network.hint"
  | "display.section"
  | "display.enable"
  | "display.choose"
  | "display.remove"
  | "display.blur"
  | "display.opacity"
  | "display.dim"
  | "display.panelOpacity"
  | "display.hint"
  | "advanced.section"
  | "advanced.dataFolder"
  | "advanced.reset"
  | "advanced.resetHint"
  | "about.version"
  | "about.credits"
  | "error.microphone"
  | "error.audioFile"
  | "error.modelLoad";

const en: Record<MessageKey, string> = {
  "app.name": "DeepCW",
  "app.tagline": "NEURAL CW DECODER",
  "common.ok": "OK",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.settings": "Settings",
  "common.save": "Save",
  "common.copy": "Copy",
  "common.clear": "Clear",
  "common.file": "File",
  "common.remove": "Remove",
  "common.refresh": "Refresh",
  "common.connect": "Connect",
  "common.disconnect": "Disconnect",
  "common.none": "None",
  "common.on": "On",
  "common.off": "Off",
  "common.idle": "IDLE",
  "common.loading": "LOADING",
  "common.receiving": "RX",
  "common.custom": "Custom",
  "common.reset": "Reset",
  "common.detect": "Auto-detect",
  "common.detected": "Detected",
  "common.copyDone": "COPIED",
  "header.dial": "DIAL",
  "header.audio": "AUDIO",
  "header.sig": "SIG",
  "header.qsy": "QSY",
  "header.qsyTip": "Move this signal to the 800 Hz CW pitch",
  "header.language": "Language",
  "main.start": "START",
  "main.stop": "STOP",
  "main.noInputTitle": "NO AUDIO INPUT",
  "main.noInputHint": "Press START, or open a recording with FILE",
  "main.placeholder": "Waiting for a signal — decoded text appears here.",
  "main.fileLabel": "FILE",
  "main.savedLabel": "saved",
  "main.qualityLabel": "Quality",
  "toolbar.clearTip": "Clear the decode window (Ctrl+L)",
  "toolbar.copyTip": "Copy the whole transcript (Ctrl+Shift+C)",
  "toolbar.saveTip": "Save the transcript (Ctrl+S)",
  "toolbar.fileTip": "Decode an audio recording — or drop a file on the window",
  "toolbar.fontDown": "Smaller font",
  "toolbar.fontUp": "Larger font",
  "toolbar.tsTip": "Show a timestamp for each segment",
  "toolbar.topTip": "Keep window on top (Ctrl+T)",
  "mode.normal": "Normal",
  "mode.pileup": "Pileup",
  "mode.benchmark": "Benchmark",
  "tracks.title": "Signals",
  "tracks.empty": "No CW signals detected yet.",
  "tracks.qsy": "QSY",
  "tracks.copy": "Copy",
  "tracks.clear": "Clear",
  "tracks.clearAll": "Clear all",
  "tracks.clearRowTip": "Clear this signal",
  "tracks.frequency": "Frequency",
  "settings.title": "Settings",
  "settings.tabs.general": "General",
  "settings.tabs.radio": "Radio",
  "settings.tabs.audio": "Audio",
  "settings.tabs.network": "Network",
  "settings.tabs.display": "Display",
  "settings.tabs.advanced": "Advanced",
  "settings.tabs.about": "About",
  "general.section.decode": "DECODER",
  "general.quality": "Quality preset",
  "general.model": "Model",
  "general.window": "Decode window",
  "general.bandwidth": "Bandwidth",
  "general.cwLang": "CW language",
  "general.timestamps": "Timestamps in transcript",
  "general.fontSize": "Transcript font size",
  "general.section.ui": "INTERFACE",
  "general.language": "Interface language",
  "general.startStop": "Start / stop decoding",
  "general.startStopHint": "Audio capture starts immediately; decoding follows as soon as the model is ready.",
  "quality.high": "High",
  "quality.balanced": "Balanced",
  "quality.fast": "Fast",
  "quality.custom": "Custom",
  "quality.highDesc": "Standard model, 18 s window — best weak-signal copy.",
  "quality.balancedDesc": "Standard model, 12 s window — recommended default (lower latency).",
  "quality.fastDesc": "Tiny model, 12 s window — lightest CPU load.",
  "quality.customDesc": "Custom model / window combination.",
  "model.standard": "Standard",
  "model.tiny": "Tiny",
  "lang.english": "English",
  "lang.enJa": "English + Japanese",
  "radio.section": "CAT / RIG CONTROL",
  "radio.enable": "Enable rig control",
  "radio.port": "Serial port",
  "radio.baud": "Baud rate",
  "radio.protocol": "Protocol",
  "radio.civAddress": "CI-V address (hex)",
  "radio.pollMs": "Poll interval (ms)",
  "radio.autoDetect": "Auto-detect rig",
  "radio.detecting": "Detecting…",
  "radio.setCw": "Set CW mode",
  "radio.tx": "PTT",
  "radio.status": "Status",
  "radio.notConnected": "Not connected",
  "radio.noPorts": "No serial ports found",
  "radio.off": "Rig control is off",
  "radio.detectFailed": "No responding rig found",
  "radio.detectHint": "Scans ports, baud rates and protocols for a reply.",
  "audio.input": "Input device",
  "audio.output": "Monitor output (THRU)",
  "audio.noDevices": "Default device",
  "audio.hint": "Devices can be changed at any time; the decoder switches over immediately.",
  "network.section": "WSJT-X / N1MM UDP",
  "network.enable": "Send WSJT-X UDP messages",
  "network.host": "Host",
  "network.port": "Port",
  "network.broadcast": "UDP broadcast",
  "network.testStatus": "Test status",
  "network.testDecode": "Test decode",
  "network.hint": "N1MM+ listens on UDP 2237. Status carries the dial frequency, decode messages carry the audio offset.",
  "display.section": "BACKGROUND IMAGE",
  "display.enable": "Use background image",
  "display.choose": "Choose image…",
  "display.remove": "Remove",
  "display.blur": "Blur",
  "display.opacity": "Opacity",
  "display.dim": "Dark overlay",
  "display.panelOpacity": "Panel opacity",
  "display.hint": "Raise panel opacity if text is hard to read over a busy photo.",
  "advanced.section": "MAINTENANCE",
  "advanced.dataFolder": "Open data folder",
  "advanced.reset": "Reset all settings",
  "advanced.resetHint": "Removes the saved settings, background image and window state.",
  "about.version": "Version",
  "about.credits": "Decoder engine and models © 2026 e04 (AGPL-3.0-only).",
  "error.microphone": "Microphone unavailable",
  "error.audioFile": "Could not open this audio file",
  "error.modelLoad": "Failed to load the decoder model",
};

const zh: Record<MessageKey, string> = {
  "app.name": "DeepCW",
  "app.tagline": "神经网络 CW 解码器",
  "common.ok": "确定",
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.settings": "设置",
  "common.save": "保存",
  "common.copy": "复制",
  "common.clear": "清空",
  "common.file": "文件",
  "common.remove": "移除",
  "common.refresh": "刷新",
  "common.connect": "连接",
  "common.disconnect": "断开",
  "common.none": "无",
  "common.on": "开",
  "common.off": "关",
  "common.idle": "空闲",
  "common.loading": "加载中",
  "common.receiving": "接收",
  "common.custom": "自定义",
  "common.reset": "重置",
  "common.detect": "自动探测",
  "common.detected": "已识别",
  "common.copyDone": "已复制",
  "header.dial": "主频",
  "header.audio": "音频",
  "header.sig": "信号",
  "header.qsy": "归位",
  "header.qsyTip": "把当前信号移到 800 Hz 音调位置",
  "header.language": "语言",
  "main.start": "开始",
  "main.stop": "停止",
  "main.noInputTitle": "没有音频输入",
  "main.noInputHint": "点击开始，或用「文件」打开一段录音",
  "main.placeholder": "等待信号——解出的文字会显示在这里。",
  "main.fileLabel": "文件",
  "main.savedLabel": "已保存",
  "main.qualityLabel": "质量",
  "toolbar.clearTip": "清空解码窗口（Ctrl+L）",
  "toolbar.copyTip": "复制全部解码文本（Ctrl+Shift+C）",
  "toolbar.saveTip": "保存解码文本（Ctrl+S）",
  "toolbar.fileTip": "解码录音文件，也可以直接把文件拖进窗口",
  "toolbar.fontDown": "缩小字号",
  "toolbar.fontUp": "放大字号",
  "toolbar.tsTip": "给每段文字加上时间戳",
  "toolbar.topTip": "窗口置顶（Ctrl+T）",
  "mode.normal": "普通",
  "mode.pileup": "多信号",
  "mode.benchmark": "性能测试",
  "tracks.title": "信号列表",
  "tracks.empty": "暂未检测到 CW 信号。",
  "tracks.qsy": "归位",
  "tracks.copy": "复制",
  "tracks.clear": "清除",
  "tracks.clearAll": "全部清除",
  "tracks.clearRowTip": "清除这一条",
  "tracks.frequency": "频率",
  "settings.title": "设置",
  "settings.tabs.general": "常规",
  "settings.tabs.radio": "电台",
  "settings.tabs.audio": "音频",
  "settings.tabs.network": "网络",
  "settings.tabs.display": "显示",
  "settings.tabs.advanced": "高级",
  "settings.tabs.about": "关于",
  "general.section.decode": "解码",
  "general.quality": "质量预设",
  "general.model": "模型",
  "general.window": "解码窗口",
  "general.bandwidth": "带宽",
  "general.cwLang": "CW 语言",
  "general.timestamps": "解码文本显示时间戳",
  "general.fontSize": "解码文本字号",
  "general.section.ui": "界面",
  "general.language": "界面语言",
  "general.startStop": "开始/停止解码",
  "general.startStopHint": "点击“开始”后立即采集音频，模型就绪后马上开始解码。",
  "quality.high": "高精度",
  "quality.balanced": "均衡",
  "quality.fast": "快速",
  "quality.custom": "自定义",
  "quality.highDesc": "标准模型 + 18 秒窗口，弱信号最好。",
  "quality.balancedDesc": "标准模型 + 12 秒窗口，推荐默认（延迟更低）。",
  "quality.fastDesc": "微型模型 + 12 秒窗口，CPU 占用最低。",
  "quality.customDesc": "自定义模型与窗口组合。",
  "model.standard": "标准",
  "model.tiny": "微型",
  "lang.english": "英语",
  "lang.enJa": "英语 + 日语",
  "radio.section": "电台控制（CAT）",
  "radio.enable": "启用电台控制",
  "radio.port": "串口",
  "radio.baud": "波特率",
  "radio.protocol": "协议",
  "radio.civAddress": "CI-V 地址（十六进制）",
  "radio.pollMs": "轮询间隔（毫秒）",
  "radio.autoDetect": "自动探测电台",
  "radio.detecting": "正在探测…",
  "radio.setCw": "设为 CW 模式",
  "radio.tx": "发射",
  "radio.status": "状态",
  "radio.notConnected": "未连接",
  "radio.noPorts": "未找到串口",
  "radio.off": "电台控制已关闭",
  "radio.detectFailed": "未找到有响应的电台",
  "radio.detectHint": "自动遍历串口、波特率与协议寻找应答。",
  "audio.input": "输入设备",
  "audio.output": "监听输出（THRU）",
  "audio.noDevices": "默认设备",
  "audio.hint": "随时可以切换设备，解码会立即跟随。",
  "network.section": "WSJT-X / N1MM UDP",
  "network.enable": "启用 WSJT-X UDP 转发",
  "network.host": "主机",
  "network.port": "端口",
  "network.broadcast": "UDP 广播",
  "network.testStatus": "发送测试状态",
  "network.testDecode": "发送测试解码",
  "network.hint": "N1MM+ 默认监听 UDP 2237。状态报文带主频，解码报文带音频偏移。",
  "display.section": "背景图",
  "display.enable": "启用背景图",
  "display.choose": "选择图片…",
  "display.remove": "移除",
  "display.blur": "模糊",
  "display.opacity": "不透明度",
  "display.dim": "暗色遮罩",
  "display.panelOpacity": "面板不透明度",
  "display.hint": "背景太花时，调高面板不透明度可提升可读性。",
  "advanced.section": "维护",
  "advanced.dataFolder": "打开数据目录",
  "advanced.reset": "重置所有设置",
  "advanced.resetHint": "会清除已保存的设置、背景图和窗口状态。",
  "about.version": "版本",
  "about.credits": "解码引擎与模型 © 2026 e04（AGPL-3.0-only）。",
  "error.microphone": "麦克风不可用",
  "error.audioFile": "无法打开该音频文件",
  "error.modelLoad": "解码模型加载失败",
};

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, zh };
const STORAGE_KEY = "ui.language";

function readLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  // Default to Chinese on Chinese Windows, English otherwise.
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let currentLang: Lang = readLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  listeners.forEach((listener) => listener());
  void window.deepcwDesktop?.setLanguage?.(lang);
}

export function t(key: MessageKey): string {
  return DICTIONARIES[currentLang][key] ?? key;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useI18n(): {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey) => string;
} {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return {
    lang,
    setLang,
    t: (key: MessageKey) => DICTIONARIES[lang][key] ?? key,
  };
}

export function initLanguage(): void {
  document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
}
