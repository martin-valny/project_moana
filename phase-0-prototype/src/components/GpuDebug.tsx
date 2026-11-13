import { useEffect, useState } from 'react';
import { detectQualityTier } from '../three/qualityTier';
import { supportsHalfFloatRenderTarget } from '../three/frameBufferSupport';

/**
 * `?debug=1` only. Not app UI — a throwaway probe for the "looks great on
 * laptop, ugly on phone" reports that this project keeps hitting (see
 * qualityTier.ts and GlobeSphere.tsx's precision="highp" fix). Those were
 * both diagnosed from a screenshot plus code reading, on hardware nobody
 * writing the fix could actually hold — this puts the numbers that matter
 * (which quality tier got picked, whether the GPU actually grants highp in
 * the fragment shader, what's rendering) on screen so the next report comes
 * with data instead of another guess.
 */
declare const __BUILD_ID__: string;

/**
 * Shader bisect. Each stage makes GlobeSphere's surface shader output one
 * intermediate value instead of the final colour (see `uDebugStage` there);
 * the same scanline is read back for each, so a single screenshot shows the
 * first step that comes back zero on this device. `rgb` stages print full
 * colours, the rest print the green channel only. `L` marks a land sample
 * on a stage that is only computed over ocean.
 */
const STAGES: Array<[number, string, 'g' | 'rgb']> = [
  [1, 'const .02', 'g'],
  [2, 'const .25', 'g'],
  [3, 'uOceanDeep x8', 'rgb'],
  [4, 'land mask m', 'g'],
  [5, 'nightLum x4', 'g'],
  [6, 'edgeJitter (fbm)', 'g'],
  [7, 'fieldEnergy', 'g'],
  [8, 'noise n', 'g'],
  [9, 'band', 'g'],
  [10, 'base ocean x8', 'rgb'],
  [11, 'final ocean x4', 'rgb'],
  [12, 'NaN map (nan=bright)', 'g'],
  [13, 'lit colour x4', 'rgb'],
  [14, 'lit factor', 'g'],
];

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function readScanline(mode: 'g' | 'rgb'): string {
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!canvas || !gl) return 'no canvas';
  const y = Math.floor(canvas.height / 2);
  const buf = new Uint8Array(4);
  const SAMPLES = 16;
  const out: string[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const x = Math.floor(((i + 0.5) / SAMPLES) * canvas.width);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    if (mode === 'rgb') out.push(`(${buf[0]},${buf[1]},${buf[2]})`);
    else out.push(buf[0] > 30 && buf[0] > 2 * buf[1] + 10 ? 'L' : String(buf[1]));
  }
  return out.join(' ');
}

export function GpuDebug() {
  const [lines, setLines] = useState<string[]>(['probing...']);

  useEffect(() => {
    const out: string[] = [`build=${__BUILD_ID__}`];
    const tier = detectQualityTier();
    out.push(`tier=${tier.tier} octaves=${tier.octaves} mipmapBlur=${tier.mipmapBlur} dpr=${JSON.stringify(tier.dpr)}`);
    out.push(`ua=${navigator.userAgent}`);
    out.push(
      `cores=${navigator.hardwareConcurrency ?? 'n/a'} mem=${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 'n/a'} dpr(actual)=${window.devicePixelRatio}`,
    );

    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) {
      out.push('webgl: unavailable');
    } else {
      out.push(`webgl: ${gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl1'}`);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        out.push(`renderer=${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`);
        out.push(`vendor=${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)}`);
      } else {
        out.push('renderer=(masked — no WEBGL_debug_renderer_info)');
      }
      for (const [name, kind] of [
        ['VERTEX highp float', { shader: gl.VERTEX_SHADER, type: gl.HIGH_FLOAT }],
        ['FRAGMENT highp float', { shader: gl.FRAGMENT_SHADER, type: gl.HIGH_FLOAT }],
        ['FRAGMENT mediump float', { shader: gl.FRAGMENT_SHADER, type: gl.MEDIUM_FLOAT }],
      ] as const) {
        const p = gl.getShaderPrecisionFormat(kind.shader, kind.type);
        out.push(
          `${name}: ${p ? `range=[-${p.rangeMin},${p.rangeMax}] precision=${p.precision}${p.rangeMax === 0 ? ' (UNSUPPORTED)' : ''}` : 'query failed'}`,
        );
      }
      // EffectComposer (@react-three/postprocessing) defaults to a
      // HalfFloatType main frame buffer for HDR precision ahead of ACES
      // tonemapping, without checking whether this GPU can actually render
      // into one. If this comes back false, that buffer's color attachment
      // isn't color-renderable, the framebuffer is incomplete, and WebGL
      // silently no-ops every draw into it — the whole base scene (ocean,
      // stars, everything except Bloom's own additively-composited glow)
      // reads back blank. Globe.tsx now probes this itself and falls back
      // to UnsignedByteType when it's false, so this line should read
      // `frameBufferType=UnsignedByteType (half-float unsupported)` on an
      // affected device rather than reproducing the bug — if the ambient
      // ocean is STILL missing with that fallback active, the cause is
      // something else and this extension isn't it.
      const halfFloatOk = supportsHalfFloatRenderTarget(gl);
      out.push(
        `EXT_color_buffer_half_float(or _float)=${halfFloatOk} -> frameBufferType=${halfFloatOk ? 'HalfFloatType' : 'UnsignedByteType (half-float unsupported)'}`,
      );
    }

    setLines(out);
  }, []);

  // Everything above only queries what the GPU *claims* to support — tier,
  // precision, extensions all came back matching desktop on the iPhone this
  // was tested on, yet the ambient ocean was still flat black there. So this
  // reads back what actually landed in the framebuffer: a scanline of real
  // on-screen pixel values through the middle of the globe, straight from
  // the live canvas (needs Globe.tsx's `preserveDrawingBuffer: debug`, or
  // the browser is free to have already discarded the buffer by the time
  // this timer fires). If calm-ocean samples come back indistinguishable
  // from the page background, the crush is real and on-screen, not a
  // trick of a phone photo — and if they come back close to what desktop
  // shows, the bug is downstream of the canvas (display/compositor colour
  // management), not in this render at all.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
      if (!canvas || !gl) {
        setLines((prev) => [...prev, 'pixel probe: no canvas/webgl2 context found']);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      const y = Math.floor(h / 2);
      const buf = new Uint8Array(4);
      const SAMPLES = 16;
      const samples: string[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const x = Math.floor(((i + 0.5) / SAMPLES) * w);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        samples.push(`(${buf[0]},${buf[1]},${buf[2]})`);
      }
      setLines((prev) => [...prev, `pixel probe scanline y=${y} of ${w}x${h}: ${samples.join(' ')}`]);
      void runBisect();
    }, 2500);

    let cancelled = false;
    async function runBisect() {
      const win = window as unknown as {
        __moanaSetDebugStage?: (stage: number) => void;
        __moanaSetFx?: (on: boolean) => void;
      };
      if (!win.__moanaSetDebugStage || !win.__moanaSetFx) {
        setLines((prev) => [...prev, 'bisect: hooks missing']);
        return;
      }
      const settle = async () => {
        await nextFrame();
        await nextFrame();
        await wait(150);
      };
      for (const [stage, label, mode] of STAGES) {
        if (cancelled) return;
        win.__moanaSetDebugStage(stage);
        await settle();
        const line = `s${stage} ${label}: ${readScanline(mode)}`;
        setLines((prev) => [...prev, line]);
      }
      // Normal render, postprocessing off: is the black made by the shader
      // or by the effect chain?
      win.__moanaSetDebugStage(0);
      win.__moanaSetFx(false);
      await wait(600);
      const noFx = `no-fx final: ${readScanline('rgb')}`;
      win.__moanaSetFx(true);
      await wait(600);
      setLines((prev) => [...prev, noFx, `fx back on: ${readScanline('rgb')}`, 'bisect done']);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <pre
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        margin: 0,
        padding: '8px 10px',
        fontSize: '8px',
        lineHeight: 1.35,
        color: '#0f0',
        background: 'rgba(0,0,0,0.85)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        pointerEvents: 'none',
      }}
    >
      {lines.join('\n')}
    </pre>
  );
}
