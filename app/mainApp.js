const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { VGAFonts8x16 } = await import('./svision/js/platform/canvas2D/vga/vgaFonts8x16.js?ver='+window.srcVersion);
const { DOSBootModel } = await import('./svision/js/platform/canvas2D/vga/dosBootModel.js?ver='+window.srcVersion);
const { VGAControls } = await import('./svision/js/platform/canvas2D/vga/vgaControls.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { Version } = await import('./version.js?ver='+window.srcVersion);
// begin code

/**
 * The application: boots "MS-DOS", then runs the game. Two models so far,
 * switched by name the way every svision game does it; the menu, the
 * settings and the story screens come with later milestones.
 */
export class MainApp extends AbstractApp {

  constructor(platform, importPath, wsURL) {
    super(platform, 'bodyApp', importPath, wsURL);
    this.id = 'MainApp';
    this.version = Version;
    this.copyright = '©2026 L. Mitrenga, CC BY-NC-SA 4.0';

    this.fonts = {};
    this.fonts.vgaFonts8x16Mono = new VGAFonts8x16(this, false);

    /** the samples of the original on one bus; the music waits for a player (P6) */
    this.audioManager = new AudioManager(this);

    /** the controls of the original: cursor keys, Shift, the keypad diagonals */
    this.controlsOptions = VGAControls.controlsOptions(VGAControls.PRINCE);
    this.controls = {
      keyboard: VGAControls.defaultControls('keyboard', VGAControls.PRINCE),
      mouse: VGAControls.defaultControls('mouse', VGAControls.PRINCE),
      gamepads: VGAControls.defaultControls('gamepads', VGAControls.PRINCE),
      /** the on-screen controls come with the touch layout (P3+); the input
          manager only marks whether a touch screen is there */
      touchscreen: {supported: false, type: false}
    };

    /** the game worker, made by the game model from the glued modules */
    this.worker = null;
    /** the level the game model shows; a debugging convenience until P7 */
    this.levelNumber = 1;

    this.setModel('BootModel');
  } // constructor

  /**
   * Switches models: shuts the current one down, makes the next, initialises
   * it and lays it out.
   * @param {string} model - 'BootModel' or 'GameModel'.
   */
  setModel(model) {
    var needResizeApp = false;
    if (this.model) {
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'BootModel':
        this.model = new DOSBootModel(this, {
          nextModel: 'GameModel',
          skipKeys: 'any',   // any key, mouse button, touch or gamepad button skips the boot
          memoryKB: 640,
          extendedKB: 3072,
          dos: {
            autoexec: ['Microsoft (R) Mouse Driver Version 8.20', ''],
            commands: [
              {command: 'CD PRINCE', prompt: 'C:\\PRINCE>'},
              {command: 'PRINCE'}
            ]
          }
        });
        break;
      case 'GameModel':
        this.model = new GameModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

} // MainApp
