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
- An entry that is not an object with exactly 1 key shows as compact JSON.

A `fieldFilters` entry with `"from": "keys"` takes its values from the keys of the objects in the list. The values above are `a`, `b` and `c`. The `values` labels apply to them, in the picker and in the table column. Without `from`, the values are the items of the field. A node with an empty list or no field has the value `""`, shown as None.
