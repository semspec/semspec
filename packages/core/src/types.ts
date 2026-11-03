// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The types of the 2 inputs, the profile and the graph, and of the model that the page reads.

export type Role = 'hierarchy' | 'part' | 'linked' | 'check';

// A chip of a node summary. A string names a built-in chip. An object reads a field of the node.
export type ChipSpec =
  | 'lifecycle'
  | 'members'
  | 'coverage'
  | 'verified'
  | 'verifyTypes'
  | 'checkType'
  | { field: string; format?: 'upper'; tone?: ChipTone; template?: string; slice?: number };

export type ChipTone = 'life' | 'muted' | 'count' | 'level' | 'good' | 'warn' | 'plain';

export interface CitationSpec {
  source: string;
  // A dotted path to the display name of the source. A value at the path is the name as written.
  name?: string;
  subtitle?: string;
  parts: { field: string; prefix?: string; wrap?: string }[];
}

export interface ProfileLayout {
  default?: 'layered' | 'grouped' | 'force';
  groupEdge?: string;
  groupBy?: 'parents';
}

export interface KindSpec {
  id: string;
  label: string;
  plural: string;
  prefix?: string;
  role: Role;
  color: { light: string; dark: string };
  // Groups of parent fields. The first group that names a node places the node in the tree.
  parents?: string[][];
  placedUnder?: string;
  unplacedLabel?: string;
  citation?: CitationSpec;
  chips?: ChipSpec[];
  // The class that the kind maps to, as a full IRI or a CURIE. See iri.ts.
  iri?: string;
}

export interface PartSpec {
  kind: string;
  owner: string;
  field: string;
  id: string;
  text: string;
  idPrefixPattern?: string;
  setup?: string;
  scope?: string;
  edge: string;
  sectionTitle?: string;
}

// An object in a node of the owner kind that is a node of its own. 1 node of `kind` is made for
// each distinct value of `id`. The owner gets `edge` to the new node, and `edge` is a parent field.
export interface EmbeddedSpec {
  owner: string;
  // A dotted path to the object in the owner.
  field: string;
  kind: string;
  // The key of the id inside the object. An object needs it. A string or a number in `field` is
  // the id itself, and the new node has no other field.
  id?: string;
  edge: string;
}

export interface CheckTypeSpec {
  key: string[];
  title: string[];
  titlePrefix?: string;
}

export interface CheckSpec {
  kind: string;
  field: string;
  edge: string;
  typeField: string;
  types?: Record<string, CheckTypeSpec>;
  // The fields that the details panel shows for a check.
  detail?: { name: string[]; file?: string; record?: string };
  sectionTitle?: string;
  noneText?: string;
}

// A status that a node carries in 1 field, for example the result of a review. A node with no
// status of its own gets the status of the nodes below it. Each value has a tone: `good`, `warn`
// or `bad`. The profile names exactly 1 value of each tone.
export interface StatusSpec {
  label: string;
  field: string;
  values: { value: string; label: string; tone: StatusTone }[];
  // A list field of a node with a status. The details panel shows it next to the status.
  detail?: { field: string; label: string };
}

// The gap kinds that can fail the check command. A gap that the profile does not list never fails the check.
//   bad-status: a node whose own status has the tone `bad`.
//   no-check: a part with no check.
//   no-source: a node that the provenance of the profile needs a source for, and that has none.
//   unplaced: a node of a kind with `placedUnder` that no parent field places under a node of that kind.
//   unresolved-link: a link that names a node that is not in the graph.
//   broken-cross-link: a cross link that names a node that is not in the other graph of the workspace.
//   missing-deliverable: a node that misses a deliverable that the profile states for its kind.
export const GATE_KINDS = ['bad-status', 'no-check', 'no-source', 'unplaced', 'unresolved-link', 'broken-cross-link', 'missing-deliverable'] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export interface GateSpec {
  fail?: GateKind[];
}

// What a task on a node of 1 kind must deliver. Every part is optional.
//   parts: the node has at least `min` parts.
//   checks: `each-part` means each part of the node has a check. `node` means the node has a check.
//   status: the status of the node (rolled up from the nodes below) is one of these values or tones.
//   fields: these node fields have a value.
//   links: for each edge or cross link field, the node has at least `min` links. `direction` is `out` (the default) or `in`.
//   provenance: the node has the marker and the source that the profile provenance names.
export const DELIVERABLE_KEYS = ['parts', 'checks', 'status', 'fields', 'links', 'provenance'] as const;
export type DeliverableKey = (typeof DELIVERABLE_KEYS)[number];
export interface DeliverableSpec {
  parts?: { min: number };
  checks?: 'each-part' | 'node';
  status?: string[];
  fields?: string[];
  links?: Record<string, { min: number; direction?: 'out' | 'in' }>;
  provenance?: boolean;
}

export type StatusTone = 'good' | 'warn' | 'bad';

// A filter on a list field or a text field of a node.
export interface FieldFilterSpec {
  field: string;
  label: string;
  // A label for a value. A value with no label shows as it is.
  values?: Record<string, string>;
  // The picker groups the values by the text before the first separator.
  groupBy?: string;
  // `keys` takes the values from the keys of the objects in the list field.
  from?: 'keys';
}

export interface PropertySpec {
  label: string;
  field: string;
  format?: 'upper' | 'list' | 'code' | 'yesno';
}

export interface DetailsSpec {
  properties?: PropertySpec[];
  statementTitle?: Record<string, string>;
  textSections?: { title: string; field: string; kinds?: string[] }[];
  optionSections?: { title: string; field: string; primary: string; secondary: string; secondaryPrefix?: string }[];
  sourceSections?: { title: string; field: string; name: string; section?: string; url?: string; retrieved?: string }[];
  objectLists?: { title: string; field: string; badge: string; value: string[]; suffix?: string; suffixSeparator?: string }[];
  // A list of tagged objects, 1 key each. `labels` maps "<tag>.<key>" and "<tag>" to a label.
  taggedLists?: { title: string; field: string; labels?: Record<string, string> }[];
  citations?: {
    kind: string;
    title: string;
    rows: { label: string; path: string; template?: string; link?: boolean }[];
    anchor?: string;
    url?: string;
  }[];
}

// A field that points into another graph of the workspace. The field holds 1 node id or a list of node ids
// of the target graph. The field can also be an `embedded` field. `graph` is the id of the target graph in the workspace file.
export interface CrossLinkSpec {
  field: string;
  graph: string;
  label: string;
}

// A link from a node or a check to an outside tool. The template is a URL with placeholders such as
// `{story.id}`. A placeholder reads a field of the node or of the check by its dotted path.
//   kinds: the spec applies to nodes of these kinds.
//   checkTypes: the spec applies to checks of these types.
//   With neither key, the spec applies to every node and every check.
//   field: the link shows only when this field has a value.
export interface ExternalLinkSpec {
  label: string;
  template: string;
  kinds?: string[];
  checkTypes?: string[];
  field?: string;
}

// A filled link: the label of the spec and an http or https URL.
export interface ExternalLink {
  label: string;
  url: string;
}

// The type of an edge property. `date` is an ISO date string: YYYY, YYYY-MM or YYYY-MM-DD.
export type PropertyType = 'string' | 'number' | 'boolean' | 'date';

// The declaration of one edge name. `labels` is [reading from the source, reading from the target].
// `down` marks an edge whose target is the more general node. `target` is the key of the node id in
// an object of a link field (default "id"). `from` and `to` are the kinds of the source node and of
// the target node that an edge of this name may join. `properties` declares the properties of an edge.
export interface EdgeSpec {
  labels: [string, string];
  down?: boolean;
  target?: string;
  from?: string[];
  to?: string[];
  properties?: Record<string, { type: PropertyType; required?: boolean; vocabulary?: string; iri?: string }>;
  // The property that the edge name maps to, as a full IRI or a CURIE. See iri.ts.
  iri?: string;
}

// The IRIs of a profile. `base` starts the IRI of each node and of each minted term. `prefixes` maps a prefix
// to a namespace IRI, so a CURIE in an `iri` of the profile has a meaning. `field` names a node field that holds
// the IRI of the node.
export interface IriSpec {
  base?: string;
  prefixes?: Record<string, string>;
  field?: string;
}

// Provenance: where a fact comes from. The same fields apply to a node, to an edge property and to a
// refs item. See provenance.ts for the mapping to W3C PROV-O. Every part is optional.
export interface ProvenanceSpec {
  // The label of the filter by marker. The default is "Provenance".
  label?: string;
  // The field of the marker, and the vocabulary that holds its codes.
  marker?: { field: string; vocabulary: string };
  // The field of the source. With `kind`, the field holds the id of a node of that kind, and the model makes
  // an edge from the node to the source node. `edge` names that edge (default "derivedFrom").
  source?: { field: string; kind?: string; edge?: string };
  retrieved?: string;
  agent?: string;
  note?: string;
  // The marker codes whose node or edge must have a source.
  requireSource?: string[];
}

// A concept of a vocabulary. It maps to skos:Concept: `code` to skos:notation, `label` to
// skos:prefLabel, `definition` to skos:definition, `broader` to skos:broader (the code of another
// concept of the scheme) and `altLabels` to skos:altLabel. Only a code is a valid value of a field.
export interface Concept {
  code: string;
  label: string;
  definition?: string;
  broader?: string;
  altLabels?: string[];
  // Sorts the concepts in a list. A concept with no order comes after the ones with an order.
  order?: number;
  iri?: string;
}

// A vocabulary maps to skos:ConceptScheme.
export interface Vocabulary {
  label: string;
  definition?: string;
  iri?: string;
  concepts: Concept[];
}

// A vocabulary in a profile file: inline, or in a file next to the profile.
export type VocabularyInput = Vocabulary | { file: string };

// One refs field. `target` is the key of the node id in an item and `note` is the key of the edge
// note. `many` is the key of a boolean in an item. When it is true, the note gets the suffix `[]`.
export interface RefsSpec {
  field: string;
  target: string;
  note: string;
  many?: string;
}

// A profile as a file holds it: `refs` is 1 entry or a list.
export type ProfileInput = Omit<Profile, 'refs' | 'vocabularies'> & { refs?: RefsSpec | RefsSpec[]; vocabularies?: Record<string, VocabularyInput> };

export interface SearchSpec {
  synonymFields?: string[];
  fields?: string[];
  boost?: Record<string, number>;
  // The optional model for meaning search. See `EmbeddingConfig`. A workspace file can set it too, and then it wins.
  embeddings?: import('./embed.js').EmbeddingConfig;
}

// The settings of the spec command. `roots` names the kinds of the root nodes that get a default document.
// `presets` names sets of marker options. A marker uses a set with `use=<name>`.
export interface SpecSpec {
  roots?: string[];
  presets?: Record<string, Record<string, string | number | boolean | (string | number)[]>>;
}

export interface Profile {
  // The name of the project, shown as secondary text.
  project: string;
  // `defaultKind` is the kind of a node with no value in the `kind` key.
  // `markdown` turns on the reading of `*.md` files in a graph folder. `body` is the field that gets the text after the front matter.
  // `origin` names the field that holds the path of the file a node was copied from. The Source section shows that file.
  source: { nodes: string; id: string; kind: string; defaultKind?: string; markdown?: { body: string }; origin?: string };
  fields: { title: string[]; idPrefixPattern?: string; statement: string[]; level?: string; delivery?: string; decided?: string };
  lifecycle: {
    field: string;
    fallback: string;
    byKind?: Record<string, string>;
    states?: Record<string, { muted?: boolean }>;
  };
  kinds: KindSpec[];
  // Edge declarations, by edge name.
  edges: Record<string, EdgeSpec>;
  links?: string[];
  // Links into other graphs. They are not edges of this graph.
  crossLinks?: CrossLinkSpec[];
  // Fields that hold a list of objects, each with the id of a node and a note. A profile file holds
  // 1 entry or a list of entries. `normalise` makes the list.
  refs?: RefsSpec[];
  supersededBy?: string;
  linkedScopeEdges?: string[];
  parts?: PartSpec[];
  embedded?: EmbeddedSpec[];
  checks?: CheckSpec;
  // The links to outside tools. See `ExternalLinkSpec`.
  externalLinks?: ExternalLinkSpec[];
  status?: StatusSpec;
  fieldFilters?: FieldFilterSpec[];
  // Vocabularies by scheme id. The command line tool reads the ones that name a file.
  vocabularies?: Record<string, Vocabulary>;
  // The scheme of a field, by field path. The field is a node field, the lifecycle field or a field filter field.
  fieldVocabularies?: Record<string, string>;
  provenance?: ProvenanceSpec;
  // The property that a node field maps to, by field name, as a full IRI or a CURIE.
  fieldIris?: Record<string, string>;
  iri?: IriSpec;
  // The words that the search reads. `synonymFields` name node fields with words that mean the same as the title. `fields`
  // name more node fields to read. `boost` sets the weight of a field. The built-in names are id, title, sub, statement and parts.
  search?: SearchSpec;
  // The gates of the check command. See `GateSpec`.
  gates?: GateSpec;
  // The settings of the spec command. See `SpecSpec`.
  spec?: SpecSpec;
  // What a task on a node of a kind must deliver, by kind id. See `DeliverableSpec`.
  deliverables?: Record<string, DeliverableSpec>;
  facets?: { groupKind: string; groupLabel: string };
  entry?: { kind: string; childKind: string; title: string; countLabel: string };
  groups?: { hierarchy: string };
  details?: DetailsSpec;
  // The layout of the Graph and Cards views. `groupEdge` names the edge whose target is the container of its source.
  // `groupBy: 'parents'` nests each node in the parent that the parents rule of its kind picks. It wins over `groupEdge`.
  layout?: ProfileLayout;
}

// A graph is a list of nodes. Each node has an id, a kind and any other fields.
// The profile says which fields name other nodes.
export type RawNode = { id?: string; [field: string]: unknown };
export type Graph = { [key: string]: unknown };

export interface VNode {
  id: string;
  kind: string;
  title: string;
  sub: string;
  lifecycle: string;
  delivery: string;
  level: string;
  statement: string;
  parents: string[];
  up: string[];
  cov?: { parts: number; verified: number };
  // The status value of the node itself, when the profile has a status and the node names a known value.
  status?: string;
  // The fields of the graph node that the details panel reads.
  d: Record<string, any>;
}

export interface VEdge {
  s: string;
  t: string;
  k: string;
  n?: string;
  // The properties of the edge.
  p?: Record<string, unknown>;
}

// A link from a node of this graph to a node of another graph. `t` may name no node.
export interface CrossLink {
  s: string;
  field: string;
  graph: string;
  t: string;
}

export interface Model {
  profile: Profile;
  nodes: VNode[];
  edges: VEdge[];
  unresolved: { s: string; t: string; k: string }[];
  // The links to other graphs, in the order of the nodes and of the profile.
  crossLinks: CrossLink[];
  unplaced: string[];
  stats: { unplaced: number; unplacedLive: number };
  disclosure: Record<string, unknown>;
  problems: number;
  // The file of each node, by node id: a path relative to the workspace file, or to the profile in the single graph form.
  // The CLI sets it. A node that comes from no file has no entry.
  files?: Record<string, string>;
}

export interface Index {
  profile: Profile;
  byId: Map<string, VNode>;
  children: Map<string, string[]>;
  scopeChildren: Map<string, string[]>;
  out: Map<string, VEdge[]>;
  inc: Map<string, VEdge[]>;
  // The outgoing cross links of each node.
  crossOut: Map<string, CrossLink[]>;
  model: Model;
  moduleCache: Map<string, Set<string>>;
  statusCache: Map<string, Set<string>>;
  carrierCache: Map<string, Set<string>>;
  fieldCache: Map<string, Map<string, boolean>>;
  unplaced: Set<string>;
}

export interface Filters {
  q: string;
  kinds: string[];
  lifecycles: string[];
  deliveries: string[];
  modules: string[];
  statuses: string[];
  // The selected markers of the provenance filter. '' selects the nodes without a marker.
  markers?: string[];
  // The selected values of each field filter, by field. '' selects the nodes without a value.
  fields?: Record<string, string[]>;
}

export interface Walk {
  shown: Set<string>;
  intro: Map<string, Set<string>>;
}

export interface Chip {
  text: string;
  tone: ChipTone;
  struck?: boolean;
}

export interface Summary {
  kind: string;
  title: string;
  sub: string;
  id: string;
  muted: boolean;
  chips: Chip[];
}

// The status of a node: its own value, or the roll-up of the nodes below it.
// `counts` holds the number of nodes with a status of their own, for each value.
// `value` is null when no node with a status is below the node.
export interface NodeStatus {
  value: string | null;
  tone: StatusTone | null;
  counts: Record<string, number>;
  total: number;
}

export interface Groups {
  edge: { k: string; dir: 'in' | 'out'; count: number }[];
  kind: { kind: string; count: number }[];
  total: number;
}
