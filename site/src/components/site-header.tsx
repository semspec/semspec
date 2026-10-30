// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { GithubIcon, LogoMark } from '@/components/icons';
import { LinkButton } from '@/components/link-button';
import { ThemeSwitch } from '@/components/theme-switch';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GITHUB_URL, NAV_LINKS } from '@/lib/links';

// The sticky header: logo, nav links, GitHub link and theme switch. On a phone the nav links move into a sheet.
export function SiteHeader({ route }: { route: string }) {
  const [open, setOpen] = useState(false);
  const current = (href: string) => (href === route ? ('page' as const) : undefined);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <a href="/" className="-ml-1 flex items-center gap-2 rounded-md px-1 py-1 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <LogoMark className="size-6" />
          <span>Semspec</span>
        </a>
        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <LinkButton key={link.label} href={link.href} variant="ghost" className="aria-[current=page]:bg-muted" aria-current={current(link.href)}>
              {link.label}
            </LinkButton>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<LinkButton href={GITHUB_URL} variant="ghost" size="icon" aria-label="Semspec on GitHub" />}>
              <GithubIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>GitHub</TooltipContent>
          </Tooltip>
          <ThemeSwitch />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open the menu" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Links to the pages of the site</SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {NAV_LINKS.map((link) => (
                  <LinkButton key={link.label} href={link.href} variant="ghost" size="lg" className="justify-start aria-[current=page]:bg-muted" aria-current={current(link.href)} onClick={() => setOpen(false)}>
                    {link.label}
                  </LinkButton>
                ))}
                <LinkButton href={GITHUB_URL} variant="ghost" size="lg" className="justify-start" onClick={() => setOpen(false)}>
                  <GithubIcon className="size-4" />
                  GitHub
                </LinkButton>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
