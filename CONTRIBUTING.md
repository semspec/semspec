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

Use the year of the first publication of the file. The files in `src/app/components/ui` come from shadcn/ui. They keep only the SPDX line, and `NOTICE` holds their MIT licence.

## Checks

Run `npm run typecheck` and `npm test` before you open a pull request.

## Security

Report a security problem through the process in `SECURITY.md`. Do not open a public issue.
