const { VGAPlatform } = await import('./svision/js/platform/canvas2D/vga/vgaPlatform.js?ver='+window.srcVersion);
// begin code

/**
 * The machine Prince of Persia ran on: a PC with a VGA card in mode 13h on a
 * 4:3 monitor — 320x200 pixels shown 1.2 times taller than wide, a black
 * border that never changes (R-029).
 */
export function appPlatform() {
  return new VGAPlatform({
    width: 320,
    height: 200,
    pixelAspect: 1.2,
    minimalBorder: 0
  });
} // appPlatform
