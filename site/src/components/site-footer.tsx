// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { DOCS_URL, GITHUB_URL } from '@/lib/links';

const FOOTER_LINKS = [
  { label: 'GitHub', href: GITHUB_URL },
  { label: 'Docs', href: DOCS_URL },
  { label: 'Roadmap', href: '/roadmap/' },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 text-sm sm:px-6 md:flex-row md:items-start md:justify-between">
        <p>Semspec · Apache License 2.0 · Copyright 2026 The Semspec Authors</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
