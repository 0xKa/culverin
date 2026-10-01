export const encoder = new TextEncoder();

export function put(
  block: Uint8Array,
  offset: number,
  width: number,
  value: string,
): void {
  const bytes = encoder.encode(value);
  if (bytes.length > width) throw new Error("field overflow");
  block.set(bytes, offset);
}

export function octal(
  block: Uint8Array,
  offset: number,
  width: number,
  value: number,
): void {
  put(block, offset, width, value.toString(8).padStart(width - 1, "0") + "\0");
}

export function checksum(block: Uint8Array): void {
  block.fill(32, 148, 156);
  const sum = block.subarray(0, 512).reduce((value, byte) => value + byte, 0);
  octal(block, 148, 8, sum);
}

export function entry(path: string, body: Uint8Array, type = "0"): Uint8Array {
  const block = new Uint8Array(512);
  put(block, 0, 100, path);
  octal(block, 100, 8, 0o644);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, body.length);
  octal(block, 136, 12, 0);
  put(block, 156, 1, type);
  put(block, 257, 6, "ustar\0");
  put(block, 263, 2, "00");
  checksum(block);
  return join(block, body, new Uint8Array((512 - (body.length % 512)) % 512));
}

export function link(path: string, target: string, type = "2"): Uint8Array {
  const block = entry(path, new Uint8Array(0), type);
  put(block, 157, 100, target);
  checksum(block);
  return block;
}

export function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function archive(...entries: Uint8Array[]): Uint8Array {
  return join(...entries, new Uint8Array(1024));
}
