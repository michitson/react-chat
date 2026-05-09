# react-chat

A reusable React component for building chat UIs (chatbot frontends, support inboxes, etc.). Published as `@michitson/react-chat`. The component is environment-agnostic — pair it with any backend that yields `AsyncIterable<ChatStreamChunk>`.

## Layout

```
react-chat/                            ← workspace root (pnpm)
├── pnpm-workspace.yaml
├── package.json                       ← scripts: dev, dev:next, build, test, typecheck
├── packages/
│   └── react-chat/                    ← THE PUBLISHED PACKAGE
│       ├── package.json               ← @michitson/react-chat
│       ├── src/
│       │   ├── Chatbot.tsx            ← the component (single file, 'use client' at top)
│       │   └── index.ts               ← barrel re-exports
│       └── tests/                     ← Vitest + RTL (stage 3)
└── apps/
    ├── vite-demo/                     ← fast manual iteration; consumes the package via workspace:*
    └── next-demo/                     ← Next 15 App Router smoke test (stage 4)
```

`packages/react-chat/` is the only thing that ships to npm. The `apps/*` directories are the **test harness** — vite-demo for quick visual iteration, next-demo for proving Next.js compatibility (RSC boundary, hydration), tests for automated regression coverage.

## Commands

Run from the workspace root:
- `pnpm dev` → starts vite-demo on http://localhost:5173
- `pnpm dev:next` → starts next-demo (after stage 4)
- `pnpm test` → runs Vitest in packages/react-chat (after stage 3)
- `pnpm build` → builds packages/react-chat into `dist/`
- `pnpm typecheck` → typechecks every workspace project in parallel

## Architecture notes (the non-obvious bits)

### `src/` vs `dist/` consumption
During development, `package.json` `main`/`exports` point at `src/index.ts`. pnpm symlinks the workspace, Vite transforms TSX directly, HMR works on package edits. At publish time, `publishConfig` overrides `main`/`exports` to point at `dist/` (built ESM + CJS + .d.ts). One package, two consumption modes.

### `'use client'` preservation
The component uses React hooks, so it must be a client component in Next.js App Router. The directive is at the top of `Chatbot.tsx`. **esbuild strips top-level directives by default**, so tsup is configured with a `banner` that re-injects `'use client';` into the built ESM/CJS output. Without this, importing the published package into a Next.js Server Component would silently fail at runtime.

### Tailwind content scanning across packages
Tailwind's JIT only emits classes it sees referenced in source. Since `Chatbot.tsx` lives in a separate package, every consuming app's `tailwind.config.ts` must include the package source (or, post-publish, the built `dist/`) in its `content` array. See `apps/vite-demo/tailwind.config.ts` for the workspace pattern; the README covers the npm-consumer pattern.

### Streaming protocol
`SendMessage` returns `AsyncIterable<ChatStreamChunk>` where `ChatStreamChunk = string | { type: 'choices'; options: string[] }`. Yield strings to append text; yield a choices object to attach clickable choice buttons to the assistant's current message. Choices render only on the **last** assistant message and only when `!isStreaming` — so they auto-hide as soon as a new turn starts. No explicit cleanup needed.

### Smart auto-scroll
Tracks `userPinnedRef` based on scroll distance from bottom. Auto-scrolls on new content only when pinned. Scrolling up while streaming pauses auto-scroll; scrolling back to bottom re-engages it.

### AbortController plumbing
`SendMessage` receives `{ signal: AbortSignal }`. The stop button calls `abortRef.current?.abort()`, which exits the `for await` loop. The echo backend checks `signal.aborted` between yields — real backends should plumb the same signal into `fetch` / SDK calls.

## Out of scope (deliberately, for v1)
- localStorage persistence
- regenerate / edit-last actions
- file attachments
- empty-state example prompts
- i18n
- voice input

These can come later as opt-in props or hooks; not worth designing for hypotheticals now.

## Stage status (build-out plan)

1. ✅ Restructure into pnpm monorepo (vite-demo consuming workspace package)
2. ✅ tsup build for the package (dual ESM/CJS, .d.ts, `'use client'` banner, `publishConfig`). Note: `treeshake: true` strips top-level directives via rollup post-processing, so we leave it off and rely on esbuild's tree-shaking.
3. ✅ Vitest + RTL test suite — 15 tests covering: initial render, Send disabled/enabled state, submit clears input, streamed chunk accumulation, typing indicator, textarea disabled while streaming, Stop button visibility, abort + signal propagation + partial text preservation, Enter sends, Shift+Enter newline, choices visibility (post-stream only), choice click submission, previous-turn choice clearing.
4. ✅ apps/next-demo (Next 15 App Router) — RSC/CSR boundary verified. `app/page.tsx` is a server component that renders `ChatShell.tsx` (`'use client'`), which in turn renders `Chatbot`. SSR delivers the initial messages + choice buttons in the HTML; client hydrates on top. Note: `next.config.mjs` includes `transpilePackages: ['@michitson/react-chat']` so Next processes the workspace TS source during dev (the published package wouldn't need this since `dist/` is pre-built JS).
5. ✅ Published. v0.0.1 was broken (publishConfig field overrides for main/module/types/exports are no longer applied by npm — verified by smoke-testing the install). Republished as v0.0.2 with top-level main/exports pointing at dist/ and bundler aliases in the demos for workspace HMR. v0.0.1 deprecated on the registry. See `RETROSPECTIVE.md` for the full deployment story including the publishConfig trap and the granular access token + bypass-2FA pattern that worked for CLI publishing.

## Conventions
- Single-file component policy: `Chatbot.tsx` is the deliverable. Keep it self-contained — no internal-only sibling files. Helpers (markdown classes, density tokens) stay in the same file.
- Tests live in `packages/react-chat/tests/` and use a deterministic test backend (no real timers).
- echoBackend.ts is **demo code**, lives in `apps/vite-demo/src/`, and is not part of the published surface.
