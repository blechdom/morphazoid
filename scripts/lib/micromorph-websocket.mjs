import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { isIP } from "node:net";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_QUEUED_MESSAGES = 32;
const DEFAULT_CLOSE_TIMEOUT_MS = 1000;
const EMPTY_BUFFER = Buffer.alloc(0);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function isLoopbackAddress(value) {
  if (typeof value !== "string") return false;
  const address = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (address === "localhost" || address === "::1") return true;
  if (address.startsWith("::ffff:")) return isLoopbackAddress(address.slice(7));
  if (isIP(address) === 4) return address.split(".")[0] === "127";
  return false;
}

export function isPureAbsolutePathname(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  if (value.includes("?") || value.includes("#")) return false;
  try {
    const parsed = new URL(value, "http://loopback.invalid");
    return parsed.origin === "http://loopback.invalid"
      && parsed.pathname === value
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function headerValue(request, name) {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(",") : value;
}

function headerHasToken(value, expected) {
  return typeof value === "string"
    && value.split(",").some((part) => part.trim().toLowerCase() === expected);
}

function isValidWebSocketKey(value) {
  if (typeof value !== "string") return false;
  try {
    return Buffer.from(value, "base64").byteLength === 16
      && /^[A-Za-z0-9+/]{22}==$/.test(value);
  } catch {
    return false;
  }
}

function isValidCloseCode(code) {
  return (
    code >= 1000
    && code <= 1014
    && ![1004, 1005, 1006].includes(code)
  ) || (code >= 3000 && code <= 4999);
}

function normalizePayload(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("WebSocket binary payload must be a Buffer, ArrayBuffer, or typed array");
}

function encodeServerFrame(opcode, payload = EMPTY_BUFFER, final = true) {
  const body = normalizePayload(payload);
  let headerBytes = 2;
  if (body.byteLength >= 126 && body.byteLength <= 0xffff) headerBytes += 2;
  if (body.byteLength > 0xffff) headerBytes += 8;

  const frame = Buffer.allocUnsafe(headerBytes + body.byteLength);
  frame[0] = (final ? 0x80 : 0) | opcode;

  if (body.byteLength < 126) {
    frame[1] = body.byteLength;
  } else if (body.byteLength <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(body.byteLength, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(body.byteLength), 2);
  }

  body.copy(frame, headerBytes);
  return frame;
}

function encodeClosePayload(code, reason) {
  if (!isValidCloseCode(code)) throw new RangeError(`Invalid WebSocket close code: ${code}`);
  const reasonBytes = Buffer.from(reason, "utf8");
  if (reasonBytes.byteLength > 123) {
    throw new RangeError("WebSocket close reason must be at most 123 UTF-8 bytes");
  }
  const payload = Buffer.allocUnsafe(2 + reasonBytes.byteLength);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return payload;
}

class AsyncQueue {
  constructor(maxValues = Number.POSITIVE_INFINITY) {
    this.maxValues = maxValues;
    this.values = [];
    this.waiters = [];
    this.ended = false;
    this.failure = null;
  }

  push(value) {
    if (this.ended) return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else {
      if (this.values.length >= this.maxValues) return false;
      this.values.push(value);
    }
    return true;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  discard() {
    if (this.ended) return;
    this.values.length = 0;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error) {
    if (this.ended) return;
    this.values.length = 0;
    this.failure = error;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.values.length > 0) {
      return Promise.resolve({ value: this.values.shift(), done: false });
    }
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  return() {
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

/**
 * One accepted RFC 6455 connection. Complete text/binary messages can be
 * consumed with `for await`; EventEmitter listeners receive the same messages.
 */
export class WebSocketConnection extends EventEmitter {
  constructor(socket, request, options = {}) {
    super();
    this.socket = socket;
    this.request = request;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.maxQueuedMessages = options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    this.state = "open";
    this._buffer = EMPTY_BUFFER;
    this._fragmentOpcode = null;
    this._fragmentBytes = 0;
    this._fragments = [];
    this._messages = new AsyncQueue(this.maxQueuedMessages);
    this._closeSent = false;
    this._closeReceived = false;
    this._closeDetails = null;
    this._closeEmitted = false;
    this._closeTimer = null;

    // A connection error remains observable without making EventEmitter throw
    // when an async-iterator-only consumer has no explicit error listener.
    this.on("error", () => {});

    socket.on("data", (chunk) => this._receive(chunk));
    socket.on("error", (error) => this._handleSocketError(error));
    socket.on("close", () => this._handleSocketClose());
    socket.on("end", () => {
      if (!this._closeReceived && this.state === "open") this.state = "closing";
    });
  }

  get bufferedAmount() {
    return this.socket.writableLength;
  }

  get remoteAddress() {
    return this.socket.remoteAddress;
  }

  pause() {
    this.socket.pause();
    return this;
  }

  resume() {
    this.socket.resume();
    return this;
  }

  async waitForDrain() {
    if (this.socket.destroyed) throw new Error("WebSocket connection is closed");
    if (!this.socket.writableNeedDrain) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.off("drain", onDrain);
        this.socket.off("close", onClose);
        this.socket.off("error", onError);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error("WebSocket connection closed before draining"));
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      this.socket.once("drain", onDrain);
      this.socket.once("close", onClose);
      this.socket.once("error", onError);
    });
  }

  sendText(text) {
    if (typeof text !== "string") throw new TypeError("sendText expects a string");
    return this._sendMessage(0x1, Buffer.from(text, "utf8"));
  }

  sendBinary(data) {
    return this._sendMessage(0x2, normalizePayload(data));
  }

  ping(data = EMPTY_BUFFER) {
    const payload = normalizePayload(data);
    if (payload.byteLength > 125) throw new RangeError("WebSocket ping payload exceeds 125 bytes");
    this._assertOpen();
    return this.socket.write(encodeServerFrame(0x9, payload));
  }

  close(code = 1000, reason = "") {
    if (this.state === "closed" || this._closeSent) return false;
    const payload = encodeClosePayload(code, reason);
    this._closeSent = true;
    this.state = "closing";
    const accepted = this.socket.write(encodeServerFrame(0x8, payload));
    this._armCloseTimer();
    return accepted;
  }

  terminate() {
    if (!this.socket.destroyed) this.socket.destroy();
  }

  [Symbol.asyncIterator]() {
    return this._messages[Symbol.asyncIterator]();
  }

  _assertOpen() {
    if (this.state !== "open" || this.socket.destroyed) {
      throw new Error("WebSocket connection is not open");
    }
  }

  _sendMessage(opcode, payload) {
    this._assertOpen();
    if (payload.byteLength > this.maxMessageBytes) {
      throw new RangeError(`Outgoing WebSocket message exceeds ${this.maxMessageBytes} bytes`);
    }
    if (payload.byteLength > this.maxFrameBytes) {
      throw new RangeError(
        `Outgoing WebSocket message exceeds the unfragmented frame cap of ${this.maxFrameBytes} bytes`,
      );
    }
    return this.socket.write(encodeServerFrame(opcode, payload));
  }

  _receive(chunk) {
    if (this.state === "closed" || chunk.byteLength === 0) return;
    this._buffer = this._buffer.byteLength === 0
      ? chunk
      : Buffer.concat([this._buffer, chunk], this._buffer.byteLength + chunk.byteLength);

    while (this.state !== "closed" && this._parseFrame()) {
      // Parse every complete frame already delivered by the kernel.
    }
  }

  _parseFrame() {
    if (this._buffer.byteLength < 2) return false;

    const first = this._buffer[0];
    const second = this._buffer[1];
    const final = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let headerLength = 2;

    if (rsv !== 0) return this._protocolError(1002, "RSV bits are unsupported");
    if (!masked) return this._protocolError(1002, "Client frames must be masked");

    if (payloadLength === 126) {
      if (this._buffer.byteLength < 4) return false;
      payloadLength = this._buffer.readUInt16BE(2);
      headerLength = 4;
      if (payloadLength < 126) return this._protocolError(1002, "Non-minimal frame length");
    } else if (payloadLength === 127) {
      if (this._buffer.byteLength < 10) return false;
      const encodedLength = this._buffer.readBigUInt64BE(2);
      if ((encodedLength & (1n << 63n)) !== 0n) {
        return this._protocolError(1002, "Invalid 64-bit frame length");
      }
      if (encodedLength <= 0xffffn) return this._protocolError(1002, "Non-minimal frame length");
      if (encodedLength > BigInt(this.maxFrameBytes)) {
        return this._protocolError(1009, "Frame is too large");
      }
      payloadLength = Number(encodedLength);
      headerLength = 10;
    }

    const isControl = opcode >= 0x8;
    if (isControl && (!final || payloadLength > 125)) {
      return this._protocolError(1002, "Invalid control frame");
    }
    if (payloadLength > this.maxFrameBytes) {
      return this._protocolError(1009, "Frame is too large");
    }

    const frameLength = headerLength + 4 + payloadLength;
    if (this._buffer.byteLength < frameLength) return false;

    const mask = this._buffer.subarray(headerLength, headerLength + 4);
    const payload = Buffer.from(this._buffer.subarray(headerLength + 4, frameLength));
    for (let index = 0; index < payload.byteLength; index += 1) {
      payload[index] ^= mask[index & 3];
    }
    this._buffer = this._buffer.subarray(frameLength);
    this._handleFrame(opcode, final, payload);
    return true;
  }

  _handleFrame(opcode, final, payload) {
    if (opcode === 0x8) {
      this._handleCloseFrame(payload);
      return;
    }
    // Once this endpoint sends Close, only the peer's Close handshake matters.
    if (this.state === "closing") return;
    if (opcode === 0x9) {
      this.socket.write(encodeServerFrame(0xa, payload));
      this.emit("ping", payload);
      return;
    }
    if (opcode === 0xa) {
      this.emit("pong", payload);
      return;
    }
    if (![0x0, 0x1, 0x2].includes(opcode)) {
      this._protocolError(1002, "Unsupported opcode");
      return;
    }

    if (opcode === 0x0) {
      if (this._fragmentOpcode === null) {
        this._protocolError(1002, "Unexpected continuation frame");
        return;
      }
      if (!this._appendFragment(payload)) return;
      if (final) {
        const messageOpcode = this._fragmentOpcode;
        const complete = Buffer.concat(this._fragments, this._fragmentBytes);
        this._resetFragments();
        this._emitMessage(messageOpcode, complete);
      }
      return;
    }

    if (this._fragmentOpcode !== null) {
      this._protocolError(1002, "New data frame during fragmented message");
      return;
    }
    if (payload.byteLength > this.maxMessageBytes) {
      this._protocolError(1009, "Message is too large");
      return;
    }
    if (final) {
      this._emitMessage(opcode, payload);
      return;
    }
    this._fragmentOpcode = opcode;
    this._appendFragment(payload);
  }

  _appendFragment(payload) {
    if (this._fragmentBytes + payload.byteLength > this.maxMessageBytes) {
      this._protocolError(1009, "Message is too large");
      return false;
    }
    this._fragments.push(payload);
    this._fragmentBytes += payload.byteLength;
    return true;
  }

  _resetFragments() {
    this._fragmentOpcode = null;
    this._fragmentBytes = 0;
    this._fragments = [];
  }

  _emitMessage(opcode, payload) {
    let message;
    if (opcode === 0x1) {
      try {
        message = { type: "text", data: UTF8_DECODER.decode(payload) };
      } catch {
        this._protocolError(1007, "Invalid UTF-8 text message");
        return;
      }
    } else {
      message = { type: "binary", data: payload };
    }
    if (!this._messages.push(message)) {
      this._protocolError(1009, "Inbound message queue is full");
      return;
    }
    this.emit("message", message);
  }

  _handleCloseFrame(payload) {
    let code = 1005;
    let reason = "";
    if (payload.byteLength === 1) {
      this._protocolError(1002, "Invalid close payload");
      return;
    }
    if (payload.byteLength >= 2) {
      code = payload.readUInt16BE(0);
      if (!isValidCloseCode(code)) {
        this._protocolError(1002, "Invalid close code");
        return;
      }
      try {
        reason = UTF8_DECODER.decode(payload.subarray(2));
      } catch {
        this._protocolError(1007, "Invalid UTF-8 close reason");
        return;
      }
    }

    this._closeReceived = true;
    this._closeDetails = { code, reason, wasClean: true };
    this.state = "closing";
    if (!this._closeSent) {
      this._closeSent = true;
      this.socket.write(encodeServerFrame(0x8, payload));
    }
    this.socket.end();
    this._armCloseTimer();
  }

  _protocolError(code, reason) {
    if (this.state !== "open") return false;
    this._resetFragments();
    this._messages.discard();
    this._closeSent = true;
    this.state = "closing";
    this._closeDetails = { code, reason, wasClean: false };
    const frame = encodeServerFrame(0x8, encodeClosePayload(code, reason));
    this.socket.end(frame);
    this._armCloseTimer();
    return false;
  }

  _armCloseTimer() {
    if (this._closeTimer || this.socket.destroyed) return;
    this._closeTimer = setTimeout(() => this.terminate(), this.closeTimeoutMs);
    this._closeTimer.unref?.();
  }

  _handleSocketError(error) {
    this.emit("error", error);
    this._messages.fail(error);
  }

  _handleSocketClose() {
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = null;
    this.state = "closed";
    this._messages.end();
    if (this._closeEmitted) return;
    this._closeEmitted = true;
    const details = this._closeDetails ?? { code: 1006, reason: "", wasClean: false };
    this.emit("close", details);
  }
}

function rejectUpgrade(socket, statusCode, statusText) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n`
    + "Connection: close\r\n"
    + "Content-Length: 0\r\n"
    + "Cache-Control: no-store\r\n\r\n",
  );
}

function extractBearerToken(request, requestUrl, tokenQueryParameter) {
  const authorization = headerValue(request, "authorization");
  if (typeof authorization === "string") {
    const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
    if (match) return match[1];
  }
  return requestUrl.searchParams.get(tokenQueryParameter);
}

/**
 * A loopback-only, zero-dependency WebSocket server suitable for a local model
 * adapter. Call `listen()`, then consume accepted connections with `for await`.
 *
 * `validateOrigin(origin, request)` and `validateToken(token, request)` may be
 * synchronous or asynchronous and must return true to accept the upgrade.
 */
export class LoopbackWebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 3939;
    this.path = options.path ?? "/v1/stream";
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.maxQueuedMessages = options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    this.validateOrigin = options.validateOrigin ?? null;
    this.validateToken = options.validateToken ?? null;
    this.tokenQueryParameter = options.tokenQueryParameter ?? "token";
    this._httpServer = null;
    this._listenPromise = null;
    this._connections = new Set();
    this._connectionQueue = new AsyncQueue();
    this._closing = false;

    if (!isLoopbackAddress(this.host)) {
      throw new RangeError(`Micromorph WebSocket host must be loopback, received: ${this.host}`);
    }
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535) {
      throw new RangeError(`Invalid WebSocket port: ${this.port}`);
    }
    if (!isPureAbsolutePathname(this.path)) {
      throw new TypeError("WebSocket path must be a pure absolute pathname without query or hash");
    }
    for (const [name, value] of [
      ["maxFrameBytes", this.maxFrameBytes],
      ["maxMessageBytes", this.maxMessageBytes],
      ["maxQueuedMessages", this.maxQueuedMessages],
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
    if (this.maxMessageBytes < this.maxFrameBytes) {
      throw new RangeError("maxMessageBytes must be greater than or equal to maxFrameBytes");
    }
    this.on("error", () => {});
  }

  get listening() {
    return Boolean(this._httpServer?.listening);
  }

  get connectionCount() {
    return this._connections.size;
  }

  address() {
    return this._httpServer?.address() ?? null;
  }

  async listen() {
    if (this._listenPromise) return this._listenPromise;
    if (this._closing) throw new Error("WebSocket server is closing");

    this._httpServer = createServer((request, response) => {
      response.writeHead(426, {
        "Cache-Control": "no-store",
        Connection: "close",
        "Content-Length": "0",
        Upgrade: "websocket",
      });
      response.end();
    });
    this._httpServer.on("error", (error) => {
      this.emit("error", error);
      this._connectionQueue.fail(error);
    });
    this._httpServer.on("upgrade", (request, socket, head) => {
      void this._handleUpgrade(request, socket, head).catch((error) => {
        this.emit("validationError", error, request);
        rejectUpgrade(socket, 500, "Internal Server Error");
      });
    });

    this._listenPromise = new Promise((resolve, reject) => {
      const onError = (error) => {
        this._httpServer.off("listening", onListening);
        this._listenPromise = null;
        reject(error);
      };
      const onListening = () => {
        this._httpServer.off("error", onError);
        resolve(this);
      };
      this._httpServer.once("error", onError);
      this._httpServer.once("listening", onListening);
      this._httpServer.listen({ host: this.host, port: this.port });
    });
    return this._listenPromise;
  }

  async close(options = {}) {
    if (this._closing) return;
    this._closing = true;
    this._connectionQueue.end();
    const server = this._httpServer;
    if (!server) return;

    const closeCode = options.code ?? 1001;
    const closeReason = options.reason ?? "server shutdown";
    const timeoutMs = options.timeoutMs ?? this.closeTimeoutMs;
    const serverClosed = new Promise((resolve) => server.close(resolve));
    for (const connection of this._connections) connection.close(closeCode, closeReason);

    if (this._connections.size > 0) {
      await Promise.race([
        Promise.all([...this._connections].map((connection) => (
          connection.state === "closed" ? undefined : once(connection, "close")
        ))),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    }
    for (const connection of this._connections) connection.terminate();
    await serverClosed;
    this._httpServer = null;
    this._listenPromise = null;
  }

  [Symbol.asyncIterator]() {
    return this._connectionQueue[Symbol.asyncIterator]();
  }

  async _handleUpgrade(request, socket, head) {
    socket.pause();
    if (this._closing) return rejectUpgrade(socket, 503, "Service Unavailable");
    if (!isLoopbackAddress(socket.remoteAddress ?? "")) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      return rejectUpgrade(socket, 400, "Bad Request");
    }
    if (requestUrl.pathname !== this.path) return rejectUpgrade(socket, 404, "Not Found");

    const key = headerValue(request, "sec-websocket-key");
    const validHandshake = request.method === "GET"
      && headerHasToken(headerValue(request, "upgrade"), "websocket")
      && headerHasToken(headerValue(request, "connection"), "upgrade")
      && headerValue(request, "sec-websocket-version") === "13"
      && isValidWebSocketKey(key);
    if (!validHandshake) return rejectUpgrade(socket, 400, "Bad Request");

    const origin = headerValue(request, "origin") ?? null;
    const token = extractBearerToken(request, requestUrl, this.tokenQueryParameter);
    if (this.validateOrigin && await this.validateOrigin(origin, request) !== true) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }
    if (this.validateToken && await this.validateToken(token, request) !== true) {
      return rejectUpgrade(socket, 401, "Unauthorized");
    }
    if (socket.destroyed) return;

    const accept = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n"
      + "Upgrade: websocket\r\n"
      + "Connection: Upgrade\r\n"
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const connection = new WebSocketConnection(socket, request, {
      maxFrameBytes: this.maxFrameBytes,
      maxMessageBytes: this.maxMessageBytes,
      maxQueuedMessages: this.maxQueuedMessages,
      closeTimeoutMs: this.closeTimeoutMs,
    });
    this._connections.add(connection);
    connection.once("close", () => this._connections.delete(connection));
    this._connectionQueue.push(connection);
    this.emit("connection", connection, request);
    if (head.byteLength > 0) connection._receive(head);
    socket.resume();
  }
}

export function createLoopbackWebSocketServer(options) {
  return new LoopbackWebSocketServer(options);
}

export const websocketDefaults = Object.freeze({
  maxFrameBytes: DEFAULT_MAX_FRAME_BYTES,
  maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES,
  maxQueuedMessages: DEFAULT_MAX_QUEUED_MESSAGES,
  closeTimeoutMs: DEFAULT_CLOSE_TIMEOUT_MS,
});
