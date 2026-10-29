import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

/** JSON evidence consists of parsed JSON/plain records; no replacer or toJSON hooks. */
function* jsonParts(
  value: unknown,
  ancestors = new Set<object>(),
): Generator<string> {
  if (value === null || typeof value !== 'object') {
    yield JSON.stringify(value) ?? 'null';
    return;
  }
  if (ancestors.has(value)) throw new TypeError('Circular JSON evidence');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      yield '[';
      for (let index = 0; index < value.length; index++) {
        if (index) yield ',';
        yield* jsonParts(value[index], ancestors);
      }
      yield ']';
    } else {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new TypeError('JSON evidence requires plain records');
      if ('toJSON' in value && typeof value.toJSON === 'function')
        throw new TypeError('JSON evidence cannot contain toJSON hooks');
      yield '{';
      let first = true;
      for (const key of Object.keys(value)) {
        const field = Reflect.get(value, key);
        if (
          field === undefined ||
          typeof field === 'function' ||
          typeof field === 'symbol'
        )
          continue;
        if (!first) yield ',';
        first = false;
        yield JSON.stringify(key) + ':';
        yield* jsonParts(field, ancestors);
      }
      yield '}';
    }
  } finally {
    ancestors.delete(value);
  }
}

/** Bound serialization buffers; publish atomically only after the complete file is written. */
export const writeReplayJsonFile = async (file: string, value: unknown) => {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + randomUUID();
  const stream = fs.createWriteStream(temporary, {
    flags: 'wx',
    highWaterMark: 65536,
  });
  let failure: Error | undefined;
  stream.on('error', (error) => {
    failure = error;
  });
  try {
    let buffer = '';
    for (const part of jsonParts(value)) {
      buffer += part;
      if (buffer.length >= 65536) {
        if (failure) throw failure;
        if (!stream.write(buffer)) await once(stream, 'drain');
        buffer = '';
      }
    }
    if (failure) throw failure;
    stream.end(buffer + '\n');
    await once(stream, 'close');
    if (failure) throw failure;
    await fsp.rename(temporary, file);
  } catch (error) {
    stream.destroy();
    if (!stream.closed) await once(stream, 'close').catch(() => undefined);
    await fsp.rm(temporary, { force: true });
    throw error;
  }
};
