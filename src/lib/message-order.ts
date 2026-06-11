import type { Prisma } from "../../generated/prisma/client";

export type MessagePosition = {
  createdAt: Date;
  id: string;
};

export const MESSAGE_ORDER_ASC = [
  { createdAt: "asc" },
  { id: "asc" }
] satisfies Prisma.MessageOrderByWithRelationInput[];

export const MESSAGE_ORDER_DESC = [
  { createdAt: "desc" },
  { id: "desc" }
] satisfies Prisma.MessageOrderByWithRelationInput[];

export function messagesAfter(message: MessagePosition): Prisma.MessageWhereInput {
  return {
    OR: [
      { createdAt: { gt: message.createdAt } },
      {
        createdAt: message.createdAt,
        id: { gt: message.id }
      }
    ]
  };
}

export function messagesBefore(message: MessagePosition): Prisma.MessageWhereInput {
  return {
    OR: [
      { createdAt: { lt: message.createdAt } },
      {
        createdAt: message.createdAt,
        id: { lt: message.id }
      }
    ]
  };
}

export function isMessageAfter(message: MessagePosition, cursor: MessagePosition) {
  const timeDiff = message.createdAt.getTime() - cursor.createdAt.getTime();

  if (timeDiff !== 0) {
    return timeDiff > 0;
  }

  return message.id > cursor.id;
}
