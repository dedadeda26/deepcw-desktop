'use strict';

/**
 * WSJT-X compatible UDP message encoder.
 *
 * N1MM+, JTAlert, GridTracker and friends listen for these datagrams to mirror
 * the decoder's status and decoded messages. The wire format is the one from
 * wsjtx/Network/NetworkMessage.cpp: big-endian QDataStream with length-prefixed
 * UTF-8 strings.
 */

const dgram = require('node:dgram');

const MAGIC = 0xadbccbda;
const SCHEMA = 3;

const TYPE = {
  HEARTBEAT: 0,
  STATUS: 1,
  DECODE: 2,
  CLEAR: 3,
  REPLY: 4,
  QSO_LOGGED: 5,
  CLOSE: 6,
  REPLAY: 7,
  HALT_TX: 8,
  FREE_TEXT: 9,
  WSPR_DECODE: 10,
  LOCATION: 11,
  LOGGED_ADIF: 12,
};

class Writer {
  constructor() {
    /** @type {Buffer[]} */
    this.parts = [];
  }

  u8(value) {
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value & 0xff);
    this.parts.push(buffer);
    return this;
  }

  bool(value) {
    return this.u8(value ? 1 : 0);
  }

  u32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE(value >>> 0);
    this.parts.push(buffer);
    return this;
  }

  i32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value | 0);
    this.parts.push(buffer);
    return this;
  }

  u64(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(Math.round(value)));
    this.parts.push(buffer);
    return this;
  }

  f64(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleBE(Number(value) || 0);
    this.parts.push(buffer);
    return this;
  }

  /** QDataStream QString: quint32 byte length + UTF-8. Null is 0xFFFFFFFF. */
  str(value) {
    if (value === null || value === undefined) {
      return this.u32(0xffffffff);
    }
    const bytes = Buffer.from(String(value), 'utf8');
    this.u32(bytes.length);
    this.parts.push(bytes);
    return this;
  }

  build() {
    return Buffer.concat(this.parts);
  }
}

function frame(type, fill) {
  const writer = new Writer();
  writer.u32(MAGIC).u32(SCHEMA).u32(type);
  fill(writer);
  return writer.build();
}

function msSinceMidnight(date = new Date()) {
  return (
    date.getHours() * 3600000 +
    date.getMinutes() * 60000 +
    date.getSeconds() * 1000 +
    date.getMilliseconds()
  );
}

function encodeHeartbeat(id) {
  return frame(TYPE.HEARTBEAT, (writer) => {
    writer.str(id).u32(SCHEMA).str('0.5.4-desktop').str('deepcw');
  });
}

/**
 * @param {string} id
 * @param {{
 *   dialFrequency: number,
 *   mode?: string,
 *   dxCall?: string,
 *   report?: string,
 *   txMode?: string,
 *   txEnabled?: boolean,
 *   transmitting?: boolean,
 *   decoding?: boolean,
 *   rxDF?: number,
 *   txDF?: number,
 *   deCall?: string,
 *   deGrid?: string,
 *   dxGrid?: string,
 *   txWatchdog?: boolean,
 *   subMode?: string,
 *   fastMode?: boolean,
 * }} status
 */
function encodeStatus(id, status) {
  return frame(TYPE.STATUS, (writer) => {
    writer
      .str(id)
      .u64(status.dialFrequency || 0)
      .str(status.mode || 'CW')
      .str(status.dxCall || '')
      .str(status.report || '')
      .str(status.txMode || status.mode || 'CW')
      .bool(Boolean(status.txEnabled))
      .bool(Boolean(status.transmitting))
      .bool(Boolean(status.decoding))
      .u32(Math.max(0, Math.round(status.rxDF || 0)))
      .u32(Math.max(0, Math.round(status.txDF || 0)))
      .str(status.deCall || '')
      .str(status.deGrid || '')
      .str(status.dxGrid || '')
      .bool(Boolean(status.txWatchdog))
      .str(status.subMode || '')
      .bool(Boolean(status.fastMode));
  });
}

/**
 * @param {string} id
 * @param {{
 *   new?: boolean,
 *   time?: number,
 *   snr?: number,
 *   deltaTime?: number,
 *   deltaFrequency?: number,
 *   mode?: string,
 *   message: string,
 *   lowConfidence?: boolean,
 *   offAir?: boolean,
 * }} decode
 */
function encodeDecode(id, decode) {
  return frame(TYPE.DECODE, (writer) => {
    writer
      .str(id)
      .bool(decode.new !== false)
      .u32(decode.time ?? msSinceMidnight())
      .i32(Math.round(decode.snr ?? 0))
      .f64(decode.deltaTime ?? 0)
      .u32(Math.max(0, Math.round(decode.deltaFrequency || 0)))
      .str(decode.mode || 'CW')
      .str(decode.message || '')
      .bool(Boolean(decode.lowConfidence))
      .bool(Boolean(decode.offAir));
  });
}

function encodeClear(id) {
  return frame(TYPE.CLEAR, (writer) => {
    writer.str(id);
  });
}

function encodeClose(id) {
  return frame(TYPE.CLOSE, (writer) => {
    writer.str(id);
  });
}

class WsjtxSender {
  constructor() {
    /** @type {import('node:dgram').Socket | null} */
    this.socket = null;
    this.id = 'DeepCW';
    this.config = {
      enabled: false,
      host: '127.0.0.1',
      port: 2237,
      broadcast: false,
    };
  }

  configure(config = {}) {
    this.config = {
      ...this.config,
      ...config,
    };
    if (this.socket && this.socket._deepcwBroadcast !== this.config.broadcast) {
      try {
        this.socket.setBroadcast(Boolean(this.config.broadcast));
        this.socket._deepcwBroadcast = this.config.broadcast;
      } catch {
        /* ignore */
      }
    }
    return { ...this.config };
  }

  ensureSocket() {
    if (this.socket) return this.socket;
    this.socket = dgram.createSocket({ type: 'udp4' });
    try {
      this.socket.setBroadcast(Boolean(this.config.broadcast));
      this.socket._deepcwBroadcast = this.config.broadcast;
    } catch {
      /* ignore */
    }
    this.socket.on('error', () => {
      /* keep the app alive when the receiver disappears */
    });
    this.socket.unref?.();
    return this.socket;
  }

  send(buffer) {
    if (!this.config.enabled) return false;
    const socket = this.ensureSocket();
    socket.send(buffer, this.config.port, this.config.host, () => undefined);
    return true;
  }

  sendHeartbeat() {
    return this.send(encodeHeartbeat(this.id));
  }

  sendStatus(status) {
    return this.send(encodeStatus(this.id, status));
  }

  sendDecode(decode) {
    return this.send(encodeDecode(this.id, decode));
  }

  sendClear() {
    return this.send(encodeClear(this.id));
  }

  sendClose() {
    return this.send(encodeClose(this.id));
  }

  close() {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }
}

module.exports = {
  TYPE,
  encodeHeartbeat,
  encodeStatus,
  encodeDecode,
  encodeClear,
  encodeClose,
  WsjtxSender,
};

