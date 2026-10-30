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
npm run build     # the app in dist/app and the command line tool in dist/cli
```

The pure logic is in `src/core`. It has no framework dependency. The app is in `src/app`. It uses React, shadcn/ui on Base UI, Tailwind CSS, React Flow with dagre, and TanStack Table. The command line tool is in `src/cli`. The fixtures in `fixtures/` use 2 profiles with different kinds.
