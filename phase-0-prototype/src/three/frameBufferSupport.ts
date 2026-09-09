/**
 * Whether this WebGL context can actually render into a half-float color
 * buffer. Mirrors the exact check three.js's own WebGLRenderer uses
 * internally for its transmission render target (see
 * `extensions.has('EXT_color_buffer_half_float') || extensions.has('EXT_color_buffer_float')`
 * in three's WebGLRenderer) — but @react-three/postprocessing's
 * EffectComposer does NOT perform this check before requesting a
 * HalfFloatType frame buffer for its main input/output buffers, it just
 * hands the type straight to WebGLRenderTarget.
 *
 * When the extension is missing, that render target's color attachment is
 * not actually color-renderable: the framebuffer is incomplete, and per the
 * WebGL spec, draw calls into an incomplete framebuffer silently no-op — no
 * exception, no console warning. The composer's base scene render (the
 * whole GlobeSphere + Stars pass, which feeds every later effect) lands in
 * that broken buffer and reads back as empty, while Bloom's own glow — its
 * own separate internal mip-chain render targets, composited additively on
 * top — can still show up fine. That reads exactly like "swell packets
 * render correctly, everything dim between them is flat black": one target
 * silently failing, not any part of the field math being wrong.
 */
export function supportsHalfFloatRenderTarget(gl: WebGL2RenderingContext | WebGLRenderingContext): boolean {
  return gl.getExtension('EXT_color_buffer_half_float') != null || gl.getExtension('EXT_color_buffer_float') != null;
}
