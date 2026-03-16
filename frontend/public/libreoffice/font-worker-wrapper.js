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
var _pendingFontRequestId = null;

/**
 * Write font data into the WASM virtual filesystem.
 */
function _installFonts(fonts) {
  if (!self.Module || !self.Module.FS || !fonts || !fonts.length) {
    return { installedCount: 0, installedFonts: [] };
  }
  var FS = self.Module.FS;

  // Ensure the custom fonts directory exists
  try { FS.mkdir('/usr/share/fonts'); } catch (_e) { /* already exists */ }
  try { FS.mkdir('/usr/share/fonts/custom'); } catch (_e) { /* already exists */ }

  var installed = 0;
  var installedFonts = [];
  for (var i = 0; i < fonts.length; i++) {
    try {
      var font = fonts[i];
      FS.writeFile('/usr/share/fonts/custom/' + font.name, new Uint8Array(font.data));
      installed++;
      installedFonts.push(font.name);
    } catch (err) {
      console.warn('[Font Worker] Failed to install font ' + fonts[i].name + ':', err);
    }
  }

  if (installed > 0) {
    console.log('[Font Worker] Installed ' + installed + ' custom font(s)');
    try {
      console.log('[Font Worker] Current LibreOffice font directory entries:', FS.readdir('/usr/share/fonts/custom'));
    } catch (_dirError) {
      console.warn('[Font Worker] Unable to read LibreOffice font directory:', _dirError);
    }
  }
  _fontsInstalled = true;
  return { installedCount: installed, installedFonts: installedFonts };
}

// Replace the onmessage handler with our wrapper
self.onmessage = async function(event) {
  var data = event.data;

  // Handle our custom "upload-fonts" message
  if (data && data.type === 'upload-fonts') {
    console.log('[Font Worker] Received font upload request for ' + ((data.fonts && data.fonts.length) || 0) + ' file(s)');
    if (self.Module && self.Module.FS) {
      // Module already initialized, install fonts immediately
      var installResult = _installFonts(data.fonts);
      self.postMessage({
        id: data.id,
        type: 'upload-fonts-result',
        success: true,
        installedCount: installResult.installedCount,
        installedFonts: installResult.installedFonts
      });
    } else {
      // Queue fonts for installation after init
      _pendingFonts = data.fonts || [];
      _pendingFontRequestId = data.id;
      console.log('[Font Worker] LibreOffice not ready yet, queued font upload request');
    }
    return;
  }

  // For "init" messages, run the original handler first, then install queued fonts
  if (data && data.type === 'init' && _pendingFonts.length > 0) {
    await _originalOnMessage.call(self, event);
    // After init, Module.FS should be available
    if (self.Module && self.Module.FS && !_fontsInstalled) {
      var queuedInstallResult = _installFonts(_pendingFonts);
      self.postMessage({
        id: _pendingFontRequestId,
        type: 'upload-fonts-result',
        success: true,
        installedCount: queuedInstallResult.installedCount,
        installedFonts: queuedInstallResult.installedFonts
      });
      _pendingFonts = [];
      _pendingFontRequestId = null;
    }
    return;
  }

  // Forward all other messages to the original handler
  await _originalOnMessage.call(self, event);
};
