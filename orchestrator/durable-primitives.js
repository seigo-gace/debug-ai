"use strict";

const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");

const ENVELOPE_SCHEMA = "debugai.durable-envelope/v1";

const DEFAULT_JSON_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxNodes: 100000,
  maxArrayLength: 4096,
  maxObjectKeys: 4096,
  maxStringBytes: 256 * 1024,
});

const RECORD_SCHEMA_PATTERN =
  /^[A-Za-z][A-Za-z0-9._-]*\/v[1-9][0-9]*$/;

const RECORD_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

const STORAGE_COMPONENT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

class DurableError extends Error {
  constructor(code, { cause, meta = null } = {}) {
    if (
      typeof code !== "string" ||
      !/^[A-Z][A-Z0-9_]{1,119}$/.test(code)
    ) {
      throw new TypeError("DURABLE_ERROR_CODE_INVALID");
    }

    super(code, cause === undefined ? undefined : { cause });

    this.name = "DurableError";
    this.code = code;
    this.meta = meta;
  }

  toJSON() {
    return {
      schema: "debugai.durable-error/v1",
      code: this.code,
    };
  }
}

function requireCondition(condition, code) {
  if (!condition) {
    throw new DurableError(code);
  }
}

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function assertRecordId(value) {
  requireCondition(
    typeof value === "string" &&
      RECORD_ID_PATTERN.test(value),
    "DURABLE_RECORD_ID_INVALID"
  );

  return value;
}

function assertHash(value) {
  requireCondition(
    typeof value === "string" &&
      HASH_PATTERN.test(value),
    "DURABLE_DIGEST_INVALID"
  );

  return value;
}

function assertRecordSchema(value) {
  requireCondition(
    typeof value === "string" &&
      value.length <= 128 &&
      RECORD_SCHEMA_PATTERN.test(value),
    "DURABLE_RECORD_SCHEMA_INVALID"
  );

  return value;
}

function assertStorageRelativePath(value) {
  requireCondition(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 2048 &&
      !value.includes("\\") &&
      !value.includes("\u0000"),
    "DURABLE_STORAGE_PATH_INVALID"
  );

  const parts = value.split("/");

  requireCondition(
    parts.length <= 16 &&
      parts.every(
        part =>
          part !== "." &&
          part !== ".." &&
          STORAGE_COMPONENT_PATTERN.test(part)
      ),
    "DURABLE_STORAGE_PATH_INVALID"
  );

  return parts;
}

function sha256Bytes(value) {
  requireCondition(
    typeof value === "string" ||
      Buffer.isBuffer(value) ||
      value instanceof Uint8Array,
    "DURABLE_HASH_INPUT_INVALID"
  );

  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function normalizeJsonLimits(options = {}) {
  requireCondition(
    isPlainObject(options),
    "DURABLE_JSON_LIMITS_INVALID"
  );

  const allowed = new Set(
    Object.keys(DEFAULT_JSON_LIMITS)
  );

  for (const key of Object.keys(options)) {
    requireCondition(
      allowed.has(key),
      "DURABLE_JSON_LIMIT_UNKNOWN"
    );
  }

  const limits = {
    ...DEFAULT_JSON_LIMITS,
    ...options,
  };

  for (const value of Object.values(limits)) {
    requireCondition(
      Number.isSafeInteger(value) && value > 0,
      "DURABLE_JSON_LIMIT_INVALID"
    );
  }

  requireCondition(
    limits.maxDepth <= 128,
    "DURABLE_JSON_DEPTH_LIMIT_INVALID"
  );

  return limits;
}

function canonicalJson(value, options = {}) {
  const limits = normalizeJsonLimits(options);
  const ancestors = new Set();
  const chunks = [];

  let bytes = 0;
  let nodes = 0;

  function append(text) {
    bytes += Buffer.byteLength(text, "utf8");

    requireCondition(
      bytes <= limits.maxBytes,
      "DURABLE_JSON_BYTE_LIMIT"
    );

    chunks.push(text);
  }

  function encodeString(text) {
    requireCondition(
      Buffer.byteLength(text, "utf8") <=
        limits.maxStringBytes,
      "DURABLE_JSON_STRING_LIMIT"
    );

    return JSON.stringify(text);
  }

  function enterNode(depth) {
    nodes += 1;

    requireCondition(
      nodes <= limits.maxNodes,
      "DURABLE_JSON_NODE_LIMIT"
    );

    requireCondition(
      depth <= limits.maxDepth,
      "DURABLE_JSON_DEPTH_LIMIT"
    );
  }

  function visit(current, depth) {
    enterNode(depth);

    if (current === null) {
      append("null");
      return;
    }

    if (typeof current === "string") {
      append(encodeString(current));
      return;
    }

    if (typeof current === "boolean") {
      append(current ? "true" : "false");
      return;
    }

    if (typeof current === "number") {
      requireCondition(
        Number.isFinite(current) &&
          !Object.is(current, -0) &&
          (
            !Number.isInteger(current) ||
            Number.isSafeInteger(current)
          ),
        "DURABLE_JSON_NUMBER_INVALID"
      );

      append(JSON.stringify(current));
      return;
    }

    requireCondition(
      typeof current === "object",
      "DURABLE_JSON_VALUE_INVALID"
    );

    requireCondition(
      !ancestors.has(current),
      "DURABLE_JSON_CYCLE"
    );

    requireCondition(
      Object.getOwnPropertySymbols(current).length === 0,
      "DURABLE_JSON_SYMBOL_KEY"
    );

    ancestors.add(current);

    try {
      const descriptors =
        Object.getOwnPropertyDescriptors(current);

      if (Array.isArray(current)) {
        requireCondition(
          Object.getPrototypeOf(current) ===
            Array.prototype,
          "DURABLE_JSON_ARRAY_PROTOTYPE_INVALID"
        );

        requireCondition(
          current.length <= limits.maxArrayLength,
          "DURABLE_JSON_ARRAY_LIMIT"
        );

        const propertyNames =
          Object.getOwnPropertyNames(current);

        requireCondition(
          propertyNames.length === current.length + 1,
          "DURABLE_JSON_ARRAY_PROPERTIES_INVALID"
        );

        append("[");

        for (let index = 0; index < current.length; index++) {
          const descriptor = descriptors[String(index)];

          requireCondition(
            descriptor !== undefined &&
              Object.hasOwn(descriptor, "value") &&
              descriptor.enumerable === true,
            "DURABLE_JSON_ARRAY_ELEMENT_INVALID"
          );

          if (index > 0) {
            append(",");
          }

          visit(descriptor.value, depth + 1);
        }

        append("]");
        return;
      }

      requireCondition(
        isPlainObject(current),
        "DURABLE_JSON_OBJECT_INVALID"
      );

      const keys = Object.getOwnPropertyNames(current).sort();

      requireCondition(
        keys.length <= limits.maxObjectKeys,
        "DURABLE_JSON_OBJECT_KEY_LIMIT"
      );

      append("{");

      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const descriptor = descriptors[key];

        requireCondition(
          !FORBIDDEN_OBJECT_KEYS.has(key),
          "DURABLE_JSON_OBJECT_KEY_FORBIDDEN"
        );

        requireCondition(
          Object.hasOwn(descriptor, "value") &&
            descriptor.enumerable === true,
          "DURABLE_JSON_PROPERTY_INVALID"
        );

        if (index > 0) {
          append(",");
        }

        append(encodeString(key));
        append(":");
        visit(descriptor.value, depth + 1);
      }

      append("}");
    } finally {
      ancestors.delete(current);
    }
  }

  visit(value, 0);

  return chunks.join("");
}

function cloneJson(value, options = {}) {
  return JSON.parse(canonicalJson(value, options));
}

function hashCanonical(value, options = {}) {
  return sha256Bytes(canonicalJson(value, options));
}

function encodeEnvelope(record, options = {}) {
  requireCondition(
    isPlainObject(record),
    "DURABLE_RECORD_OBJECT_REQUIRED"
  );

  assertRecordSchema(record.schema);

  const payloadText = canonicalJson(record, options);
  const payload = JSON.parse(payloadText);

  const envelope = {
    schema: ENVELOPE_SCHEMA,
    payload,
    payload_sha256: sha256Bytes(payloadText),
  };

  return canonicalJson(envelope, options);
}

function decodeUtf8(value, maxBytes) {
  let bytes;

  if (typeof value === "string") {
    bytes = Buffer.from(value, "utf8");
  } else if (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array
  ) {
    bytes = Buffer.from(value);
  } else {
    throw new DurableError("DURABLE_READ_INPUT_INVALID");
  }

  requireCondition(
    bytes.length <= maxBytes,
    "DURABLE_JSON_BYTE_LIMIT"
  );

  let text;

  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch (cause) {
    throw new DurableError(
      "DURABLE_UTF8_INVALID",
      { cause }
    );
  }

  return { bytes, text };
}

function decodeEnvelope(
  value,
  {
    expectedSchema = null,
    expectedDigest = null,
    limits: options = {},
  } = {}
) {
  const limits = normalizeJsonLimits(options);
  const { bytes, text } = decodeUtf8(
    value,
    limits.maxBytes
  );

  if (expectedDigest !== null) {
    assertHash(expectedDigest);

    requireCondition(
      sha256Bytes(bytes) === expectedDigest,
      "DURABLE_RECORD_DIGEST_MISMATCH"
    );
  }

  let envelope;

  try {
    envelope = JSON.parse(text);
  } catch (cause) {
    throw new DurableError(
      "DURABLE_JSON_INVALID",
      { cause }
    );
  }

  requireCondition(
    isPlainObject(envelope),
    "DURABLE_ENVELOPE_OBJECT_REQUIRED"
  );

  const keys = Object.keys(envelope).sort();

  requireCondition(
    keys.length === 3 &&
      keys[0] === "payload" &&
      keys[1] === "payload_sha256" &&
      keys[2] === "schema",
    "DURABLE_ENVELOPE_FIELDS_INVALID"
  );

  requireCondition(
    envelope.schema === ENVELOPE_SCHEMA,
    "DURABLE_ENVELOPE_SCHEMA_UNSUPPORTED"
  );

  requireCondition(
    isPlainObject(envelope.payload),
    "DURABLE_RECORD_OBJECT_REQUIRED"
  );

  assertRecordSchema(envelope.payload.schema);
  assertHash(envelope.payload_sha256);

  if (expectedSchema !== null) {
    assertRecordSchema(expectedSchema);

    requireCondition(
      envelope.payload.schema === expectedSchema,
      "DURABLE_RECORD_SCHEMA_MISMATCH"
    );
  }

  const payloadText =
    canonicalJson(envelope.payload, limits);

  requireCondition(
    sha256Bytes(payloadText) ===
      envelope.payload_sha256,
    "DURABLE_PAYLOAD_DIGEST_MISMATCH"
  );

  requireCondition(
    canonicalJson(envelope, limits) === text,
    "DURABLE_ENVELOPE_NOT_CANONICAL"
  );

  return envelope.payload;
}

module.exports = {
  ENVELOPE_SCHEMA,
  DEFAULT_JSON_LIMITS,
  DurableError,
  requireCondition,
  isPlainObject,
  assertRecordId,
  assertHash,
  assertRecordSchema,
  assertStorageRelativePath,
  sha256Bytes,
  normalizeJsonLimits,
  canonicalJson,
  cloneJson,
  hashCanonical,
  encodeEnvelope,
  decodeEnvelope,
};
