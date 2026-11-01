// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import buildInfo from 'virtual:build-info';
import roadmap from 'virtual:roadmap';
import { ArrowRight } from 'lucide-react';
import { CodeText } from '@/components/code-text';
import { KindDot } from '@/components/kind-dot';
import { LinkButton } from '@/components/link-button';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { GITHUB_URL } from '@/lib/links';
import type { PlannedFeature, ShippedFeature } from '@/lib/roadmap';

const containerClass = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
const h2Class = 'text-2xl font-semibold tracking-tight sm:text-3xl';

// "3 of 5 conditions verified". A single condition uses the singular.
const countText = (f: { verified: number; total: number }) => `${f.verified} of ${f.total} ${f.total === 1 ? 'condition' : 'conditions'} verified`;

export function Roadmap() {
  return (
    <div className={`${containerClass} py-12 sm:py-16`}>
      <h1 className="text-4xl font-semibold tracking-tighter sm:text-5xl">Roadmap</h1>

      <section aria-labelledby="vision-title" className="mt-12 scroll-mt-20">
        <h2 id="vision-title" className={h2Class}>
          Vision
        </h2>
        <div className="mt-4 max-w-3xl space-y-4 text-lg text-pretty text-muted-foreground">
          <p>Semspec keeps the requirements of a project in its repository, as a typed graph. People and agents read the same graph. They change it in the same pull request as the code.</p>
          <p>
            Today Semspec reads the graph, checks it against a profile and shows it on 1 page. The next features make it a harness for agents. An agent gets the requirements of its task. A gate blocks a change that breaks the graph. Formal models and traces check the acceptance conditions, and the results set the status.
          </p>
          <p>The name means semantic specification.</p>
        </div>
      </section>

      <section id="next" aria-labelledby="next-title" className="mt-16 scroll-mt-20">
        <h2 id="next-title" className={h2Class}>
          Next
        </h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Each planned feature or capability lists its requirements and the status of each acceptance condition. This page comes from the <CodeText>requirements</CodeText> folder at commit{' '}
          <a href={`${GITHUB_URL}/tree/${buildInfo.commit}/requirements`} className="font-mono underline underline-offset-4 hover:text-foreground">
            {buildInfo.commit}
          </a>
          .
        </p>
        <div className="mt-5">
          <LinkButton href="/demo/requirements.html" variant="outline" size="lg" className="h-10 px-4 text-sm">
            Open the graph in the explorer
            <ArrowRight data-icon="inline-end" />
          </LinkButton>
        </div>
        <ul role="list" className="mt-8 space-y-6">
          {roadmap.planned.map((f) => (
            <li key={f.id}>
              <PlannedCard feature={f} />
            </li>
          ))}
        </ul>
      </section>

      <section id="shipped" aria-labelledby="shipped-title" className="mt-16 scroll-mt-20">
        <h2 id="shipped-title" className={h2Class}>
          Shipped
        </h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">These features are in the current version.</p>
        <ul role="list" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roadmap.shipped.map((f) => (
            <li key={f.id} className="flex">
              <ShippedCard feature={f} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PlannedCard({ feature }: { feature: PlannedFeature }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <h3 className="flex items-center gap-2">
            <KindDot kind={feature.kind} className="size-3" />
            {feature.title}
          </h3>
        </CardTitle>
        {feature.feature && <p className="text-sm text-muted-foreground">In the feature {feature.feature}</p>}
        <CardDescription>{feature.statement}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Progress value={feature.verified} max={Math.max(feature.total, 1)} aria-label={`Conditions verified in ${feature.title}`} getAriaValueText={() => countText(feature)} className="gap-2 [&_[data-slot=progress-indicator]]:bg-good">
          <span className="text-sm text-muted-foreground">{countText(feature)}</span>
        </Progress>
        <ul role="list" className="space-y-5">
          {feature.requirements.map((r) => (
            <li key={r.id} className="rounded-lg border bg-background/50 p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <KindDot kind="requirement" />
                <h4 className="font-medium">{r.title}</h4>
                {r.areas.map((area) => (
                  <Badge key={area} variant="secondary">
                    {area}
                  </Badge>
                ))}
              </div>
              <p className="mt-1.5 text-muted-foreground">{r.statement}</p>
              {r.conditions.length > 0 && (
                <ul role="list" className="mt-3 space-y-2 border-t pt-3">
                  {r.conditions.map((c) => (
                    <li key={c.id} className="flex items-start gap-3">
                      <span className="mt-px shrink-0">
                        <StatusBadge status={c.status} />
                      </span>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ShippedCard({ feature }: { feature: ShippedFeature }) {
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle>
          <h3 className="flex items-center gap-2">
            <KindDot kind="feature" />
            {feature.title}
          </h3>
        </CardTitle>
        <CardDescription>{feature.statement}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-1.5">
        <Progress value={feature.verified} max={Math.max(feature.total, 1)} aria-label={`Conditions verified in ${feature.title}`} getAriaValueText={() => countText(feature)} className="[&_[data-slot=progress-indicator]]:bg-good" />
        <p className="text-xs text-muted-foreground">{countText(feature)}</p>
      </CardContent>
    </Card>
  );
}
