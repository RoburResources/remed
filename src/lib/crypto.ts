import crypto from "node:crypto";

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacHex(algorithm: "sha256" | "sha1", secret: string, value: string): string {
  return crypto.createHmac(algorithm, secret).update(value).digest("hex");
}

export function hmacBase64(algorithm: "sha1" | "sha256", secret: string, value: string): string {
  return crypto.createHmac(algorithm, secret).update(value).digest("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

export function randomNumericNonce(length = 6): string {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}

export function hashApprovalNonce(taskId: number, nonce: string, secret: string): string {
  return hmacHex("sha256", secret, `${taskId}:${nonce}`);
}

export function idempotencyKey(parts: Array<string | number | null | undefined>): string {
  return sha256Hex(parts.filter((part) => part !== null && part !== undefined).join("|"));
}
