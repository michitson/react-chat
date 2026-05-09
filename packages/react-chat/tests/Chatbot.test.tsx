import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Chatbot,
  type ChatMessage,
  type ChatStreamChunk,
  type SendMessage,
} from '../src';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock('remark-gfm', () => ({ default: () => undefined }));
vi.mock('rehype-highlight', () => ({ default: () => undefined }));

afterEach(() => cleanup());

function simpleBackend(...chunks: ChatStreamChunk[]): SendMessage {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

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

const HELLO_MSG: ChatMessage = {
  id: 'init-1',
  role: 'assistant',
  content: 'Hi there',
};

describe('Chatbot', () => {
  it('renders initial messages', () => {
    render(
      <Chatbot sendMessage={simpleBackend()} initialMessages={[HELLO_MSG]} />,
    );
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('disables Send when input is empty', () => {
    render(<Chatbot sendMessage={simpleBackend()} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('enables Send when input has content', async () => {
    const user = userEvent.setup();
    render(<Chatbot sendMessage={simpleBackend()} />);
    await user.type(screen.getByRole('textbox'), 'hello');
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('clicking Send shows the user message and clears input', async () => {
    const user = userEvent.setup();
    render(<Chatbot sendMessage={simpleBackend('reply')} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(textarea.value).toBe('');
  });

  it('streamed chunks accumulate in the assistant bubble', async () => {
    const user = userEvent.setup();
    render(<Chatbot sendMessage={simpleBackend('Hello ', 'world', '!')} />);
    await user.type(screen.getByRole('textbox'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('Hello world!')).toBeInTheDocument();
  });

  it('shows typing indicator before first chunk arrives', async () => {
    const user = userEvent.setup();
    const { send } = stallingBackend();
    render(<Chatbot sendMessage={send} />);
    await user.type(screen.getByRole('textbox'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByLabelText(/typing/i)).toBeInTheDocument();
  });

  it('disables textarea while streaming', async () => {
    const user = userEvent.setup();
    const { send } = stallingBackend();
    render(<Chatbot sendMessage={send} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(textarea).toBeDisabled());
  });

  it('shows Stop button while streaming', async () => {
    const user = userEvent.setup();
    const { send } = stallingBackend();
    render(<Chatbot sendMessage={send} />);
    await user.type(screen.getByRole('textbox'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(
      await screen.findByRole('button', { name: /stop/i }),
    ).toBeInTheDocument();
  });

  it('Stop aborts the stream, preserves partial text, and re-enables input', async () => {
    const user = userEvent.setup();
    const { send, signalCaptured } = stallingBackend(['partial']);
    render(<Chatbot sendMessage={send} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('partial');
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(textarea).toBeEnabled());
    expect(signalCaptured()?.aborted).toBe(true);
    expect(screen.getByText('partial')).toBeInTheDocument();
  });

  it('Enter sends the message', async () => {
    const user = userEvent.setup();
    render(<Chatbot sendMessage={simpleBackend('ok')} />);
    await user.type(screen.getByRole('textbox'), 'hi{Enter}');
    expect(await screen.findByText('hi')).toBeInTheDocument();
  });

  it('Shift+Enter inserts a newline and does not submit', async () => {
    const user = userEvent.setup();
    render(<Chatbot sendMessage={simpleBackend('reply')} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, 'line1{Shift>}{Enter}{/Shift}line2');
    expect(textarea.value).toBe('line1\nline2');
    expect(screen.queryByText('reply')).not.toBeInTheDocument();
  });

  it('renders choice buttons after the stream completes', async () => {
    const user = userEvent.setup();
    render(
      <Chatbot
        sendMessage={simpleBackend('Pick one', {
          type: 'choices',
          options: ['Yes', 'No'],
        })}
      />,
    );
    await user.type(screen.getByRole('textbox'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('does not render choice buttons while streaming', async () => {
    const user = userEvent.setup();
    const { send } = stallingBackend([
      'Pick one',
      { type: 'choices', options: ['Yes', 'No'] },
    ]);
    render(<Chatbot sendMessage={send} />);
    await user.type(screen.getByRole('textbox'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Pick one');
    await screen.findByRole('button', { name: /stop/i });
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
  });

  it('clicking a choice submits it as the user message', async () => {
    const user = userEvent.setup();
    let turn = 0;
    const send: SendMessage = async function* () {
      turn++;
      if (turn === 1) {
        yield 'Pick';
        yield { type: 'choices', options: ['Yes', 'No'] };
      } else {
        yield 'ok';
      }
    };
    render(<Chatbot sendMessage={send} />);
    await user.type(screen.getByRole('textbox'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    // After turn 2 begins, turn 1's choices vanish (not last anymore) — so the
    // only "Yes" in the DOM is the user message.
    expect(await screen.findByText('Yes')).toBeInTheDocument();
    expect(await screen.findByText('ok')).toBeInTheDocument();
  });

  it("hides previous turn's choices once a new turn starts", async () => {
    const user = userEvent.setup();
    let turn = 0;
    const send: SendMessage = async function* () {
      turn++;
      if (turn === 1) {
        yield 'Pick';
        yield { type: 'choices', options: ['Yes', 'No'] };
      } else {
        yield 'thanks';
      }
    };
    render(<Chatbot sendMessage={send} />);
    await user.type(screen.getByRole('textbox'), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: 'Yes' });

    await user.type(screen.getByRole('textbox'), 'next');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('thanks');
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
  });
});
