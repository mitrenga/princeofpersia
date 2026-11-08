const { VGAVideoRAM } = await import('../svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
// begin code

/**
 * A "chtab" — one set of sprites of the original with its 16-colour
 * palette: the prince, a guard type, the tiles of a dungeon or a palace, the
 * wall pieces, the flames and potions. In the data files every image is
 * drawn with colours 0..15; on screen the game gives each set a palette row
 * `r` and writes `r*16 + colour` into the VGA memory, so the 256-colour
 * palette of the screen is the sets' palettes stacked (SDLPoP `seg009.c`,
 * `set_loaded_palette`, `load_sprites_from_file`).
 *
 * Images here already carry the row offset, so a blit is a plain copy and
 * the transparent colour of the set is `r*16`.
 */
export class Chtab {

  /**
   * @param {number} row - Palette row 0..15 the set is loaded into.
   */
  constructor(row) {
    this.id = 'Chtab';
    /** the palette row, i.e. the high nibble of every pixel */
    this.row = row;
    /** the images as off-screen buffers, 0-based; `null` for an empty slot */
    this.images = [];
    /** 6-bit r, g, b of the 16 colours, as read from the data file */
    this.vga = new Uint8Array(48);
    /** the source name, for messages */
    this.name = '';
  } // constructor

  /** the pixel value that means "nothing here" */
  get transparent() {
    return this.row << 4;
  } // transparent

  /**
   * The image with a 1-based number, the way the original's tables count.
   * @param {number} number - 1..n; 0 or a missing slot gives null.
   * @returns {VGAVideoRAM|null}
   */
  image(number) {
    if (number <= 0 || number > this.images.length) {
      return null;
    }
    return this.images[number-1];
  } // image

  /**
   * Writes the 16 colours into the palette row of the set.
   * @param {VGAPalette} palette - The screen palette.
   * @returns {Chtab} This.
   */
  install(palette) {
    palette.load(this.vga, this.row*16, 16);
    return this;
  } // install

  /**
   * Turns an image record of a data file into a buffer with the row offset
   * applied to every pixel, colour 0 included.
   * @param {Object} record - `{width, height, pixels}`, pixels base64 of 0..15.
   * @param {number} row - Palette row.
   * @returns {VGAVideoRAM}
   */
  static decodeImage(record, row) {
    var buffer = VGAVideoRAM.buffer(record.width, record.height, record.pixels);
    var offset = row << 4;
    for (var i = 0; i < buffer.bytes.length; i++) {
      buffer.bytes[i] |= offset;
    }
    return buffer;
  } // decodeImage

  /**
   * Builds a set from a `data/gfx/*.json` file written by
   * `tools/dumpdat.mjs`.
   * @param {Object} data - The parsed file.
   * @param {Object} [options]
   * @param {boolean} [options.optional=true] - Apply the optional graphics
   *        (resources 1200+n of the environment DATs), the way SDLPoP does
   *        unconditionally; false keeps the base images only.
   * @param {string} [options.palette] - Which of `data.palettes` to use
   *        when the file has more than one (the guards: 'dungeon' or
   *        'palace'); `data.palette` by default.
   * @returns {Chtab}
   */
  static fromData(data, options) {
    var settings = options || {};
    var chtab = new Chtab(data.paletteRow);
    chtab.name = data.name || data.source || '';
    var palette = data.palette;
    if (settings.palette && data.palettes && data.palettes[settings.palette]) {
      palette = data.palettes[settings.palette];
    }
    chtab.vga.set(palette.vga);
    for (var i = 0; i < data.images.length; i++) {
      var record = data.images[i];
      chtab.images.push(record ? Chtab.decodeImage(record, chtab.row) : null);
    }
    if (settings.optional !== false && data.optional) {
      var numbers = Object.keys(data.optional);
      for (var n = 0; n < numbers.length; n++) {
        var number = parseInt(numbers[n], 10);
        while (chtab.images.length < number) {
          chtab.images.push(null);
        }
        chtab.images[number-1] = Chtab.decodeImage(data.optional[numbers[n]], chtab.row);
      }
    }
    return chtab;
  } // fromData

} // Chtab
