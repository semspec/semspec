---
id: provenance
kind: reference
title: Provenance
description: Record where a fact comes from.
order: 5
related: [vocabularies, profile, export]
documents: [req-provenance]
---
A node and an edge can record where a fact comes from: a source, the date it was read, who is responsible, and how the fact was obtained. The shape follows W3C PROV-O. Every part is optional.

```json
"provenance": {
  "label": "How known",
  "marker": { "field": "how", "vocabulary": "how" },
  "source": { "field": "source", "kind": "source" },
  "retrieved": "retrieved",
  "agent": "agent",
  "note": "remark",
  "requireSource": ["verified"]
}
```

The same field names apply to the fields of a node, to the properties of an edge, and to the keys of a refs item or of a link object. The mapping to PROV-O:

| Semspec | PROV-O |
|---|---|
| a node or an edge | `prov:Entity` |
| `source` | `prov:wasDerivedFrom` |
| `retrieved` | `prov:generatedAtTime` |
| `agent` | `prov:wasAttributedTo` |
| `marker` | the `rdf:type` of the `prov:Activity` that generated the entity (`prov:wasGeneratedBy`). The code names the type of activity, for example "read in a source". |
| `note` | `rdfs:comment` |

- `marker` takes its codes from a vocabulary. See [Vocabularies](vocabularies.md). A marker value that is not a code is an error.
- `source.kind` is optional. When it is set, the source field holds the id of a node of that kind, for example a document node. The id must name an existing node of that kind, or it is an error. The model then makes an edge from the node to the source node. `source.edge` names it. The default is `derivedFrom`, with the labels "Derived from" and "Source of". A profile can give the edge its own entry in `edges`. An edge cannot have an edge, so a source on an edge is only checked.
- Without `source.kind`, the source is free text. The details panel shows a URL as a link.
- `retrieved` is an ISO date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. A date after the date of the run is an error. Quote a year in YAML.
- `requireSource` lists marker codes. A node or an edge with one of these markers must have a source, or it is an error. The rule needs `marker` and `source`.
- The profile is checked for an unknown vocabulary, an unknown code in `requireSource`, an unknown source kind and a field used for 2 parts.
- A provenance property of an edge never gives the warning for an undeclared property.
- `semspec schema` gives the marker field the codes of its vocabulary and the date field an ISO pattern.

The explorer shows provenance in 4 places:

- The details panel of a node and of a selected edge has a "Provenance" section: the label of the marker with its code and definition, the source (a node button, or a link for a URL), the date, the agent and the note.
- An edge in the edge lists of the details panel has a small badge with the label of its marker.
- A filter selects nodes by marker. The filter has the label `provenance.label`, or "Provenance". It exists only when the profile has `provenance.marker`. A node with no marker has the value None.
- When the profile has `provenance.source`, the status bar shows how many nodes of the scope have no source. Source nodes, parts and checks do not count.
