'use strict';

/**
 * Minimal CAT (computer aided tuning) controller.
 *
 * Supports the two command families that cover most contest rigs:
 *   - Kenwood / Elecraft ASCII ("FA;" / "MD3;" / "TX;")
 *   - Yaesu ASCII ("FA" 9 digits / "MD03;" / "TX1;")
 *   - Icom CI-V binary (default address 0x94 = IC-7300)
 *
 * The controller polls the VFO frequency and exposes it to the renderer so the
 * decoder can display absolute frequencies and forward them over UDP.
 */

const { EventEmitter } = require('node:events');
const { SerialPort } = require('serialport');

const MODE_CODES = {
  CW: { kenwood: 3, yaesu: 3, icom: 0x03 },
  'CW-R': { kenwood: 7, yaesu: 7, icom: 0x07 },
  USB: { kenwood: 2, yaesu: 2, icom: 0x01 },
  LSB: { kenwood: 1, yaesu: 1, icom: 0x00 },
  AM: { kenwood: 5, yaesu: 5, icom: 0x02 },
  FM: { kenwood: 4, yaesu: 4, icom: 0x05 },
};

function digits(value, length) {
  return String(Math.max(0, Math.round(value))).padStart(length, '0').slice(-length);
}

function encodeIcomBcd(hz) {
  const bytes = Buffer.alloc(5);
  let rest = Math.max(0, Math.round(hz));
  for (let i = 0; i < 5; i += 1) {
    const low = rest % 10;
    rest = Math.floor(rest / 10);
    const high = rest % 10;
    rest = Math.floor(rest / 10);
    bytes[i] = (high << 4) | low;
  }
  return bytes;
}

function decodeIcomBcd(bytes) {
  let hz = 0;
  let scale = 1;
  for (let i = 0; i < Math.min(5, bytes.length); i += 1) {
    const low = bytes[i] & 0x0f;
    const high = (bytes[i] >> 4) & 0x0f;
    hz += low * scale;
    scale *= 10;
    hz += high * scale;
    scale *= 10;
  }
  return hz;
}

function buildIcomFrame(address, command, payload = Buffer.alloc(0)) {
  return Buffer.concat([
    Buffer.from([0xfe, 0xfe, address, 0xe0, command]),
    payload,
    Buffer.from([0xfd]),
  ]);
}

class RigController extends EventEmitter {
  constructor() {
    super();
    /** @type {SerialPort | null} */
    this.port = null;
    this.config = {
      path: '',
      baudRate: 19200,
      protocol: 'kenwood',
      civAddress: 0x94,
      pollMs: 800,
    };
    this.buffer = Buffer.alloc(0);
    this.frequency = null;
    this.mode = 'CW';
    this.connected = false;
    this.error = null;
    this.pollTimer = null;
    this.pttOn = false;
    this.pttSafetyTimer = null;
  }

  status() {
    return {
      connected: this.connected,
      frequency: this.frequency,
      mode: this.mode,
      error: this.error,
      port: this.config.path,
      protocol: this.config.protocol,
      ptt: this.pttOn,
    };
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  async list() {
    const ports = await SerialPort.list();
    return ports.map((entry) => ({
      path: entry.path,
      manufacturer: entry.manufacturer || '',
      description: entry.friendlyName || entry.pnpId || '',
    }));
  }

  async connect(config = {}) {
    await this.disconnect();
    this.config = {
      ...this.config,
      ...config,
      civAddress: Number(config.civAddress ?? this.config.civAddress),
      baudRate: Number(config.baudRate ?? this.config.baudRate),
      pollMs: Math.max(200, Number(config.pollMs ?? this.config.pollMs)),
    };
    this.error = null;
    this.frequency = null;

    if (!this.config.path) {
      this.error = 'No serial port selected.';
      this.emitStatus();
      return this.status();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve(this.status());
        }
      };

      const port = new SerialPort(
        {
          path: this.config.path,
          baudRate: this.config.baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          autoOpen: false,
        },
        (openError) => {
          if (openError) {
            this.error = openError.message;
            this.connected = false;
            this.emitStatus();
            finish();
          }
        },
      );

      port.open((openError) => {
        if (openError) {
          this.error = openError.message;
          this.connected = false;
          this.emitStatus();
          finish();
          return;
        }

        this.port = port;
        this.connected = true;
        this.error = null;
        this.buffer = Buffer.alloc(0);

        port.on('data', (chunk) => this.handleData(chunk));
        port.on('error', (error) => {
          this.error = error.message;
          this.connected = false;
          this.emitStatus();
        });
        port.on('close', () => {
          this.connected = false;
          this.port = null;
          this.stopPolling();
          this.emitStatus();
        });

        this.startPolling();
        this.queryFrequency();
        this.emitStatus();
        finish();
      });
    });
  }

  async disconnect() {
    this.stopPolling();
    await this.setPttSafe(false);
    const port = this.port;
    this.port = null;
    this.connected = false;
    this.frequency = null;
    this.pttOn = false;
    if (!port) {
      this.emitStatus();
      return this.status();
    }
    await new Promise((resolve) => {
      try {
        port.close(() => resolve());
      } catch {
        resolve();
      }
    });
    this.emitStatus();
    return this.status();
  }

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.queryFrequency();
    }, this.config.pollMs);
    this.pollTimer.unref?.();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  queryFrequency() {
    if (!this.port || !this.connected) return;
    if (this.config.protocol === 'icom') {
      this.write(buildIcomFrame(this.config.civAddress, 0x03));
      return;
    }
    this.write(Buffer.from('FA;', 'ascii'));
  }

  write(buffer) {
    if (!this.port || !this.connected) return false;
    try {
      this.port.write(buffer);
      return true;
    } catch (error) {
      this.error = error.message;
      return false;
    }
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (this.config.protocol === 'icom') {
      this.parseIcom();
      return;
    }

    // ASCII CAT: commands are terminated by ';'
    for (;;) {
      const index = this.buffer.indexOf(0x3b);
      if (index < 0) break;
      const command = this.buffer.subarray(0, index + 1).toString('ascii');
      this.buffer = this.buffer.subarray(index + 1);
      this.parseAscii(command);
    }
    if (this.buffer.length > 256) {
      this.buffer = Buffer.alloc(0);
    }
  }

  parseAscii(command) {
    const upper = command.toUpperCase();

    if (upper.startsWith('FA')) {
      const value = Number(command.slice(2).replace(/[^0-9]/g, ''));
      if (Number.isFinite(value) && value > 0) {
        this.updateFrequency(value);
      }
      return;
    }

    if (upper.startsWith('MD')) {
      const code = Number(command.slice(2).replace(/[^0-9]/g, ''));
      const entry = Object.entries(MODE_CODES).find(
        ([name, modes]) =>
          (this.config.protocol === 'yaesu' ? modes.yaesu : modes.kenwood) ===
          Number.parseInt(String(code), 10),
      );
      if (entry) {
        this.updateMode(entry[0]);
      }
      return;
    }

    if (upper.startsWith('TX') || upper.startsWith('RX')) {
      this.updatePtt(upper.startsWith('TX') && !upper.startsWith('TX0'));
    }
  }

  parseIcom() {
    const buffer = this.buffer;
    let start = buffer.indexOf(Buffer.from([0xfe, 0xfe]));
    while (start >= 0) {
      const end = buffer.indexOf(0xfd, start + 2);
      if (end < 0) break;
      const frame = buffer.subarray(start, end + 1);
      this.buffer = buffer.subarray(end + 1);
      this.parseIcomFrame(frame);
      start = this.buffer.indexOf(Buffer.from([0xfe, 0xfe]));
    }

    if (this.buffer.length > 512) {
      this.buffer = Buffer.alloc(0);
    }
  }

  parseIcomFrame(frame) {
    // FE FE <to> <from> <cmd> <data...> FD
    if (frame.length < 6) return;
    const command = frame[4];
    const data = frame.subarray(5, frame.length - 1);

    if (command === 0x03 && data.length >= 5) {
      this.updateFrequency(decodeIcomBcd(data));
      return;
    }

    if (command === 0x00 && data.length >= 6) {
      this.updateFrequency(decodeIcomBcd(data.subarray(0, 5)));
      const mode = data[5];
      const match = Object.entries(MODE_CODES).find(
        ([, modes]) => modes.icom === mode,
      );
      if (match) this.updateMode(match[0]);
      return;
    }

    if (command === 0xfb && data.length >= 6) {
      this.updateFrequency(decodeIcomBcd(data.subarray(0, 5)));
    }
  }

  updateFrequency(hz) {
    if (!Number.isFinite(hz) || hz <= 0) return;
    if (this.frequency === hz) return;
    this.frequency = hz;
    this.emitStatus();
  }

  updateMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emitStatus();
  }

  updatePtt(on) {
    if (this.pttOn === on) return;
    this.pttOn = on;
    this.emitStatus();
  }

  async setFrequency(hz) {
    if (!this.connected) return this.status();
    const frequency = Math.max(0, Math.round(hz));
    if (this.config.protocol === 'icom') {
      this.write(
        buildIcomFrame(this.config.civAddress, 0x05, encodeIcomBcd(frequency)),
      );
    } else if (this.config.protocol === 'yaesu') {
      this.write(Buffer.from(`FA${digits(frequency, 9)};`, 'ascii'));
    } else {
      this.write(Buffer.from(`FA${digits(frequency, 11)};`, 'ascii'));
    }
    this.frequency = frequency;
    this.emitStatus();
    return this.status();
  }

  async setMode(mode) {
    if (!this.connected) return this.status();
    const entry = MODE_CODES[mode];
    if (!entry) return this.status();
    if (this.config.protocol === 'icom') {
      this.write(
        buildIcomFrame(
          this.config.civAddress,
          0x06,
          Buffer.from([entry.icom, 0x01]),
        ),
      );
    } else if (this.config.protocol === 'yaesu') {
      this.write(Buffer.from(`MD0${entry.yaesu};`, 'ascii'));
    } else {
      this.write(Buffer.from(`MD${entry.kenwood};`, 'ascii'));
    }
    this.mode = mode;
    this.emitStatus();
    return this.status();
  }

  async setPtt(on) {
    if (!this.connected) return this.status();
    if (this.config.protocol === 'icom') {
      this.write(
        buildIcomFrame(
          this.config.civAddress,
          0x1c,
          Buffer.from([0x00, on ? 0x01 : 0x00]),
        ),
      );
    } else if (this.config.protocol === 'yaesu') {
      this.write(Buffer.from(on ? 'TX1;' : 'TX0;', 'ascii'));
    } else {
      this.write(Buffer.from(on ? 'TX;' : 'RX;', 'ascii'));
    }
    this.pttOn = on;
    this.emitStatus();

    if (this.pttSafetyTimer) {
      clearTimeout(this.pttSafetyTimer);
      this.pttSafetyTimer = null;
    }
    if (on) {
      // Never leave the rig keyed if the UI stops responding.
      this.pttSafetyTimer = setTimeout(() => {
        void this.setPttSafe(false);
      }, 60000);
      this.pttSafetyTimer.unref?.();
    }

    return this.status();
  }

  async setPttSafe(on) {
    try {
      await this.setPtt(on);
    } catch {
      /* ignore */
    }
  }

  /** Open a port, query it and wait briefly for a valid reply. */
  async probe(config, timeoutMs = 550) {
    await this.disconnect();
    const status = await this.connect(config);
    if (!status.connected) {
      return false;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.frequency != null) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    await this.disconnect();
    return false;
  }

  /**
   * Scan serial ports / baud rates / protocols for a rig that answers.
   * Returns { config, frequency } for the first responder, or null.
   */
  async autoDetect() {
    const ports = (await SerialPort.list()).map((entry) => entry.path);
    const baudRates = [9600, 19200, 38400, 115200, 4800];
    const protocols = [
      { protocol: 'kenwood' },
      { protocol: 'yaesu' },
      { protocol: 'icom', civAddress: 0x94 },
    ];

    for (const path of ports) {
      for (const protocol of protocols) {
        for (const baudRate of baudRates) {
          const config = {
            enabled: true,
            path,
            baudRate,
            protocol: protocol.protocol,
            civAddress: protocol.civAddress ?? 0x94,
            pollMs: 500,
          };
          this.emit('detect', { path, baudRate, protocol: protocol.protocol });
          // eslint-disable-next-line no-await-in-loop
          const found = await this.probe(config);
          if (found) {
            const frequency = this.frequency;
            const mode = this.mode;
            await this.disconnect();
            return {
              config,
              status: {
                connected: false,
                frequency,
                mode,
                error: null,
                port: path,
                protocol: protocol.protocol,
                ptt: false,
              },
            };
          }
        }
      }
    }

    return null;
  }
}

module.exports = {
  RigController,
  MODE_CODES,
  encodeIcomBcd,
  decodeIcomBcd,
  buildIcomFrame,
  digits,
};
