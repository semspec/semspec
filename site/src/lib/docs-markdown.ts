// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Renders the Markdown body of a docs page to HTML at build time. The client never runs this code.
// Code blocks go through Shiki with the same 2 themes as the snippets of the home page.
import { Marked, Renderer } from 'marked';
import type { Tokens } from 'marked';
import { bundledLanguages, codeToHtml } from 'shiki';
import { escapeHtml, htmlToText, rewriteLink, slugger } from './docs';
import type { DocHeading, LinkContext, RenderedBody } from './docs';

export interface RenderedPage extends RenderedBody {
  html: string;
}

// Highlights code. A language that Shiki does not know gives plain text.
export async function highlightCode(code: string, lang: string): Promise<string> {
  const known = lang in bundledLanguages || ['text', 'plaintext', 'txt', 'plain'].includes(lang);
  return codeToHtml(code, { lang: known ? lang : 'text', themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
}

type CodeToken = Tokens.Code & { highlighted?: string };

// Renders 1 body. A link to a Markdown file that is not a page throws.
export async function renderBody(markdown: string, context: LinkContext): Promise<RenderedPage> {
  const headings: DocHeading[] = [];
  const links = new Set<string>();
  const slug = slugger();

  const marked = new Marked({
    async: true,
    gfm: true,
    walkTokens: async (token) => {
      if (token.type === 'code') (token as CodeToken).highlighted = await highlightCode(token.text, (token.lang ?? '').trim().split(/\s+/)[0] ?? '');
    },
    renderer: {
      heading(this: Renderer, { tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>\n`;
        const text = htmlToText(inner);
        const id = slug(text);
        headings.push({ depth, id, text });
        return `<h${depth} id="${id}">${inner}<a class="doc-anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">#</a></h${depth}>\n`;
      },
      link(this: Renderer, { href, title, tokens }: Tokens.Link) {
        const rewritten = rewriteLink(href, context);
        if (rewritten.page) links.add(rewritten.page);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(rewritten.href)}"${titleAttr}>${this.parser.parseInline(tokens)}</a>`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? '').trim().split(/\s+/)[0] ?? '';
        const caption = lang ? `<figcaption>${escapeHtml(lang)}</figcaption>` : '';
        return `<figure class="doc-code">${caption}<div class="code">${(token as CodeToken).highlighted ?? ''}</div></figure>\n`;
      },
      table(this: Renderer, token: Tokens.Table) {
        return `<div class="doc-table">${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
    },
  });

  const html = await marked.parse(markdown);
  return { html, headings, links: [...links] };
}
