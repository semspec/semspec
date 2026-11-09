---
id: tagged-lists
kind: reference
title: Tagged lists and the filter by tag
description: Show a list of tagged objects and filter by its tags.
order: 6
related: [profile]
documents: [req-tagged-lists, req-filter-by-tag]
---
A tagged list is a list of objects. Each object has exactly 1 key, the tag. The value of the tag is an object of inner keys, or an empty object:

```json
{ "id": "n1", "origin": [ { "a": { "area": "X" } }, { "b": { "type": "Y", "property": "Z" } }, { "c": {} } ] }
```

`details.taggedLists` shows the list in the details panel:

```json
{ "title": "Origin", "field": "origin", "labels": { "a.area": "Area of A", "b.type": "Type of B", "b.property": "Property of B", "c": "Note" } }
```

- Each inner key and value of a tag gives the line `<label>: <value>`. The label is `labels["<tag>.<key>"]`.
- A tag with no inner key gives the line `labels["<tag>"]`.
- A missing label falls back to `<tag> <key>` as written, or to the tag.
- A tag with a text value gives the line `<label>: <text>`. The label is `labels["<tag>"]`. When a node of any graph of the workspace has the text as its id, the line shows the title of that node as a link that selects it, also in another graph.
- A tag with 1 inner key whose value is an object is a nested tag. The entry gives 1 line: `labels["<tag>.<nested tag>"]`, then the values of the inner keys of the nested tag, joined with a space in key order.
- Any other shape shows as compact JSON.

`linkKey` names an inner key whose value is a URL. The value links the line of its entry and gives no line of its own. For a nested tag, the key is read in the nested tag. Only http and https URLs link. The spec Markdown writer shows the link as `[text](url)`, and a node as a link to its anchor.

```json
{ "title": "Basis", "field": "basis", "linkKey": "url", "labels": { "specialises.std": "Narrows STD", "obligation": "Obligation" } }
```

With this profile, `{ "specialises": { "std": { "type": "Device", "url": "https://example.org/x" } } }` gives the linked line `Narrows STD Device`. The entry `{ "obligation": "obl-1" }` gives `Obligation: obl-1`, or the title of the node `obl-1` as a link.

A `fieldFilters` entry with `"from": "keys"` takes its values from the keys of the objects in the list. The values above are `a`, `b` and `c`. The `values` labels apply to them, in the picker and in the table column. Without `from`, the values are the items of the field. A node with an empty list or no field has the value `""`, shown as None.
