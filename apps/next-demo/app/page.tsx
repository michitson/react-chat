import ChatShell from './ChatShell';

// Server component on purpose — proves that ChatShell ('use client') and the
// transitively-imported Chatbot ('use client') form a clean RSC/CSR boundary.
export default function Page() {
  return <ChatShell />;
}
