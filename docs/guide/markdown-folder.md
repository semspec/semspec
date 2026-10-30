---
id: markdown-folder
kind: guide
title: Markdown pages as nodes
description: Keep a wiki, docs, ADRs or RFCs as Markdown files that are the nodes of a graph.
order: 3
related: [yaml-folder, profile]
documents: [cap-read-markdown, req-read-markdown]
---
A graph folder can hold Markdown pages. Each page is 1 node. The pages also read well on GitHub.

Turn it on in the profile. Name the field that gets the text of the page:

```json
"source": { "nodes": "nodes", "id": "id", "kind": "kind", "markdown": { "body": "body" } }
```

A page starts with a block of YAML front matter:

```markdown
---
id: workspace
kind: guide
title: Workspaces
description: Keep several graphs about 1 system on 1 page.
order: 2
related: [cross-links, profile]
---
Body text in Markdown. No H1. The title comes from the front matter.
```

- Without `source.markdown`, Semspec ignores `*.md` files. A `README.md` in a graph folder changes nothing.
- With `source.markdown`, Semspec reads every `*.md` file below the folder. It reads them together with the YAML files, in sorted order of the path.
- The front matter is a line `---`, YAML, and a line `---`. The YAML must be a mapping.
- Each key of the front matter is a field of the node.
- The text after the front matter, trimmed, goes into the body field. An empty text gives no body field.
- A key of the front matter must not have the name of the body field. Semspec stops with an error.
- When the front matter has no id, the id is the file name without `.md`. The id key is `source.id`.
- A Markdown file with no front matter is no node. Semspec prints 1 warning that names the file.
- Front matter that is not valid YAML, or not a mapping, is an error that names the file.
- `--exclude` works for `.md` files as for YAML files. See [The YAML folder](yaml-folder.md).
- The body is plain text in the explorer. Show it with a field in the profile, for example `details.textSections`:

```json
"details": { "textSections": [{ "title": "Text", "field": "body" }] }
```

- `semspec schema` types the body field as a string.
