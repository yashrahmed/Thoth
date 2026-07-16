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
import { MarkdownMessage } from "./MarkdownMessage";

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
    <div className="app-shell workspace-shell" style={workspaceShellStyle}>
      <style>{globalStyles}</style>
      <div className="system-rail" aria-hidden="true">
        <span className="system-rail__label">THOTH // RELAY INTERFACE</span>
        <span className="system-rail__meter">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="system-rail__status">
          <i />
          NODE {THOTH_PROFILE.toUpperCase()} · ONLINE
        </span>
      </div>
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
    <aside className="conversation-sidebar technical-panel" style={sidebarStyle}>
      <div className="brand-lockup" style={brandLockupStyle}>
        <span className="brand-mark" style={brandMarkStyle} aria-hidden="true">
          <MessageSquare size={17} strokeWidth={2.1} />
        </span>
        <div>
          <p style={eyebrowStyle}>Thoth</p>
          <h1 style={titleStyle}>Relay Console</h1>
          <p style={bodyStyle}>Cognitive transmission system</p>
        </div>
        <span className="brand-lockup__index" aria-hidden="true">
          TH·07
        </span>
      </div>

      <div className="status-panel" style={statusPanelStyle}>
        <div className="status-panel__header">
          <span>System Telemetry</span>
          <span className="status-panel__signal" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
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
    <section className="conversation-section" style={conversationSectionStyle}>
      <div className="section-header" style={conversationSectionHeaderStyle}>
        <p style={sectionEyebrowStyle}>Stored Signals</p>
        <span style={sectionMetaStyle}>{props.loadingConversations ? "Loading..." : `${props.conversations.length} total`}</span>
      </div>

      <div className="conversation-list" style={conversationListStyle}>
        {props.conversations.length === 0 ? (
          <p style={conversationEmptyStyle}>No saved conversations yet.</p>
        ) : (
          props.conversations.map((conversation, index) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              index={index}
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
  readonly index: number;
  readonly isActive: boolean;
  readonly isDeleting: boolean;
  readonly onSelect: (conversationId: string) => Promise<void>;
  readonly onDelete: (conversationId: string) => Promise<void>;
}) {
  return (
    <div className={props.isActive ? "conversation-item is-active" : "conversation-item"} style={props.isActive ? activeConversationButtonStyle : conversationButtonStyle}>
      <button
        className="conversation-select"
        type="button"
        onClick={() => {
          void props.onSelect(props.conversation.id);
        }}
        style={conversationSelectButtonStyle}
      >
        <span className="conversation-sequence" aria-hidden="true">
          {String(props.index + 1).padStart(2, "0")}
        </span>
        <span className="conversation-copy">
          <span style={conversationButtonTitleStyle}>{formatConversationTitle(props.conversation.title)}</span>
          <span style={conversationButtonMetaStyle}>{formatTimestamp(props.conversation.updatedAt)}</span>
        </span>
      </button>
      <button
        className="conversation-delete"
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
    <main className="chat-panel technical-panel" style={chatPanelStyle}>
      <header className="chat-header" style={chatHeaderStyle}>
        <div style={chatHeaderTextStyle}>
          <p style={chatHeaderEyebrowStyle}>Active Thread // Live Channel</p>
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
        <div className="chat-header__telemetry">
          <span className="chat-header__live">
            <i />
            Signal stable
          </span>
          <span style={chatHeaderMetaStyle}>{props.conversationId ? formatConversationLabel(props.conversationId) : "Starting..."}</span>
        </div>
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
        props.messages.map((message, index) => <MessageBubble key={message.id} message={message} index={index} />)
      )}
    </div>
  );
}

function MessageBubble(props: { readonly message: ChatMessage; readonly index: number }) {
  const isUserMessage = props.message.type === "user";

  return (
    <article className={isUserMessage ? "message-shell is-user" : "message-shell is-assistant"} style={isUserMessage ? userBubbleWrapStyle : assistantBubbleWrapStyle}>
      <span className="message-sequence" aria-hidden="true">
        {String(props.index + 1).padStart(2, "0")}
      </span>
      <div className={isUserMessage ? "message-card is-user" : "message-card is-assistant"} style={isUserMessage ? userBubbleStyle : assistantBubbleStyle}>
        <div style={bubbleMetaStyle}>
          <div style={bubbleMetaLeftStyle}>
            <span>{isUserMessage ? "Operator" : "Thoth"}</span>
            <span className="message-kind">{isUserMessage ? "Input" : "Response"}</span>
            <span style={bubbleTimestampStyle}>{formatMessageTimestamp(props.message.createdAt)}</span>
          </div>
        </div>
        {props.message.content ? <MarkdownMessage content={props.message.content} /> : null}
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
    <form className="composer technical-panel" onSubmit={(event) => void props.onSendMessage(event)} style={composerStyle}>
      <label htmlFor="chat-input" style={composerLabelStyle}>
        Transmit // Message
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
        <button className="send-button" type="submit" disabled={props.booting || props.sending} style={primaryButtonStyle}>
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
    --void: #02090a;
    --ink: #061315;
    --ink-raised: #0a1c1e;
    --ink-soft: #10282a;
    --paper: #e9eee8;
    --paper-dim: #bcc9c4;
    --muted: #829793;
    --line: #aec0ba;
    --line-soft: #3e5b58;
    --cyan: #7fe3cf;
    --yellow: #f4dc3f;
    --orange: #ff8a32;
    --pink: #ff356d;
    --danger: #ff5a4f;
    --font-body: "Avenir Next", Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-display: "Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", sans-serif;
    --font-mono: "SFMono-Regular", Menlo, Consolas, monospace;
    color: var(--paper);
    background: var(--void);
    font-family: var(--font-body);
    font-size: 14px;
    font-synthesis: none;
  }

  * {
    box-sizing: border-box;
    scrollbar-width: thin;
    scrollbar-color: var(--line-soft) transparent;
  }

  html,
  body {
    margin: 0;
    min-width: 320px;
    min-height: 100%;
    background:
      radial-gradient(circle at 12% 18%, rgba(127, 227, 207, 0.55) 0 1px, transparent 1.5px),
      radial-gradient(circle at 78% 32%, rgba(233, 238, 232, 0.42) 0 1px, transparent 1.5px),
      radial-gradient(circle at 38% 78%, rgba(244, 220, 63, 0.28) 0 1px, transparent 1.5px),
      radial-gradient(ellipse at 76% -12%, rgba(255, 138, 50, 0.09), transparent 38%),
      radial-gradient(ellipse at -8% 112%, rgba(127, 227, 207, 0.1), transparent 42%),
      linear-gradient(112deg, transparent 0 64%, rgba(127, 227, 207, 0.025) 64% 64.2%, transparent 64.2%),
      var(--void);
    background-size: 190px 190px, 260px 260px, 320px 320px, auto, auto, auto, auto;
  }

  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.28;
    background:
      linear-gradient(90deg, transparent 0 18%, rgba(127, 227, 207, 0.07) 18% 18.08%, transparent 18.08% 100%),
      linear-gradient(0deg, transparent 0 78%, rgba(255, 53, 109, 0.05) 78% 78.1%, transparent 78.1% 100%);
  }

  body {
    height: 100dvh;
    overflow: hidden;
  }

  #root {
    height: 100%;
  }

  .chat-frame {
    grid-template-columns: 304px minmax(0, 1fr);
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
    text-transform: uppercase;
    letter-spacing: 0.055em;
    transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease, transform 120ms ease;
  }

  button:hover:not(:disabled) {
    border-color: var(--paper) !important;
    color: var(--paper) !important;
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
    border-color: var(--cyan) !important;
    box-shadow: 0 0 0 1px var(--cyan), 0 0 20px rgba(127, 227, 207, 0.1);
  }

  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  *::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 0;
    background: var(--line-soft);
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  .system-rail {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(170px, 1fr) minmax(180px, 0.8fr) minmax(170px, 1fr);
    align-items: center;
    gap: 18px;
    padding: 0 2px 5px;
    border-bottom: 1px solid var(--line);
    color: var(--paper-dim);
    font-family: var(--font-display);
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .system-rail__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .system-rail__status {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    white-space: nowrap;
  }

  .system-rail__status i {
    width: 6px;
    height: 6px;
    background: var(--cyan);
    box-shadow: 0 0 10px rgba(127, 227, 207, 0.65);
  }

  .system-rail__meter {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 3px;
    height: 7px;
  }

  .system-rail__meter i {
    background: var(--orange);
  }

  .system-rail__meter i:nth-last-child(-n + 2) {
    background: transparent;
    border: 1px solid var(--line-soft);
  }

  .technical-panel {
    position: relative;
  }

  .technical-panel::before,
  .technical-panel::after {
    content: "";
    position: absolute;
    z-index: 4;
    width: 13px;
    height: 13px;
    pointer-events: none;
  }

  .technical-panel::before {
    top: -1px;
    left: -1px;
    border-top: 2px solid var(--paper);
    border-left: 2px solid var(--paper);
  }

  .technical-panel::after {
    right: -1px;
    bottom: -1px;
    border-right: 2px solid var(--paper);
    border-bottom: 2px solid var(--paper);
  }

  .brand-lockup {
    position: relative;
    padding-bottom: 11px;
    border-bottom: 1px solid var(--line-soft);
  }

  .brand-lockup::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: -1px;
    width: 42px;
    height: 3px;
    background: var(--yellow);
  }

  .brand-lockup__index {
    margin-left: auto;
    align-self: start;
    color: var(--yellow);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    writing-mode: vertical-rl;
  }

  .status-panel {
    position: relative;
  }

  .status-panel__header {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line-soft);
    color: var(--paper);
    font-family: var(--font-display);
    font-size: 0.62rem;
    font-weight: 650;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .status-panel__signal {
    display: grid;
    grid-template-columns: repeat(5, 7px);
    gap: 2px;
  }

  .status-panel__signal i {
    height: 4px;
    background: var(--cyan);
  }

  .status-panel__signal i:nth-child(4) {
    background: var(--yellow);
  }

  .status-panel__signal i:nth-child(5) {
    background: transparent;
    border: 1px solid var(--line-soft);
  }

  .section-header {
    min-height: 22px;
    padding: 0 1px 5px;
    border-bottom: 1px solid var(--line-soft);
  }

  .conversation-item {
    position: relative;
    overflow: hidden;
  }

  .conversation-item::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: transparent;
  }

  .conversation-item.is-active::before {
    background: var(--pink);
    box-shadow: 0 0 12px rgba(255, 53, 109, 0.42);
  }

  .conversation-select {
    min-width: 0;
  }

  .conversation-sequence {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 0.63rem;
  }

  .conversation-item.is-active .conversation-sequence {
    color: var(--yellow);
  }

  .conversation-copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .chat-header__telemetry {
    display: grid;
    justify-items: end;
    gap: 5px;
  }

  .chat-header__live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--paper-dim);
    font-family: var(--font-display);
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .chat-header__live i {
    width: 6px;
    height: 6px;
    border: 1px solid var(--cyan);
    background: rgba(127, 227, 207, 0.24);
    box-shadow: 0 0 9px rgba(127, 227, 207, 0.44);
  }

  .message-shell {
    width: 100%;
    min-width: 0;
    align-items: stretch;
    gap: 0;
  }

  .message-sequence {
    display: grid;
    place-items: center;
    min-width: 28px;
    border: 1px solid var(--line-soft);
    color: var(--muted);
    background: rgba(2, 9, 10, 0.82);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    writing-mode: vertical-rl;
  }

  .message-shell.is-assistant .message-sequence {
    border-right: 0;
    color: var(--cyan);
  }

  .message-shell.is-user .message-sequence {
    border-right: 0;
    color: var(--pink);
  }

  .message-card {
    position: relative;
    min-width: 0;
  }

  .message-card::after {
    content: "";
    position: absolute;
    top: -1px;
    right: 16px;
    width: 32px;
    height: 3px;
    background: var(--cyan);
  }

  .message-card.is-user::after {
    background: var(--pink);
  }

  .message-kind {
    padding: 1px 4px;
    border: 1px solid currentColor;
    color: var(--yellow);
    font-size: 0.54rem;
    line-height: 1.2;
  }

  .composer::before {
    border-top-color: var(--pink);
    border-left-color: var(--pink);
  }

  .send-button {
    position: relative;
    overflow: hidden;
  }

  .send-button::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    width: 18px;
    height: 100%;
    background: var(--pink);
    clip-path: polygon(75% 0, 100% 0, 100% 100%, 0 100%);
    opacity: 0.9;
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

    .workspace-shell {
      grid-template-rows: 25px minmax(0, 1fr) !important;
    }

    .system-rail {
      grid-template-columns: minmax(120px, 1fr) minmax(120px, 0.8fr);
      padding-inline: 10px;
    }

    .system-rail__label {
      display: none;
    }

    .chat-frame {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(460px, 50dvh) minmax(520px, 58dvh);
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

    .conversation-list {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

    .chat-frame {
      grid-template-rows: minmax(590px, auto) minmax(580px, 62dvh);
    }

    .conversation-list {
      grid-template-columns: 1fr;
    }

    .message-sequence {
      display: none;
    }

    .message-card {
      width: auto;
      min-width: 0;
      max-width: 100% !important;
    }

    .chat-header__telemetry {
      justify-items: start;
    }
  }

  code {
    font-family: var(--font-mono);
  }

  a {
    color: inherit;
  }
`;

const shellStyle: React.CSSProperties = {
  height: "100dvh",
  padding: "12px",
};

const workspaceShellStyle: React.CSSProperties = {
  ...shellStyle,
  display: "grid",
  gridTemplateRows: "25px minmax(0, 1fr)",
  gap: "8px",
  padding: "8px 10px 10px",
};

const frameStyle: React.CSSProperties = {
  display: "grid",
  gap: "10px",
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
  borderRadius: "1px",
  background: "var(--ink)",
  border: "1px solid var(--line)",
  boxShadow: "0 18px 60px rgba(0, 0, 0, 0.34)",
  textAlign: "center",
};

const sidebarStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto auto",
  gap: "12px",
  height: "100%",
  minHeight: 0,
  padding: "14px",
  overflow: "hidden",
  borderRadius: "1px",
  background: "linear-gradient(168deg, rgba(10, 28, 30, 0.96) 0%, rgba(4, 14, 16, 0.98) 68%)",
  border: "1px solid var(--line-soft)",
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.38)",
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
  width: "38px",
  height: "38px",
  flexShrink: 0,
  borderRadius: "1px",
  color: "var(--void)",
  background: "var(--yellow)",
  border: "1px solid var(--paper)",
  boxShadow: "5px 5px 0 rgba(127, 227, 207, 0.12)",
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--cyan)",
  fontFamily: "var(--font-display)",
  fontSize: "0.64rem",
  fontWeight: 700,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  margin: "2px 0 1px",
  color: "var(--paper)",
  fontFamily: "var(--font-display)",
  fontSize: "1.28rem",
  lineHeight: 1,
  fontWeight: 560,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: "0.7rem",
  lineHeight: 1.35,
};

const statusPanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px 12px",
  padding: "9px 10px 10px",
  borderRadius: "1px",
  background: "rgba(2, 9, 10, 0.72)",
  border: "1px solid var(--line-soft)",
};

const statusRowStyle: React.CSSProperties = {
  display: "grid",
  gap: "2px",
  minWidth: 0,
};

const statusLabelStyle: React.CSSProperties = {
  fontSize: "0.61rem",
  color: "var(--muted)",
  fontWeight: 650,
  textTransform: "uppercase",
  letterSpacing: "0.11em",
};

const statusValueStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  color: "var(--paper)",
  fontSize: "0.73rem",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const statusValueMonoStyle: React.CSSProperties = {
  ...statusValueStyle,
  fontFamily: "var(--font-mono)",
  color: "var(--cyan)",
  fontSize: "0.65rem",
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
  color: "var(--paper)",
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const sectionMetaStyle: React.CSSProperties = {
  color: "var(--yellow)",
  fontFamily: "var(--font-mono)",
  fontSize: "0.64rem",
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
  minHeight: "50px",
  padding: "6px 6px 6px 9px",
  borderRadius: "1px",
};

const conversationButtonStyle: React.CSSProperties = {
  ...conversationButtonBaseStyle,
  border: "1px solid rgba(62, 91, 88, 0.62)",
  background: "rgba(4, 14, 16, 0.48)",
  color: "var(--paper-dim)",
};

const activeConversationButtonStyle: React.CSSProperties = {
  ...conversationButtonBaseStyle,
  border: "1px solid var(--line)",
  background: "linear-gradient(90deg, rgba(127, 227, 207, 0.13), rgba(6, 19, 21, 0.9))",
  color: "var(--paper)",
  boxShadow: "inset 4px 0 0 var(--pink), 0 0 20px rgba(127, 227, 207, 0.05)",
};

const conversationSelectButtonStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
  alignItems: "center",
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
  borderRadius: "1px",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
};

const conversationButtonTitleStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-display)",
  fontSize: "0.8rem",
  fontWeight: 600,
  letterSpacing: "0.025em",
  textTransform: "uppercase",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const conversationButtonMetaStyle: React.CSSProperties = {
  display: "block",
  color: "var(--muted)",
  fontFamily: "var(--font-mono)",
  fontSize: "0.6rem",
};

const conversationEmptyStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px",
  borderRadius: "1px",
  background: "var(--void)",
  border: "1px solid var(--line-soft)",
  color: "var(--muted)",
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
  borderRadius: "1px",
  border: "1px solid var(--line-soft)",
  background: "rgba(6, 19, 21, 0.82)",
  color: "var(--paper-dim)",
  fontFamily: "var(--font-display)",
  fontSize: "0.68rem",
  fontWeight: 600,
  cursor: "pointer",
};

const primarySidebarButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  gridColumn: "1 / -1",
  background: "var(--paper)",
  border: "1px solid var(--paper)",
  color: "var(--void)",
  boxShadow: "inset -18px 0 0 var(--pink)",
};

const dangerButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(255, 90, 79, 0.38)",
  background: "rgba(68, 8, 24, 0.28)",
  color: "#ff8a82",
};

const errorCardStyle: React.CSSProperties = {
  margin: 0,
  padding: "9px 10px",
  borderRadius: "1px",
  background: "rgba(127, 29, 29, 0.16)",
  border: "1px solid rgba(248, 113, 113, 0.24)",
  color: "#ff8a82",
  fontSize: "0.72rem",
  lineHeight: 1.4,
};

const chatPanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  minWidth: 0,
  minHeight: 0,
  borderRadius: "1px",
  overflow: "hidden",
  background: "rgba(4, 14, 16, 0.94)",
  border: "1px solid var(--line-soft)",
  boxShadow: "0 20px 58px rgba(0, 0, 0, 0.42)",
};

const chatHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "12px",
  minHeight: "68px",
  padding: "11px 16px",
  borderBottom: "1px solid var(--line)",
  background: "linear-gradient(90deg, rgba(16, 40, 42, 0.96), rgba(4, 14, 16, 0.98))",
};

const chatHeaderTextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "2px",
};

const chatHeaderEyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--cyan)",
  fontFamily: "var(--font-display)",
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
  color: "var(--paper)",
  fontFamily: "var(--font-display)",
  fontSize: "1.2rem",
  fontWeight: 560,
  lineHeight: 1,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
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
  borderRadius: "1px",
  border: "1px solid var(--line-soft)",
  background: "var(--void)",
  color: "var(--paper)",
  outline: "none",
};

const titleIconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "1px",
  border: "1px solid var(--line-soft)",
  background: "var(--void)",
  color: "var(--paper-dim)",
  cursor: "pointer",
};

const titleErrorStyle: React.CSSProperties = {
  margin: 0,
  color: "#ff8a82",
  fontSize: "0.72rem",
  lineHeight: 1.4,
};

const chatHeaderMetaStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "4px 7px",
  borderRadius: "1px",
  background: "var(--void)",
  border: "1px solid var(--line-soft)",
  color: "var(--yellow)",
  fontFamily: "var(--font-mono)",
  fontSize: "0.65rem",
};

const messageListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  padding: "18px 20px",
  display: "grid",
  alignContent: "start",
  gap: "12px",
  background:
    "linear-gradient(90deg, transparent 0 45px, rgba(127, 227, 207, 0.045) 45px 46px, transparent 46px), radial-gradient(circle at 88% 10%, rgba(244, 220, 63, 0.045), transparent 25%), linear-gradient(180deg, rgba(6, 19, 21, 0.96), rgba(2, 9, 10, 0.99))",
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
  minWidth: 0,
  maxWidth: "min(900px, 88%)",
  padding: "12px 14px",
  borderRadius: "1px",
  boxShadow: "0 7px 18px rgba(0, 0, 0, 0.16)",
};

const userBubbleStyle: React.CSSProperties = {
  ...bubbleBaseStyle,
  background: "linear-gradient(118deg, rgba(31, 35, 33, 0.96), rgba(38, 14, 24, 0.94))",
  color: "var(--paper)",
  border: "1px solid rgba(255, 53, 109, 0.62)",
  boxShadow: "0 8px 22px rgba(0, 0, 0, 0.2), inset -3px 0 0 var(--pink)",
};

const assistantBubbleStyle: React.CSSProperties = {
  ...bubbleBaseStyle,
  background: "linear-gradient(118deg, rgba(10, 28, 30, 0.97), rgba(5, 17, 19, 0.98))",
  color: "var(--paper)",
  border: "1px solid var(--line-soft)",
  boxShadow: "0 8px 22px rgba(0, 0, 0, 0.16), inset 3px 0 0 rgba(127, 227, 207, 0.55)",
};

const bubbleMetaStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "6px",
  color: "var(--paper-dim)",
  fontFamily: "var(--font-display)",
  fontSize: "0.6rem",
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
  color: "var(--muted)",
  fontFamily: "var(--font-mono)",
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
  color: "var(--muted)",
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
  borderRadius: "1px",
  background: "rgba(127, 227, 207, 0.07)",
  border: "1px solid var(--line-soft)",
  maxWidth: "100%",
};

const fileIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--cyan)",
  flexShrink: 0,
};

const fileNameStyle: React.CSSProperties = {
  fontSize: "0.73rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const composerStyle: React.CSSProperties = {
  borderTop: "1px solid var(--line)",
  padding: "9px 13px 11px",
  background: "linear-gradient(90deg, rgba(10, 28, 30, 0.98), rgba(4, 14, 16, 0.99))",
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
  borderRadius: "1px",
  border: "1px solid var(--line-soft)",
  background: "var(--void)",
  color: "var(--paper-dim)",
  fontFamily: "var(--font-display)",
  fontSize: "0.7rem",
  fontWeight: 600,
  cursor: "pointer",
};

const attachmentSummaryStyle: React.CSSProperties = {
  color: "var(--muted)",
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
  borderRadius: "1px",
  background: "var(--void)",
  border: "1px solid var(--line-soft)",
};

const selectedFileIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "1px",
  background: "var(--ink-soft)",
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
  color: "var(--muted)",
  fontSize: "0.67rem",
};

const selectedFileRemoveStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "1px",
  border: "1px solid var(--line-soft)",
  background: "var(--void)",
  color: "var(--muted)",
  cursor: "pointer",
};

const composerLabelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontSize: "0.64rem",
  color: "var(--yellow)",
  fontFamily: "var(--font-display)",
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
  borderRadius: "1px",
  border: "1px solid var(--line-soft)",
  background: "rgba(2, 9, 10, 0.92)",
  color: "var(--paper)",
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
  borderRadius: "1px",
  border: "1px solid var(--paper)",
  background: "var(--paper)",
  color: "var(--void)",
  fontFamily: "var(--font-display)",
  cursor: "pointer",
  fontSize: "0.75rem",
  fontWeight: 650,
  boxShadow: "0 0 18px rgba(233, 238, 232, 0.08)",
};

const composerErrorStyle: React.CSSProperties = {
  margin: "10px 0 0",
  color: "#ff8a82",
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
  color: "var(--paper)",
  fontFamily: "var(--font-display)",
  fontSize: "1.05rem",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const emptyBodyStyle: React.CSSProperties = {
  margin: "12px 0 0",
  color: "var(--muted)",
  fontSize: "0.78rem",
  maxWidth: "36ch",
  lineHeight: 1.6,
};
