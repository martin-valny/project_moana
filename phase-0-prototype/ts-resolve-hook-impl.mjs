/**
 * Resolver half of `ts-resolve-hook.mjs` — runs on the module-loader thread.
 * See that file for why this exists.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Only rewrite bare relative specifiers that genuinely have no extension;
    // anything else should surface its original error untouched.
    if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw err;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // try the next shape
      }
    }
    throw err;
  }
}
