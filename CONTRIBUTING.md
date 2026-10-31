# Contributing

## Licence and copyright

Semspec is licensed under the Apache License, Version 2.0. A contribution is licensed under the same licence.

You keep the copyright in your contribution. Add your name to `AUTHORS` in your first pull request.

## Sign-off

Each commit must carry a `Signed-off-by` line. The line states that you agree to the Developer Certificate of Origin 1.1 (https://developercertificate.org). In short, you state that you have the right to submit the work under the licence of the project.

Add the line with `git commit -s`. The line uses the name and the email address of your git configuration:

```
Signed-off-by: Your Name <you@example.org>
```

A pull request with a commit that has no sign-off cannot be merged.

## Source files

Each source file starts with these 2 lines:

```
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
```

Use the year of the first publication of the file. The files in `packages/app/src/components/ui` and `site/src/components/ui` come from shadcn/ui. They keep only the SPDX line, and `NOTICE` holds their MIT licence.

## Licences

Code that ships to users needs an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or 0BSD licence. This covers the runtime dependencies of `semspec` and `@semspec/core`. It also covers each package that the build inlines into the page or the CLI bundle, even when it is a dev dependency.

Build and test tools may also use BlueOak-1.0.0, CC0-1.0, MIT-0, CC-BY-4.0 or MPL-2.0.

GPL, LGPL, AGPL and EPL are not allowed anywhere. For an SPDX expression with OR, 1 allowed option is enough.

Run `npm run licences` to check the installed packages. The check also runs in CI.

## Checks

Run `npm run typecheck` and `npm test` before you open a pull request.

## Security

Report a security problem through the process in `SECURITY.md`. Do not open a public issue.
