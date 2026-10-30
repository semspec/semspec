// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import type { ReactNode } from 'react';
import heroGraph from 'virtual:hero-graph';
import roadmap from 'virtual:roadmap';
import snippets from 'virtual:snippets';
import trace from 'virtual:trace';
import { ArrowRight, Download, FileCode, FileJson, FolderGit2, Layers, ListChecks, Network, Shapes, type LucideIcon } from 'lucide-react';
import { CodeBlock, CommandLine } from '@/components/code-block';
import { CodeText } from '@/components/code-text';
import { Demo } from '@/components/demo';
import { HeroGraph } from '@/components/hero-graph';
import { GithubIcon } from '@/components/icons';
import { KindDot } from '@/components/kind-dot';
import { LinkButton } from '@/components/link-button';
import { Trace } from '@/components/trace';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DOCS_URL, GITHUB_URL } from '@/lib/links';

const FEATURES: { icon: LucideIcon; title: string; text: ReactNode }[] = [
  { icon: Shapes, title: 'Any vocabulary', text: 'The profile defines every kind, edge, field, colour and label. The tool knows no project.' },
  { icon: FolderGit2, title: 'Files in the repository', text: 'Keep 1 YAML file for each node, or the whole graph in 1 JSON or YAML file.' },
  { icon: Network, title: 'Explore the graph', text: 'Use a hierarchy tree, a scope by any node and a walk by expansion. Read the result in the Graph, Cards and Table views.' },
  { icon: ListChecks, title: 'Status that rolls up', text: 'A status rolls up from the nodes below. Filters select nodes by status and by any field of the profile.' },
  { icon: FileJson, title: 'Schemas for editors and agents', text: (<><CodeText>semspec schema</CodeText> writes a JSON Schema for each kind. An editor or an agent checks the YAML files with it.</>) },
  { icon: FileCode, title: '1 file to share', text: (<><CodeText>semspec build</CodeText> writes 1 HTML file. It opens from disk and makes no network request.</>) },
  { icon: Layers, title: 'Workspaces', text: 'Show several graphs on 1 page, each with its own profile. A node of 1 graph can link to a node of another.' },
  { icon: Download, title: 'Export', text: 'Write Turtle, TriG, JSON-LD, SHACL shapes or a Cypher script, with the IRIs from the profile.' },
];

const STANDARDS = [
  { name: 'ISO GQL and PG-Schema', use: 'The labelled property graph model' },
  { name: 'W3C SKOS', use: 'Vocabularies of codes' },
  { name: 'W3C PROV-O', use: 'Provenance of nodes and edges' },
  { name: 'RDF 1.2, Turtle, TriG and JSON-LD', use: 'Export' },
  { name: 'W3C SHACL', use: 'Shapes of the kinds' },
  { name: 'JSON Schema 2020-12', use: 'Schemas of the kinds and the inputs' },
  { name: 'Cypher', use: 'Import into a property graph database' },
];

// 1 vertical rhythm for every section, the hero included. The gap between 2 sections is the padding of both.
const sectionClass = 'scroll-mt-20 border-b py-12 sm:py-16';
const containerClass = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
const h2Class = 'text-2xl font-semibold tracking-tight sm:text-3xl';

export function Home() {
  return (
    <>
      <section aria-labelledby="hero-title" className="relative isolate overflow-hidden border-b">
        {/* A dot grid behind the whole hero. A mask makes it fade out under the text column. */}
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0 -z-20" />
        <div className={`${containerClass} grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:gap-12`}>
          <div className="min-w-0">
            <Badge variant="outline" className="h-6 bg-background/70 px-3 text-muted-foreground">
              Open source · Apache 2.0
            </Badge>
            <h1 id="hero-title" className="mt-6 max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tighter text-balance sm:text-6xl">
              AI-native requirements engineering harness
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
              Semspec turns requirements that a project keeps as YAML or JSON into a typed, linked graph. It shows how each requirement traces to its parts, its checks and its status.
            </p>
            <p className="mt-3 max-w-2xl text-pretty text-muted-foreground">A profile defines the kinds, the edges and the fields. The same tool works for any project and any vocabulary.</p>
            <div className="mt-8 max-w-2xl">
              <CommandLine code="npm install --save-dev github:semspec/semspec" label="Copy the install command" />
              <p className="mt-2 text-sm text-muted-foreground">Semspec needs Node 20 or later. It is not on npm yet.</p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="#demo" size="lg" className="h-10 px-4 text-sm">
                Open the demo
                <ArrowRight data-icon="inline-end" />
              </LinkButton>
              <LinkButton href={DOCS_URL} variant="outline" size="lg" className="h-10 px-4 text-sm">
                Read the docs
              </LinkButton>
              <LinkButton href={GITHUB_URL} variant="outline" size="lg" className="h-10 px-4 text-sm">
                <GithubIcon data-icon="inline-start" className="size-4" />
                View on GitHub
              </LinkButton>
            </div>
          </div>
          <div className="relative min-w-0">
            {/* The clip box starts at the left edge of the trace card, so it never reaches the text column. It is 2 card widths wide. The graph is centred on the card. */}
            <div aria-hidden="true" className="hero-graph-clip pointer-events-none absolute -inset-y-96 left-0 -z-10 hidden w-[200%] lg:block">
              <HeroGraph graph={heroGraph} className="absolute top-1/2 left-1/4 size-[1100px] max-w-none -translate-x-1/2 -translate-y-1/2" />
            </div>
            <Trace trace={trace} className="min-w-0" />
          </div>
        </div>
      </section>

      <section id="demo" aria-labelledby="demo-title" className={sectionClass}>
        <div className={containerClass}>
          <h2 id="demo-title" className={h2Class}>
            Live demo
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            This is the page that <CodeText>semspec build</CodeText> writes. It runs in your browser and sends no request.
          </p>
          <div className="mt-8">
            <Demo />
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className={sectionClass}>
        <div className={containerClass}>
          <h2 id="how-title" className={h2Class}>
            How it works
          </h2>
          <ol role="list" className="mt-10 space-y-12">
            <Step n={1} title="Define a profile" text="The profile names the kinds, the edges, the fields and the colours.">
              <CodeBlock {...snippets.profile} />
            </Step>
            <Step n={2} title="Write 1 file for each node" text="Each node is a YAML file in a folder for its kind. You review a change in a pull request, like code.">
              <CodeBlock {...snippets.requirement} />
            </Step>
            <Step
              n={3}
              title="Build the page"
              text={
                <>
                  Semspec checks both inputs and writes 1 HTML file. <CodeText>serve</CodeText> runs a live page that reads the files again on each load.
                </>
              }
            >
              <CodeBlock {...snippets.shell} />
            </Step>
          </ol>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className={sectionClass}>
        <div className={containerClass}>
          <h2 id="features-title" className={h2Class}>
            What Semspec does today
          </h2>
          <ul role="list" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex">
                <Card className="w-full">
                  <CardHeader>
                    <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
                      <Icon aria-hidden="true" className="size-4.5" />
                    </span>
                    <CardTitle>
                      <h3>{title}</h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground">{text}</CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="standards" aria-labelledby="standards-title" className={sectionClass}>
        <div className={containerClass}>
          <h2 id="standards-title" className={h2Class}>
            Open standards
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">Semspec maps its model to these standards.</p>
          <ul role="list" className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {STANDARDS.map((s) => (
              <li key={s.name} className="rounded-xl border bg-card p-4">
                <strong className="block font-semibold">{s.name}</strong>
                <span className="mt-1 block text-sm text-muted-foreground">{s.use}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="next" aria-labelledby="next-title" className="scroll-mt-20 py-12 sm:py-16">
        <div className={containerClass}>
          <h2 id="next-title" className={h2Class}>
            What comes next
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">The next features make Semspec a harness for agents. The roadmap comes from the requirements graph of this repository.</p>
          <ul role="list" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roadmap.planned.map((f) => (
              <li key={f.id} className="flex">
                <Card size="sm" className="w-full">
                  <CardHeader>
                    <CardTitle>
                      <h3 className="flex items-center gap-2">
                        <KindDot kind="feature" />
                        {f.title}
                      </h3>
                    </CardTitle>
                    <CardDescription>{f.statement}</CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <LinkButton href="/roadmap/" variant="outline" size="lg" className="h-10 px-4 text-sm">
              See the roadmap
              <ArrowRight data-icon="inline-end" />
            </LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}

function Step({ n, title, text, children }: { n: number; title: string; text: ReactNode; children: ReactNode }) {
  return (
    <li className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-10">
      <div>
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border bg-card font-mono text-sm font-medium">
          {n}
        </span>
        <h3 className="mt-4 text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-muted-foreground">{text}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
