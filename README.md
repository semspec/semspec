# Semspec

AI-native requirements engineering harness.

Semspec turns requirements that a project keeps as YAML or JSON into a typed, linked graph. It shows how each requirement traces to its parts, its checks and its status. A profile defines the kinds, the edges and the fields, so the same tool works for any project and any vocabulary.

What Semspec does today:

- It reads a folder of YAML files (1 file for each node), a YAML file or a JSON file. `--exclude` skips other folders.
- A profile defines kinds, edges, parts and checks. It also defines a status with a roll-up from the nodes below (good, warn, bad), and filters on any list field.
- You explore the graph with a hierarchy tree, a scope by any node, a walk of the graph by expansion, and Graph, Cards and Table views with a details panel.
- A status colour mode colours the graph by status. Filters select nodes by status and by profile fields. The table exports to CSV.
- `semspec schema` writes a JSON Schema for each kind, so editors and agents can check the YAML files.
- `serve` runs a live local page. `build` writes 1 self-contained HTML file.
- A workspace holds several graphs, each with its own profile, on 1 page. A node of 1 graph can link to a node of another graph.
- `semspec export` writes a graph or a workspace as RDF (Turtle, JSON-LD), as SHACL shapes or as a Cypher script.

The tool knows no project. Every kind, edge, field, colour and label comes from the profile.

## Install

Semspec is not on npm yet. Install it from GitHub:

```
npm install github:radoystoyanov/semspec#<commit or tag>
```

The install builds the tool. It needs Node 20 or later.

## Use

```
semspec serve --graph <graph> --profile <profile> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
semspec build --graph <graph> --profile <profile> --out explorer.html [--exclude <pattern>]...
semspec serve --workspace <file> [--port 4173] [--host 127.0.0.1]
semspec build --workspace <file> --out workspace.html
semspec schema --profile <profile> --out <dir>
semspec export --graph <graph> --profile <profile> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
semspec export --workspace <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
semspec --version
semspec version --json
```

- `serve` starts a server on localhost. It reads both inputs again on each page load.
- `build` writes 1 HTML file. The file has the data, the script and the style inline. It opens from disk and makes no network request.
- The page has a Light, Dark and System switch in the header. It keeps the choice in the browser storage of the viewer.
- `schema` writes 1 JSON Schema for each kind of the profile. See "The schemas of the kinds".
- `export` writes the graph for other tools. See "Export".
- `semspec --version` (or `-v`) prints `semspec <version> (<commit>)`, with ` dirty` after the commit when the tree was dirty at build time. `semspec version --json` prints `{ "name", "version", "commit", "dirty" }`. The page has the same text in `<meta name="generator">`.

`<graph>` is a JSON file, a YAML file or a folder of YAML files. `<profile>` is a JSON file or a YAML file (`.yaml` or `.yml`).

`--exclude` skips paths of a graph folder. It can repeat. See "The YAML folder".

`--workspace` reads a workspace file instead of `--graph` and `--profile`. See "Workspace". It cannot combine with `--graph`, `--profile` or `--exclude`.

`serve` and `build` check the 2 inputs first and stop with a message when an input is not valid. A message about a YAML node names its file.

## The YAML folder

A folder can hold the graph, with 1 file for each node. The folder can have sub-folders, for example 1 for each kind:

```
requirements/
  epic/epic-checkout.yaml
  story/story-pay-by-card.yaml
```

- Semspec reads every `*.yaml` and `*.yml` file below the folder, in sorted order of the path.
- A file that holds a mapping is 1 node. A file that holds a list of mappings is several nodes.
- The graph is `{ "<source.nodes>": [ ...the nodes... ] }`. The profile names the key in `source.nodes`.
- A single YAML file can also hold a whole graph, in the same shape as a JSON graph.
- `serve` reads the folder again on each page load, so an edit shows on reload.

A graph folder can sit next to folders that hold YAML but no nodes, for example `schema/` or `generated/`. Skip them with `--exclude`:

```
semspec build --graph requirements --profile profile.yaml --out explorer.html --exclude schema --exclude 'generated/**'
```

- A pattern matches a path relative to the graph folder, with `/` as separator.
- `*` matches any characters except `/`. `**` matches any characters, including `/`. `?` matches 1 character except `/`.
- A pattern with no `/` and no wildcard, such as `schema`, matches a folder or a file of that name at any depth.
- Semspec does not read into an excluded folder.
- `--exclude` has no effect when `--graph` is a file. Semspec prints 1 warning.
- Quote a pattern with `*` or `?`, so the shell does not expand it.

## Workspace

A user can keep several graphs about 1 system, for example a requirements graph and a domain model. A workspace file lists them. The page holds all graphs, with a switch between them.

```json
{
  "title": "Shop workspace",
  "graphs": [
    { "id": "req", "label": "Requirements", "graph": "product/graph.json", "profile": "product/profile.json" },
    { "id": "domain", "label": "Domain model", "graph": "domain/graph.json", "profile": "domain/profile.json", "exclude": ["schema"] }
  ]
}
```

- The workspace file is JSON or YAML. See `schema/workspace.schema.json` and `fixtures/workspace/`.
- A path is relative to the workspace file. `graph` and `profile` take the same files as `--graph` and `--profile`.
- `id` is unique. A cross link names it. `label` is the name in the switch. `exclude` is optional and works like `--exclude`.
- Each graph and each profile is checked as in the single-graph form. A message names the graph id.
- `serve` reads all inputs again on each page load.
- The page title is the workspace title. The header shows the label of the active graph and a switch when the workspace has more than 1 graph.
- Each graph keeps its scope, filters, view, selection, walk and canvas positions. A return to the graph restores them.

### Cross links

A profile declares the fields that point into another graph:

```json
"crossLinks": [ { "field": "terms", "graph": "domain", "label": "Uses term" } ]
```

- `field` is a field of a node. It holds a list of node ids of the target graph, for example `"terms": ["basket", "card"]`. An object with an `id` is not accepted.
- `graph` is the `id` of the target graph in the workspace file.
- `label` is the title of the section in the details panel.
- A cross link is not an edge of the graph. It does not change the tree, the scope, the walk or the canvas.
- A cross link to a graph that the workspace does not have is an error. An id that the target graph does not have is a warning, and the link is skipped.
- `field` must not be a parent field or a link field of the profile.
- The details panel shows a section with the label of each entry, and a section "Used by" with the label of the source graph for a node that other graphs point at. A click on an entry shows the node in its graph, selected and revealed in the tree. The Back button in the header returns to the previous graph and node.

## The schemas of the kinds

`semspec schema --profile profile.json --out schemas` writes `schemas/<kind id>.schema.json` for each kind. Each file is a JSON Schema (draft 2020-12) that holds only what the profile knows: the id with the prefix of the kind, the kind, the title, statement and lifecycle fields, the parent and link fields, the refs, the parts, the checks and the status. The schema allows other fields. An editor can use the schemas to check the YAML files.

## The graph

The graph is an object with a list of nodes. See `schema/graph.schema.json`.

```json
{ "nodes": [ { "id": "epic-checkout", "kind": "epic", "products": ["prd-shop"] } ] }
```

- A node has an `id`, a `kind` and any other fields. The profile can rename the 3 keys in its `source` object.
- A field that the profile names as a parent field or a link field holds a list of node ids. An item can also be an object that holds the node id and the properties of the edge. See "Edges".
- A node with no value in the kind key gets `source.defaultKind`, when the profile sets it.
- A field that the profile names as an embedded field holds an object, a string or a number. The explorer makes 1 node for each distinct id, and the owners link to it. A string or a number is the id, and the new node has no other field. An object holds its id in the key that `id` names. A node of the graph with the same id wins.
- A field that the profile names as a part field holds a list of parts. A part is an object. The explorer shows each part as a node of its own.
- A field that the profile names as the check field holds a list of checks. A check is an object. 2 checks with the same type and key share 1 node.
- A node with no `title` gets one from its id, in sentence case. The explorer takes the casing of each word from the texts of the graph, so an acronym that the texts write in capitals stays in capitals.
- `disclosure` and `problems` are optional. A producer can use them to report what it found.

## The profile

The profile is a JSON or YAML object. See `schema/profile.schema.json` and the 2 examples in `fixtures/`.

| Key | Meaning |
|---|---|
| `project` | The name of the project. The page shows it as secondary text. |
| `source` | The keys of the list of nodes, the id and the kind. The optional `defaultKind` is the kind of a node with no value in the kind key. |
| `fields` | The fields for the title, the statement, the level and the delivery state, and a pattern that cuts a prefix from an id. |
| `lifecycle` | The field of the state, a fallback, a fallback for each kind, and the states that show muted. |
| `kinds` | The node kinds: id, label, plural, role, colour for the light and the dark theme, parent field groups, a citation rule (with an optional `name` path for the display name of the source) and the chips of a summary. |
| `edges` | A label pair for each edge name, and a `down` flag for an edge whose target is the more general node. An entry can also have `target` (the key of the node id in an object of a link field, default `id`), `from` and `to` (the kinds of the 2 nodes of an edge) and `properties` (the declared properties of an edge). See "Edges". |
| `links`, `supersededBy` | Link fields that are not parent fields. |
| `refs` | A field that holds a list of objects: `field`, `target` (the key of the node id in an object) and `note` (the key of the edge note). Give 1 entry or a list of entries. Each `field` needs an entry in `edges`, which gives the labels of its edge. An entry can have `many`, the key of a boolean in an object. When the boolean is true, the edge note gets the suffix `[]`, so a note `lines` reads `lines[]`. Every other key of an object is a property of the edge. |
| `crossLinks` | Fields that hold node ids of another graph of a workspace: the field, the id of the target graph and a label. See "Cross links". |
| `linkedScopeEdges` | The edges that pull a linked node into the scope of a node. |
| `parts` | Which kinds own parts, in which field, and the fields of a part. |
| `embedded` | Objects in a node that are nodes of their own: the owner kind, the dotted path of the object, the new kind, the key of the id in the object (needed only for an object) and the edge. The edge is a parent field of the owner. It differs from the field. |
| `checks` | The check field, the check kind, the check types and their identity. |
| `status` | A status field with 3 values, 1 for each tone: good, warn and bad. A node with no status of its own gets the roll-up of the nodes below it: all good is good, all bad is bad, and a mix is warn. A node with a muted lifecycle does not count. A toggle colours the canvas by status, and a filter selects the status values. |
| `fieldFilters` | Filters on a list field or a text field: the field, a label, labels for values, a separator that groups the values in the picker, and an optional `from`. A node without the field takes the values of the nodes above or below it. The table has a column for each field. |
| `vocabularies`, `fieldVocabularies` | The codes that a field can take, and what each code means. See "Vocabularies". |
| `provenance` | Where a fact comes from: the fields of the marker, the source, the date, the agent and the note, and the markers that need a source. See "Provenance". |
| `iri`, `fieldIris` | The IRIs of the export: a base, prefixes, the field that holds a node IRI, and the property of a field. A kind, an edge, an edge property, a vocabulary and a concept can name an `iri` too. See "Export". |
| `layout` | The layout of the Graph and Cards views. The optional `default` is `layered`, `grouped` or `force`. The optional `groupEdge` names the edge whose target is the container of its source. The value `grouped` needs `groupEdge`. See the section on layouts. |
| `facets`, `entry`, `groups` | The group facet, the start page and the names of tree groups. |
| `details` | The sections of the details panel: properties, text sections, option lists, source lists, object lists, tagged lists and citations. |

## Edges

The model is a labelled property graph, as in ISO GQL (ISO/IEC 39075) and PG-Schema. A node has a kind (its label) and fields (its properties). An edge has a kind, a note and properties.

An edge gets its properties from 2 places:

- A refs item: every key except the target key, the note key and the `many` key is a property. The item `{ "ref": "x", "text": "note", "since": "2024", "share": 0.4 }` gives an edge with the note `note` and the properties `since` and `share`.
- A link field: an item is a node id, or an object `{ "<target key>": "<id>", ...properties }`. The profile names the target key in `edges.<field>.target`. The default is `id`. An object without the target key is an error that names the node.

An embedded object, a part and a check make edges with no properties.

Parallel edges (the same source, target and kind) stay 2 edges when their properties differ, as GQL allows. The model keeps 1 edge when the properties are equal. The order of the keys does not matter.

A profile can declare constraints for an edge name:

```json
"edges": {
  "complies": {
    "labels": ["Complies with", "Complied with by"],
    "target": "std",
    "from": ["story"],
    "to": ["standard"],
    "properties": { "since": { "type": "date", "required": true }, "share": { "type": "number" } }
  }
}
```

- `from` and `to` list the kinds of the source node and of the target node. An edge with another kind is an error. A kind that the profile does not define is a profile error.
- `properties` declares the properties by name. The `type` is `string`, `number`, `boolean` or `date`. A property of the type `string` can have a `vocabulary`. See "Vocabularies". A `date` is an ISO date string: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Quote a year in YAML, so it stays a string.
- A property that `properties` does not declare is a warning. A missing required property and a value of the wrong type are errors. An edge name with no `properties` has no property check.
- `semspec schema` types a link field as a list of ids or objects, with the declared properties.

The details panel shows the properties after each edge, for example `since 2024 · share 0.4`. A click on an edge in the Graph view or the Cards view selects it. The panel then shows the kind, the source, the target, the note and the properties, with buttons to select the source or the target. The table has no column for edge properties.

## Vocabularies

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

## Provenance

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

- `marker` takes its codes from a vocabulary. See "Vocabularies". A marker value that is not a code is an error.
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

## Export

`semspec export` writes a graph for other tools. The model is a labelled property graph, so each format maps it in the closest way.

| Format | Output |
|---|---|
| `turtle` | RDF as Turtle, with RDF 1.2 annotations (`{| ... |}`) for edge properties. With `--workspace`: TriG with 1 named graph for each graph of the workspace. |
| `jsonld` | RDF as JSON-LD with a `@context`. Edge properties use `@annotation`. With `--workspace`: 1 `@graph` for each graph of the workspace. |
| `shacl` | SHACL shapes of the profile as Turtle. With `--workspace`: the shapes of all profiles. |
| `cypher` | A Cypher script for a property graph database (Neo4j 5 syntax for the indexes). With `--workspace`: a property `graph` on each node. |

`--annotations reified` writes an edge with properties as an `rdf:Statement` node (`rdf:subject`, `rdf:predicate`, `rdf:object`) next to the plain triple. Use it for a reader that knows neither RDF 1.2 annotations nor `@annotation`. The JSON-LD annotation form is the JSON-LD 1.1 star draft. A JSON-LD 1.1 processor does not know it.

### IRIs

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

### The RDF mapping

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

Provenance follows PROV-O, as in "Provenance". A node with a `provenance` entry in its profile is also a `prov:Entity`. An edge with provenance gets `a prov:Entity` in its annotation.

| Semspec | RDF |
|---|---|
| marker | `prov:wasGeneratedBy` a blank `prov:Activity` that has the concept of the marker as a second type |
| source node | an edge to the source node. Its predicate is `prov:wasDerivedFrom`, unless the profile maps the edge. |
| source as free text | `prov:wasDerivedFrom` with a URL as an IRI, or any other text as a literal |
| retrieved | `prov:generatedAtTime` with an `xsd` date type (not `xsd:dateTime`, because the value can be a year) |
| agent | `prov:wasAttributedTo` an IRI of the type `prov:Agent` with an `rdfs:label` |
| note | `rdfs:comment` |

### SHACL

A node shape exists for each kind, with `sh:targetClass` the class of the kind.

- The shape requires 1 `dct:identifier` and an `rdfs:label` that are strings.
- A parent field, and an edge whose `from` names the kind, give a `sh:property` on the edge predicate with `sh:nodeKind sh:IRI` and `sh:class` of the kinds in `to`. More than 1 kind gives `sh:or`.
- A coded field gives `sh:in` with the concept IRIs. A marker gives `sh:in` on the types of the activity.
- The date of `provenance.retrieved` gets a `sh:pattern` for ISO dates.
- A typed edge property gets a shape that targets the subjects of the property (`sh:targetSubjectsOf`), with `sh:datatype` (a date and a number use `sh:or`), `sh:in` for a coded property, and `sh:pattern` for a date. A required edge property is not a constraint, because nothing targets the edge that lacks it. `semspec` checks it when it reads the graph.

### Cypher

- A node has the label of its kind, in backticks. A backtick in the name is doubled.
- A node has its fields as properties, and `id` and `title`. A text, number or boolean list stays a list. Any other list, and an object, is a JSON string. A link field, a refs field and a check field are relationships, not properties.
- An edge is a relationship. The type is the edge name in upper snake case, for example `inGroup` is `IN_GROUP`. The properties are the edge properties, with the provenance parts and `note`. A cross link of a workspace is a relationship with the field name as the type.
- A string is on 1 line. The script escapes `"`, `\`, control characters and line separators.
- Nodes use `MERGE` on `id` (and `graph` for a workspace). Relationships use `CREATE`, so run the script once.
- Batches are `UNWIND` lists of at most 500 rows. A batch has 1 label or 1 relationship type. `CREATE INDEX` statements come first.

### Escaping

Turtle strings are on 1 line with `\"`, `\\`, `\n`, `\r`, `\t`, `\b`, `\f` and `\u` escapes. Unicode stays as it is. An IRI keeps its characters, and `<`, `>`, `"`, `{`, `}`, `|`, `^`, a backtick, a backslash and a space get a `\u` escape. The Turtle writer is part of Semspec. It uses no RDF library.

## Layouts

The Graph view and the Cards view have 3 layouts. A profile picks the first one with `layout.default`. A switch in the toolbar of the canvas changes it.

- `layered`: dagre lays out the nodes from left to right. The general nodes are on the left. This is the default. It suits requirements.
- `grouped`: a node that is the target of the `groupEdge` edge from a node on the canvas is a container. Its members sit inside it. A container can sit inside a container. A member with 2 containers sits in the first one. The edges of the `groupEdge` name are hidden for the container of a member, because the nesting shows them. The switch is disabled when the profile has no `groupEdge`.
- `force`: `d3-force` places the nodes. The simulation runs a fixed number of ticks from start positions that follow the node order. The same input gives the same result. It suits a graph with no main direction.

A walk puts a new node next to its source in every layout.

```json
"layout": { "default": "grouped", "groupEdge": "epics" }
```

## Tagged lists and the filter by tag

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

A kind has 1 of 4 roles.

- `hierarchy`: the node sits in the tree. `parents` lists groups of parent fields. The first group that names a node places the node in the tree. Every group counts for the scope.
- `part`: the node comes from a part field of its owner.
- `linked`: the node links to the hierarchy and has its own tree group. A scope pulls it in when a node of the scope links to it.
- `check`: the node comes from a check field.

A kind can set `placedUnder`. A node of that kind that reaches no node of the named kind goes to a warning group in the tree.

## The requirements of Semspec

The repository keeps its own requirements as a Semspec graph in `requirements/`. `requirements/profile.yaml` is the profile. `requirements/graph/` holds 1 YAML file for each node, in a folder for each kind. Each acceptance condition names the tests in `test/` that prove it. A test in `test/build.test.ts` fails when a named test does not exist.

```
npm run build                 # once, to build the command line tool
npm run requirements          # serves the graph on http://127.0.0.1:4173
npm run requirements:build    # writes dist/requirements.html
```

## Develop

```
npm install
npm test          # unit tests, build tests and CLI tests
npm run typecheck
npm run build     # the app in dist/app and the command line tool in dist/cli
```

The pure logic is in `src/core`. It has no framework dependency. The app is in `src/app`. It uses React, shadcn/ui on Base UI, Tailwind CSS, React Flow with dagre, and TanStack Table. The command line tool is in `src/cli`. The fixtures in `fixtures/` use 2 profiles with different kinds.

## Licence

Apache License 2.0. See `LICENSE` and `NOTICE`.
