---
id: deploying
kind: guide
title: Deploying the site
description: The Cloudflare Worker that serves semspec.dev, and the build from master.
order: 15
related: [releasing, gates]
documents: [req-site-deploy]
---
This guide is for maintainers. A Cloudflare Worker with static assets serves the site at semspec.dev. Workers Builds builds it from each commit on `master`. No workflow of the repository deploys, and the repository holds no Cloudflare secret.

## What deploys when

- A commit on `master` starts a build. The site at semspec.dev changes when the build and the deploy end.
- `master` gets a commit only through a pull request whose checks pass. Turn on the branch rule for `master` that needs the checks, so each build has passed the gates.
- Builds of other branches are off.

## The Worker

The file `wrangler.jsonc` holds the settings of the Worker:

- the name `semspec`
- the folder `site/dist` as static assets, with no script
- the custom domain `semspec.dev`

The file has a `build` command, `npm ci --prefix site && npm run build --prefix site`. The deploy runs it itself and builds the site into `site/dist`. The site build also builds the root packages. So the deploy never fails on a missing `site/dist`, whatever the build command of the dashboard is.

A change of these settings goes through a pull request like any other change.

## The build

Connect the Worker to the repository once, in the Cloudflare dashboard: Workers & Pages > Create > Import a repository. The Cloudflare GitHub app gets read access to the repository.

| Setting | Value |
|---|---|
| Repository | `semspec/semspec` |
| Project name | `semspec` |
| Branch | `master` |
| Builds for other branches | Off |
| Build command | `npm run build` (may be empty or any command) |
| Deploy command | `npx wrangler deploy` |
| Root directory | the root of the repository |

The build reads the Node version from the file `.node-version`. That file names the lowest Node version of the engines field, and a test keeps them equal.

The first deploy adds the custom domain `semspec.dev` from `wrangler.jsonc`. The zone semspec.dev is in the same Cloudflare account, so Cloudflare makes the DNS record and the certificate. A DNS record that already exists for semspec.dev blocks it: delete that record first.
