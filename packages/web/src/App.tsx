import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileQuestionMark,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideoCamera,
  LogOut,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  SendHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";

type ConversationResponse = {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type ConversationListResponse = {
  readonly items: ReadonlyArray<ConversationResponse>;
  readonly pageNum: number;
  readonly pageSize: number;
};

type ChatFile = {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// Message IDs are transport identifiers. Keep UUIDs and decimal bigint IDs
// byte-for-byte intact; never parse them as JavaScript numbers.
type MessageId = string;

type ChatMessage = {
  readonly id: MessageId;
  readonly conversationId: string;
  readonly type: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly files: ReadonlyArray<ChatFile>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type MessagePageResponse = {
  readonly items: ReadonlyArray<ChatMessage>;
  readonly pageNum: number;
  readonly pageSize: number;
};

type CompletionResponse = {
  readonly messages: ReadonlyArray<{
    readonly type: ChatMessage["type"];
    readonly content: string;
  }>;
};

const THOTH_API_URL = import.meta.env.VITE_THOTH_API_URL?.trim() || "/api/v1";
const THOTH_PROFILE = import.meta.env.VITE_THOTH_PROFILE?.trim() || "local";
const MESSAGE_PAGE_SIZE = 50;
const CONVERSATION_PAGE_SIZE = 40;
const IMAGE_FILE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"]);
const CODE_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cjs",
  "cpp",
  "css",
  "go",
  "graphql",
  "gql",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "lua",
  "mjs",
  "mts",
  "php",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const TEXT_FILE_EXTENSIONS = new Set(["conf", "env", "ini", "log", "md", "rtf", "txt"]);
const SPREADSHEET_FILE_EXTENSIONS = new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsx"]);
const PRESENTATION_FILE_EXTENSIONS = new Set(["key", "odp", "ppt", "pptx"]);
const ARCHIVE_FILE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]);
const AUDIO_FILE_EXTENSIONS = new Set(["aac", "aiff", "flac", "m4a", "mp3", "ogg", "wav"]);
const VIDEO_FILE_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm"]);
const FONT_FILE_EXTENSIONS = new Set(["otf", "ttf", "woff", "woff2"]);

type AttachmentIconDescriptor = {
  readonly Icon: LucideIcon;
  readonly label: string;
  readonly color: string;
};

type AttachmentIconRule = {
  readonly matches: (mimeType: string, extension: string) => boolean;
  readonly descriptor: AttachmentIconDescriptor;
};

const ATTACHMENT_ICON_RULES: ReadonlyArray<AttachmentIconRule> = [
  {
    matches: (mimeType, extension) => mimeType.startsWith("image/") || IMAGE_FILE_EXTENSIONS.has(extension),
    descriptor: { Icon: FileImage, label: "Image file", color: "#8ee7c8" },
  },
  {
    matches: (mimeType, extension) => mimeType === "application/pdf" || extension === "pdf",
    descriptor: { Icon: FileText, label: "PDF file", color: "#ffb4a8" },
  },
  {
    matches: (mimeType, extension) => mimeType.startsWith("audio/") || AUDIO_FILE_EXTENSIONS.has(extension),
    descriptor: { Icon: FileMusic, label: "Audio file", color: "#f0abfc" },
  },
  {
    matches: (mimeType, extension) => mimeType.startsWith("video/") || VIDEO_FILE_EXTENSIONS.has(extension),
    descriptor: { Icon: FileVideoCamera, label: "Video file", color: "#fdba74" },
  },
  {
    matches: isSpreadsheetFile,
    descriptor: { Icon: FileSpreadsheet, label: "Spreadsheet file", color: "#67e8f9" },
  },
  {
    matches: isPresentationFile,
    descriptor: { Icon: Presentation, label: "Presentation file", color: "#fde68a" },
  },
  {
    matches: isArchiveFile,
    descriptor: { Icon: FileArchive, label: "Archive file", color: "#c4b5fd" },
  },
  {
    matches: isCodeFile,
    descriptor: { Icon: FileCode, label: "Code file", color: "#93c5fd" },
  },
  {
    matches: (mimeType, extension) => mimeType.startsWith("text/") || TEXT_FILE_EXTENSIONS.has(extension),
    descriptor: { Icon: FileText, label: "Text file", color: "#f8d7a4" },
  },
  {
    matches: (mimeType, extension) => mimeType.startsWith("font/") || FONT_FILE_EXTENSIONS.has(extension),
    descriptor: { Icon: FileType, label: "Font file", color: "#facc15" },
  },
];

const FORBIDDEN_PATH = "/forbidden";
const LOGIN_PATH = "/login";

export function App() {
  if (typeof window !== "undefined") {
    if (window.location.pathname === FORBIDDEN_PATH) {
      return <ForbiddenView />;
    }

    if (window.location.pathname === LOGIN_PATH) {
      return <LoginView />;
    }
  }

  return <ConversationApp />;
}

function ConversationApp() {
  const [conversations, setConversations] = useState<ReadonlyArray<ConversationResponse>>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>([]);
  const [draft, setDraft] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<ReadonlyArray<File>>([]);
  const [booting, setBooting] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState("");
  const [updatingTitle, setUpdatingTitle] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [titleError, setTitleError] = useState("");
  const [composerError, setComposerError] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const previousLastMessageIdRef = useRef<MessageId>("");
  const lastMessageId = messages[messages.length - 1]?.id ?? "";

  useEffect(() => {
    void initializeConversationView();
  }, []);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadMessages(conversationId, { quiet: true });
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [conversationId]);

  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    const lastMessageChanged = lastMessageId !== previousLastMessageIdRef.current;
    const isInitialMessageLoad = !previousLastMessageIdRef.current && Boolean(lastMessageId);
    const isNearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;

    if (booting || sending || isInitialMessageLoad || (lastMessageChanged && isNearBottom)) {
      scroller.scrollTop = scroller.scrollHeight;
    }

    previousLastMessageIdRef.current = lastMessageId;
  }, [lastMessageId, booting, sending]);

  async function initializeConversationView(): Promise<void> {
    setBooting(true);
    setError("");
    setComposerError("");

    try {
      const items = await loadConversations({ quiet: true });
      const firstConversation = items[0];

      if (firstConversation) {
        setConversationId(firstConversation.id);
        setDraft("");
        setSelectedFiles([]);
        await loadMessages(firstConversation.id, { quiet: true });
      } else {
        await createConversation();
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to connect to conv-agent.");
    } finally {
      setBooting(false);
    }
  }

  async function loadConversations(options?: { readonly quiet?: boolean }): Promise<ReadonlyArray<ConversationResponse>> {
    if (!options?.quiet) {
      setLoadingConversations(true);
    }

    try {
      const url = buildConvAgentRequestUrl("/conversations", {
        pageNum: "1",
        pageSize: String(CONVERSATION_PAGE_SIZE),
      });

      const response = await apiFetch(url);

      if (!response.ok) {
        throw new Error(`Conversation list failed with ${response.status}.`);
      }

      const page = (await response.json()) as ConversationListResponse;

      setConversations(page.items);
      return page.items;
    } finally {
      if (!options?.quiet) {
        setLoadingConversations(false);
      }
    }
  }

  async function createConversation(): Promise<void> {
    setBooting(true);
    setError("");
    setComposerError("");

    try {
      const response = await apiFetch(buildConvAgentRequestUrl("/conversations"), {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Conversation creation failed with ${response.status}.`);
      }

      const conversation = (await response.json()) as ConversationResponse;

      setConversationId(conversation.id);
      setMessages([]);
      setDraft("");
      setSelectedFiles([]);
      await loadConversations({ quiet: true });
      await loadMessages(conversation.id, { quiet: true });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to connect to conv-agent.");
    } finally {
      setBooting(false);
    }
  }

  async function loadMessages(id: string, options?: { readonly quiet?: boolean }): Promise<void> {
    if (!options?.quiet) {
      setRefreshing(true);
    }

    try {
      const url = buildConvAgentRequestUrl(`/conversations/${id}/chat`, {
        pageNum: "1",
        pageSize: String(MESSAGE_PAGE_SIZE),
      });

      const response = await apiFetch(url);

      if (!response.ok) {
        throw new Error(`Message fetch failed with ${response.status}.`);
      }

      const page = requireMessagePageResponse(await response.json());

      setMessages(page.items);
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load messages.");
    } finally {
      if (!options?.quiet) {
        setRefreshing(false);
      }
    }
  }

  async function selectConversation(id: string): Promise<void> {
    if (!id || id === conversationId) {
      return;
    }

    setConversationId(id);
    setMessages([]);
    setDraft("");
    setSelectedFiles([]);
    setComposerError("");
    setTitleError("");
    await loadMessages(id);
  }

  async function updateConversationTitle(id: string, title: string): Promise<boolean> {
    if (!id) {
      setTitleError("Select a conversation before updating the title.");
      return false;
    }

    setUpdatingTitle(true);
    setTitleError("");

    try {
      const response = await apiFetch(buildConvAgentRequestUrl(`/conversations/${id}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error(await readResponseErrorMessage(response, `Conversation title update failed with ${response.status}.`));
      }

      const updatedConversation = (await response.json()) as ConversationResponse;

      setConversations((currentConversations) => {
        let replaced = false;
        const nextConversations = currentConversations.map((conversation) => {
          if (conversation.id !== updatedConversation.id) {
            return conversation;
          }

          replaced = true;
          return updatedConversation;
        });

        return replaced ? nextConversations : [updatedConversation, ...currentConversations];
      });

      return true;
    } catch (caughtError) {
      setTitleError(caughtError instanceof Error ? caughtError.message : "Unable to update the conversation title.");
      return false;
    } finally {
      setUpdatingTitle(false);
    }
  }

  async function deleteConversation(id: string): Promise<void> {
    setDeletingConversationId(id);
    setError("");

    try {
      const response = await apiFetch(buildConvAgentRequestUrl(`/conversations/${id}`), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Conversation delete failed with ${response.status}.`);
      }

      const remainingConversations = conversations.filter((conversation) => conversation.id !== id);

      setConversations(remainingConversations);

      if (conversationId !== id) {
        return;
      }

      const nextConversation = remainingConversations[0];

      if (nextConversation) {
        setConversationId(nextConversation.id);
        setMessages([]);
        await loadMessages(nextConversation.id);
        return;
      }

      setConversationId("");
      setMessages([]);
      await createConversation();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to delete the conversation.");
    } finally {
      setDeletingConversationId("");
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedDraft = draft.trim();

    if (!conversationId) {
      setComposerError("Create a conversation before sending a message.");
      return;
    }

    if (!trimmedDraft && selectedFiles.length === 0) {
      setComposerError("Write something or attach a file first.");
      return;
    }

    setSending(true);
    setComposerError("");

    try {
      const formData = new FormData();

      formData.set("type", "user");
      formData.set("content", trimmedDraft);

      for (const file of selectedFiles) {
        formData.append("attachment", file);
      }

      const response = await apiFetch(buildConvAgentRequestUrl(`/conversations/${conversationId}/append-direct`), {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Message send failed with ${response.status}.`);
      }

      const appendedMessageId = requireMessageId((await response.json()) as unknown);

      setDraft("");
      setSelectedFiles([]);

      // The endpoint completes exactly the messages whose ids are sent, so
      // this client shapes the chat as the loaded history plus the message
      // that was just appended.
      const completionMessageIds = [...messages.map((message) => message.id), appendedMessageId];

      await requestAndAppendCompletion(conversationId, completionMessageIds);
      await loadConversations({ quiet: true });
      await loadMessages(conversationId, { quiet: true });
    } catch (caughtError) {
      setComposerError(caughtError instanceof Error ? caughtError.message : "Unable to send the message.");
    } finally {
      setSending(false);
    }
  }

  // Completions are side-effect free: the service runs the LLM over exactly
  // the messages whose ids are sent and returns the reply messages, which
  // this client appends explicitly, in order, at the end of the conversation.
  async function requestAndAppendCompletion(id: string, messageIds: ReadonlyArray<MessageId>): Promise<void> {
    const completionResponse = await apiFetch(buildConvAgentRequestUrl(`/conversations/${id}/request-completion`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageIds }),
    });

    if (!completionResponse.ok) {
      throw new Error(`Message was saved, but the completion request failed with ${completionResponse.status}.`);
    }

    const completion = (await completionResponse.json()) as CompletionResponse;

    for (const completionMessage of completion.messages) {
      const completionFormData = new FormData();

      completionFormData.set("type", completionMessage.type);
      completionFormData.set("content", completionMessage.content);

      const appendCompletionResponse = await apiFetch(buildConvAgentRequestUrl(`/conversations/${id}/append-direct`), {
        method: "POST",
        body: completionFormData,
      });

      if (!appendCompletionResponse.ok) {
        throw new Error(`Completion was generated, but appending it failed with ${appendCompletionResponse.status}.`);
      }
    }
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setSelectedFiles((currentFiles) => [...currentFiles, ...files]);
    event.target.value = "";
  }

  function removeSelectedFile(indexToRemove: number): void {
    setSelectedFiles((currentFiles) => currentFiles.filter((_, index) => index !== indexToRemove));
  }

  const activeConversation = conversations.find((conversation) => conversation.id === conversationId) ?? null;

  return (
    <div className="app-shell" style={shellStyle}>
      <style>{globalStyles}</style>
      <div className="chat-frame" style={frameStyle}>
        <ConversationSidebar
          conversations={conversations}
          activeConversation={activeConversation}
          conversationId={conversationId}
          booting={booting}
          sending={sending}
          refreshing={refreshing}
          loadingConversations={loadingConversations}
          deletingConversationId={deletingConversationId}
          error={error}
          onSelectConversation={selectConversation}
          onDeleteConversation={deleteConversation}
          onCreateConversation={createConversation}
          onRefresh={async () => {
            await loadConversations();

            if (conversationId) {
              await loadMessages(conversationId);
            }
          }}
          onLogout={logoutFromAccess}
        />

        <ChatPanel
          scrollerRef={scrollerRef}
          conversation={activeConversation}
          conversationId={conversationId}
          booting={booting}
          sending={sending}
          updatingTitle={updatingTitle}
          messages={messages}
          draft={draft}
          selectedFiles={selectedFiles}
          titleError={titleError}
          composerError={composerError}
          onUpdateConversationTitle={updateConversationTitle}
          onDraftChange={setDraft}
          onSendMessage={sendMessage}
          onFileSelection={handleFileSelection}
          onRemoveSelectedFile={removeSelectedFile}
        />
      </div>
    </div>
  );
}

function ForbiddenView() {
  return (
    <div className="app-shell" style={shellStyle}>
      <style>{globalStyles}</style>
      <div style={forbiddenFrameStyle}>
        <div style={forbiddenCardStyle}>
          <p style={eyebrowStyle}>Thoth</p>
          <h1 style={titleStyle}>Access denied</h1>
          <p style={bodyStyle}>Your account does not have access to this app. If you signed in with the wrong Google account, sign out and try again.</p>
          <button
            type="button"
            onClick={() => {
              logoutFromAccess();
            }}
            style={{ ...ghostButtonStyle, marginTop: "20px", maxWidth: "240px" }}
          >
            <LogOut size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginView() {
  return (
    <div className="app-shell" style={shellStyle}>
      <style>{globalStyles}</style>
      <div style={forbiddenFrameStyle}>
        <div style={forbiddenCardStyle}>
          <p style={eyebrowStyle}>Thoth</p>
          <h1 style={titleStyle}>Sign in</h1>
          <p style={bodyStyle}>You have been signed out. Sign in with Google to continue.</p>
          <button
            type="button"
            onClick={() => {
              startLoginFromLandingPage();
            }}
            style={{ ...ghostButtonStyle, marginTop: "20px", maxWidth: "240px" }}
          >
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}

function ConversationSidebar(props: {
  readonly conversations: ReadonlyArray<ConversationResponse>;
  readonly activeConversation: ConversationResponse | null;
  readonly conversationId: string;
  readonly booting: boolean;
  readonly sending: boolean;
  readonly refreshing: boolean;
  readonly loadingConversations: boolean;
  readonly deletingConversationId: string;
  readonly error: string;
  readonly onSelectConversation: (conversationId: string) => Promise<void>;
  readonly onDeleteConversation: (conversationId: string) => Promise<void>;
  readonly onCreateConversation: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onLogout: () => void;
}) {
  return (
    <aside className="conversation-sidebar" style={sidebarStyle}>
      <div style={brandLockupStyle}>
        <span style={brandMarkStyle} aria-hidden="true">
          <MessageSquare size={17} strokeWidth={2.1} />
        </span>
        <div>
          <p style={eyebrowStyle}>Thoth</p>
          <h1 style={titleStyle}>Workspace</h1>
          <p style={bodyStyle}>Conversation console</p>
        </div>
      </div>

      <div style={statusPanelStyle}>
        <StatusRow label="Endpoint" value={THOTH_API_URL} mono />
        <StatusRow label="Profile" value={THOTH_PROFILE} />
        <StatusRow label="Conversation" value={props.activeConversation ? formatConversationTitle(props.activeConversation.title) : "Starting..."} />
        <StatusRow label="Conversation ID" value={props.conversationId || "Starting..."} mono />
        <StatusRow label="State" value={formatUiState(props.booting, props.sending, props.refreshing)} />
      </div>

      <ConversationListSection
        conversations={props.conversations}
        conversationId={props.conversationId}
        loadingConversations={props.loadingConversations}
        deletingConversationId={props.deletingConversationId}
        onSelectConversation={props.onSelectConversation}
        onDeleteConversation={props.onDeleteConversation}
      />

      <div className="sidebar-actions" style={sidebarActionsStyle}>
        <button
          type="button"
          onClick={() => {
            void props.onCreateConversation();
          }}
          style={primarySidebarButtonStyle}
        >
          <Plus aria-hidden="true" size={15} strokeWidth={2.3} />
          New Conversation
        </button>
        <button
          type="button"
          onClick={() => {
            void props.onRefresh();
          }}
          disabled={(!props.conversationId || props.refreshing) && !props.loadingConversations}
          style={ghostButtonStyle}
        >
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.1} />
          Refresh
        </button>
        <button type="button" onClick={props.onLogout} style={dangerButtonStyle}>
          <LogOut aria-hidden="true" size={14} strokeWidth={2.2} />
          Logout
        </button>
      </div>

      {props.error ? <p style={errorCardStyle}>{props.error}</p> : null}
    </aside>
  );
}

function ConversationListSection(props: {
  readonly conversations: ReadonlyArray<ConversationResponse>;
  readonly conversationId: string;
  readonly loadingConversations: boolean;
  readonly deletingConversationId: string;
  readonly onSelectConversation: (conversationId: string) => Promise<void>;
  readonly onDeleteConversation: (conversationId: string) => Promise<void>;
}) {
  return (
    <section style={conversationSectionStyle}>
      <div style={conversationSectionHeaderStyle}>
        <p style={sectionEyebrowStyle}>Threads</p>
        <span style={sectionMetaStyle}>{props.loadingConversations ? "Loading..." : `${props.conversations.length} total`}</span>
      </div>

      <div className="conversation-list" style={conversationListStyle}>
        {props.conversations.length === 0 ? (
          <p style={conversationEmptyStyle}>No saved conversations yet.</p>
        ) : (
          props.conversations.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === props.conversationId}
              isDeleting={props.deletingConversationId === conversation.id}
              onSelect={props.onSelectConversation}
              onDelete={props.onDeleteConversation}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ConversationListItem(props: {
  readonly conversation: ConversationResponse;
  readonly isActive: boolean;
  readonly isDeleting: boolean;
  readonly onSelect: (conversationId: string) => Promise<void>;
  readonly onDelete: (conversationId: string) => Promise<void>;
}) {
  return (
    <div style={props.isActive ? activeConversationButtonStyle : conversationButtonStyle}>
      <button
        type="button"
        onClick={() => {
          void props.onSelect(props.conversation.id);
        }}
        style={conversationSelectButtonStyle}
      >
        <span style={conversationButtonTitleStyle}>{formatConversationTitle(props.conversation.title)}</span>
        <span style={conversationButtonMetaStyle}>{formatTimestamp(props.conversation.updatedAt)}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          void props.onDelete(props.conversation.id);
        }}
        disabled={props.isDeleting}
        aria-label={`Delete conversation ${formatConversationTitle(props.conversation.title)}`}
        style={deleteConversationButtonStyle}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function ChatPanel(props: {
  readonly scrollerRef: React.RefObject<HTMLDivElement | null>;
  readonly conversation: ConversationResponse | null;
  readonly conversationId: string;
  readonly booting: boolean;
  readonly sending: boolean;
  readonly updatingTitle: boolean;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly draft: string;
  readonly selectedFiles: ReadonlyArray<File>;
  readonly titleError: string;
  readonly composerError: string;
  readonly onUpdateConversationTitle: (conversationId: string, title: string) => Promise<boolean>;
  readonly onDraftChange: (draft: string) => void;
  readonly onSendMessage: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onFileSelection: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onRemoveSelectedFile: (index: number) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(props.conversation?.title ?? "");
  }, [props.conversation?.id]);

  useEffect(() => {
    if (!editingTitle) {
      setTitleDraft(props.conversation?.title ?? "");
    }
  }, [editingTitle, props.conversation?.title]);

  async function submitTitleUpdate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!props.conversation) {
      return;
    }

    const updated = await props.onUpdateConversationTitle(props.conversation.id, titleDraft);

    if (updated) {
      setEditingTitle(false);
    }
  }

  function cancelTitleUpdate(): void {
    setTitleDraft(props.conversation?.title ?? "");
    setEditingTitle(false);
  }

  return (
    <main className="chat-panel" style={chatPanelStyle}>
      <header className="chat-header" style={chatHeaderStyle}>
        <div style={chatHeaderTextStyle}>
          <p style={chatHeaderEyebrowStyle}>Current Conversation</p>
          {editingTitle ? (
            <form className="title-edit-form" onSubmit={(event) => void submitTitleUpdate(event)} style={titleEditFormStyle}>
              <input
                aria-label="Conversation title"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={props.updatingTitle}
                placeholder="No Title"
                style={titleEditInputStyle}
              />
              <button type="submit" disabled={props.updatingTitle} aria-label="Save conversation title" title="Save title" style={titleIconButtonStyle}>
                <Check size={16} strokeWidth={2} />
              </button>
              <button type="button" disabled={props.updatingTitle} onClick={cancelTitleUpdate} aria-label="Cancel title edit" title="Cancel" style={titleIconButtonStyle}>
                <X size={16} strokeWidth={2} />
              </button>
            </form>
          ) : (
            <div style={chatHeaderTitleRowStyle}>
              <h2 style={chatHeaderTitleStyle}>{props.conversation ? formatConversationTitle(props.conversation.title) : "No Title"}</h2>
              <button
                type="button"
                disabled={!props.conversation || props.booting}
                onClick={() => {
                  setTitleDraft(props.conversation?.title ?? "");
                  setEditingTitle(true);
                }}
                aria-label="Edit conversation title"
                title="Edit title"
                style={titleIconButtonStyle}
              >
                <Pencil size={16} strokeWidth={1.9} />
              </button>
            </div>
          )}
          {props.titleError ? <p style={titleErrorStyle}>{props.titleError}</p> : null}
        </div>
        <span style={chatHeaderMetaStyle}>{props.conversationId ? formatConversationLabel(props.conversationId) : "Starting..."}</span>
      </header>
      <MessageList scrollerRef={props.scrollerRef} booting={props.booting} messages={props.messages} />
      <Composer
        booting={props.booting}
        sending={props.sending}
        draft={props.draft}
        selectedFiles={props.selectedFiles}
        composerError={props.composerError}
        onDraftChange={props.onDraftChange}
        onSendMessage={props.onSendMessage}
        onFileSelection={props.onFileSelection}
        onRemoveSelectedFile={props.onRemoveSelectedFile}
      />
    </main>
  );
}

function MessageList(props: { readonly scrollerRef: React.RefObject<HTMLDivElement | null>; readonly booting: boolean; readonly messages: ReadonlyArray<ChatMessage> }) {
  return (
    <div className="message-list" ref={props.scrollerRef} style={messageListStyle}>
      {props.booting ? (
        <EmptyState title="Starting conversation" body="The UI is creating a fresh conversation and waiting for the service." />
      ) : props.messages.length === 0 ? (
        <EmptyState title="No messages yet" body="Send the first prompt to start the thread." />
      ) : (
        props.messages.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
    </div>
  );
}

function MessageBubble(props: { readonly message: ChatMessage }) {
  const isUserMessage = props.message.type === "user";

  return (
    <article style={isUserMessage ? userBubbleWrapStyle : assistantBubbleWrapStyle}>
      <div style={isUserMessage ? userBubbleStyle : assistantBubbleStyle}>
        <div style={bubbleMetaStyle}>
          <div style={bubbleMetaLeftStyle}>
            <span>{isUserMessage ? "You" : "Assistant"}</span>
            <span style={bubbleTimestampStyle}>{formatMessageTimestamp(props.message.createdAt)}</span>
          </div>
        </div>
        {props.message.content ? <p style={messageTextStyle}>{props.message.content}</p> : null}
        {props.message.files.length > 0 ? (
          <div style={fileListStyle}>
            <p style={attachmentLabelStyle}>Attachments</p>
            {props.message.files.map((file) => (
              <FileAttachmentView key={file.id} file={file} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Composer(props: {
  readonly booting: boolean;
  readonly sending: boolean;
  readonly draft: string;
  readonly selectedFiles: ReadonlyArray<File>;
  readonly composerError: string;
  readonly onDraftChange: (draft: string) => void;
  readonly onSendMessage: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  readonly onFileSelection: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly onRemoveSelectedFile: (index: number) => void;
}) {
  return (
    <form className="composer" onSubmit={(event) => void props.onSendMessage(event)} style={composerStyle}>
      <label htmlFor="chat-input" style={composerLabelStyle}>
        Message
      </label>
      <div style={attachmentToolbarStyle}>
        <label style={attachmentPickerStyle}>
          <input type="file" multiple onChange={props.onFileSelection} disabled={props.booting || props.sending} style={visuallyHiddenInputStyle} />
          <Paperclip aria-hidden="true" size={14} strokeWidth={2.1} />
          Attach Files
        </label>
        {props.selectedFiles.length > 0 ? (
          <span style={attachmentSummaryStyle}>
            {props.selectedFiles.length} file
            {props.selectedFiles.length === 1 ? "" : "s"} selected
          </span>
        ) : null}
      </div>
      <SelectedFileList selectedFiles={props.selectedFiles} onRemoveSelectedFile={props.onRemoveSelectedFile} />
      <div className="composer-row" style={composerRowStyle}>
        <textarea
          id="chat-input"
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          placeholder="Ask Thoth something practical."
          rows={2}
          disabled={props.booting || props.sending}
          style={composerInputStyle}
        />
        <button type="submit" disabled={props.booting || props.sending} style={primaryButtonStyle}>
          <SendHorizontal aria-hidden="true" size={15} strokeWidth={2.2} />
          {props.sending ? "Sending" : "Send"}
        </button>
      </div>
      {props.composerError ? <p style={composerErrorStyle}>{props.composerError}</p> : null}
    </form>
  );
}

function SelectedFileList(props: { readonly selectedFiles: ReadonlyArray<File>; readonly onRemoveSelectedFile: (index: number) => void }) {
  if (props.selectedFiles.length === 0) {
    return null;
  }

  return (
    <div style={selectedFileListStyle}>
      {props.selectedFiles.map((file, index) => {
        const icon = resolveAttachmentIcon({ filename: file.name, mimeType: file.type });
        const Icon = icon.Icon;

        return (
          <div key={`${file.name}-${file.size}-${index}`} style={selectedFileChipStyle}>
            <span style={{ ...selectedFileIconWrapStyle, color: icon.color }} title={icon.label} aria-hidden="true">
              <Icon size={18} strokeWidth={1.9} />
            </span>
            <div style={selectedFileMetaStyle}>
              <span style={selectedFileNameStyle}>{file.name}</span>
              <span style={selectedFileSizeStyle}>{formatFileSize(file.size)}</span>
            </div>
            <button type="button" onClick={() => props.onRemoveSelectedFile(index)} style={selectedFileRemoveStyle} aria-label={`Remove ${file.name}`}>
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StatusRow(props: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <div style={statusRowStyle}>
      <span style={statusLabelStyle}>{props.label}</span>
      <span style={props.mono ? statusValueMonoStyle : statusValueStyle}>{props.value}</span>
    </div>
  );
}

function EmptyState(props: { readonly title: string; readonly body: string }) {
  return (
    <div style={emptyStateStyle}>
      <h2 style={emptyTitleStyle}>{props.title}</h2>
      <p style={emptyBodyStyle}>{props.body}</p>
    </div>
  );
}

function FileAttachmentView(props: { readonly file: ChatFile }) {
  const file = props.file;
  const icon = resolveAttachmentIcon({ filename: file.filename, mimeType: file.mimeType });
  const Icon = icon.Icon;

  return (
    <div style={fileChipStyle}>
      <span style={{ ...fileIconWrapStyle, color: icon.color }} title={icon.label} aria-hidden="true">
        <Icon size={16} strokeWidth={1.9} />
      </span>
      <span style={fileNameStyle}>{file.filename}</span>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M9 4h6" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function resolveAttachmentIcon(file: { readonly filename: string; readonly mimeType: string }): AttachmentIconDescriptor {
  const mimeType = normalizeMimeType(file.mimeType);
  const extension = getFileExtension(file.filename);
  const rule = ATTACHMENT_ICON_RULES.find((candidate) => candidate.matches(mimeType, extension));

  if (rule) {
    return rule.descriptor;
  }

  return { Icon: FileQuestionMark, label: "File", color: "rgba(255, 248, 240, 0.78)" };
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function getFileExtension(filename: string): string {
  const normalizedFilename = filename.trim().toLowerCase();
  const extensionStart = normalizedFilename.lastIndexOf(".");

  if (extensionStart <= 0 || extensionStart === normalizedFilename.length - 1) {
    return "";
  }

  return normalizedFilename.slice(extensionStart + 1);
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, { ...init, credentials: "include" });

    if (response.status === 403) {
      navigateTo("/forbidden");
      throw new Error("Not authorized.");
    }

    if (response.status === 401) {
      navigateTo("/login");
      throw new Error("Not authenticated. Redirecting to sign in.");
    }

    return response;
  } catch (error) {
    // A fetch TypeError here usually means CF Access challenged an XHR and the
    // cross-origin redirect to the team domain was blocked by CORS. Bounce
    // through /login so the user re-authenticates at the edge.
    if (error instanceof TypeError) {
      navigateTo("/login");
      throw new Error("Session expired. Redirecting to sign in.", { cause: error });
    }

    throw error;
  }
}

function navigateTo(path: string): void {
  if (window.location.pathname !== path) {
    window.location.href = path;
  }
}

function logoutFromAccess(): void {
  window.location.href = new URL(buildConvAgentRequestUrl("/auth/logout"), window.location.origin).toString();
}

function startLoginFromLandingPage(): void {
  window.location.href = "/";
}

function buildConvAgentRequestUrl(path: string, searchParams?: Readonly<Record<string, string>>): string {
  const base = THOTH_API_URL.endsWith("/") ? THOTH_API_URL.slice(0, -1) : THOTH_API_URL;
  const isAbsoluteBase = /^https?:\/\//i.test(base);
  const url = new URL(`${base}${path}`, window.location.origin);

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  if (isAbsoluteBase) {
    return url.toString();
  }

  return `${url.pathname}${url.search}`;
}

async function readResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.clone().json()) as unknown;
    const message = extractResponseErrorMessage(body);

    if (message) {
      return message;
    }
  } catch {
    // Fall through to the transport-level fallback.
  }

  return fallback;
}

function extractResponseErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }

  const error = body.error;

  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function requireMessageId(value: unknown): MessageId {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Message response did not contain a valid message id.");
  }

  return value.id;
}

function requireMessagePageResponse(value: unknown): MessagePageResponse {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every((item) => isRecord(item) && typeof item.id === "string" && item.id.length > 0)) {
    throw new Error("Message page response contained an invalid message id.");
  }

  return value as unknown as MessagePageResponse;
}

function isSpreadsheetFile(mimeType: string, extension: string): boolean {
  return SPREADSHEET_FILE_EXTENSIONS.has(extension) || mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv";
}

function isPresentationFile(mimeType: string, extension: string): boolean {
  return PRESENTATION_FILE_EXTENSIONS.has(extension) || mimeType.includes("presentation") || mimeType.includes("powerpoint");
}

function isArchiveFile(mimeType: string, extension: string): boolean {
  return ARCHIVE_FILE_EXTENSIONS.has(extension) || mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("compressed") || mimeType.includes("archive");
}

function isCodeFile(mimeType: string, extension: string): boolean {
  return (
    CODE_FILE_EXTENSIONS.has(extension) ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    mimeType.includes("toml") ||
    mimeType.includes("javascript")
  );
}

function formatConversationTitle(title: string | null): string {
  const normalizedTitle = title?.trim();

  return normalizedTitle ? normalizedTitle : "No Title";
}

function formatConversationLabel(id: string): string {
  if (id.length <= 16) {
    return id;
  }

  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMessageTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }

  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} +00:00 UTC`;
}

function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUiState(booting: boolean, sending: boolean, refreshing: boolean): string {
  if (booting) {
    return "Booting";
  }

  if (sending) {
    return "Sending";
  }

  if (refreshing) {
    return "Syncing";
  }

  return "Ready";
}

const globalStyles = `
  :root {
    color: #f4f7ff;
    background: #080b12;
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    font-synthesis: none;
  }

  * {
    box-sizing: border-box;
    scrollbar-width: thin;
    scrollbar-color: #34415c transparent;
  }

  html,
  body {
    margin: 0;
    min-width: 320px;
    min-height: 100%;
    background:
      radial-gradient(circle at 78% -20%, rgba(91, 92, 246, 0.13), transparent 38%),
      #080b12;
  }

  body {
    height: 100dvh;
    overflow: hidden;
  }

  #root {
    height: 100%;
  }

  .chat-frame {
    grid-template-columns: 272px minmax(0, 1fr);
  }

  .composer-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  button,
  label {
    -webkit-tap-highlight-color: transparent;
  }

  button {
    transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease;
  }

  button:hover:not(:disabled) {
    border-color: #475775 !important;
  }

  button:active:not(:disabled) {
    transform: translateY(1px);
  }

  button:disabled,
  textarea:disabled,
  input:disabled {
    cursor: not-allowed !important;
    opacity: 0.52;
  }

  input:focus,
  textarea:focus {
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
  }

  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  *::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 8px;
    background: #34415c;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  @media (max-width: 760px) {
    body {
      height: auto;
      overflow: auto;
    }

    #root {
      height: auto;
    }

    .app-shell {
      min-height: 100dvh !important;
      padding: 0 !important;
    }

    .chat-frame {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(280px, 42dvh) minmax(480px, 58dvh);
      gap: 0 !important;
      min-height: 100dvh !important;
      height: auto !important;
    }

    .conversation-sidebar,
    .chat-panel {
      border-radius: 0 !important;
    }

    .conversation-sidebar {
      position: relative !important;
      top: 0 !important;
      border-width: 0 0 1px !important;
    }

    .chat-panel {
      border-width: 0 !important;
    }

    .chat-header {
      padding-inline: 16px !important;
    }

    .message-list {
      padding: 16px !important;
    }

    .composer {
      padding-inline: 12px !important;
    }
  }

  @media (max-width: 520px) {
    body {
      min-width: 0;
    }

    .composer-row {
      grid-template-columns: 1fr;
    }

    .sidebar-actions {
      grid-template-columns: 1fr !important;
    }
  }

  code {
    font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
  }

  a {
    color: inherit;
  }
`;

const shellStyle: React.CSSProperties = {
  height: "100dvh",
  padding: "12px",
};

const frameStyle: React.CSSProperties = {
  display: "grid",
  gap: "12px",
  height: "100%",
  minHeight: 0,
};

const forbiddenFrameStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100%",
};

const forbiddenCardStyle: React.CSSProperties = {
  maxWidth: "480px",
  padding: "32px",
  borderRadius: "10px",
  background: "#0f1420",
  border: "1px solid #253047",
  boxShadow: "0 18px 60px rgba(0, 0, 0, 0.34)",
  textAlign: "center",
};

const sidebarStyle: React.CSSProperties = {
  position: "sticky",
  top: "12px",
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto auto",
  gap: "14px",
  height: "100%",
  minHeight: 0,
  padding: "16px",
  overflow: "hidden",
  borderRadius: "10px",
  background: "linear-gradient(180deg, #111725 0%, #0d121c 100%)",
  border: "1px solid #253047",
  boxShadow: "0 16px 42px rgba(0, 0, 0, 0.28)",
};

const brandLockupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "11px",
  minWidth: 0,
};

const brandMarkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "34px",
  height: "34px",
  flexShrink: 0,
  borderRadius: "8px",
  color: "#7dd3fc",
  background: "linear-gradient(145deg, rgba(56, 189, 248, 0.18), rgba(139, 92, 246, 0.2))",
  border: "1px solid rgba(125, 211, 252, 0.28)",
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: "#7dd3fc",
  fontSize: "0.68rem",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  margin: "2px 0 1px",
  fontSize: "1.08rem",
  lineHeight: 1.2,
  fontWeight: 650,
  letterSpacing: "-0.01em",
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  color: "#8996ad",
  fontSize: "0.76rem",
  lineHeight: 1.35,
};

const statusPanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "9px 12px",
  padding: "11px 12px",
  borderRadius: "8px",
  background: "#0b1019",
  border: "1px solid #202a3d",
};

const statusRowStyle: React.CSSProperties = {
  display: "grid",
  gap: "2px",
  minWidth: 0,
};

const statusLabelStyle: React.CSSProperties = {
  fontSize: "0.61rem",
  color: "#718097",
  fontWeight: 650,
  textTransform: "uppercase",
  letterSpacing: "0.11em",
};

const statusValueStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  color: "#d9e1ef",
  fontSize: "0.73rem",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const statusValueMonoStyle: React.CSSProperties = {
  ...statusValueStyle,
  fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: "0.68rem",
};

const conversationSectionStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: "8px",
  minHeight: 0,
};

const conversationSectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "12px",
};

const sectionEyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.67rem",
  color: "#a8b4c7",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const sectionMetaStyle: React.CSSProperties = {
  color: "#718097",
  fontSize: "0.7rem",
};

const conversationListStyle: React.CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "6px",
  minHeight: 0,
  overflowY: "auto",
  paddingRight: "3px",
};

const conversationButtonBaseStyle: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "6px",
  alignItems: "center",
  minHeight: "48px",
  padding: "7px 7px 7px 10px",
  borderRadius: "7px",
};

const conversationButtonStyle: React.CSSProperties = {
  ...conversationButtonBaseStyle,
  border: "1px solid transparent",
  background: "transparent",
  color: "#d5deec",
};

const activeConversationButtonStyle: React.CSSProperties = {
  ...conversationButtonBaseStyle,
  border: "1px solid rgba(125, 211, 252, 0.3)",
  background: "linear-gradient(90deg, rgba(56, 189, 248, 0.14), rgba(139, 92, 246, 0.1))",
  color: "#f4f7ff",
  boxShadow: "inset 2px 0 0 #38bdf8",
};

const conversationSelectButtonStyle: React.CSSProperties = {
  display: "grid",
  gap: "3px",
  textAlign: "left",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

const deleteConversationButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "29px",
  height: "29px",
  borderRadius: "6px",
  border: "1px solid transparent",
  background: "transparent",
  color: "#718097",
  cursor: "pointer",
};

const conversationButtonTitleStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 560,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const conversationButtonMetaStyle: React.CSSProperties = {
  color: "#718097",
  fontSize: "0.67rem",
};

const conversationEmptyStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px",
  borderRadius: "7px",
  background: "#0b1019",
  color: "#718097",
  fontSize: "0.76rem",
};

const sidebarActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "6px",
};

const ghostButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "34px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "7px 9px",
  borderRadius: "6px",
  border: "1px solid #2a354b",
  background: "#121926",
  color: "#b9c5d8",
  fontSize: "0.72rem",
  fontWeight: 600,
  cursor: "pointer",
};

const primarySidebarButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  gridColumn: "1 / -1",
  background: "linear-gradient(135deg, #2563eb, #4f46e5)",
  border: "1px solid #5f76ed",
  color: "#ffffff",
};

const dangerButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(248, 113, 113, 0.24)",
  background: "rgba(127, 29, 29, 0.14)",
  color: "#fca5a5",
};

const errorCardStyle: React.CSSProperties = {
  margin: 0,
  padding: "9px 10px",
  borderRadius: "7px",
  background: "rgba(127, 29, 29, 0.16)",
  border: "1px solid rgba(248, 113, 113, 0.24)",
  color: "#fca5a5",
  fontSize: "0.72rem",
  lineHeight: 1.4,
};

const chatPanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  minWidth: 0,
  minHeight: 0,
  borderRadius: "10px",
  overflow: "hidden",
  background: "#0b1019",
  border: "1px solid #253047",
  boxShadow: "0 18px 52px rgba(0, 0, 0, 0.3)",
};

const chatHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "12px",
  minHeight: "64px",
  padding: "11px 18px",
  borderBottom: "1px solid #253047",
  background: "#101622",
};

const chatHeaderTextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "2px",
};

const chatHeaderEyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: "#7dd3fc",
  fontSize: "0.62rem",
  fontWeight: 700,
  letterSpacing: "0.11em",
  textTransform: "uppercase",
};

const chatHeaderTitleStyle: React.CSSProperties = {
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "1rem",
  fontWeight: 630,
  lineHeight: 1.2,
};

const chatHeaderTitleRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, auto) auto",
  justifyContent: "start",
  alignItems: "center",
  gap: "7px",
  minWidth: 0,
};

const titleEditFormStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 420px) auto auto",
  alignItems: "center",
  gap: "6px",
  maxWidth: "min(100%, 560px)",
};

const titleEditInputStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  padding: "7px 9px",
  borderRadius: "6px",
  border: "1px solid #34415c",
  background: "#0b1019",
  color: "#f4f7ff",
  outline: "none",
};

const titleIconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "6px",
  border: "1px solid #2a354b",
  background: "#151d2b",
  color: "#9fb0c8",
  cursor: "pointer",
};

const titleErrorStyle: React.CSSProperties = {
  margin: 0,
  color: "#fca5a5",
  fontSize: "0.72rem",
  lineHeight: 1.4,
};

const chatHeaderMetaStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "4px 7px",
  borderRadius: "5px",
  background: "#0b1019",
  border: "1px solid #202a3d",
  color: "#718097",
  fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: "0.65rem",
};

const messageListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  padding: "18px 22px",
  display: "grid",
  alignContent: "start",
  gap: "10px",
  background: "linear-gradient(180deg, #0b1019 0%, #0a0f17 100%)",
};

const userBubbleWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const assistantBubbleWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-start",
};

const bubbleBaseStyle: React.CSSProperties = {
  maxWidth: "min(820px, 82%)",
  padding: "11px 13px",
  borderRadius: "9px",
  boxShadow: "0 7px 18px rgba(0, 0, 0, 0.16)",
};

const userBubbleStyle: React.CSSProperties = {
  ...bubbleBaseStyle,
  background: "linear-gradient(135deg, #263758, #2b315c)",
  color: "#f4f7ff",
  border: "1px solid #405477",
  borderBottomRightRadius: "3px",
};

const assistantBubbleStyle: React.CSSProperties = {
  ...bubbleBaseStyle,
  background: "#131a27",
  color: "#e6ebf5",
  border: "1px solid #263249",
  borderBottomLeftRadius: "3px",
};

const bubbleMetaStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "6px",
  color: "#8fa0b8",
  fontSize: "0.62rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
};

const bubbleMetaLeftStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "baseline",
  flexWrap: "wrap",
};

const bubbleTimestampStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.02em",
  textTransform: "none",
  color: "#718097",
};

const messageTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.82rem",
  lineHeight: 1.52,
  whiteSpace: "pre-wrap",
};

const fileListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  marginTop: "9px",
};

const attachmentLabelStyle: React.CSSProperties = {
  width: "100%",
  margin: "0 0 2px",
  color: "#8fa0b8",
  fontSize: "0.62rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  opacity: 0.74,
};

const fileChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 8px",
  borderRadius: "6px",
  background: "rgba(125, 211, 252, 0.08)",
  border: "1px solid rgba(125, 211, 252, 0.16)",
  maxWidth: "100%",
};

const fileIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#a8b4c7",
  flexShrink: 0,
};

const fileNameStyle: React.CSSProperties = {
  fontSize: "0.73rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const composerStyle: React.CSSProperties = {
  borderTop: "1px solid #253047",
  padding: "10px 14px 12px",
  background: "#101622",
};

const attachmentToolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "8px",
  marginBottom: "7px",
};

const attachmentPickerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid #2a354b",
  background: "#151d2b",
  color: "#a8b4c7",
  fontSize: "0.7rem",
  fontWeight: 600,
  cursor: "pointer",
};

const attachmentSummaryStyle: React.CSSProperties = {
  color: "#718097",
  fontSize: "0.68rem",
};

const visuallyHiddenInputStyle: React.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const selectedFileListStyle: React.CSSProperties = {
  display: "grid",
  gap: "6px",
  marginBottom: "8px",
};

const selectedFileChipStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  gap: "8px",
  alignItems: "center",
  padding: "7px 8px",
  borderRadius: "6px",
  background: "#151d2b",
  border: "1px solid #2a354b",
};

const selectedFileIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "5px",
  background: "#0b1019",
  flexShrink: 0,
};

const selectedFileMetaStyle: React.CSSProperties = {
  display: "grid",
  gap: "2px",
  minWidth: 0,
};

const selectedFileNameStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const selectedFileSizeStyle: React.CSSProperties = {
  color: "#718097",
  fontSize: "0.67rem",
};

const selectedFileRemoveStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "5px",
  border: "1px solid #2a354b",
  background: "#0b1019",
  color: "#8fa0b8",
  cursor: "pointer",
};

const composerLabelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontSize: "0.64rem",
  color: "#8fa0b8",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const composerRowStyle: React.CSSProperties = {
  display: "grid",
  gap: "8px",
  alignItems: "end",
};

const composerInputStyle: React.CSSProperties = {
  width: "100%",
  resize: "none",
  minHeight: "54px",
  maxHeight: "132px",
  padding: "10px 11px",
  borderRadius: "7px",
  border: "1px solid #2a354b",
  background: "#0b1019",
  color: "#f4f7ff",
  fontSize: "0.8rem",
  lineHeight: 1.45,
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  minWidth: "84px",
  minHeight: "54px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "10px 14px",
  borderRadius: "7px",
  border: "1px solid #5f76ed",
  background: "linear-gradient(135deg, #2563eb, #4f46e5)",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontWeight: 650,
};

const composerErrorStyle: React.CSSProperties = {
  margin: "10px 0 0",
  color: "#fca5a5",
  fontSize: "0.72rem",
};

const emptyStateStyle: React.CSSProperties = {
  minHeight: "100%",
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  padding: "32px 20px",
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#d9e1ef",
  fontSize: "1.05rem",
};

const emptyBodyStyle: React.CSSProperties = {
  margin: "12px 0 0",
  color: "#718097",
  fontSize: "0.78rem",
  maxWidth: "36ch",
  lineHeight: 1.6,
};
