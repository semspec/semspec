---
id: export
kind: reference
title: Export
description: Write a graph or a workspace as RDF, SHACL shapes or a Cypher script.
order: 7
related: [profile, provenance, vocabularies, cli]
documents: [feat-connect, cap-export-graph, req-export-rdf-cypher]
---
`semspec export` writes a graph for other tools. The model is a labelled property graph, so each format maps it in the closest way.

| Format | Output |
|---|---|
| `turtle` | RDF as Turtle, with RDF 1.2 annotations (`{| ... |}`) for edge properties. With `--workspace`: TriG with 1 named graph for each graph of the workspace. |
| `jsonld` | RDF as JSON-LD with a `@context`. Edge properties use `@annotation`. With `--workspace`: 1 `@graph` for each graph of the workspace. |
| `shacl` | SHACL shapes of the profile as Turtle. With `--workspace`: the shapes of all profiles. |
| `cypher` | A Cypher script for a property graph database (Neo4j 5 syntax for the indexes). With `--workspace`: a property `graph` on each node. |

`--annotations reified` writes an edge with properties as an `rdf:Statement` node (`rdf:subject`, `rdf:predicate`, `rdf:object`) next to the plain triple. Use it for a reader that knows neither RDF 1.2 annotations nor `@annotation`. The JSON-LD annotation form is the JSON-LD 1.1 star draft. A JSON-LD 1.1 processor does not know it.

## IRIs

The profile can name the IRIs. All parts are optional.

```json
"iri": { "base": "https://example.org/x/", "prefixes": { "ex": "https://example.org/ns/" }, "field": "webid" },
"fieldIris": { "priority": "ex:priority" },
"kinds": [{ "id": "story", "iri": "ex:Story" }],
"edges": { "complies": { "iri": "ex:compliesWith", "properties": { "since": { "type": "date", "iri": "ex:since" } } } }
```

- A node IRI is `<base><kind>/<url-encoded id>`. If the node has the field `iri.field` and the value is an IRI or a CURIE, the value is the node IRI.
- An `iri` is a full IRI or a CURIE. A user can map a kind to an existing class, for example a bank class of FIBO or `schema:Organization`.
- A CURIE needs a prefix in `iri.prefixes`. The prefixes `rdf`, `rdfs`, `owl`, `xsd`, `skos`, `prov`, `sh` and `dct` are always known. An unknown prefix is a profile error, and so is a redefined built-in prefix.
- A vocabulary and a concept have an optional `iri` too.
- Without `iri.base`, the base is `urn:semspec:<graph id>:`. The graph id is `graph` for `--graph` and the id of the graph for `--workspace`.
- Without an `iri`, the export mints the IRI under the base:

| Term | Minted IRI |
|---|---|
| kind | `<base>vocab/<kind>` |
| edge | `<base>vocab/edge/<edge>` |
| edge property | `<base>vocab/edge/<edge>/<property>` |
| node field | `<base>vocab/field/<field>` |
| vocabulary | `<base>scheme/<id>` |
| concept | `<base>scheme/<id>/<code>` |
| agent | `<base>agent/<name>` |

## The RDF mapping

| Semspec | RDF |
|---|---|
| a node | `rdf:type` the class of its kind, `rdfs:label` its title, `dct:identifier` its id |
| a node field | a property. A string is a plain literal. A number is `xsd:integer`, `xsd:decimal` or `xsd:double`. A boolean is `xsd:boolean`. An ISO date string is `xsd:gYear`, `xsd:gYearMonth` or `xsd:date`. A list gives 1 value for each item. An object is an `rdf:JSON` literal (`@json` in JSON-LD). |
| a coded field | the IRI of the concept |
| a cross link of a workspace | an object property to the IRI of the target node. A target that does not exist stays a literal. |
| an edge | a triple `source predicate target` |
| an edge property, the edge note | an annotation on the triple. The note is `rdfs:comment`. A coded property is a concept IRI. |
| a link field, a refs field, a check field | not a property. The edges and the check nodes hold them. |
| a vocabulary | `skos:ConceptScheme` with `skos:prefLabel`, `skos:definition` |
| a concept | `skos:Concept` with `skos:inScheme`, `skos:notation`, `skos:prefLabel`, `skos:definition`, `skos:broader`, `skos:altLabel` |
| a kind in the profile | `owl:Class` with `rdfs:label` |
| an edge in the profile | `owl:ObjectProperty` with `rdfs:label`. `from` and `to` give `rdfs:domain` and `rdfs:range`. More than 1 kind gives an `owl:unionOf`. |
| an edge property in the profile | `owl:DatatypeProperty` with the `xsd` range (`owl:ObjectProperty` for a coded property). A date has no range. |
| a field of the nodes | `owl:DatatypeProperty`, or `owl:ObjectProperty` for a coded field |

The export declares a mapped term (a term with an `iri`) too, so the file holds its label. It does not describe it further.

Provenance follows PROV-O, as in [Provenance](provenance.md). A node with a `provenance` entry in its profile is also a `prov:Entity`. An edge with provenance gets `a prov:Entity` in its annotation.

| Semspec | RDF |
|---|---|
| marker | `prov:wasGeneratedBy` a blank `prov:Activity` that has the concept of the marker as a second type |
| source node | an edge to the source node. Its predicate is `prov:wasDerivedFrom`, unless the profile maps the edge. |
| source as free text | `prov:wasDerivedFrom` with a URL as an IRI, or any other text as a literal |
| retrieved | `prov:generatedAtTime` with an `xsd` date type (not `xsd:dateTime`, because the value can be a year) |
| agent | `prov:wasAttributedTo` an IRI of the type `prov:Agent` with an `rdfs:label` |
| note | `rdfs:comment` |

## SHACL

A node shape exists for each kind, with `sh:targetClass` the class of the kind.

- The shape requires 1 `dct:identifier` and an `rdfs:label` that are strings.
- A parent field, and an edge whose `from` names the kind, give a `sh:property` on the edge predicate with `sh:nodeKind sh:IRI` and `sh:class` of the kinds in `to`. More than 1 kind gives `sh:or`.
- A coded field gives `sh:in` with the concept IRIs. A marker gives `sh:in` on the types of the activity.
- The date of `provenance.retrieved` gets a `sh:pattern` for ISO dates.
- A typed edge property gets a shape that targets the subjects of the property (`sh:targetSubjectsOf`), with `sh:datatype` (a date and a number use `sh:or`), `sh:in` for a coded property, and `sh:pattern` for a date. A required edge property is not a constraint, because nothing targets the edge that lacks it. `semspec` checks it when it reads the graph.

## Cypher

- A node has the label of its kind, in backticks. A backtick in the name is doubled.
- A node has its fields as properties, and `id` and `title`. A text, number or boolean list stays a list. Any other list, and an object, is a JSON string. A link field, a refs field and a check field are relationships, not properties.
- An edge is a relationship. The type is the edge name in upper snake case, for example `inGroup` is `IN_GROUP`. The properties are the edge properties, with the provenance parts and `note`. A cross link of a workspace is a relationship with the field name as the type.
- A string is on 1 line. The script escapes `"`, `\`, control characters and line separators.
- Nodes use `MERGE` on `id` (and `graph` for a workspace). Relationships use `CREATE`, so run the script once.
- Batches are `UNWIND` lists of at most 500 rows. A batch has 1 label or 1 relationship type. `CREATE INDEX` statements come first.

## Escaping

Turtle strings are on 1 line with `\"`, `\\`, `\n`, `\r`, `\t`, `\b`, `\f` and `\u` escapes. Unicode stays as it is. An IRI keeps its characters, and `<`, `>`, `"`, `{`, `}`, `|`, `^`, a backtick, a backslash and a space get a `\u` escape. The Turtle writer is part of Semspec. It uses no RDF library.
