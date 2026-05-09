'use client';

import { useEffect, useState } from 'react';
import {
  Chatbot,
  type ChatbotDensity,
  type ChatMessage,
} from '@michitson/react-chat';
import { echoBackend } from './echoBackend';

const DENSITIES: ChatbotDensity[] = ['comfortable', 'compact', 'tight'];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Hi! What would you like to see?',
    choices: ['Tell me a joke', 'Show me markdown', 'Ask me something'],
  },
];

export default function ChatShell() {
  const [dark, setDark] = useState(false);
  const [density, setDensity] = useState<ChatbotDensity>('comfortable');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          @michitson/react-chat — Next.js demo
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 p-0.5 text-xs dark:border-slate-700 dark:bg-slate-800">
            {DENSITIES.map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={
                  density === d
                    ? 'rounded-md bg-white px-2 py-1 font-medium text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'rounded-md px-2 py-1 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }
              >
                {d}
              </button>
            ))}
          </div>
          <button
            onClick={() => setDark((d) => !d)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {dark ? 'Light' : 'Dark'} mode
          </button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="h-full w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <Chatbot
            sendMessage={echoBackend}
            placeholder="Say something…"
            density={density}
            initialMessages={INITIAL_MESSAGES}
          />
        </div>
      </div>
    </div>
  );
}
