// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The details of the selected node, and the neighbours panel for the walk.
// The profile says which sections a node has and which fields they read.
import type { ReactNode } from 'react';
import { ArrowRight, ChevronsLeft, EyeOff, ExternalLink as ExternalLinkIcon, Network, Target, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChipView, KindBadge, KindDot, NodeSummaryView, StatusCounts, StatusDot } from '@/components/kind';
import { Core, type ExternalLink, type VEdge } from '@/lib/core';
import { useWorkspace } from '@/lib/workspace';
import type { Viewer } from '@/lib/use-viewer';
import { cn } from '@/lib/utils';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ExtLink({ url }: { url: unknown }) {
  const href = Core.safeUrl(url);
  if (!href) return <code className="font-mono text-[11px] break-all">{String(url)}</code>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all">
      {href}
    </a>
  );
}

// A link to an outside tool. It opens in a new tab and has no access to this page.
const OUTSIDE = { target: '_blank', rel: 'noopener noreferrer' } as const;

function LinkButton({ link }: { link: ExternalLink }) {
  const href = Core.safeUrl(link.url);
  if (!href) return null;
  return (
    <a href={href} {...OUTSIDE} title={href} className={buttonVariants({ variant: 'outline', size: 'xs' })}>
      {link.label}
      <ExternalLinkIcon />
    </a>
  );
}

function LinkButtons({ links }: { links: ExternalLink[] }) {
  return (
    <span className="flex flex-wrap gap-1" data-testid="outside-links">
      {links.map((l, i) => (
        <LinkButton key={i} link={l} />
      ))}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number | string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 py-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 normal-case tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

// A single line break in a source text is a wrap. A blank line is a paragraph.
function Text({ children, className }: { children: ReactNode; className?: string }) {
  const text = String(children).trim().replace(/\n(?!\n)/g, ' ');
  return <p className={cn('text-[13px] leading-relaxed break-words whitespace-pre-line', className)}>{text}</p>;
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  if (children === undefined || children === null || children === '' || children === false) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Code({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code title={title} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all">
      {children}
    </code>
  );
}

// A coded value: its label, its code in small mono text, and its definition below in muted text.
function Coded({ concept }: { concept: { code: string; label: string; definition?: string } }) {
  return (
    <span className="flex flex-col">
      <span>
        {concept.label} <code className="font-mono text-[10px] text-muted-foreground">{concept.code}</code>
      </span>
      {concept.definition && <span className="text-xs text-muted-foreground">{concept.definition}</span>}
    </span>
  );
}

function formatProp(value: unknown, format?: string, field?: string): ReactNode {
  if (value === undefined || value === null || value === '') return '';
  if (field && Core.schemeOf(field)) {
    const items = Array.isArray(value) ? value : [value];
    return <span className="flex flex-col gap-1">{items.map((x, i) => { const c = Core.fieldConcept(field, x); return c ? <Coded key={i} concept={c} /> : <span key={i}>{String(x)}</span>; })}</span>;
  }
  if (format === 'list') return Array.isArray(value) ? value.join(', ') : String(value);
  if (format === 'upper') return <span className="font-mono text-xs uppercase">{String(value)}</span>;
  if (format === 'code') return <Code>{String(value)}</Code>;
  if (format === 'yesno') return value ? 'yes' : '';
  return String(value);
}

function firstValue(obj: Record<string, any>, fields: string[] | undefined): string {
  for (const f of fields ?? []) if (obj[f] !== undefined && obj[f] !== null && obj[f] !== '') return String(obj[f]);
  return '';
}

function CheckList({ list }: { list: Record<string, any>[] }) {
  const checks = Core.profile.checks;
  const detail = checks?.detail;
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((e, i) => {
        const type = checks ? String(e[checks.typeField] ?? '') : '';
        const name = firstValue(e, detail?.name ?? checks?.types?.[type]?.title);
        const file = detail?.file ? e[detail.file] : undefined;
        const record = detail?.record ? e[detail.record] : undefined;
        const links = Core.checkLinks(e);
        // 1 link makes the title a link. More links show as small buttons below the title.
        const href = links.length === 1 ? Core.safeUrl(links[0].url) : null;
        const title = name ? <Code title={name}>{name}</Code> : null;
        return (
          <li key={i} className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-2 py-1.5">
            <span className="flex items-start gap-1.5">
              <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
                {type}
              </Badge>
              {href ? (
                <a href={href} {...OUTSIDE} title={`${links[0].label}: ${href}`} className="text-primary underline underline-offset-2">
                  {title ?? links[0].label}
                </a>
              ) : (
                title
              )}
            </span>
            {links.length > 1 && <LinkButtons links={links} />}
            {file && (
              <span className="font-mono text-[11px] break-all text-muted-foreground" title={String(file)}>
                {String(file)}
              </span>
            )}
            {record && <span className="font-mono text-[11px] break-all text-muted-foreground">{String(record)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// The label of the marker of a record, or undefined when it has none.
function markerLabel(record: Record<string, unknown> | undefined): string | undefined {
  const marker = Core.provenanceOf(record).marker;
  if (typeof marker !== 'string') return undefined;
  return Core.markerConcept(marker)?.label ?? marker;
}

// The provenance of a node or of an edge: the marker, the source, the date, the agent and the note.
// A source that is a node shows as a node button. Other text shows as a link when it is a URL.
function ProvenanceSection({ v, record }: { v: Viewer; record: Record<string, unknown> | undefined }) {
  const spec = Core.provenance;
  const p = Core.provenanceOf(record);
  if (!spec || !Object.keys(p).length) return null;
  const marker = typeof p.marker === 'string' ? Core.markerConcept(p.marker) : undefined;
  const source = p.source === undefined ? undefined : String(p.source);
  return (
    <>
      <Separator />
      <Section title="Provenance">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]" data-testid="provenance">
          <Prop label="How">{marker ? <Coded concept={marker} /> : p.marker === undefined ? '' : String(p.marker)}</Prop>
          <Prop label="Source">
            {source === undefined ? '' : spec.source?.kind !== undefined && v.index.byId.has(source) ? <NodeButton v={v} id={source} /> : <SourceText text={source} />}
          </Prop>
          <Prop label="Retrieved">{p.retrieved === undefined ? '' : String(p.retrieved)}</Prop>
          <Prop label="Agent">{p.agent === undefined ? '' : String(p.agent)}</Prop>
          <Prop label="Note">{p.note === undefined ? '' : String(p.note)}</Prop>
        </dl>
      </Section>
    </>
  );
}

// Free text of a source: a link when it is a URL, else plain text.
function SourceText({ text }: { text: string }) {
  return Core.safeUrl(text) ? <ExtLink url={text} /> : <span>{text}</span>;
}

function NodeButton({ v, id, note, props, edge, marker }: { v: Viewer; id: string; note?: string; props?: VEdge['p']; edge?: string; marker?: string }) {
  const n = v.index.byId.get(id);
  if (!n) return <code>{id}</code>;
  return (
    <button type="button" onClick={() => v.select(id)} title={n.id} className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <KindDot kind={n.kind} className="mt-1.5" />
      <span className="min-w-0">
        <span className="block break-words">
          {n.title}
          {marker && (
            <Badge variant="outline" className="ml-1.5 h-4 px-1.5 align-middle text-[10px]" data-testid="edge-marker">
              {marker}
            </Badge>
          )}
        </span>
        {note && <span className="block text-xs break-words text-muted-foreground">{note}</span>}
        {props && <span className="block text-xs break-words text-muted-foreground">{Core.formatEdgeProps(props, edge)}</span>}
      </span>
    </button>
  );
}

// A linked node with its citation, when the profile gives its kind a citation section.
function LinkedCard({ v, id, props, edge, marker }: { v: Viewer; id: string; props?: VEdge['p']; edge?: string; marker?: string }) {
  const o = v.index.byId.get(id)!;
  const spec = (Core.profile.details?.citations ?? []).find((c) => c.kind === o.kind);
  const anchor = spec?.anchor ? Core.getPath(o.d, spec.anchor) : undefined;
  const url = spec?.url ? Core.getPath(o.d, spec.url) : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-md border px-2.5 py-2">
      <NodeButton v={v} id={id} props={props} edge={edge} marker={marker} />
      {o.sub && <div className="pl-5 text-xs text-muted-foreground">{o.sub}</div>}
      {Boolean(anchor || url) && (
        <div className="pl-5 text-xs">
          {anchor ? <span className="text-muted-foreground">{String(anchor)}. </span> : null}
          {url ? <ExtLink url={url} /> : null}
        </div>
      )}
    </div>
  );
}

// The details of a selected edge: its kind, its 2 nodes, its note and its properties.
function EdgeDetails({ v, edge }: { v: Viewer; edge: VEdge }) {
  const labels = Core.EDGE_LABEL[edge.k];
  const props = Object.entries(Core.withoutProvenance(edge.p) ?? {});
  return (
    <div className="px-4 pb-6" data-testid="edge-details">
      <div className="flex flex-col gap-2 pt-3 pb-3">
        <Badge variant="outline" className="w-fit">
          Edge
        </Badge>
        <h2 className="text-base leading-snug font-semibold break-words">{labels?.[0] ?? edge.k}</h2>
        <code className="font-mono text-[11px] break-all text-muted-foreground">{edge.k}</code>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button variant="outline" size="sm" onClick={() => v.select(edge.s)}>
            <Target /> Select the source
          </Button>
          <Button variant="outline" size="sm" onClick={() => v.select(edge.t)}>
            <ArrowRight /> Select the target
          </Button>
        </div>
      </div>
      <Separator />
      <Section title="Source">
        <NodeButton v={v} id={edge.s} />
      </Section>
      <Separator />
      <Section title="Target">
        <NodeButton v={v} id={edge.t} />
      </Section>
      {edge.n && (
        <>
          <Separator />
          <Section title="Note">
            <Text>{edge.n}</Text>
          </Section>
        </>
      )}
      <ProvenanceSection v={v} record={edge.p} />
      {props.length > 0 && (
        <>
          <Separator />
          <Section title="Properties" count={props.length}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              {props.map(([key, value]) => {
                const concept = Core.propertyConcept(edge.k, key, value);
                return (
                  <Prop key={key} label={key}>
                    {concept ? <Coded concept={concept} /> : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                  </Prop>
                );
              })}
            </dl>
          </Section>
        </>
      )}
    </div>
  );
}

export function DetailsPanel({ v }: { v: Viewer }) {
  const { index } = v;
  const P = Core.profile;
  const D = P.details ?? {};
  if (v.selectedEdge) return <EdgeDetails v={v} edge={v.selectedEdge} />;
  const n = v.selected ? index.byId.get(v.selected) : null;
  if (!n) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <Target className="size-8 opacity-40" />
        <div className="font-medium text-foreground">Nothing selected</div>
        Select a node in the tree, the table or the canvas to see its details.
      </div>
    );
  }
  const d = n.d;
  const kindSpec = Core.kindSpec(n.kind);
  const out = index.out.get(n.id)!;
  const inc = index.inc.get(n.id)!;
  const other = (e: VEdge) => (e.s === n.id ? e.t : e.s);
  const linkEdges = new Set([...(P.linkedScopeEdges ?? []), ...(P.refs ?? []).map((r) => r.field)]);
  const linked = (kind: string) => [...out, ...inc].filter((e) => index.byId.get(other(e))?.kind === kind && linkEdges.has(e.k));
  const summary = Core.summaryOf(index, n);
  const canScope = Core.HIERARCHY_KINDS.includes(n.kind) || Core.LINKED_KINDS.includes(n.kind);
  const sup = P.supersededBy ? out.find((e) => e.k === P.supersededBy) : undefined;
  const statementTitle = D.statementTitle?.[n.kind] ?? D.statementTitle?.default ?? 'Statement';
  const nodeLinks = Core.nodeLinks(n);
  const isPart = kindSpec?.role === 'part';
  const isCheck = n.kind === P.checks?.kind;
  const ownParts = (P.parts ?? []).filter((p) => p.owner === n.kind);
  const ownChecks = (d[P.checks?.field ?? ''] as Record<string, any>[] | undefined) ?? [];
  const S = P.status;
  const status = Core.statusOf(index, n.id, v.filters.fields);
  // The status value of a part node and the list of its detail field.
  const partStatus = (c: typeof n) => {
    const value = S?.values.find((x) => x.value === c.status);
    const detail = S?.detail ? ((c.d[S.detail.field] as unknown[] | undefined) ?? []) : [];
    if (!value && !detail.length) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        {value && (
          <span className="inline-flex items-center gap-1">
            <StatusDot tone={value.tone} />
            {value.label}
          </span>
        )}
        {detail.length > 0 && (
          <span className="text-muted-foreground">
            {S!.detail!.label}: {detail.join(', ')}
          </span>
        )}
      </div>
    );
  };

  const groups = (edges: VEdge[], dir: 0 | 1) => {
    const g = new Map<string, VEdge[]>();
    edges.forEach((e) => g.set(e.k, [...(g.get(e.k) ?? []), e]));
    return Array.from(g.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, list]) => ({ k, label: Core.EDGE_LABEL[k]?.[dir] ?? k, list }));
  };
  const Divider = () => <Separator />;

  return (
    <div className="px-4 pb-6" data-testid="details-panel">
      <div className="flex flex-col gap-2 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <KindBadge kind={n.kind} />
          {summary.chips.slice(0, 2).map((c, i) => (
            <ChipView key={i} chip={c} />
          ))}
        </div>
        <h2 className={cn('text-base leading-snug font-semibold break-words', summary.muted && 'line-through')}>{n.title}</h2>
        {n.sub && <div className="text-xs text-muted-foreground">{n.sub}</div>}
        <code className="font-mono text-[11px] break-all text-muted-foreground">{n.id}</code>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {canScope && (
            <Button variant="outline" size="sm" onClick={() => v.setScope({ type: 'node', id: n.id })}>
              <Target /> Scope to this node
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => v.startFrom(n.id)}>
            <Network /> Start a walk
          </Button>
        </div>
      </div>
      <Divider />

      <Section title="Properties">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {(D.properties ?? []).map((p) => (
            <Prop key={p.label} label={p.label}>
              {formatProp(Core.getPath(d, p.field), p.format, p.field)}
            </Prop>
          ))}
          {S && status.total > 0 && (
            <Prop label={S.label}>
              <StatusCounts status={status} />
            </Prop>
          )}
          <Prop label="Parent">{n.parents.length ? <span className="flex flex-col">{n.parents.map((p) => <NodeButton key={p} v={v} id={p} />)}</span> : ''}</Prop>
        </dl>
        {sup && (
          <div className="rounded-md bg-warn/10 px-2 py-1.5 text-xs text-warn">
            {Core.EDGE_LABEL[sup.k]?.[0] ?? sup.k} <NodeButton v={v} id={sup.t} />
          </div>
        )}
      </Section>

      {nodeLinks.length > 0 && (
        <>
          <Divider />
          <Section title="Links" count={nodeLinks.length}>
            <LinkButtons links={nodeLinks} />
          </Section>
        </>
      )}

      {n.statement && (
        <>
          <Divider />
          <Section title={statementTitle}>
            <Text>{n.statement}</Text>
          </Section>
        </>
      )}

      <ProvenanceSection v={v} record={d} />

      {isPart && (
        <>
          <Divider />
          <Section title={P.checks?.sectionTitle ?? 'Checks'} count={(d.checks ?? []).length}>
            {d.setup && <Text className="text-muted-foreground">Setup: {d.setup}</Text>}
            {(d.checks ?? []).length ? <CheckList list={d.checks} /> : <Text className="text-warn">{P.checks?.noneText ?? 'No check.'}</Text>}
          </Section>
        </>
      )}
      {isCheck && (
        <>
          <Divider />
          <Section title={P.checks?.sectionTitle ?? 'Check'}>
            <CheckList list={[d]} />
          </Section>
        </>
      )}

      {(D.textSections ?? [])
        .filter((s) => (!s.kinds || s.kinds.includes(n.kind)) && d[s.field])
        .map((s) => (
          <div key={s.title}>
            <Divider />
            <Section title={s.title}>
              <Text>{String(d[s.field])}</Text>
            </Section>
          </div>
        ))}

      {ownParts.map((part) => {
        const parts = inc.filter((e) => e.k === part.edge).map((e) => index.byId.get(e.s)!);
        return (
          <div key={part.kind}>
            <Divider />
            <Section title={part.sectionTitle ?? capitalise(Core.KIND_PLURAL[part.kind])} count={n.cov ? `${n.cov.verified} of ${n.cov.parts} with a check` : 0}>
              {!parts.length && <Text className="text-muted-foreground">None.</Text>}
              {parts.map((c) => (
                <div key={c.id} className={cn('flex flex-col gap-1.5 rounded-md border px-2.5 py-2', !(c.d.checks ?? []).length && 'border-l-2 border-l-warn')}>
                  <Text>{c.statement}</Text>
                  {partStatus(c)}
                  {(c.d.checks ?? []).length ? <CheckList list={c.d.checks} /> : <span className="text-xs text-warn">{P.checks?.noneText ?? 'No check.'}</span>}
                </div>
              ))}
            </Section>
          </div>
        );
      })}
      {ownChecks.length > 0 && (
        <>
          <Divider />
          <Section title={P.checks?.sectionTitle ?? 'Checks'} count={ownChecks.length}>
            <CheckList list={ownChecks} />
          </Section>
        </>
      )}

      {(D.objectLists ?? [])
        .filter((l) => Array.isArray(d[l.field]) && d[l.field].length)
        .map((l) => (
          <div key={l.title}>
            <Divider />
            <Section title={l.title} count={d[l.field].length}>
              <ul className="flex flex-col gap-1">
                {d[l.field].map((item: Record<string, string>, i: number) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      {item[l.badge]}
                    </Badge>
                    <Code>{firstValue(item, l.value) + (l.suffix && item[l.suffix] ? (l.suffixSeparator ?? '') + item[l.suffix] : '')}</Code>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        ))}

      {(D.optionSections ?? [])
        .filter((s) => Array.isArray(d[s.field]) && d[s.field].length)
        .map((s) => (
          <div key={s.title}>
            <Divider />
            <Section title={s.title} count={d[s.field].length}>
              {d[s.field].map((a: Record<string, string>, i: number) => (
                <div key={i} className="flex flex-col gap-0.5 rounded-md border px-2.5 py-2">
                  <Text className="font-medium">{a[s.primary]}</Text>
                  <Text className="text-muted-foreground">
                    {s.secondaryPrefix ?? ''}
                    {a[s.secondary]}
                  </Text>
                </div>
              ))}
            </Section>
          </div>
        ))}

      {(D.citations ?? [])
        .filter((c) => c.kind === n.kind)
        .map((c) => (
          <div key={c.title}>
            <Divider />
            <Section title={c.title}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                {c.rows.map((r) => {
                  const value = Core.getPath(d, r.path);
                  return (
                    <Prop key={r.label} label={r.label}>
                      {value === undefined || value === '' ? '' : r.link ? <ExtLink url={value} /> : r.template ? r.template.replace('{value}', String(value)) : String(value)}
                    </Prop>
                  );
                })}
              </dl>
            </Section>
          </div>
        ))}

      {(D.sourceSections ?? [])
        .filter((s) => Array.isArray(d[s.field]) && d[s.field].length)
        .map((s) => (
          <div key={s.title}>
            <Divider />
            <Section title={s.title} count={d[s.field].length}>
              <ul className="flex flex-col gap-2">
                {d[s.field].map((item: Record<string, string>, i: number) => (
                  <li key={i} className="text-[13px]">
                    <div className="break-words">{item[s.name]}</div>
                    {s.section && item[s.section] && <div className="text-xs break-words text-muted-foreground">{item[s.section]}</div>}
                    {s.url && item[s.url] && <ExtLink url={item[s.url]} />}
                    {s.retrieved && item[s.retrieved] && <div className="text-xs text-muted-foreground">Retrieved {item[s.retrieved]}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        ))}

      {(D.taggedLists ?? [])
        .filter((l) => Array.isArray(d[l.field]) && d[l.field].length)
        .map((l) => (
          <div key={l.title}>
            <Divider />
            <Section title={l.title} count={d[l.field].length}>
              <ul className="flex flex-col gap-1">
                {d[l.field].map((entry: unknown, i: number) => (
                  <li key={i} className="flex flex-col gap-0.5 text-[13px] break-words">
                    <TaggedEntry v={v} entry={entry} spec={l} />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        ))}

      {Core.LINKED_KINDS.filter((k) => k !== n.kind).map((kind) => {
        const edges = linked(kind);
        if (!edges.length) return null;
        return (
          <div key={kind}>
            <Divider />
            <Section title={capitalise(Core.KIND_PLURAL[kind])} count={edges.length}>
              {edges.map((e, i) =>
                (D.citations ?? []).some((c) => c.kind === kind) ? <LinkedCard key={i} v={v} id={other(e)} props={e.p} edge={e.k} marker={markerLabel(e.p)} /> : <NodeButton key={i} v={v} id={other(e)} note={e.n} props={e.p} edge={e.k} marker={markerLabel(e.p)} />,
              )}
            </Section>
          </div>
        );
      })}

      <CrossLinks v={v} id={n.id} />

      {[
        { title: 'Outgoing edges', list: groups(out, 0), total: out.length },
        { title: 'Incoming edges', list: groups(inc, 1), total: inc.length },
      ].map(({ title, list, total }) => (
        <div key={title}>
          <Divider />
          <Section title={title} count={total}>
            {!total && <span className="text-xs text-muted-foreground">None.</span>}
            {list.map((g) => (
              <div key={g.k} className="flex flex-col">
                <div className="text-xs font-medium text-muted-foreground">
                  {g.label} · {g.list.length}
                </div>
                {g.list.map((e, i) => (
                  <NodeButton key={i} v={v} id={other(e)} note={e.n} props={e.p} edge={e.k} marker={markerLabel(e.p)} />
                ))}
              </div>
            ))}
          </Section>
        </div>
      ))}
    </div>
  );
}

// The lines of 1 entry of a tagged list. The address of a line is an outside link. A node is a link that selects it.
function TaggedEntry({ v, entry, spec }: { v: Viewer; entry: unknown; spec: { labels?: Record<string, string>; linkKey?: string } }) {
  const ws = useWorkspace();
  // The active graph first, then the other graphs of the workspace.
  const resolve = (id: string) => {
    for (const g of [ws.activeId, ...ws.graphs.map((x) => x.id).filter((x) => x !== ws.activeId)]) {
      const n = ws.nodeOf(g, id);
      if (n) return { graph: g, id, title: n.title || id };
    }
    return undefined;
  };
  return (
    <>
      {Core.taggedLines(entry, spec.labels, { linkKey: spec.linkKey, resolve }).map((line, i) => {
        const href = line.href ? Core.safeUrl(line.href) : null;
        if (line.node) {
          const { graph, id } = line.node;
          return (
            <span key={i}>
              {line.label}:{' '}
              <button type="button" title={id} onClick={() => (graph === ws.activeId ? v.select(id) : ws.jump(graph, id))} className="text-left text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {line.value}
              </button>
            </span>
          );
        }
        if (href)
          return (
            <a key={i} href={href} {...OUTSIDE} className="text-primary underline underline-offset-2">
              {line.text}
            </a>
          );
        return <span key={i}>{line.text}</span>;
      })}
    </>
  );
}

// A button that shows a node of another graph.
function CrossLinkButton({ graph, id, note }: { graph: string; id: string; note?: string }) {
  const ws = useWorkspace();
  const target = ws.nodeOf(graph, id);
  if (!target) return <code title="This node is not in the graph.">{id}</code>;
  return (
    <Button variant="ghost" size="sm" title={id} onClick={() => ws.jump(graph, id)} className="h-auto w-full flex-col items-start gap-0 px-1 py-0.5 text-left font-normal whitespace-normal">
      <span className="break-words">{target.title}</span>
      {note && <span className="text-xs break-words text-muted-foreground">{note}</span>}
    </Button>
  );
}

// The cross links of a node: 1 section for each entry of `crossLinks` in the profile, and 1
// section for each graph that points at the node.
function CrossLinks({ v, id }: { v: Viewer; id: string }) {
  const ws = useWorkspace();
  const out = v.index.crossOut.get(id) ?? [];
  const incoming = ws.incoming(id);
  const sources = ws.graphs.filter((g) => incoming.some((c) => c.graph === g.id));
  return (
    <>
      {(Core.profile.crossLinks ?? [])
        .filter((spec) => ws.graphs.some((g) => g.id === spec.graph))
        .map((spec) => {
          const links = out.filter((c) => c.field === spec.field);
          if (!links.length) return null;
          const target = ws.graphs.find((g) => g.id === spec.graph)!;
          return (
            <div key={spec.field}>
              <Separator />
              <Section title={spec.label} count={links.length}>
                {links.map((c) => (
                  <CrossLinkButton key={c.t} graph={c.graph} id={c.t} note={target.label} />
                ))}
              </Section>
            </div>
          );
        })}
      {sources.map((g) => {
        const list = incoming.filter((c) => c.graph === g.id);
        return (
          <div key={g.id}>
            <Separator />
            <Section title={`Used by · ${g.label}`} count={list.length}>
              {list.map((c) => (
                <CrossLinkButton key={c.s + c.field} graph={c.graph} id={c.s} note={c.label} />
              ))}
            </Section>
          </div>
        );
      })}
    </>
  );
}

// The neighbours of the selected node, with the counts that an expand adds.
export function ExpandPanel({ v }: { v: Viewer }) {
  const { index } = v;
  const n = v.selected ? index.byId.get(v.selected) : null;
  if (!n) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <Network className="size-8 opacity-40" />
        <div className="font-medium text-foreground">No node selected</div>
        Select a node on the canvas to see its neighbours.
      </div>
    );
  }
  const onCanvas = v.canvasSet.has(n.id);
  const groups = Core.neighbourGroups(index, v.canvasSet, n.id);
  const summary = Core.summaryOf(index, n);
  return (
    <div className="flex flex-col gap-3 px-4 py-3" data-testid="expand-panel">
      <NodeSummaryView summary={summary} count={groups.total} />
      {!onCanvas && (
        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          This node is not on the canvas.
          <Button className="mt-2 w-full" size="sm" variant="outline" onClick={() => v.startFrom(n.id)}>
            <Network /> Start a walk from it
          </Button>
        </div>
      )}
      {onCanvas && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Neighbours not on the canvas</h3>
            <Badge variant="secondary">{groups.total}</Badge>
          </div>
          {groups.total === 0 ? (
            <p className="text-sm text-muted-foreground">Every neighbour of this node is on the canvas.</p>
          ) : (
            <>
              <Button size="sm" onClick={() => v.expand(n.id)}>
                Expand all ({groups.total})
              </Button>
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium text-muted-foreground">By node kind</div>
                {groups.kind.map((k) => (
                  <div key={k.kind} className="flex items-center gap-2 text-[13px]">
                    <KindDot kind={k.kind} />
                    <span className="flex-1">{capitalise(Core.KIND_PLURAL[k.kind])}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{k.count}</span>
                    <Button size="xs" variant="outline" onClick={() => v.expand(n.id, { kind: k.kind })}>
                      Expand
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs font-medium text-muted-foreground">By edge kind</div>
                {groups.edge.map((g) => (
                  <div key={g.k + g.dir} className="flex items-center gap-2 text-[13px]">
                    <span className="flex-1">{Core.EDGE_LABEL[g.k]?.[g.dir === 'out' ? 0 : 1] ?? g.k}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{g.count}</span>
                    <Button size="xs" variant="outline" onClick={() => v.expand(n.id, { k: g.k, dir: g.dir })}>
                      Expand
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          <Separator />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={!v.walk} onClick={() => v.collapse(n.id)}>
              <ChevronsLeft /> Collapse
            </Button>
            <Button size="sm" variant="outline" onClick={() => v.hide(n.id)}>
              <EyeOff /> Hide
            </Button>
            <Button size="sm" variant="outline" disabled={!v.canUndo} onClick={v.undo}>
              <Undo2 /> Undo
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
