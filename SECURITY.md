# Security policy

## Report a problem

Report a security problem only through GitHub private vulnerability reporting. Open the Security tab of the repository at https://github.com/semspec/semspec and select "Report a vulnerability".

Do not open a public issue for a security problem.

## What to include

- The version or the commit of Semspec.
- The steps that show the problem.
- The input files (graph and profile), if they are safe to share.
- The impact, as you see it.

## What you can expect

Semspec has 1 maintainer.

- You get an answer within 7 days.
- You get a fix or a decision, and the reason for the decision.
- If you want, the release notes credit you.

## Supported versions

Semspec is before version 1.0. Only the latest release on the default branch gets fixes.

## Scope

In scope:

- The generated page runs code that comes from a graph file or a profile file. One example is script injection through a node field.
- The local server of `semspec serve` exposes files that are not part of the page.
- The local server listens on more than the host that the user chose.
- A dependency has a known vulnerability that affects Semspec.

Out of scope:

- A user serves the page on a public host on purpose.
