/**
 * LibreOffice Worker wrapper that adds system font loading support.
 *
 * This script wraps the original browser.worker.global.js and adds
 * an "upload-fonts" message handler. After the WASM module initializes,
 * it writes font files into the virtual filesystem so LibreOffice can
 * use them for rendering CJK and other system fonts.
 */

/* global importScripts, self */

// Import the original LibreOffice worker script.
// This sets self.onmessage to the original handler.
importScripts('/libreoffice/browser.worker.global.js');

// Capture the original onmessage handler set by the Worker script.
var _originalOnMessage = self.onmessage;
var _fontsInstalled = false;
var _pendingFonts = [];

/**
 * Write font data into the WASM virtual filesystem.
 */
function _installFonts(fonts) {
  if (!self.Module || !self.Module.FS || !fonts || !fonts.length) return;
  var FS = self.Module.FS;

  // Ensure the custom fonts directory exists
  try { FS.mkdir('/usr'); } catch (_e) { /* already exists */ }
  try { FS.mkdir('/usr/share'); } catch (_e) { /* already exists */ }
  try { FS.mkdir('/usr/share/fonts'); } catch (_e) { /* already exists */ }
  try { FS.mkdir('/usr/share/fonts/custom'); } catch (_e) { /* already exists */ }

  var installed = 0;
  for (var i = 0; i < fonts.length; i++) {
    try {
      var font = fonts[i];
      FS.writeFile('/usr/share/fonts/custom/' + font.name, new Uint8Array(font.data));
      installed++;
    } catch (err) {
      console.warn('[Font Worker] Failed to install font ' + fonts[i].name + ':', err);
    }
  }

  if (installed > 0) {
    console.log('[Font Worker] Installed ' + installed + ' custom font(s)');
  }
  _fontsInstalled = true;
}

// Replace the onmessage handler with our wrapper
self.onmessage = async function(event) {
  var data = event.data;

  // Handle our custom "upload-fonts" message
  if (data && data.type === 'upload-fonts') {
    if (self.Module && self.Module.FS) {
      // Module already initialized, install fonts immediately
      _installFonts(data.fonts);
    } else {
      // Queue fonts for installation after init
      _pendingFonts = data.fonts || [];
    }
    // Respond with success
    self.postMessage({ id: data.id, type: 'upload-fonts-result', success: true });
    return;
  }

  // For "init" messages, run the original handler first, then install queued fonts
  if (data && data.type === 'init' && _pendingFonts.length > 0) {
    await _originalOnMessage.call(self, event);
    // After init, Module.FS should be available
    if (self.Module && self.Module.FS && !_fontsInstalled) {
      _installFonts(_pendingFonts);
      _pendingFonts = [];
    }
    return;
  }

  // Forward all other messages to the original handler
  await _originalOnMessage.call(self, event);
};
