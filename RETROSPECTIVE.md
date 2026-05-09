# Retrospective: Designing & Publishing `@michitson/react-chat`

This document is an exhaustive walk-through of how `@michitson/react-chat` was designed, built, tested, and published — including a live failure case (the broken v0.0.1 publish) and what we learned from it.

It is intentionally pedagogical. If you arrive cold, you should be able to read it top-to-bottom and understand both *what* the project is and *why* every meaningful decision was made the way it was.

---

## Part 0 — What we built

A reusable React component for building chat UIs (chatbot frontends, support inboxes, in-product assistants). Published to npm as `@michitson/react-chat`, source on GitHub at `michitson/react-chat`.

It is **not** a chat *framework*. It is one self-contained component that renders a streaming chat interface and accepts a backend you supply. Position: lightweight, owned, framework-free — a different product from `@assistant-ui/react`.

The repository has four moving parts:

| Path | Role |
|------|------|
| `packages/react-chat/` | The published package. The thing that goes to npm. |
| `apps/vite-demo/` | Fast manual iteration. Vite dev server, source-aliased to package source for HMR. |
| `apps/next-demo/` | Next.js 15 App Router demo. Validates RSC/CSR boundary and SSR. |
| `packages/react-chat/tests/` | 15 Vitest + React Testing Library tests covering observable behavior. |

The two demos plus the test suite together form the "test harness" — three independent ways to keep the component honest.

---

# Part 1 — Design choices

For each decision I'll give: **the choice**, **the reasoning**, **what we considered and rejected**, and **the implication for consumers**.

## 1.1 Framework: React + TypeScript

**Choice.** React 18 + TypeScript, strict mode.

**Why.** React is the incumbent in the ecosystems we'd target (Next.js apps, embedded widgets in marketing sites, internal tools). TypeScript is non-negotiable for a public package — consumers need types to use the component safely, and `strict` mode keeps us honest about edge cases.

**Considered and rejected.** Vue / Svelte: smaller audience for a reusable chat primitive. Web Components (framework-agnostic): would solve cross-framework adoption but at the cost of much harder Tailwind integration and a steeper learning curve.

**Implication.** Consumers must be on React 18+ (we declare `^18 || ^19` in `peerDependencies`). They get full type inference through the public surface (`Chatbot`, `ChatMessage`, `SendMessage`, etc.) without doing anything special.

## 1.2 Single-file component

**Choice.** The entire component lives in one file: `packages/react-chat/src/Chatbot.tsx` (~440 lines including types and helpers). The barrel `index.ts` just re-exports.

**Why.** This is one of the package's defining characteristics. The whole thing fits in a single review-able file. It's also the unit of distribution: someone who doesn't want the npm dependency can literally `cp` `Chatbot.tsx` into their project, install the four runtime deps, and it works.

**Considered and rejected.** Multi-file split (Bubble, Input, Composer, MessageList, etc.). That's the conventional architecture for component libraries — and assistant-ui does it well — but the cost is opacity: consumers can't read it in one sitting, and "borrowing pieces" gets harder. Our positioning is "the small, owned, framework-free chat UI primitive," which the single-file approach reinforces.

**Implication.** Adding new internal abstractions has a real cost: the moment we split into multiple files, the "I can read it all" property is gone. We hold the line by keeping helpers (markdown class strings, density tokens, `MessageBubble`, `TypingIndicator`) in the same file rather than extracting them.

## 1.3 Backend contract: `AsyncIterable<ChatStreamChunk>`

**Choice.** The component takes a single `sendMessage` prop with this signature:

```ts
type SendMessage = (
  messages: ChatMessage[],
  options: { signal: AbortSignal },
) => AsyncIterable<ChatStreamChunk>;

type ChatStreamChunk =
  | string                                    // append text to the assistant message
  | { type: 'choices'; options: string[] };   // attach choice buttons
```

**Why.** This is *primitive* enough to wrap anything: `fetch` + Server-Sent Events, the Anthropic SDK, an in-process function, a websocket, a mock for tests. No `Runtime` class to extend, no adapters to import. The `AsyncIterable<string>` shape is also the universal language of streaming text in modern JS — it composes with `for await…of` directly.

The discriminated union makes choices a first-class thing without polluting the string-only happy path. Backends that don't need choices simply never yield the object form, and TypeScript's covariance lets `AsyncIterable<string>` flow into the `AsyncIterable<ChatStreamChunk>` type without code changes.

**Considered and rejected.**

- **Class-based runtime** (the assistant-ui pattern): more powerful but couples consumers to a specific lifecycle.
- **Event emitters** (`onToken`, `onDone`, `onError`): less ergonomic in modern JS than `for await`, hides the abort path, harder to type.
- **Two separate props** for text and choices: would force backends to maintain two parallel streams or weird state machines.

**Implication.** A real LLM backend is ~10 lines:

```ts
const send: SendMessage = async function* (messages, { signal }) {
  const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages }), signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    yield decoder.decode(value);
  }
};
```

The `signal` flows through `fetch` and cancels the request when the user clicks Stop.

## 1.4 Tailwind CSS for styling

**Choice.** Tailwind utility classes throughout the component, with arbitrary children selectors (e.g. `[&_p]:my-2`) for markdown styling.

**Why.** Tailwind is the dominant convention in the modern React ecosystem and is what most consumers will already have configured. Utility classes are easy to override with more-specific consumer classes (later wins for Tailwind utilities at the same specificity). Arbitrary children selectors let us style markdown output (which we don't directly render) without writing a separate stylesheet.

**Considered and rejected.**

- **CSS-in-JS** (styled-components, emotion): adds a runtime dep and a peer-dep concern. Hostile to SSR setups that don't already have it.
- **CSS modules**: ships with a CSS file consumers must import, which is more friction.
- **Unstyled headless primitives** (Radix style): exactly what assistant-ui does. Powerful, but the user-facing positioning of "chat UI working in 5 minutes" depends on having opinionated default styles.

**Implication.** Consumers must have Tailwind configured **and** must add the package's path to their Tailwind `content` array — otherwise Tailwind's JIT won't see the classes the component uses and they won't get emitted to CSS. The README spells this out:

```ts
content: [
  './src/**/*.{ts,tsx}',
  './node_modules/@michitson/react-chat/dist/**/*.{js,mjs,cjs}',
],
```

The pattern points at `dist/` because that's where consumers' Tailwind will find the built code with class names baked in. Inside our own monorepo, `apps/vite-demo/tailwind.config.ts` and `apps/next-demo/tailwind.config.ts` instead point at `../../packages/react-chat/src/**/*.{ts,tsx}` — same idea, different location for workspace consumption.

## 1.5 Markdown via `react-markdown` + `remark-gfm` + `rehype-highlight`

**Choice.** Assistant messages run through `react-markdown` with `remark-gfm` (tables, strikethrough, task lists) and `rehype-highlight` (syntax highlighting via highlight.js).

**Why.** A chat assistant that doesn't render markdown is a non-starter. Writing our own markdown renderer is a years-long mistake. These three libraries together are well-maintained, type-safe, and handle the corner cases (escaped characters, nested code, etc.).

**Considered and rejected.** Marked, markdown-it: lower-level (string-in, HTML-string-out), would require us to render via `dangerouslySetInnerHTML` and lose React's component model. Plain text only: a feature regression.

**Implication.** Three real dependencies in `package.json` `dependencies` (not peers) because the component depends on specific versions and APIs. The cost: ~40kb of code in the consumer's bundle. The benefit: nothing to do — bold, code blocks, tables all just work.

User messages are rendered as **plain text with `whitespace-pre-wrap`**, not through markdown. Reasoning: users typing into a chat interface aren't writing markdown, and rendering their input as markdown would be confusing (unexpected formatting on `**word**` etc).

## 1.6 Smart auto-scroll via a "pinned" ref

**Choice.** Track `userPinnedRef.current` based on scroll distance from the bottom. Auto-scroll on new messages **only if** pinned. The scroll handler flips the flag based on a 64px threshold.

```ts
const handleScroll = useCallback(() => {
  const el = scrollRef.current;
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  userPinnedRef.current = distance < SCROLL_PIN_THRESHOLD_PX;
}, []);
```

**Why.** Naïvely auto-scrolling on every chunk yanks the user's reading position when they've scrolled up to look at history mid-stream — a uniformly hated behavior. The pinned ref pattern is the standard solution: stay glued to the bottom unless the user explicitly walks away from it.

**Considered and rejected.** Always-scroll (broken, see above). State-based pinning: works, but state changes trigger renders we don't need. A `requestAnimationFrame` debounce: overkill for what the scroll handler does already.

**Implication.** Scrolling up during a long stream pauses auto-scroll. Scrolling back to the bottom re-engages it. Users don't have to think about it.

## 1.7 `AbortController` plumbing

**Choice.** The component creates a fresh `AbortController` per submit, passes its `signal` into `sendMessage`, and exposes a Stop button that calls `abortRef.current?.abort()`. The for-await loop checks `signal.aborted` between chunks; backends are expected to honor the signal too (most natively do via `fetch`).

**Why.** This is the platform-standard cancellation primitive. Consumers don't have to learn anything new — `AbortSignal` flows through `fetch`, the Anthropic SDK, the OpenAI SDK, etc. natively. Using a custom mechanism (a stop boolean, an event) would be a worse abstraction.

**Considered and rejected.** A `stop` boolean: doesn't propagate to network layers, so the request keeps draining tokens you no longer want. A custom event: same problem, plus more API surface to learn.

**Implication.** Stop is *real* cancellation, not just "stop showing me tokens." Consumer backends that pass `signal` to `fetch` get free network-level cancellation.

## 1.8 Choices as a first-class stream chunk

**Choice.** The stream yields either strings (text) or a discriminated `{ type: 'choices', options: string[] }` object. Choice objects attach a `choices` array to the assistant message. The choices render as buttons **only when the message is the last one AND the stream isn't active**.

**Why.** Real LLM-driven assistants frequently want to offer enumerated choices ("Yes / No," "Light / Dark / Auto," "Tell me a joke / Show me docs"). A user who clicks one means *exactly* the same thing as if they'd typed it — but the UX of clicking is much better than typing. Without first-class support, every consumer reinvents this with brittle parsing of assistant text.

The "only on the last message, only when not streaming" rule means choices auto-hide as soon as a new turn begins. Clicking a choice → submits as a user message → previous assistant message is no longer last → its choices vanish. No explicit cleanup needed.

**Considered and rejected.** Plain string protocol with the consumer parsing buttons out of assistant text: brittle, model-dependent, inconsistent UX. A separate prop or callback: doesn't fit the streaming model.

**Implication.** Backends that don't need choices never yield the object form — they keep yielding strings. TS covariance lets `AsyncIterable<string>` flow where `AsyncIterable<ChatStreamChunk>` is expected.

## 1.9 Density tokens (3 presets, not freeform)

**Choice.** A `density: 'comfortable' | 'compact' | 'tight'` prop. Each preset is a record of Tailwind class strings for bubble width, row alignment, and gap.

**Why.** Density is a *user preference* in real product use (different users like different conversation densities). But exposing every spacing knob would explode the API. Three presets cover 95% of the case and are easy to reason about.

**Considered and rejected.** Numerical density (`density={0.5}`): forces the component to do interpolation and removes the concept of "named designs that match my product." A `spacing` prop with raw Tailwind utilities: removes encapsulation; consumer can already do this via the `classNames` slot map if they really need it.

**Implication.** Three good defaults, one prop. Consumers don't have to design their own density system.

## 1.10 Dark mode via Tailwind `dark:` classes (class strategy)

**Choice.** Every styled element has a `dark:` variant. The consumer toggles `dark` class on `<html>` (or any ancestor).

**Why.** Tailwind's `darkMode: 'class'` is the modern convention for class-based dark mode toggling. It plays well with both manual user toggles and OS-pref-driven setups (the consumer just wires their preference logic to a class toggle).

**Considered and rejected.** Media-query-only dark mode (`@media (prefers-color-scheme: dark)`): no manual override. Theme variables: more powerful but adds API surface and a runtime cost.

**Implication.** Consumer's `tailwind.config.ts` must have `darkMode: 'class'`. Trivially documented in the README.

## 1.11 Positioning relative to assistant-ui

**Choice.** Explicit, in the README. We are not "assistant-ui but better." We are a *different product*: smaller, single-file, framework-free.

**Why.** Honesty + discoverability. People googling "react chat component" land on assistant-ui and any other library. Saying clearly *what we are* and *what we are not* prevents misalignment of expectations and avoids inviting comparisons we'd lose (assistant-ui has more features than us; that's by design).

**Considered and rejected.** Pretending we're the same product. We'd lose, and consumers would feel misled.

---

# Part 2 — Project architecture

## 2.1 Workspace layout (pnpm monorepo)

```
react-chat/
├── pnpm-workspace.yaml
├── package.json                    ← root scripts (dev, build, test, typecheck)
├── packages/
│   └── react-chat/                 ← THE PUBLISHED PACKAGE
└── apps/
    ├── vite-demo/                  ← fast manual iteration
    └── next-demo/                  ← Next.js RSC validation
```

**Why this shape.** It's the dominant convention for open-source component packages (turborepo, nx, and most well-maintained npm libraries use `packages/*` and `apps/*`). One published thing, multiple consumers in the same repo, minimal config to keep them in sync.

## 2.2 Why pnpm

**pnpm vs npm vs yarn vs bun:**

- **npm**: works but has clunky workspace support and a slow installer.
- **yarn classic**: legacy, deprecated.
- **yarn berry**: powerful, but its non-standard `node_modules` layout creates compatibility headaches.
- **bun**: very fast, but younger and the workspace story is still evolving.
- **pnpm**: fast installs, disk-efficient via global content-addressed store, **best workspace support of the four**, mature, and has the killer `workspace:*` protocol for cross-package linking. It's the modern default.

## 2.3 Workspace dependency: `"@michitson/react-chat": "workspace:*"`

In `apps/vite-demo/package.json` and `apps/next-demo/package.json`:

```json
"dependencies": {
  "@michitson/react-chat": "workspace:*",
  ...
}
```

The `workspace:*` protocol tells pnpm: "don't fetch this from the registry — symlink to the local `packages/react-chat` directory at any version." When publishing a workspace itself, pnpm rewrites this to the actual version automatically. (We don't publish the demos, so this never matters in our case.)

Result: `apps/vite-demo/node_modules/@michitson/react-chat/` is a symlink → `../../../packages/react-chat/`. Editing the package source is visible in the demo immediately.

## 2.4 Cross-package Tailwind scanning

Tailwind's JIT compiler scans your source for class strings and only emits CSS for classes it sees. If `Chatbot.tsx` lives in `packages/react-chat/src/` but is rendered by `apps/vite-demo/src/App.tsx`, the demo's Tailwind needs to know to scan **both** trees.

```ts
// apps/vite-demo/tailwind.config.ts
content: [
  './index.html',
  './src/**/*.{ts,tsx}',
  '../../packages/react-chat/src/**/*.{ts,tsx}',  // ← workspace package source
],
```

For real consumers (post-publish), the equivalent in their `tailwind.config.ts` is:

```ts
content: [
  './src/**/*.{ts,tsx}',
  './node_modules/@michitson/react-chat/dist/**/*.{js,mjs,cjs}',  // ← published built code
],
```

Same idea, different location. We document the consumer pattern in the README.

## 2.5 The "test harness" framing

Three independent quality machines:

1. **`apps/vite-demo`** — fast HMR, refresh-and-poke development. Catches what your eyes catch.
2. **`apps/next-demo`** — production environment fit. Catches RSC/CSR mismatches, hydration issues, `'use client'` placement, transpilation gotchas.
3. **`packages/react-chat/tests/`** — Vitest + RTL automated regression. Catches behavior changes that don't show up visually.

None of these alone is enough. Vite-demo wouldn't catch a broken Next build. Tests can't tell you the bubbles look ugly. Next-demo is too slow for daily iteration.

Together, they cover the three things that can break independently.

## 2.6 `CLAUDE.md` and `RETROSPECTIVE.md`

`CLAUDE.md` lives in the repo root. Future AI sessions in this directory auto-load it as context — it documents layout, commands, the streaming protocol, and the non-obvious architectural decisions. It's also useful for human readers as a quick orientation doc.

`RETROSPECTIVE.md` (this file) is the longer-form companion: design rationale + deployment narrative + gotchas log.

---

# Part 3 — Build pipeline (tsup)

## 3.1 Why tsup

**tsup vs Vite library mode vs raw Rollup vs raw esbuild vs tsc:**

- **tsc**: emits per-file `.js` + `.d.ts` but doesn't bundle, doesn't handle CSS, doesn't drop unused exports, and is dog-slow.
- **raw esbuild**: blazing fast and bundles, but you have to write all the orchestration (multi-format, dts, etc).
- **raw Rollup**: very capable, very configurable, somewhat slow, lots of config.
- **Vite library mode**: works for many cases, but the dts story is awkward.
- **tsup**: thin wrapper around esbuild + a `.d.ts` rollup. One config file. Handles dual ESM/CJS, types, source maps, banners, peer-dep externalization. The right tool for "publish a library" by a wide margin.

## 3.2 Dual ESM (`.mjs`) + CJS (`.cjs`) output

```ts
// tsup.config.ts
format: ['esm', 'cjs'],
outExtension({ format }) {
  return { js: format === 'esm' ? '.mjs' : '.cjs' };
},
```

**Why both.** The npm ecosystem still has CJS consumers (older Node setups, some bundlers, Jest in some configurations). Modern setups want ESM. Shipping both costs us ~13kb of duplicated CJS in the tarball; in exchange, we can be installed anywhere. The right tradeoff for a small library.

**Why explicit `.mjs` / `.cjs` extensions.** With `"type": "module"` in `package.json`, Node interprets bare `.js` as ESM. Mixing CJS into a `"type": "module"` package without explicit `.cjs` extensions is a recipe for "ERR_REQUIRE_ESM." Explicit extensions are unambiguous regardless of `type`.

## 3.3 `.d.ts` and `.d.cts`

tsup emits both:

- `dist/index.d.ts` — used when ESM consumers `import` from us
- `dist/index.d.cts` — used when CJS consumers `require` from us

For `moduleResolution: "bundler"` (modern Vite/Next/etc), one `.d.ts` works. For `moduleResolution: "node16"` or `"nodenext"`, the resolver wants matching extensions: `import` reads `.d.ts`, `require` reads `.d.cts`. Shipping both is the safe path.

The package.json `exports` map points each format at its respective types:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.mjs",
    "require": "./dist/index.cjs"
  }
}
```

The conditional resolution is order-sensitive: `types` should appear first so TypeScript finds it before falling through to the JS conditions.

## 3.4 The `'use client'` banner — and the `treeshake` trap

The component uses React hooks, so it must be a *client component* in Next.js App Router. The directive `'use client'` at the top of the source file marks it.

**Problem 1: esbuild strips top-level directives during bundling.** When tsup hands a bundle to esbuild, the `'use client'` from `Chatbot.tsx` gets dropped because directives in non-entry positions can't be reliably hoisted.

**Solution.** Re-inject the directive via tsup's `banner` option:

```ts
banner: { js: "'use client';" },
```

This puts `'use client';` at the very top of `dist/index.mjs` and `dist/index.cjs`. Verified by reading the first line of each.

**Problem 2: `treeshake: true` strips it again.** Initial config had:

```ts
treeshake: true,
```

…which we added thinking "more tree-shaking is more better." But `treeshake: true` runs the *post-esbuild* output through Rollup, and Rollup strips top-level directives, emitting:

```
[plugin] dist/index.mjs (1:0): Module level directives cause errors when bundled, "use client" in "dist/index.mjs" was ignored.
```

So the banner injected the directive, then treeshake ate it. Removing `treeshake: true` solved it — esbuild's own tree-shaking is fine for a 440-line library.

**Lesson.** Top-level directives are fragile. Verify they survive the build by `head -1 dist/index.{mjs,cjs}`.

## 3.5 `external: ['react', 'react-dom']`

tsup config:

```ts
external: ['react', 'react-dom'],
```

This tells esbuild *not* to bundle React into our output — leave the `import` references as-is so the consumer's React (declared in their `peerDependencies`) is used.

**Why this matters.** Without it, our bundle would ship its own copy of React and the consumer would have two Reacts at runtime. That breaks all the things that depend on React having a single instance: hooks, context, etc.

**Implication.** `peerDependencies: { react: ^18 || ^19 }` in our `package.json` — we *don't ship* React, the consumer brings it.

## 3.6 Source maps

```ts
sourcemap: true,
```

tsup emits `.mjs.map` and `.cjs.map`. They roughly double the tarball size (16.6 kB → 16.6 kB even with maps because most of the size *is* the maps), but they're enormously useful when a consumer hits a runtime error and needs to point a stack trace at our source. Worth shipping.

---

# Part 4 — `package.json` field by field

```json
{
  "name": "@michitson/react-chat",
  "version": "0.0.2",
  "description": "...",
  "license": "MIT",
  "author": "michitson",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/michitson/react-chat.git",
    "directory": "packages/react-chat"
  },
  "homepage": "https://github.com/michitson/react-chat#readme",
  "bugs": { "url": "https://github.com/michitson/react-chat/issues" },
  "keywords": ["react", "chat", "chatbot", "ui", "streaming", "markdown", "tailwind", "component"],

  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },

  "files": ["dist", "src", "README.md", "LICENSE"],
  "sideEffects": false,
  "scripts": { ... },
  "publishConfig": { "access": "public" },

  "peerDependencies": { "react": "^18 || ^19", "react-dom": "^18 || ^19" },
  "dependencies": { "highlight.js": "...", "react-markdown": "...", "rehype-highlight": "...", "remark-gfm": "..." },
  "devDependencies": { ... }
}
```

Field-by-field meaning:

- **name**. Scoped (`@michitson/...`). Free, never collides with existing global names. Discoverable on the npm scope page.
- **version**. SemVer. `0.0.x` for pre-stable. Once published, that exact version is immutable forever — even after `npm unpublish`, that version slot is locked.
- **license**. SPDX identifier. MIT means anyone can use, modify, redistribute; they just keep the copyright notice.
- **repository**. Tells npm and tooling where the source lives. The `directory` subfield narrows to a subpath inside a monorepo, so the GitHub link goes to the right directory in our `packages/react-chat` layout.
- **homepage** / **bugs**. Links rendered on the npm package page. Quality-of-life for users.
- **keywords**. Improve discoverability in npm search.
- **type: module**. Files with bare `.js` extensions are ESM. Doesn't affect us much because our outputs are explicit `.mjs`/`.cjs`, but it sets the correct default for any other JS we'd add.
- **main**. Legacy CJS entry point. Used by old tools that don't read `exports`.
- **module**. Bundler-era ESM entry point. Used by tools that prefer ESM but predate `exports`.
- **types**. Where TS finds type definitions when not using `exports`-aware resolution.
- **exports**. The modern entry-point map. Lets you have *conditional* exports (different files for `import` vs `require` vs `types`). The conditions are tried top-to-bottom, so `types` first, then `import`, then `require`.
- **files**. Whitelist of what goes into the published tarball. Anything not listed is excluded. We ship `dist/`, `src/` (for debugging), `README.md`, `LICENSE`. Not listed = `tsup.config.ts`, `vitest.config.ts`, `node_modules`, etc.
- **sideEffects: false**. A signal to consumer bundlers that no module in this package has import-time side effects, so they can aggressively tree-shake unused exports. We have one export (`Chatbot`) so it doesn't help us much, but it's accurate and free.
- **scripts**. Standard verbs: `build` (tsup), `clean`, `test` / `test:watch` (vitest), `typecheck` (tsc).
- **publishConfig**. *The trap that bit us.* See Part 7.
- **peerDependencies**. React + ReactDOM. Consumer brings them — we don't bundle them, we don't include them in the install graph.
- **dependencies**. Real runtime deps that *we* pull in: `react-markdown`, `remark-gfm`, `rehype-highlight`, `highlight.js`. These auto-install when a consumer installs us.
- **devDependencies**. Tools we use during build/test/dev. Never installed for consumers.

---

# Part 5 — Testing (Vitest + React Testing Library)

## 5.1 Why Vitest

**Vitest vs Jest:**

- Native ESM support (Jest still has rough edges with ESM-only deps like `react-markdown`).
- Same config style as Vite (we already know Vite).
- Faster cold starts.
- API is largely Jest-compatible (`describe`, `it`, `expect`, `vi.mock`).

For a Vite-shaped project, Vitest is the right answer.

## 5.2 jsdom

`vitest.config.ts`:

```ts
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./tests/setup.ts'],
  css: false,
}
```

jsdom gives us a fake DOM in Node. Enough for component rendering, queries, events. **Not** enough for: real CSS layout, scroll position calculations, animations. So our tests assert *behavior* (text content, role/disabled state, button presence), never *layout*.

`globals: true` means `expect`, `vi`, `describe`, etc. are available without import. `css: false` skips CSS file loading entirely (we'd otherwise import `globals.css` and try to parse Tailwind).

## 5.3 React Testing Library philosophy

Query elements by *what the user sees*, not by class name or test ID:

```ts
screen.getByRole('button', { name: /send/i });
screen.getByRole('textbox');
screen.findByText('Hello world!');
screen.getByLabelText(/typing/i);
```

If you change the className, the test still passes. If you remove the visible text, the test fails — *as it should*, because that's a user-visible regression.

## 5.4 Mocking `react-markdown`

```ts
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock('remark-gfm', () => ({ default: () => undefined }));
vi.mock('rehype-highlight', () => ({ default: () => undefined }));
```

**Why.** `react-markdown` pulls in micromark and ~30 other ESM-only packages. Loading them in jsdom slows tests significantly and adds dependency surface to our test suite. We're not testing markdown rendering quality — that's react-markdown's job. We're testing *our orchestration* (does content end up in the bubble? does the right component get rendered?).

The mock renders `children` as plain text in a `<span>`, so `screen.getByText('Hello world!')` works.

## 5.5 The "stalling backend" pattern

For tests that need to hold the stream open mid-flight (typing indicator visible, abort works, choices NOT visible while streaming):

```ts
function stallingBackend(initial: ChatStreamChunk[] = []) {
  let captured: AbortSignal | null = null;
  const send: SendMessage = async function* (_msgs, { signal }) {
    captured = signal;
    for (const c of initial) yield c;
    await new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  };
  return { send, signalCaptured: () => captured };
}
```

The generator yields any initial chunks, then *waits forever* for the abort signal. This lets the test:

1. Trigger streaming
2. Assert mid-stream UI state (typing dots, disabled input, Stop button visible)
3. Click Stop
4. Assert post-abort state (input re-enabled, partial text preserved, signal aborted)

`signalCaptured()` lets the test assert `signal.aborted === true` after Stop.

## 5.6 What 15 tests cover

| # | Test | Why it matters |
|---|------|---------------|
| 1 | Renders initial messages | Base contract |
| 2 | Send disabled when input empty | Form ergonomics |
| 3 | Send enables when input has content | … same |
| 4 | Click Send → user msg shown, input cleared | Submit flow |
| 5 | Streamed chunks accumulate in assistant bubble | Streaming protocol |
| 6 | Typing indicator visible before first chunk | Loading UX |
| 7 | Textarea disabled while streaming | Prevent double-submit |
| 8 | Stop button visible while streaming | Cancel UX |
| 9 | Stop aborts stream + preserves partial + re-enables input | Real abort |
| 10 | Enter sends | Keyboard |
| 11 | Shift+Enter inserts newline, doesn't submit | Keyboard |
| 12 | Choices render after stream completes | Choices lifecycle |
| 13 | Choices NOT visible while streaming | … |
| 14 | Click choice → submits as user message | Choice → user |
| 15 | Previous turn's choices hidden after new turn | Choices lifecycle |

These are the bits most likely to break silently when refactoring. Visual stuff (colors, spacing) is easier to eyeball during dev, so it isn't tested.

## 5.7 What we deliberately don't test

- **Markdown rendering quality** — that's react-markdown's job
- **Scroll behavior** — jsdom has no real scroll; would need Playwright
- **CSS / Tailwind class application** — fragile, tied to the design system
- **Visual regressions** — would want Storybook + Chromatic, deferred

---

# Part 6 — The two demos

## 6.1 vite-demo

`apps/vite-demo/` is a minimal Vite + React + Tailwind app. Its `App.tsx` mounts the chat with a dark-mode toggle and a density picker. `echoBackend.ts` lives here (not in the package) — it's demo code.

Key config: `vite.config.ts` aliases the package name to source for HMR (Part 8 reasoning).

`pnpm dev` starts on `:5173`. Edits to `Chatbot.tsx` (in the package) hot-reload via the alias.

## 6.2 next-demo

`apps/next-demo/` is a Next.js 15 App Router app. Important properties:

- **`app/page.tsx` is a Server Component** (no `'use client'`). Returns `<ChatShell />`.
- **`app/ChatShell.tsx` is a Client Component** (`'use client'`). Imports `Chatbot` from the package.
- **`Chatbot` itself** has `'use client'` baked in (we verified the directive survives bundling).

This three-layer structure is the *whole point* of next-demo — proving the RSC/CSR boundary is correct. The server prerenders the page (SSR), the client hydrates the chat island.

`pnpm dev:next` runs at `:3000`. `pnpm --filter next-demo build` compiles cleanly: 198 kB first-load JS, page prerendered as static.

`next.config.mjs` aliases the package name to source (same reason as vite-demo). It also sets `transpilePackages` as a belt-and-braces measure to ensure Next processes the TS source.

---

# Part 7 — Git & GitHub

## 7.1 One commit per stage

The commit history reads:

1. Stage 1 — pnpm monorepo restructure
2. Stage 2 — tsup build config
3. Stage 3 — Vitest + RTL test suite
4. Stage 4 — Next.js 15 App Router demo
5. v0.0.1 — first npm publish prep (README + LICENSE + version bump)
6. v0.0.2 — fix broken entry points

Each commit is a coherent unit. If something needed reverting, we could revert that one commit. If you want to learn how the project came together, you can `git log --oneline` and read the story top-to-bottom.

This is much easier to read (and to learn from) than one giant "initial commit" containing everything.

## 7.2 Tag releases

`git tag -a v0.0.2 -m "v0.0.2: fix entry points"` then `git push --follow-tags`.

Tags pin specific commits as releases. GitHub renders them as a "Releases" section on the repo page. Future GitHub Actions / CI / changelog generators all key off tags. They're cheap; tag every published version.

## 7.3 Public OSS-style repo

The package is npm-public; the source is GitHub-public. Visitors clicking through the npm page expect to find the source. Public-by-default also helps if anyone wants to file an issue, send a PR, or just read the code to audit it.

---

# Part 8 — npm publishing: the full story

## 8.1 What "publishing" actually does

When you run `npm publish`, npm:

1. Reads your `files` array → builds a tarball with exactly those paths.
2. Computes a sha512 integrity hash of the tarball.
3. PUTs the tarball + computed metadata to `https://registry.npmjs.org/`.
4. Updates the `latest` dist-tag to your version (unless you pass `--tag beta` or similar).
5. Records the version slot as **immutable forever** — even if you `npm unpublish`, no one can ever publish that exact `name@version` again.

That last point is why version bumps are non-trivial: each version is a permanent commitment.

## 8.2 Scoped vs unscoped

Our package is `@michitson/react-chat` — *scoped* under the `@michitson` user namespace.

- **Scoped names** are free, can never collide with existing packages outside your scope, and signal personal/org ownership.
- **Unscoped names** are global. Most desirable names are taken. You'd have to pick something like `react-chat-stream` (unique) instead of `chat` (definitely taken).

For a personal package, scoped is almost always right.

## 8.3 `publishConfig.access: "public"`

Scoped packages **default to private** — and private packages on npm require a paid plan. For free public-scoped publishing you must explicitly opt in:

```json
"publishConfig": { "access": "public" }
```

Or the equivalent CLI flag: `npm publish --access public`. Without this, the publish fails with a 402 or a paid-plan-required error.

## 8.4 `npm pack --dry-run` — always do this first

Before any real publish:

```bash
npm pack --dry-run
```

This shows you exactly what tarball would be produced — every file, sizes, integrity hash — without uploading anything. **Always check this before publishing.** Catches the "I forgot to include LICENSE" / "I'm shipping `node_modules` by accident" / "the tarball is 50 MB" class of mistakes.

For us, the final tarball was 11 files, 16.6 kB compressed, 90.9 kB unpacked. Right size for what this is.

## 8.5 Authentication: `npm login`

The first time:

```bash
npm login
```

Modern npm pops a browser flow, you confirm in the browser, you're done. There's a quirky "404 on /login/cli/..." page that occasionally shows after the auth completes — harmless, the CLI already has the token.

Verify with:

```bash
npm whoami
# → michitson
```

## 8.6 The 2FA-via-CLI trap (live case study)

npm requires 2FA for write operations (publish, deprecate, owner changes) on most accounts.

**The valid 2FA methods, ranked by CLI-friendliness:**

| Method | Login | Publish (CLI) |
|--------|-------|---------------|
| Email-based 2FA | ✅ | ❌ |
| Security key (WebAuthn / passkey) | ✅ (browser) | ❌ (CLI can't drive WebAuthn) |
| TOTP (authenticator app) | ✅ | ✅ via `--otp=<code>` |
| Granular access token with bypass-2FA | ✅ | ✅ |

**What we hit:** the account had email-based 2FA + a security key. Login worked (email code). Publish failed:

```
npm error code E403
npm error 403 Forbidden — Two-factor authentication or granular access token with bypass 2fa enabled is required
```

Then re-trying produced:

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

These two errors are confusing because they say slightly different things, but the underlying issue is the same: the CLI needs a way to provide 2FA that doesn't involve a browser.

**The fix that worked:** create a granular access token with the "bypass 2FA" flag enabled.

1. Visit `https://www.npmjs.com/settings/<username>/tokens`
2. *Generate New Token → Granular Access Token*
3. Configure:
   - Name: descriptive (e.g. `react-chat-publish`)
   - Expiration: 30–90 days
   - Packages and scopes: limit to `@michitson` (or just the specific package)
   - Permissions: *Read and write*
   - **Toggle on: "Allow this token to bypass two-factor authentication"** ← critical
4. Copy the token (starts with `npm_`) — it's only displayed once
5. Save it to `~/.npmrc`:
   ```bash
   npm config set //registry.npmjs.org/:_authToken npm_xxx...
   ```
6. `npm publish` now works.

**Security tradeoff.** A bypass-2FA token is essentially a "publish-without-2FA" credential — protect it like a password. Limit to the smallest scope you need. Set a 30-day expiration. Rotate periodically.

This is also what CI systems use (GitHub Actions secrets, etc.) when automating publishes.

## 8.7 The `publishConfig` field-override trap (the v0.0.1 disaster)

**What we tried.** The classic monorepo pattern: dev consumption uses workspace-symlinked `src/`, published consumption uses built `dist/`. The traditional way to switch was to put the dist-pointing fields under `publishConfig`:

```json
"main": "./src/index.ts",
"types": "./src/index.ts",
"exports": { ".": "./src/index.ts" },
"publishConfig": {
  "access": "public",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "...", "import": "...", "require": "..." } }
}
```

Theory: at publish time, npm merges `publishConfig` into the top-level fields, so the published `package.json` has the dist-pointing entry points.

**What actually happened.** npm emitted four warnings:

```
npm warn Unknown publishConfig config "main". This will stop working in the next major version of npm.
npm warn Unknown publishConfig config "module". ...
npm warn Unknown publishConfig config "types". ...
npm warn Unknown publishConfig config "exports". ...
```

We dismissed them as "deprecation warnings, the override still works." We were wrong. **The current npm CLI ignores those fields entirely** — it doesn't apply them, it doesn't merge them, it just drops them with a warning. The published `package.json` had `main: "./src/index.ts"` and friends untouched. Consumers installing v0.0.1 would resolve `main` to a `.ts` file Node can't run.

**The fix.** Move the dist-pointing fields to the top level permanently:

```json
"main": "./dist/index.cjs",
"module": "./dist/index.mjs",
"types": "./dist/index.d.ts",
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.mjs",
    "require": "./dist/index.cjs"
  }
},
"publishConfig": { "access": "public" }
```

But now workspace dev consumption (vite-demo, next-demo importing `@michitson/react-chat`) would resolve through `main` → `dist/index.cjs`, requiring a build before dev works and breaking HMR on package edits.

**The HMR fix.** Add a path alias in each demo's bundler config that overrides the package name to point at source during dev:

```ts
// apps/vite-demo/vite.config.ts
resolve: {
  alias: {
    '@michitson/react-chat': path.resolve(__dirname, '../../packages/react-chat/src/index.ts'),
  },
}
```

```js
// apps/next-demo/next.config.mjs
webpack: (config) => {
  config.resolve.alias['@michitson/react-chat'] = path.resolve(__dirname, '../../packages/react-chat/src/index.ts');
  return config;
}
```

Real consumers (post-publish) don't share these aliases — they resolve through the published `package.json` and use `dist/`. We get HMR; consumers get a working package.

**Lesson.** Always **verify the published `package.json` after publishing** by installing in a fresh directory. `npm pack --dry-run` shows you the *files* in the tarball but **not how npm will rewrite `package.json` after applying `publishConfig`** — that only becomes visible post-publish.

We caught this immediately, published v0.0.2 with the fix, and `npm deprecate`'d v0.0.1 with a pointer to the fix. Total damage: one bad version permanently in the registry (annotated as deprecated). This is the most common kind of "first publish" disaster.

## 8.8 `npm deprecate`

```bash
npm deprecate @michitson/react-chat@0.0.1 "v0.0.1 has broken main/exports — use 0.0.2 or later."
```

Marks a published version as deprecated. The version stays in the registry (immutable), but anyone who installs it gets a warning. Friendlier than `npm unpublish` (which requires <72 hours since publish and triggers npm's anti-rugpull rules). Use it when you ship a broken version and want to nudge people toward the fix.

## 8.9 Smoke testing in a fresh directory

After every publish, install in `/tmp` and import:

```bash
cd /tmp && rm -rf smoketest && mkdir smoketest && cd smoketest
npm init -y
npm install @michitson/react-chat react react-dom
node --input-type=module -e "import * as M from '@michitson/react-chat'; console.log(Object.keys(M));"
# → [ 'Chatbot' ]
```

This catches "the published package.json is wrong" / "I forgot a file in the files array" / "the bundle has a runtime error" — the class of issues that pass `npm pack --dry-run` but break for real consumers.

For us, this smoke test is what surfaced the v0.0.1 problem.

---

# Part 9 — Maintenance & next steps

## 9.1 Release checklist (do this every time)

```bash
# 1. Make sure tests pass
pnpm test

# 2. Make sure both demos build
pnpm --filter vite-demo build
pnpm --filter next-demo build

# 3. Bump version (edit package.json or use `npm version patch`)
#    `npm version patch` will commit + tag in one shot if you're inside the package dir

# 4. Build fresh
pnpm --filter @michitson/react-chat build

# 5. Inspect tarball
cd packages/react-chat && npm pack --dry-run

# 6. Publish
npm publish

# 7. Smoke test in /tmp
cd /tmp && mkdir test-$(date +%s) && cd $_
npm init -y
npm install @michitson/react-chat react react-dom
node --input-type=module -e "import('@michitson/react-chat').then(m => console.log(Object.keys(m)))"

# 8. Tag and push (if not done by `npm version`)
git tag -a vX.Y.Z -m "vX.Y.Z: ..."
git push --follow-tags
```

## 9.2 Semver

| Bump | When |
|------|------|
| **Patch** (0.0.x → 0.0.y) | Bug fixes that don't change the API |
| **Minor** (0.x.0 → 0.y.0) | Backwards-compatible additions to the API |
| **Major** (x.0.0 → y.0.0) | Breaking changes |

Pre-1.0 (`0.x.x`), the rules are looser by convention — many maintainers treat each minor as potentially breaking. Don't release `1.0.0` until the API is stable.

## 9.3 What we deliberately didn't build (yet)

- **CI/CD via GitHub Actions** — auto-test on PRs, auto-publish on tag push. Worthwhile if this becomes a multi-collaborator project or you want hands-off releases.
- **Changesets** (`@changesets/cli`) — automates version bumps + changelog generation. Useful when you want a structured release log and you publish frequently.
- **Provenance attestation** (`npm publish --provenance`) — cryptographic proof the package came from a specific GitHub Actions run. Available only via CI. A "v1.0.0+" thing.
- **Storybook** — visual playground for component variants. Useful if you add many props or want a designer-friendly review surface.
- **Playwright E2E** — real-browser tests of full chat flows. Valuable for: scroll behavior, real CSS, real keyboard input. Out of scope for unit tests.
- **Bundle size monitoring** (`size-limit`) — fails CI if the bundle grows beyond a budget. Good once you have CI.

None of these are needed for v0.0.x. Add them when the friction of *not* having them exceeds the cost of setting them up.

---

# Part 10 — Gotchas log (the bits that bit us)

A short list of "I would not have known this" moments. Worth re-reading before the next first-publish.

1. **`'use client'` is stripped by `treeshake: true`** in tsup. Rollup's post-processing removes top-level directives. Solution: leave `treeshake` off; rely on esbuild's own tree-shaking.
2. **Tailwind needs to scan the package source** from each consumer. Forgetting this means classes silently don't get emitted to CSS and the component renders as unstyled HTML.
3. **`publishConfig` field overrides for `main`/`module`/`types`/`exports` are now ignored** by npm CLI, with only a warning. Always set the production fields at the top level and use bundler aliases for workspace dev consumption.
4. **Security keys can't drive `npm publish`** from the CLI — the CLI has no way to do WebAuthn. Use a granular access token with bypass-2FA, or set up TOTP.
5. **Email 2FA only works for login**, not for write operations. The npm UI may not make this obvious.
6. **Always smoke-test in `/tmp`** after publishing. `npm pack --dry-run` shows you the files but not the post-`publishConfig` `package.json`.
7. **Scoped packages default to private**. You must explicitly `publishConfig.access: "public"` (or pass `--access public`) for free OSS publishing.
8. **Each `name@version` slot is forever.** Treat publish as a permanent commitment. Mistakes get fixed by *bumping*, not by republishing.
9. **The 404 after `npm login` is a known UI quirk** — the auth still completed. `npm whoami` is the source of truth.
10. **Type tests are different from runtime tests.** TypeScript happy ≠ runtime correct (we had a published package that typechecked locally but was unusable from any consumer because of the publishConfig issue). Always verify with a real install.

---

# Part 11 — Where to look when something breaks

| Symptom | Where to look |
|---------|--------------|
| Tests pass but UI is wrong | `apps/vite-demo` — visual eyeball check |
| UI looks fine but breaks under Next | `apps/next-demo` — RSC/CSR boundary issues |
| Component fails after `pnpm dev` | Check `vite.config.ts` / `next.config.mjs` aliases — they need to match the package source path |
| Consumer's Tailwind doesn't apply our classes | Their `content` array doesn't include `node_modules/@michitson/react-chat/dist/...` |
| `'use client'` runtime error in Next | Check `head -1 dist/index.mjs` — the directive must be present |
| Published package fails to import | Smoke test in `/tmp`. Check the published `package.json` `main` / `exports` |
| `npm publish` fails with 403/EOTP | 2FA. Use a bypass-2FA granular token |
| `npm publish` fails with 402 | `publishConfig.access: "public"` is missing |
| Test suite very slow | The `react-markdown` mock isn't being applied. Check the mock paths |

---

This document was generated immediately after the v0.0.2 publish. It will go out of date — but the *gotchas log* and *publishing trap* sections in particular should remain useful for any future package.

Welcome to npm. The first one is the hardest.
