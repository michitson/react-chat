'use client';

/**
 * Chatbot.tsx — self-contained streaming chat component.
 *
 * Runtime deps the consumer must install:
 *   react, react-dom, react-markdown, remark-gfm, rehype-highlight, highlight.js
 * Plus Tailwind CSS configured in the consumer project.
 *
 * For syntax-highlighted code blocks, the consumer must also import a
 * highlight.js theme once anywhere in their app, e.g.:
 *   import 'highlight.js/styles/github-dark.css';
 *
 * Streaming protocol: sendMessage returns AsyncIterable<ChatStreamChunk>.
 * Yield strings to append text. Yield { type: 'choices', options } to attach
 * clickable choice buttons to the assistant's current message — the buttons
 * appear once streaming ends and disappear as soon as the user replies.
 */

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  choices?: string[];
}

export type ChatStreamChunk =
  | string
  | { type: 'choices'; options: string[] };

export interface SendMessageOptions {
  signal: AbortSignal;
}

export type SendMessage = (
  messages: ChatMessage[],
  options: SendMessageOptions,
) => AsyncIterable<ChatStreamChunk>;

export interface ChatbotClassNames {
  container?: string;
  messageList?: string;
  userBubble?: string;
  assistantBubble?: string;
  input?: string;
  sendButton?: string;
  choiceButton?: string;
}

export type ChatbotDensity = 'comfortable' | 'compact' | 'tight';

export interface ChatbotProps {
  sendMessage: SendMessage;
  initialMessages?: ChatMessage[];
  placeholder?: string;
  density?: ChatbotDensity;
  className?: string;
  classNames?: ChatbotClassNames;
}

const DENSITY: Record<
  ChatbotDensity,
  { bubble: string; rowUser: string; rowAssistant: string; gap: string }
> = {
  comfortable: {
    bubble: 'max-w-[85%]',
    rowUser: 'justify-end',
    rowAssistant: 'justify-start',
    gap: 'gap-4',
  },
  compact: {
    bubble: 'max-w-[70%]',
    rowUser: 'justify-end pr-[8%]',
    rowAssistant: 'justify-start pl-[8%]',
    gap: 'gap-3',
  },
  tight: {
    bubble: 'max-w-[55%]',
    rowUser: 'justify-end pr-[18%]',
    rowAssistant: 'justify-start pl-[18%]',
    gap: 'gap-1.5',
  },
};

const cx = (...parts: Array<string | undefined | false>) =>
  parts.filter(Boolean).join(' ');

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const SCROLL_PIN_THRESHOLD_PX = 64;
const TEXTAREA_MAX_PX = 200;

export function Chatbot({
  sendMessage,
  initialMessages = [],
  placeholder = 'Type a message…',
  density = 'comfortable',
  className,
  classNames: cn = {},
}: ChatbotProps) {
  const densityStyles = DENSITY[density];
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userPinnedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!userPinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    userPinnedRef.current = distance < SCROLL_PIN_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [input]);

  const submit = useCallback(
    async (overrideText?: string) => {
      const trimmed = (overrideText ?? input).trim();
      if (!trimmed || isStreaming) return;

      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        content: trimmed,
      };
      const assistantMsg: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
      setIsStreaming(true);
      setStreamingId(assistantMsg.id);
      userPinnedRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = sendMessage([...messages, userMsg], {
          signal: controller.signal,
        });
        for await (const chunk of stream) {
          if (controller.signal.aborted) break;
          if (typeof chunk === 'string') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + chunk }
                  : m,
              ),
            );
          } else if (chunk.type === 'choices') {
            const opts = chunk.options;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, choices: opts } : m,
              ),
            );
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const text = err instanceof Error ? err.message : String(err);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: m.content + `\n\n_Error: ${text}_` }
                : m,
            ),
          );
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        setStreamingId(null);
      }
    },
    [input, isStreaming, messages, sendMessage],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      submit();
    },
    [submit],
  );

  const lastIndex = messages.length - 1;

  return (
    <div
      className={cx(
        'flex h-full w-full flex-col bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100',
        className,
        cn.container,
      )}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cx('flex-1 overflow-y-auto px-4 py-6', cn.messageList)}
      >
        <div className={cx('mx-auto flex max-w-3xl flex-col', densityStyles.gap)}>
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              isStreaming={m.id === streamingId}
              isLast={i === lastIndex}
              choicesActive={i === lastIndex && !isStreaming}
              density={densityStyles}
              onChoiceSelect={(choice) => submit(choice)}
              userClass={cn.userBubble}
              assistantClass={cn.assistantBubble}
              choiceClass={cn.choiceButton}
            />
          ))}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isStreaming}
            className={cx(
              'flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-slate-400 dark:focus:ring-slate-700',
              cn.input,
            )}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className={cx(
                'rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
                cn.sendButton,
              )}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={cx(
                'rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
                cn.sendButton,
              )}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
  choicesActive: boolean;
  density: { bubble: string; rowUser: string; rowAssistant: string; gap: string };
  onChoiceSelect: (choice: string) => void;
  userClass?: string;
  assistantClass?: string;
  choiceClass?: string;
}

const MARKDOWN_CLASSES = cx(
  'text-sm leading-relaxed',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold',
  '[&_h2]:my-3 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:my-2 [&_h3]:font-semibold',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_a]:underline [&_a]:underline-offset-2',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 dark:[&_blockquote]:border-slate-600 dark:[&_blockquote]:text-slate-300',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-slate-100 dark:[&_pre]:bg-slate-950',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-slate-200/70 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] dark:[&_:not(pre)>code]:bg-slate-700/70',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left dark:[&_th]:border-slate-600',
  '[&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 dark:[&_td]:border-slate-700',
);

function MessageBubble({
  message,
  isStreaming,
  isLast,
  choicesActive,
  density,
  onChoiceSelect,
  userClass,
  assistantClass,
  choiceClass,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const showTyping = !isUser && message.content === '' && isStreaming;
  const showChoices =
    !isUser &&
    isLast &&
    choicesActive &&
    !!message.choices &&
    message.choices.length > 0;

  const bubble = (
    <div
      className={cx(
        'rounded-2xl px-4 py-2.5 shadow-sm',
        isUser
          ? cx(
              'whitespace-pre-wrap bg-slate-900 text-sm leading-relaxed text-white dark:bg-slate-100 dark:text-slate-900',
              userClass,
            )
          : cx(
              'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
              assistantClass,
            ),
      )}
    >
      {showTyping ? (
        <TypingIndicator />
      ) : isUser ? (
        message.content
      ) : (
        <div className={MARKDOWN_CLASSES}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cx(
        'flex w-full',
        isUser ? density.rowUser : density.rowAssistant,
      )}
    >
      <div className={cx('flex flex-col gap-2', density.bubble)}>
        {bubble}
        {showChoices && (
          <div className="flex flex-wrap gap-1.5">
            {message.choices!.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => onChoiceSelect(choice)}
                className={cx(
                  'rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
                  choiceClass,
                )}
              >
                {choice}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
    </div>
  );
}
