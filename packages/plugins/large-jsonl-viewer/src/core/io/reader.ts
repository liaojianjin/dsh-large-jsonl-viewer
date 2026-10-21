/** Source bytes are supplied by the Host filesystem; only caches use Node fs. */
export interface Identity {
  size: number;
  version: string;
  target: string;
  fingerprint: string;
}
export interface Reader {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
}
export interface RangeReader extends Reader {
  validate(): Promise<void>;
}
export interface Writer {
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>;
}
export function safePosition(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid byte position');
  return value;
}
export async function readExactly(
  reader: Reader,
  buffer: Buffer,
  position: number,
  cancelled = () => false,
): Promise<void> {
  safePosition(position);
  safePosition(position + buffer.length);
  let offset = 0;
  while (offset < buffer.length) {
    if (cancelled()) throw new Error('Cancelled');
    const { bytesRead } = await reader.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead <= 0 || bytesRead > buffer.length - offset)
      throw new Error('Unexpected EOF or invalid short read');
    offset += bytesRead;
  }
}
export async function writeExactly(writer: Writer, buffer: Buffer, position = 0): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await writer.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten <= 0 || bytesWritten > buffer.length - offset)
      throw new Error('Invalid short write');
    offset += bytesWritten;
  }
}
export function sameIdentity(a: Identity, b: Identity): boolean {
  return (
    a.size === b.size &&
    a.version === b.version &&
    a.target === b.target &&
    a.fingerprint === b.fingerprint
  );
}
export function decodeRecord(bytes: Buffer, firstLine: boolean): { raw: string; bom: boolean } {
  let end = bytes.length;
  if (end && bytes[end - 1] === 10) {
    end--;
    if (end && bytes[end - 1] === 13) end--;
  }
  const bom = firstLine && end >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  return {
    raw: new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(bom ? 3 : 0, end),
    ),
    bom,
  };
}
