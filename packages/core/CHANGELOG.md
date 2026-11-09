# @semspec/core

## 0.3.0

### Minor Changes

- e23f46f: Add the tool coverage and the command semspec coverage, which report the status of the conditions in a selection of nodes.
- b4c70cd: Derive condition status from fresh test reports and declared source fingerprints, through an evidence port with one adapter for each report format. The core library holds the types of the port and the rule that joins results to checks. The profile key `evidence` sets the adapters (JUnit and Vitest JSON), the check types that each one answers, and a key rule for each: class and method, file and name, or file and title path with a separator. The profile key `verification` stays valid as the JUnit adapter with the key rule class and method, a record of version 1 still loads, and a record of an unknown version makes the evidence stale with a warning. The JUnit adapter reads the reports of JUnit, node test, cargo nextest and the JUnit reporters of Playwright and Vitest. The Vitest adapter reads the JSON report and builds the key from the list of titles. A condition keeps its authored status and gets a derived status in its own field. The roll-up, the gates and the default display use the derived status when the profile has evidence, and the details panel shows both when they differ. `semspec coverage` and the MCP tool coverage count both statuses, the conditions where they differ and the stale conditions, and the option `--status-source` (input `statusSource`) selects the status that the filters, the groups and the gate use. Add native snapshot and collection commands, and expose passed, failed, not-run and stale evidence through graph loads.
- 34fa8e2: A workspace file can list views of its graphs, each with its own profile, parents rule, layout and filters, and the profile key layout.groupBy: parents nests the grouped layout by the parents rule of each kind. The serve command reloads the open page when a file changes and keeps the view, scope, selection, layout and filters. The details panel has a Source section with the path and the text of the file of a node. The profile key source.origin and the workspace key sourceRoot set the file and the source root, and build --sources puts the texts into the page.
- fd8fef3: Show the link, the nested tag and the text of a node id in a tagged list of the details, with the new profile option `linkKey`.

### Patch Changes

- 54a56a8: Show the full text in each cell and list item of a Markdown spec, with no cut at 120 or 160 characters.

## 0.2.1

### Patch Changes

- a6689ac: Releases are automatic after the version pull request merges. The site deploy builds the site itself. Dependabot pull requests need no changeset.
  
  Semspec needs Node 22.23.4 or later, the release with the eMudhra certificate fix.
- 999df88: - Site: the logo and the favicon are the mark of the app, 3 connected boxes. The header blurs the page under it, also in Safari.

## 0.2.0

### Minor Changes

- ada117d: Semspec 0.2.0 adds these changes.
  
  - Markdown specs: a Markdown file gets generated sections from a template. The new command `semspec spec` writes them. `semspec spec --check` finds a stale file.
  - Site: the generated site has cards and a roadmap. Cloudflare Pages builds it from master for semspec.dev.
  - Links to outside tools: the profile key `externalLinks` turns fields of a node or a check into links.
  - Filters and columns: the app hides the filters and columns of a field that the profile does not define.
  - Colour: the status colour is an alternative to the kind colour on the canvas.
  - Coverage chips: a chip names the check kind. A node with no checks shows no chip.
  - Node: Node 22.22.2 or later is now needed (`engines` is `>=22.22.2`). CI runs on Node 22.
  - Tests run faster.
