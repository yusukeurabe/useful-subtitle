export const MAX_FRAME_BYTES = 128 * 1024;

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !value.id.length || value.id.length > 128
    || typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.model)
    || typeof value.system !== 'string' || value.system.length > 8192
    || typeof value.user !== 'string' || !value.user.length || value.user.length > 16384
    || (value.maxTokens !== undefined && (!Number.isInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 4096))) {
    throw new Error('Invalid native request');
  }
  return value;
}

export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_FRAME_BYTES) throw new Error('Frame too large');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  constructor(onMessage) { this.onMessage = onMessage; }
  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) throw new Error('Invalid frame length');
      if (this.#buffer.length < length + 4) return;
      const body = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.subarray(length + 4);
      this.onMessage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
    }
  }
  end() { if (this.#buffer.length) throw new Error('Incomplete frame'); }
}
