---
id: deploying
kind: guide
title: Deploying the site
description: The Cloudflare Pages project that builds the site from master and serves it at semspec.dev.
order: 15
related: [releasing, gates]
documents: [req-site-deploy]
---
This guide is for maintainers. Cloudflare Pages builds the site from each commit on `master` and serves it at semspec.dev. No workflow of the repository deploys, and the repository holds no Cloudflare secret.

## What deploys when

- A commit on `master` starts a production build. The site at semspec.dev changes when the build ends.
- `master` gets a commit only through a pull request whose checks pass. Turn on the branch rule for `master` that needs the checks, so each production build has passed the gates.
- Preview builds of other branches are off.

## The Pages project

Make the project once, in the Cloudflare dashboard: Workers & Pages > Create > Pages > Connect to Git. The Cloudflare GitHub app gets read access to the repository.

| Setting | Value |
|---|---|
| Project name | `semspec` |
| Repository | `semspec/semspec` |
| Production branch | `master` |
| Preview deployments | None |
| Build command | `npm ci && npm run build && npm ci --prefix site && npm run build --prefix site` |
| Build output directory | `site/dist` |
| Root directory | the root of the repository |

The build reads the Node version from the file `.node-version`. That file names the lowest Node version of the engines field, and a test keeps them equal.

A project that was made by a direct upload cannot connect to Git later. Delete such a project first, with `npx wrangler pages project delete semspec`.

## The custom domain

In the project, open Custom domains > Set up a custom domain, and enter `semspec.dev`. The zone semspec.dev is in the same Cloudflare account, so the dashboard makes the DNS record. The domain is active when the certificate is ready.
