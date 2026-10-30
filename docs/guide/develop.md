---
id: develop
kind: guide
title: Develop
description: Run the tests and build the app and the command line tool.
order: 7
related: [semspec-requirements]
documents: []
---
```
npm install
npm test          # unit tests, build tests and CLI tests
npm run typecheck
npm run build     # the core in packages/core/dist, the app in packages/app/dist and the command line tool in packages/cli/dist
```

The repository is an npm workspace. The root package `semspec` installs the command line tool. The pure logic is in `packages/core` (`@semspec/core`). It has no framework dependency and imports no Node module. The app is in `packages/app`. It uses React, shadcn/ui on Base UI, Tailwind CSS, React Flow with dagre, and TanStack Table. The command line tool is in `packages/cli`. It imports `core` and `app`. The package `core` imports no other package. The fixtures in `fixtures/` use 2 profiles with different kinds.
