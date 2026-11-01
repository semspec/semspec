# @semspec/core

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
