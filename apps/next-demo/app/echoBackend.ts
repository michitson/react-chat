import type {
  ChatMessage,
  ChatStreamChunk,
  SendMessageOptions,
} from '@michitson/react-chat';

interface CannedReply {
  text: string;
  choices?: string[];
}

const CANNED: Record<string, CannedReply> = {
  'tell me a joke': {
    text:
      "Sure — here's one:\n\nWhy do programmers prefer dark mode?\n\n**Because light attracts bugs.** 🪲",
    choices: ['Another one', "I'm done"],
  },
  'another one': {
    text: "OK: I told my computer I needed a break — it said _“no problem, I'll go to sleep.”_",
    choices: ['One more', "I'm done"],
  },
  'one more': {
    text: 'Last one: there are 10 types of people in the world — those who understand binary, and those who don’t.',
    choices: ["I'm done"],
  },
  "i'm done": { text: 'Anytime. 👋' },
  'show me markdown': {
    text: [
      "Here's a small markdown sampler:",
      '',
      '## A heading',
      '',
      'Some **bold**, some _italic_, and a [link](https://example.com).',
      '',
      '- bullet one',
      '- bullet two with `inline code`',
      '- bullet three',
      '',
      '```ts',
      'function greet(name: string): string {',
      '  return `Hello, ${name}!`;',
      '}',
      '```',
      '',
      '> A blockquote, for good measure.',
    ].join('\n'),
  },
  'ask me something': {
    text: "OK — what's your style?",
    choices: ['Light mode', 'Dark mode', 'Auto'],
  },
  'light mode': {
    text: 'Noted: light mode. Anything else?',
    choices: ['Yes', 'No, thanks'],
  },
  'dark mode': {
    text: 'Noted: dark mode. Anything else?',
    choices: ['Yes', 'No, thanks'],
  },
  auto: {
    text: 'Noted: auto. Anything else?',
    choices: ['Yes', 'No, thanks'],
  },
  yes: {
    text: 'Cool — pick a topic:',
    choices: ['Tell me a joke', 'Show me markdown'],
  },
  'no, thanks': { text: 'All good. 🫡' },
};

export async function* echoBackend(
  messages: ChatMessage[],
  { signal }: SendMessageOptions,
): AsyncIterable<ChatStreamChunk> {
  const last = messages[messages.length - 1]?.content ?? '';
  const canned = CANNED[last.trim().toLowerCase()];
  const reply = canned ?? { text: `You said: ${last}` };

  for (const token of reply.text.split(/(\s+)/)) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 40));
    yield token;
  }

  if (reply.choices && !signal.aborted) {
    yield { type: 'choices', options: reply.choices };
  }
}
