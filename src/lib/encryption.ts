import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export type EncryptedField = {
  algorithm: typeof ALGORITHM;
  ciphertext: string;
  iv: string;
  keyId: string;
  tag: string;
};

type EncryptionKey = {
  id: string;
  key: Buffer;
};

function parseKeyring(): EncryptionKey[] {
  const rawKeyring = process.env.ENCRYPTION_KEY;

  if (!rawKeyring) {
    throw new Error("ENCRYPTION_KEY is required for encrypted fields");
  }

  return rawKeyring.split(",").map((entry, index) => {
    const [maybeId, maybeKey] = entry.includes(":")
      ? entry.split(":")
      : [`key-${index + 1}`, entry];
    const key = Buffer.from(maybeKey, "base64");

    if (key.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY entry ${maybeId} must decode to 32 bytes`,
      );
    }

    return { id: maybeId, key };
  });
}

function getPrimaryKey() {
  return parseKeyring()[0];
}

function findKey(keyId: string) {
  const key = parseKeyring().find((entry) => entry.id === keyId);

  if (!key) {
    throw new Error(`No encryption key found for key id ${keyId}`);
  }

  return key;
}

export function encryptField(value: string): EncryptedField {
  const { id, key } = getPrimaryKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    keyId: id,
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptField(payload: EncryptedField): string {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported encryption algorithm ${payload.algorithm}`);
  }

  const { key } = findKey(payload.keyId);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, "base64"),
    { authTagLength: AUTH_TAG_LENGTH },
  );

  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
