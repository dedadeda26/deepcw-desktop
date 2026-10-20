export type HighlightKind = "callsign" | "report" | "keyword";

export const HIGHLIGHT_COLORS: Record<HighlightKind, string> = {
  callsign: "#ffb74d",
  report: "#5dd39e",
  keyword: "#6fa4ff",
};

const KEYWORDS = new Set([
  "CQ",
  "DE",
  "QRZ",
  "QSL",
  "QTH",
  "QSY",
  "QRM",
  "QRN",
  "QSB",
  "QRL",
  "QRP",
  "QRO",
  "73",
  "88",
  "TU",
  "TNX",
  "GM",
  "GE",
  "GA",
  "GN",
  "BK",
  "KN",
  "SK",
  "AR",
  "K",
  "R",
  "RR",
  "RST",
  "ES",
  "FB",
  "HR",
  "UR",
  "WX",
  "NAME",
  "NM",
  "RIG",
  "ANT",
  "PWR",
  "HW",
  "CPY",
  "AGN",
  "SRI",
  "GL",
  "GB",
  "HPE",
  "CU",
  "CFM",
  "DX",
  "TEST",
  "PSE",
  "PLS",
  "INFO",
  "OP",
  "QSL?",
  "SRI",
  "NR",
  "SIG",
  "RPT",
]);

/** 599, 579, 5NN, 559 are signal reports (1xx is not a RST). */
const REPORT_PATTERN = /^(?:R)?(?:5NN|5[1-9][1-9])$/;

/**
 * Amateur callsign, roughly: up to 3 prefix characters, one digit, a suffix of
 * 1–4 letters, optional /suffix (portable, maritime, …) and at least one letter.
 * Examples: K1ABC, N0CALL, JA1ABC, 9A1A, DL1ABC/P, W3ABC/QRP, 3DA0XX.
 */
const CALLSIGN_PATTERN =
  /^(?=[A-Z0-9/]*[A-Z])[A-Z0-9]{0,3}[0-9][A-Z]{1,4}(?:\/[A-Z0-9]{1,4})?$/;

export function classifyToken(rawToken: string): HighlightKind | null {
  const token = rawToken.replace(/^[^A-Z0-9/]+|[^A-Z0-9/]+$/gi, "").toUpperCase();
  if (token.length < 1) return null;

  if (REPORT_PATTERN.test(token)) return "report";

  if (KEYWORDS.has(token)) return "keyword";

  // Callsigns are at least 3 characters and contain a digit.
  if (token.length >= 3 && /[0-9]/.test(token) && CALLSIGN_PATTERN.test(token)) {
    return "callsign";
  }

  return null;
}

export type HighlightSegment = {
  text: string;
  kind: HighlightKind | null;
};

/** Split a plain text into coloured segments (whitespace is preserved). */
export function highlightText(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const tokens = text.split(/(\s+)/);

  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      segments.push({ text: token, kind: null });
      continue;
    }
    segments.push({ text: token, kind: classifyToken(token) });
  }

  return segments;
}
