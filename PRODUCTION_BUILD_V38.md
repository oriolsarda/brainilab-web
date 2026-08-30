# BrainiLab V38 — Production Build Scaffold

V38 keeps the current browser-ready static site intact.

It also adds a low-risk path toward a real asset build:

```text
package.json
tools/build.mjs
```

## Current local development

Still works with no Node dependency install:

```bash
python3 -m http.server 8000
```

## Production asset minification

When ready:

```bash
npm install
npm run build
```

The scaffold uses `esbuild` to minify the already role-split BrainiLab JavaScript bundles.

This is intentionally incremental: it does not replace the existing runtime architecture in the same release.

## Why no forced migration yet

A full Vite/esbuild module migration should happen together with the real deployment pipeline, because that is when we can also finalize:

- hashed asset filenames
- CDN cache rules
- source maps
- HTML manifest rewriting
- release rollback behavior

The V38 site itself does not require `npm install` to run.
