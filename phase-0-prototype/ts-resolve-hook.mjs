/**
 * Lets the offline harnesses (`field-metrics.mjs`, `parity-probe.mjs`) import
 * the app's own TypeScript modules directly, so they measure the code that
 * actually ships rather than a transcription of it.
 *
 * The app is written for a bundler, so its relative imports have no file
 * extension (`from './swellField'`). Node's ESM resolver requires one. This
 * hook fills that gap — and only that gap — by retrying an unresolved
 * relative specifier with `.ts`, then `/index.ts`.
 *
 * Used with `node --experimental-strip-types`, which handles the types
 * themselves. No bundler needed: Vite 8 ships rolldown rather than esbuild,
 * and adding a dependency just to run a test would be a poor trade.
 *
 *   node --import ./ts-resolve-hook.mjs --experimental-strip-types <script>
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./ts-resolve-hook-impl.mjs', pathToFileURL('./'));
