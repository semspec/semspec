---
id: vocabularies
kind: reference
title: Vocabularies
description: Give a field a fixed list of codes and a meaning for each code.
order: 4
related: [profile, edges, provenance]
documents: [req-vocabularies]
---
A field often takes its value from a fixed list of codes, for example a status or a priority. A vocabulary lists the codes and says what each code means. The shape follows W3C SKOS.

```json
"vocabularies": {
  "priority": {
    "label": "Priority",
    "definition": "How soon a story must be done.",
    "concepts": [
      { "code": "high", "label": "High", "definition": "The story blocks a release.", "order": 1 },
      { "code": "low", "label": "Low", "definition": "The story can wait.", "order": 2 }
    ]
  },
  "state": { "file": "vocabularies/state.yaml" }
},
"fieldVocabularies": { "priority": "priority", "state": "state" }
```

The mapping to SKOS:

| Semspec | SKOS |
|---|---|
| a vocabulary (`label`, `definition`, `iri`) | `skos:ConceptScheme` (`skos:prefLabel`, `skos:definition`, the IRI of the scheme) |
| a concept | `skos:Concept` (the optional `iri` is its IRI) |
| `code` | `skos:notation` |
| `label` | `skos:prefLabel` |
| `definition` | `skos:definition` |
| `broader` (a code of the same vocabulary) | `skos:broader` |
| `altLabels` | `skos:altLabel` |

`order` is a number that sorts the concepts in a list. It has no SKOS counterpart.

- A vocabulary can be in a file: `"<id>": { "file": "<path>" }`. The path is relative to the profile. The file is JSON or YAML and holds the vocabulary in the same shape. The command line tool reads the file and checks it against the profile schema. A problem names the vocabulary and the file.
- `fieldVocabularies` maps a field path to the id of a vocabulary. The field is a node field, the lifecycle field (`lifecycle.field`) or the field of a field filter. A field that holds a list takes a list of codes.
- An edge property takes its codes from a vocabulary with `"vocabulary": "<id>"` in `edges.<name>.properties.<property>`. The type of the property is `string`.
- Only a code is a valid value. An alternative label is not.
- A value that is not a code is an error that names the node, or the edge. The message lists the allowed codes when the vocabulary has 10 codes or fewer.
- A duplicated code, a `broader` code that does not exist, a cycle in `broader`, a vocabulary id that the profile lacks, and a lifecycle fallback, fallback for a kind or state that is not a code are errors in the profile.
- `semspec schema` gives a coded field an `enum` of the codes, and lists the labels in the `description`. A field with a dotted path gets no `enum`.

The explorer shows the label of a code:

- The lifecycle filter and the field filters show the label, and order the options by `order`, then by label. A value that is not a code comes after the codes. A concept with a `broader` concept is in a group under the label of the broader concept. A `values` entry or a `groupBy` of a field filter wins over the vocabulary.
- The details panel shows a coded property as the label, the code in small mono text and the definition below it. This applies to the properties of a node and to the properties of a selected edge.
- The chips, the table columns for the lifecycle, the level and the field filters, and the line of edge properties show the label.

The search uses `altLabels`. A query word that matches a label, a code or an alt label also searches the other words of the concept, with a lower weight. See [MCP server](mcp.md).
