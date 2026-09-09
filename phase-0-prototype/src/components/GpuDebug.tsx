import { useEffect, useState } from 'react';
import { detectQualityTier } from '../three/qualityTier';

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
export function GpuDebug() {
  const [lines, setLines] = useState<string[]>(['probing...']);

  useEffect(() => {
    const out: string[] = [];
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
    }

    setLines(out);
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
        fontSize: '10px',
        lineHeight: 1.5,
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
