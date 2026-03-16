import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";

export function createConvAgentFetchHandler(
  createConversation: CreateConversationFlow,
  getConversation: GetConversationFlow,
  listConversations: ListConversationsFlow,
  deleteConversation: DeleteConversationFlow,
): (req: Request) => Promise<Response> {
  return createConversationHttpHandler(
    createConversation,
    getConversation,
    listConversations,
    deleteConversation,
  );
}
