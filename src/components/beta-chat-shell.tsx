import { ChatShell } from "@/components/chat-shell";
import type { ChatShellProps } from "@/components/chat/types";

export function BetaChatShell(props: ChatShellProps) {
  return <ChatShell {...props} experience="beta" />;
}
