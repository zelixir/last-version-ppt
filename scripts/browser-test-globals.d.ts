export {}

declare global {
  interface Window {
    __PREVIEW_IMAGE_TEST_STATE__?: {
      phase?: string
    } | null
    __LAST_VERSION_PPT_FONT_TEST__?: {
      skipBundledFonts?: boolean
      onlyFontNames?: string[]
    }
  }
}
