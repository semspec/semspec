# Semspec site

This folder holds the web site of Semspec (semspec.dev). It is a separate npm package with its own `package.json` and `package-lock.json`. The root `package.json` does not list it.

The site is a static site. Vite, React 19, shadcn/ui, Tailwind CSS 4 and lucide-react build it. The build renders each page to HTML and the browser then hydrates the page.

## Contents

- `index.html`, `roadmap/index.html` and `docs/index.html` are the 3 HTML inputs. `docs/index.html` is the template of all docs pages.
- `src/` holds the React code. `src/components/ui/` holds the shadcn/ui components.
- `src/lib/roadmap.ts` turns the requirements graph of this repository into the data of the roadmap page.
- `src/lib/trace.ts` turns the same graph into the chain from the product down to a test for 1 requirement. The hero of the home page shows it.
- `src/lib/hero-graph.ts` turns the same graph into a radial layout of the hierarchy and the linked nodes. `src/components/hero-graph.tsx` draws it as the faint background of the hero.
- `src/lib/docs.ts` holds the pure logic of the docs: the page index, the sidebar order, the related pages, the previous and next page, the heading slugs and the rewrite of links. `src/lib/docs-markdown.ts` renders a Markdown body to HTML with `marked` and Shiki. `src/lib/docs-load.ts` reads the `docs/` folder of the repository with the loader of the CLI. The docs routes are `/docs/`, `/docs/<id>/` and `/docs/graph/`. A page with the id `graph` takes `/docs/graph/`, and the docs graph page then moves to `/docs/docs-graph/`.
- `vite.config.ts` has a plugin with 7 virtual modules: `virtual:roadmap`, `virtual:trace`, `virtual:hero-graph`, `virtual:snippets`, `virtual:build-info`, `virtual:docs` (the page index) and `virtual:doc-bodies` (the HTML of the bodies, only for the server build and the dev server).
- `scripts/demo.mjs` writes the 3 demo pages with the CLI of the repository. It fails when the build of the docs workspace prints a warning. `scripts/build.mjs` runs the full build. `scripts/prerender.mjs` renders the pages to HTML.
- `test/roadmap.test.ts` tests the roadmap data. `test/trace.test.ts` tests the trace. `test/hero-graph.test.ts` tests the layout of the hero graph. `test/docs.test.ts` tests the docs logic, the Markdown render and the real `docs/` folder.

The design tokens come from `../src/app/tokens.css`. The explorer uses the same file.

## Commands

Run `npm ci` at the repository root first. The site uses the CLI and the app of the root. Then run `npm ci` and `npm run build` in this folder.

```
cd <repository root>
npm ci
cd site
npm ci
npm run build
```

`npm run build` builds the CLI and the app of the root, writes the demo pages, and builds the site. The output is in `dist/`. The demo pages are in `dist/demo/`.

Other commands:

- `npm run demo` writes the demo pages to `public/demo/`. It builds the root only when the CLI is missing.
- `npm run dev` starts the Vite dev server.
- `npm run preview` serves `dist/` after a build.
- `npm test` runs the unit tests.
- `npm run typecheck` checks the types.
