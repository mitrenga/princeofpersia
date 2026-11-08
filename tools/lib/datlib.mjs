/**
 * The file formats of Prince of Persia (DOS 1.0) for the offline tools:
 * the DAT container, the compressed images, the chtab palettes and the
 * three kinds of sound resource. Written from the description of the
 * formats in NOTES.md (transcribed from SDLPoP `seg009.c`/`types.h`) and
 * checked on the operator's files by `tools/checkdat.mjs`.
 *
 * Everything here is about *reading the original's files*; what the game
 * itself needs at run time (levels, room drawing) lives in `app/pop/` and
 * is imported by the tools from there, so the tools test the game's code
 * and not a copy of it.
 *
 * @module tools/lib/datlib
 */
import fs from 'node:fs';
import path from 'node:path';

// ------------------------------------------------------------------ container

/**
 * One `*.DAT` archive: a table of numbered resources.
 *
 *   offset 0   u32 tableOffset
 *   offset 4   u16 tableSize
 *   table:     u16 count, then count x { u16 id, u32 offset, u16 size }
 *
 * Every resource starts with one checksum byte followed by `size` data
 * bytes. ★ The checksum is the complement of the sum of the data bytes:
 * `(checksum + sum(data)) & 0xFF == 0xFF` — verified on every resource of
 * all 22 DAT files of the 1.0 release (checkdat.mjs, 2026-09-14). SDLPoP
 * reads the byte and never checks it (`load_from_opendats_alloc`).
 */
export class DATFile {

  /**
   * @param {string} name - File name, for messages.
   * @param {Uint8Array} bytes - The whole file.
   */
  constructor(name, bytes) {
    this.name = name;
    this.bytes = bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.tableOffset = view.getUint32(0, true);
    this.tableSize = view.getUint16(4, true);
    const count = view.getUint16(this.tableOffset, true);
    /** the entries in file order */
    this.entries = [];
    this.byId = new Map();
    for (let i = 0; i < count; i++) {
      const at = this.tableOffset+2+8*i;
      const entry = {
        id: view.getUint16(at, true),
        offset: view.getUint32(at+2, true),
        size: view.getUint16(at+6, true)
      };
      this.entries.push(entry);
      this.byId.set(entry.id, entry);
    }
  } // constructor

  /**
   * Reads a DAT from disk.
   * @param {string} file - Path.
   * @returns {DATFile}
   */
  static open(file) {
    return new DATFile(path.basename(file), new Uint8Array(fs.readFileSync(file)));
  } // open

  /** the resource ids, ascending */
  get ids() {
    return this.entries.map((e) => e.id).sort((a, b) => a-b);
  } // ids

  has(id) {
    return this.byId.has(id);
  } // has

  /**
   * The data bytes of a resource, without the checksum byte.
   * @param {number} id
   * @returns {Uint8Array|null}
   */
  resource(id) {
    const entry = this.byId.get(id);
    if (!entry) {
      return null;
    }
    return this.bytes.subarray(entry.offset+1, entry.offset+1+entry.size);
  } // resource

  /** the stored checksum byte of a resource */
  checksum(id) {
    const entry = this.byId.get(id);
    return entry ? this.bytes[entry.offset] : null;
  } // checksum

  /** whether the stored checksum matches the data (★ complement of the sum) */
  checksumValid(id) {
    const entry = this.byId.get(id);
    if (!entry) {
      return false;
    }
    return ((this.checksum(id)+sumBytes(this.resource(id))) & 0xFF) === 0xFF;
  } // checksumValid

  /**
   * The checksum byte a resource with these data bytes gets.
   * @param {Uint8Array} data
   * @returns {number}
   */
  static checksumOf(data) {
    return (~sumBytes(data)) & 0xFF;
  } // checksumOf

} // DATFile

function sumBytes(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum += bytes[i];
  }
  return sum;
} // sumBytes

// --------------------------------------------------------------------- images

/** the compression methods, by the value in bits 8-11 of the flags */
export const IMAGE_METHOD = ['raw', 'rle', 'rle-columns', 'lzg', 'lzg-columns'];

/**
 * The 6-byte header of an image resource.
 *   u16 height, u16 width, u16 flags — bits 12-14: depth-1, bits 8-11: method
 * @param {Uint8Array} bytes - The resource.
 * @returns {{height, width, flags, depth, method, stride}}
 */
export function parseImageHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const height = view.getUint16(0, true);
  const width = view.getUint16(2, true);
  const flags = view.getUint16(4, true);
  const depth = ((flags >> 12) & 7)+1;
  const method = (flags >> 8) & 0x0F;
  return {height, width, flags, depth, method, stride: Math.floor((depth*width+7)/8)};
} // parseImageHeader

/**
 * Whether a resource has the shape of an image: a header with a sensible
 * size and a known method, and data after it.
 */
export function looksLikeImage(bytes) {
  if (bytes.length <= 6) {
    return false;
  }
  const h = parseImageHeader(bytes);
  return h.height > 0 && h.height <= 200 && h.width > 0 && h.width <= 320 &&
    h.method < IMAGE_METHOD.length && (h.flags & 0x80FF) === 0;
} // looksLikeImage

/**
 * RLE, as the original unpacks it: a signed count byte; 0..127 means copy
 * count+1 bytes, -1..-128 means repeat the next byte -count times.
 * @param {Uint8Array} src
 * @param {number} destLength
 * @returns {{out: Uint8Array, consumed: number}}
 */
export function decompressRLE(src, destLength) {
  const out = new Uint8Array(destLength);
  let s = 0, d = 0, rem = destLength;
  while (rem) {
    if (s >= src.length) {
      throw new Error('decompressRLE: source exhausted');
    }
    let count = src[s++];
    if (count < 128) {
      count++;
      do {
        out[d++] = src[s++];
        rem--; count--;
      } while (count && rem);
    } else {
      const value = src[s++];
      count = 256-count;
      do {
        out[d++] = value;
        rem--; count--;
      } while (count && rem);
    }
  }
  return {out, consumed: s};
} // decompressRLE

/** the ring buffer of the LZG coder and where writing starts in it */
export const LZG_WINDOW = 0x400;
export const LZG_START = LZG_WINDOW-0x42;

/**
 * LZG, the original's LZ77 variant: a 1 KB ring buffer that starts out
 * zeroed with the write position 0x42 bytes before its end; flag bytes of
 * eight items, LSB first, 1 = a literal byte, 0 = a copy of 16 big-endian
 * bits: 10 bits absolute position in the ring, 6 bits length-3.
 * @param {Uint8Array} src
 * @param {number} destLength
 * @returns {{out: Uint8Array, consumed: number}}
 */
export function decompressLZG(src, destLength) {
  const out = new Uint8Array(destLength);
  const window = new Uint8Array(LZG_WINDOW);
  let wp = LZG_START;
  let s = 0, d = 0, rem = destLength;
  let mask = 0;
  do {
    mask >>= 1;
    if ((mask & 0xFF00) === 0) {
      if (s >= src.length) {
        throw new Error('decompressLZG: source exhausted');
      }
      mask = src[s++] | 0xFF00;
    }
    if (mask & 1) {
      window[wp] = out[d] = src[s++];
      wp = (wp+1) & (LZG_WINDOW-1);
      d++;
      rem--;
    } else {
      const info = (src[s] << 8) | src[s+1];
      s += 2;
      let cs = info & 0x3FF;
      let len = (info >> 10)+3;
      do {
        window[wp] = out[d] = window[cs];
        wp = (wp+1) & (LZG_WINDOW-1);
        cs = (cs+1) & (LZG_WINDOW-1);
        d++;
        rem--; len--;
      } while (rem && len);
    }
  } while (rem);
  return {out, consumed: s};
} // decompressLZG

/**
 * The "columns" variants write the unpacked bytes down the columns of the
 * packed rows: byte n goes to row n % height, column n / height. This turns
 * that column-major stream into the row-major packed image.
 */
export function columnsToRows(linear, stride, height) {
  const out = new Uint8Array(stride*height);
  for (let x = 0; x < stride; x++) {
    for (let y = 0; y < height; y++) {
      out[y*stride+x] = linear[x*height+y];
    }
  }
  return out;
} // columnsToRows

export function rowsToColumns(rows, stride, height) {
  const out = new Uint8Array(stride*height);
  for (let x = 0; x < stride; x++) {
    for (let y = 0; y < height; y++) {
      out[x*height+y] = rows[y*stride+x];
    }
  }
  return out;
} // rowsToColumns

/**
 * Packed rows (1, 2 or 4 bits per pixel, MSB first) to one byte per pixel.
 */
export function unpackPixels(packed, width, height, stride, depth) {
  const out = new Uint8Array(width*height);
  const perByte = 8/depth;
  const mask = (1 << depth)-1;
  for (let y = 0; y < height; y++) {
    let x = 0;
    for (let b = 0; b < stride && x < width; b++) {
      const v = packed[y*stride+b];
      let shift = 8;
      for (let p = 0; p < perByte && x < width; p++, x++) {
        shift -= depth;
        out[y*width+x] = (v >> shift) & mask;
      }
    }
  }
  return out;
} // unpackPixels

export function packPixels(pixels, width, height, depth) {
  const stride = Math.floor((depth*width+7)/8);
  const out = new Uint8Array(stride*height);
  const perByte = 8/depth;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const shift = 8-depth*((x % perByte)+1);
      out[y*stride+Math.floor(x/perByte)] |= (pixels[y*width+x] << shift);
    }
  }
  return out;
} // packPixels

/**
 * Decodes an image resource to one byte per pixel.
 * @param {Uint8Array} bytes - The resource.
 * @returns {{width, height, depth, method, stride, packed: Uint8Array,
 *           pixels: Uint8Array, consumed: number}} `consumed` counts the
 *           bytes of the compressed stream the decoder read; `packed` is the
 *           row-major bit-packed image the stream unpacks to.
 */
export function decodeImage(bytes) {
  const h = parseImageHeader(bytes);
  const src = bytes.subarray(6);
  const size = h.stride*h.height;
  let packed, consumed;
  switch (h.method) {
    case 0:
      packed = src.slice(0, size);
      consumed = size;
      break;
    case 1: {
      const r = decompressRLE(src, size);
      packed = r.out; consumed = r.consumed;
      break;
    }
    case 2: {
      const r = decompressRLE(src, size);
      packed = columnsToRows(r.out, h.stride, h.height); consumed = r.consumed;
      break;
    }
    case 3: {
      const r = decompressLZG(src, size);
      packed = r.out; consumed = r.consumed;
      break;
    }
    case 4: {
      const r = decompressLZG(src, size);
      packed = columnsToRows(r.out, h.stride, h.height); consumed = r.consumed;
      break;
    }
    default:
      throw new Error('decodeImage: unknown method '+h.method);
  }
  return {
    width: h.width, height: h.height, depth: h.depth, method: h.method, stride: h.stride, flags: h.flags,
    packed, pixels: unpackPixels(packed, h.width, h.height, h.stride, h.depth), consumed
  };
} // decodeImage

// ------------------------------------------------------------------ encoders

/**
 * RLE the other way round, greedy: runs of `minRun` or more equal bytes
 * become a repeat, everything else literal blocks of up to 128 bytes.
 * Whether the original's packer chose the same way is what checkdat
 * measures — this is our packer, not a copy of theirs.
 * @param {Uint8Array} bytes
 * @param {number} [minRun=3]
 * @returns {Uint8Array}
 */
export function encodeRLE(bytes, minRun = 3) {
  const out = [];
  let i = 0;
  let literalStart = -1;
  const flushLiterals = (end) => {
    while (literalStart >= 0 && literalStart < end) {
      const n = Math.min(128, end-literalStart);
      out.push(n-1);
      for (let k = 0; k < n; k++) {
        out.push(bytes[literalStart+k]);
      }
      literalStart += n;
    }
    literalStart = -1;
  };
  while (i < bytes.length) {
    let run = 1;
    while (i+run < bytes.length && bytes[i+run] === bytes[i] && run < 128) {
      run++;
    }
    if (run >= minRun) {
      flushLiterals(i);
      out.push((256-run) & 0xFF);
      out.push(bytes[i]);
      i += run;
    } else {
      if (literalStart < 0) {
        literalStart = i;
      }
      i++;
    }
  }
  flushLiterals(bytes.length);
  return Uint8Array.from(out);
} // encodeRLE

/**
 * LZG the other way round, greedy longest match over the whole ring,
 * lowest position on a tie. Same caveat as encodeRLE.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function encodeLZG(bytes) {
  const window = new Uint8Array(LZG_WINDOW);
  let wp = LZG_START;
  const items = [];   // {literal: byte} or {pos, len}
  let p = 0;
  const n = bytes.length;
  while (p < n) {
    let bestLen = 0, bestPos = 0;
    const maxLen = Math.min(66, n-p);
    if (maxLen >= 3) {
      for (let s = 0; s < LZG_WINDOW; s++) {
        let l = 0;
        while (l < maxLen) {
          const pos = (s+l) & (LZG_WINDOW-1);
          const k = (pos-wp) & (LZG_WINDOW-1);
          const value = k < l ? bytes[p+k] : window[pos];
          if (value !== bytes[p+l]) {
            break;
          }
          l++;
        }
        if (l > bestLen) {
          bestLen = l; bestPos = s;
          if (l === maxLen) {
            break;
          }
        }
      }
    }
    if (bestLen >= 3) {
      items.push({pos: bestPos, len: bestLen});
      for (let i = 0; i < bestLen; i++) {
        window[wp] = bytes[p+i];
        wp = (wp+1) & (LZG_WINDOW-1);
      }
      p += bestLen;
    } else {
      items.push({literal: bytes[p]});
      window[wp] = bytes[p];
      wp = (wp+1) & (LZG_WINDOW-1);
      p++;
    }
  }
  const out = [];
  for (let i = 0; i < items.length; i += 8) {
    let flags = 0;
    const group = items.slice(i, i+8);
    group.forEach((item, bit) => {
      if (item.literal !== undefined) {
        flags |= (1 << bit);
      }
    });
    out.push(flags);
    for (const item of group) {
      if (item.literal !== undefined) {
        out.push(item.literal);
      } else {
        const info = ((item.len-3) << 10) | item.pos;
        out.push((info >> 8) & 0xFF, info & 0xFF);
      }
    }
  }
  return Uint8Array.from(out);
} // encodeLZG

/**
 * Packs pixels back into an image resource with a given method — the
 * inverse of decodeImage, for the round trip.
 */
export function encodeImage(image, method) {
  const packed = packPixels(image.pixels, image.width, image.height, image.depth);
  const stride = Math.floor((image.depth*image.width+7)/8);
  let data;
  switch (method) {
    case 0: data = packed; break;
    case 1: data = encodeRLE(packed); break;
    case 2: data = encodeRLE(rowsToColumns(packed, stride, image.height)); break;
    case 3: data = encodeLZG(packed); break;
    case 4: data = encodeLZG(rowsToColumns(packed, stride, image.height)); break;
    default: throw new Error('encodeImage: unknown method '+method);
  }
  const out = new Uint8Array(6+data.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, image.height, true);
  view.setUint16(2, image.width, true);
  // ★ bit 15 of the flags is set on every 4-bit image and clear on every
  // 1-bit one (1209 vs 33 images of the 1.0 set); the game ignores it —
  // kept as read so a repacked resource can be compared byte for byte
  const flags = image.flags === undefined ? (image.depth === 4 ? 0x8000 : 0) : (image.flags & 0x80FF);
  view.setUint16(4, flags | ((image.depth-1) << 12) | (method << 8), true);
  out.set(data, 6);
  return out;
} // encodeImage

// ------------------------------------------------------------------- palettes

/**
 * The 100-byte palette resource that heads a chtab (`dat_shpl_type`):
 *   u8 nImages, u16 rowBits, u8 nColors, rgb vga[16] (6-bit), u8 cga[16], u8 ega[32]
 */
export function parsePalette(bytes) {
  if (bytes.length !== 100) {
    throw new Error('parsePalette: '+bytes.length+' bytes, expected 100');
  }
  return {
    nImages: bytes[0],
    rowBits: bytes[1] | (bytes[2] << 8),
    nColors: bytes[3],
    vga: Array.from(bytes.subarray(4, 52)),
    cga: Array.from(bytes.subarray(52, 68)),
    ega: Array.from(bytes.subarray(68, 100))
  };
} // parsePalette

export function serializePalette(pal) {
  const out = new Uint8Array(100);
  out[0] = pal.nImages;
  out[1] = pal.rowBits & 0xFF;
  out[2] = (pal.rowBits >> 8) & 0xFF;
  out[3] = pal.nColors;
  out.set(pal.vga, 4);
  out.set(pal.cga, 52);
  out.set(pal.ega, 68);
  return out;
} // serializePalette

// --------------------------------------------------------------------- sounds

/**
 * A sound resource: one type byte, then
 *   0 speaker: u16 tempo, then notes {u16 frequency, u8 length}
 *   1 digi (1.0/1.1): u16 rate, u16 count, u16 unknown, u8 sampleSize(8), samples
 *     digi (1.3/1.4): u16 rate, u8 sampleSize(8), u16 count, u16 unknown, u16 unknown2, samples
 *   2 midi: a standard MIDI file ("MThd"...)
 * The two digi layouts are told apart by where the byte 8 sits, the way
 * SDLPoP does (`determine_wave_version`).
 */
export function parseSound(bytes, digiLayout) {
  const typeByte = bytes[0];
  const type = typeByte & 7;
  // ★ bit 7 of the type byte is the loop flag (SDLPoP `enum soundflags`,
  // sfLoop): set on 15 (level door sliding) in both IBM_SND1 and DIGISND3
  const loop = (typeByte & 0x80) !== 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 0) {
    if (bytes.length < 3) {
      // ★ the unused sounds (1, 11, 19-22, 31, 34, 42) are one type byte
      // and nothing else in IBM_SND1.DAT
      return {type: 'speaker', typeByte, loop, empty: true, tempo: 0, notes: [], tail: []};
    }
    const tempo = view.getUint16(1, true);
    const notes = [];
    for (let at = 3; at+3 <= bytes.length; at += 3) {
      notes.push([view.getUint16(at, true), bytes[at+2]]);
    }
    const tail = Array.from(bytes.subarray(3+notes.length*3));
    return {type: 'speaker', typeByte, loop, tempo, notes, tail};
  }
  if (type === 1) {
    // The layout is a property of the release, not of one resource: sound
    // 48 of 1.0 has a sample count of 0x0708 and so an 8 at both places
    // (SDLPoP gets past it by remembering the first unambiguous answer).
    // Given the release, the guess is skipped.
    const oldLayout = digiLayout ? digiLayout === '1.0' : bytes[7] === 8;
    const newLayout = digiLayout ? digiLayout === '1.3' : bytes[3] === 8;
    if (oldLayout && !newLayout) {
      return {
        type: 'digi', typeByte, loop, layout: '1.0',
        rate: view.getUint16(1, true), count: view.getUint16(3, true),
        unknown: view.getUint16(5, true), sampleSize: 8,
        samples: bytes.subarray(8)
      };
    }
    if (newLayout && !oldLayout) {
      return {
        type: 'digi', typeByte, loop, layout: '1.3',
        rate: view.getUint16(1, true), sampleSize: 8, count: view.getUint16(4, true),
        unknown: view.getUint16(6, true), unknown2: view.getUint16(8, true),
        samples: bytes.subarray(10)
      };
    }
    return {type: 'digi', typeByte, loop, layout: 'ambiguous', raw: bytes};
  }
  if (type === 2) {
    return {type: 'midi', typeByte, loop, file: bytes.subarray(1)};
  }
  return {type: 'unknown', typeByte, loop, raw: bytes};
} // parseSound

export function serializeSpeaker(sound) {
  const typeByte = sound.typeByte === undefined ? (sound.loop ? 0x80 : 0) : sound.typeByte;
  if (sound.empty) {
    return Uint8Array.of(typeByte);
  }
  const out = new Uint8Array(3+sound.notes.length*3+(sound.tail ? sound.tail.length : 0));
  const view = new DataView(out.buffer);
  out[0] = typeByte;
  view.setUint16(1, sound.tempo, true);
  sound.notes.forEach((note, i) => {
    view.setUint16(3+i*3, note[0], true);
    out[5+i*3] = note[1];
  });
  if (sound.tail) {
    out.set(sound.tail, 3+sound.notes.length*3);
  }
  return out;
} // serializeSpeaker

export function serializeDigi(sound, samples) {
  const out = new Uint8Array(8+samples.length);
  const view = new DataView(out.buffer);
  out[0] = sound.typeByte === undefined ? (1 | (sound.loop ? 0x80 : 0)) : sound.typeByte;
  view.setUint16(1, sound.rate, true);
  view.setUint16(3, sound.count, true);
  view.setUint16(5, sound.unknown, true);
  out[7] = 8;
  out.set(samples, 8);
  return out;
} // serializeDigi

// ----------------------------------------------------------------------- misc

export function toBase64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
} // toBase64

export function fromBase64(text) {
  return new Uint8Array(Buffer.from(text, 'base64'));
} // fromBase64

export function equalBytes(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
} // equalBytes
