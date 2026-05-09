# @michitson/react-chat

A lightweight, single-file React chat UI primitive. Streaming, markdown, AbortSignal cancellation, and assistant-driven choice buttons. Bring your own backend.

This is **not** a chat framework. It's a UI component for projects that want a polished chat interface without committing to a multi-package framework. Perfect for embedded help bots, doc assistants, support widgets, internal tools, and anywhere the "chat" is a feature inside a larger app rather than the whole app.

## Install

```bash
npm install @michitson/react-chat
# or pnpm / yarn
```

Peer dependencies: `react ^18 || ^19`, `react-dom ^18 || ^19`.

You also need [Tailwind CSS](https://tailwindcss.com/docs/installation) configured in your project, and you must include this package in your Tailwind `content` array:

```ts
// tailwind.config.ts
export default {
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@michitson/react-chat/dist/**/*.{js,mjs,cjs}',
  ],
  darkMode: 'class',
  // ...
};
```

For syntax-highlighted code blocks in assistant messages, import a [highlight.js](https://github.com/highlightjs/highlight.js) theme once anywhere in your app:

```ts
import 'highlight.js/styles/github-dark.css';
```

## Quickstart

```tsx
import { Chatbot, type SendMessage } from '@michitson/react-chat';

const echo: SendMessage = async function* (messages) {
  const last = messages[messages.length - 1].content;
  for (const word of `You said: ${last}`.split(' ')) {
    await new Promise((r) => setTimeout(r, 50));
    yield word + ' ';
  }
};

export default function Page() {
  return (
    <div className="h-screen">
      <Chatbot sendMessage={echo} />
    </div>
  );
}
```

The component fills its parent — give it a sized container.

## Streaming protocol

Your `sendMessage` function returns an `AsyncIterable<ChatStreamChunk>`:

```ts
type ChatStreamChunk =
  | string                                           // append text to the assistant message
  | { type: 'choices'; options: string[] };          // attach clickable choice buttons
```

Yield `string` chunks to stream text into the current assistant bubble. Yield a `choices` chunk to attach enumerated buttons to the assistant message — the user clicking one becomes their next user message, and the buttons disappear as soon as the next turn begins.

A real backend hitting an LLM via Server-Sent Events:

```ts
const send: SendMessage = async function* (messages, { signal }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
    signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    yield decoder.decode(value);
  }
};
```

The component plumbs an `AbortSignal` to your backend automatically. When the user clicks the Stop button, `signal.aborted` becomes `true` and `fetch` (or your SDK) cancels.

## API

```ts
interface ChatbotProps {
  sendMessage: SendMessage;
  initialMessages?: ChatMessage[];
  placeholder?: string;
  density?: 'comfortable' | 'compact' | 'tight';
  className?: string;
  classNames?: {
    container?: string;
    messageList?: string;
    userBubble?: string;
    assistantBubble?: string;
    input?: string;
    sendButton?: string;
    choiceButton?: string;
  };
}
```

### `initialMessages`

Seed the conversation with prior messages. Useful for a welcome from the assistant — including initial choice buttons:

```tsx
const welcome = [
  {
    id: 'welcome',
    role: 'assistant' as const,
    content: 'Hi! What would you like to do?',
    choices: ['Tell me a joke', 'Show me docs'],
  },
];

<Chatbot sendMessage={send} initialMessages={welcome} />
```

### `density`

Controls horizontal spacing between user and assistant bubbles:
- `comfortable` (default) — bubbles can be wide, sit on opposite sides
- `compact` — bubbles narrower, gentler indent
- `tight` — bubbles narrowest, deep indent so opposite roles can interleave visually

### `className` and `classNames`

`className` applies to the outer container. `classNames` is a slot map for per-element overrides:

```tsx
<Chatbot
  sendMessage={send}
  className="rounded-xl border"
  classNames={{
    userBubble: 'bg-blue-600',
    assistantBubble: 'bg-gray-100',
    sendButton: 'bg-blue-600 hover:bg-blue-700',
  }}
/>
```

Slot classes are merged with the defaults via simple string concatenation, so later (yours) wins for conflicting Tailwind utilities.

### Dark mode

Toggle the `dark` class on `<html>` (or any ancestor) and the component restyles. Standard Tailwind `darkMode: 'class'` setup.

## What's included

- Multi-turn conversation history with smooth scrolling
- Streaming token rendering (no flash on each chunk)
- Smart auto-scroll: pauses when the user scrolls up, re-engages when they scroll back to bottom
- Markdown rendering via [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) for tables/strikethrough/etc + [rehype-highlight](https://github.com/rehypejs/rehype-highlight) for syntax highlighting
- Auto-grow textarea (max ~200px) with Enter-sends / Shift+Enter-newline
- Disabled input + Stop button while streaming
- Three role-styled bubble densities
- Dark mode out of the box
- Real `AbortController` cancellation
- Assistant-driven choice buttons (auto-hide on next turn)
- TypeScript-first, no `any` in the public surface

## What's deliberately excluded

These are real product decisions, not omissions to be filled in later:

- Tool-call rendering as UI, branching, edit-last, attachments, multi-thread management, voice. If you need these, look at [`@assistant-ui/react`](https://www.assistant-ui.com/) — it's a real chat framework and ships them well. This package stays small on purpose.

## License

MIT © michitson
