---
id: external-links
kind: guide
title: Links to outside tools
description: Link a check to a story in a story tool, or to a run in CI, with the profile key externalLinks.
order: 13
related: [profile, specs, mcp]
documents: [req-external-links]
---
A check often lives in another tool: a story in a story tool, a scenario in a playground, a report of a CI run. The profile key `externalLinks` turns fields of a node or a check into links to these tools.

## Example

A project writes its checks as stories of a story tool. Each check has a `story` field with the story id and a `run` field with the id of the CI run. The check type is `story`.

```yaml
externalLinks:
  - label: Story
    template: "https://stories.example.org/?path=/story/{story}"
    checkTypes: [story]
  - label: CI run
    template: "https://ci.example.org/runs/{run}"
    checkTypes: [story]
```

A check with `story: projects-projects-page--empty` gets the link `https://stories.example.org/?path=/story/projects-projects-page--empty`. A check without a `run` field gets only the first link.

## How a link works

- A placeholder `{story}` reads a field of the node or of the check. A dotted path such as `{report.id}` reads a field in an object.
- Semspec URL-encodes each value with `encodeURIComponent`. A `/` in a value becomes `%2F`. Place a placeholder where an encoded value is valid: a path segment, a query value or a fragment.
- A link with a placeholder whose field is missing, empty or not a text, number or boolean does not show.
- The optional `field` makes a link show only when that field has a value. Use it with a template that has no placeholder.
- `kinds` lists the node kinds that get the link. `checkTypes` lists the check types that get it. A spec with neither key applies to every node and every check.
- The placeholder with the name of the id key (the `source.id` of the profile) reads the id of a node.
- Only `http` and `https` addresses open. Semspec checks the address after it fills the template. A value that builds `javascript:` or `data:` gives no link.
- A link opens in a new tab with `rel="noopener noreferrer"`.

`semspec check` reports a template with no placeholder and no fixed URL, a template that does not start with `http://` or `https://`, an unknown kind, an unknown check type and a protocol other than `http` or `https`.

## Where the links show

- The details panel has a Links section for the node. The title of a check is a link when the check has 1 link. A check with more links shows a small button for each link.
- The CSV export of the Table has a column Links with the URLs, separated by spaces.
- The RDF export writes each URL as `rdfs:seeAlso`.
- The Markdown specs write the links as Markdown links after the node title and after the check title.
- The MCP tools `get` and `slice` return `links`, a list of `{ label, url }`, for the node and for each check.
