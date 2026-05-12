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
  Pencil,
  Presentation,
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

type ChatMessage = {
  readonly id: string;
  readonly conversationId: string;
  readonly type: "user" | "assistant" | "system" | "tool";
  readonly sequenceNumber: number;
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

const CONV_AGENT_URL = import.meta.env.VITE_CONV_AGENT_URL?.trim() || "/api";
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

export function App() {
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

    scroller.scrollTop = scroller.scrollHeight;
  }, [messages, booting, sending]);

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

      const response = await fetch(url);

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
      const response = await fetch(buildConvAgentRequestUrl("/conversations"), {
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

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Message fetch failed with ${response.status}.`);
      }

      const page = (await response.json()) as MessagePageResponse;

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
      const response = await fetch(buildConvAgentRequestUrl(`/conversations/${id}`), {
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
      const response = await fetch(buildConvAgentRequestUrl(`/conversations/${id}`), {
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

      const response = await fetch(buildConvAgentRequestUrl(`/conversations/${conversationId}/add-to-conv`), {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Message send failed with ${response.status}.`);
      }

      setDraft("");
      setSelectedFiles([]);
      await loadConversations({ quiet: true });
      await loadMessages(conversationId, { quiet: true });
    } catch (caughtError) {
      setComposerError(caughtError instanceof Error ? caughtError.message : "Unable to send the message.");
    } finally {
      setSending(false);
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
    <div style={shellStyle}>
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
}) {
  return (
    <aside style={sidebarStyle}>
      <div>
        <p style={eyebrowStyle}>Thoth</p>
        <h1 style={titleStyle}>Conversation UI</h1>
        <p style={bodyStyle}>
          Minimal chat client for <code>conv-agent</code>.
        </p>
      </div>

      <div style={statusPanelStyle}>
        <StatusRow label="Endpoint" value={CONV_AGENT_URL} mono />
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

      <div style={sidebarActionsStyle}>
        <button
          type="button"
          onClick={() => {
            void props.onCreateConversation();
          }}
          style={ghostButtonStyle}
        >
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
          Refresh
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

      <div style={conversationListStyle}>
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
    <main style={chatPanelStyle}>
      <header style={chatHeaderStyle}>
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
    <div ref={props.scrollerRef} style={messageListStyle}>
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
          <span>#{props.message.sequenceNumber}</span>
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
    <form onSubmit={(event) => void props.onSendMessage(event)} style={composerStyle}>
      <label htmlFor="chat-input" style={composerLabelStyle}>
        Message
      </label>
      <div style={attachmentToolbarStyle}>
        <label style={attachmentPickerStyle}>
          <input type="file" multiple onChange={props.onFileSelection} disabled={props.booting || props.sending} style={visuallyHiddenInputStyle} />
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
          rows={3}
          disabled={props.booting || props.sending}
          style={composerInputStyle}
        />
        <button type="submit" disabled={props.booting || props.sending} style={primaryButtonStyle}>
          {props.sending ? "Sending..." : "Send"}
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

function buildConvAgentRequestUrl(path: string, searchParams?: Readonly<Record<string, string>>): string {
  const base = CONV_AGENT_URL.endsWith("/") ? CONV_AGENT_URL.slice(0, -1) : CONV_AGENT_URL;
  const isAbsoluteBase = /^https?:\/\//i.test(base);
  const url = isAbsoluteBase ? new URL(path, base) : new URL(`${base}${path}`, window.location.origin);

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
    color: #f7f1e8;
    background:
      radial-gradient(circle at top, rgba(236, 157, 88, 0.26), transparent 34%),
      linear-gradient(180deg, #21150f 0%, #130d0b 100%);
    font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
  }

  .chat-frame {
    grid-template-columns: 320px minmax(0, 1fr);
  }

  .composer-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  @media (max-width: 960px) {
    .chat-frame {
      grid-template-columns: 1fr;
      min-height: auto;
    }
  }

  @media (max-width: 720px) {
    body {
      min-width: 0;
    }

    .composer-row {
      grid-template-columns: 1fr;
    }
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  code {
    font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
  }

  a {
    color: inherit;
  }
`;

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "24px",
};

const frameStyle: React.CSSProperties = {
  display: "grid",
  gap: "20px",
  minHeight: "calc(100vh - 48px)",
};

const sidebarStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: "20px",
  padding: "28px",
  borderRadius: "28px",
  background: "linear-gradient(180deg, rgba(44, 28, 20, 0.95), rgba(26, 17, 13, 0.92))",
  border: "1px solid rgba(255, 214, 179, 0.12)",
  boxShadow: "0 24px 80px rgba(0, 0, 0, 0.28)",
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  color: "#e5aa78",
  fontSize: "0.78rem",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  margin: "10px 0 8px",
  fontSize: "2.5rem",
  lineHeight: 1,
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  color: "rgba(247, 241, 232, 0.78)",
  lineHeight: 1.5,
};

const statusPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "16px",
  borderRadius: "20px",
  background: "rgba(255, 248, 240, 0.05)",
};

const statusRowStyle: React.CSSProperties = {
  display: "grid",
  gap: "4px",
};

const statusLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "rgba(247, 241, 232, 0.56)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const statusValueStyle: React.CSSProperties = {
  color: "#f7f1e8",
};

const statusValueMonoStyle: React.CSSProperties = {
  ...statusValueStyle,
  fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: "0.88rem",
  wordBreak: "break-all",
};

const conversationSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: "12px",
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
  fontSize: "0.78rem",
  color: "rgba(247, 241, 232, 0.62)",
  textTransform: "uppercase",
  letterSpacing: "0.14em",
};

const sectionMetaStyle: React.CSSProperties = {
  color: "rgba(247, 241, 232, 0.56)",
  fontSize: "0.82rem",
};

const conversationListStyle: React.CSSProperties = {
  display: "grid",
  gap: "10px",
  maxHeight: "280px",
  overflowY: "auto",
  paddingRight: "4px",
};

const conversationButtonBaseStyle: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "10px",
  alignItems: "center",
  padding: "14px 16px",
  borderRadius: "18px",
};

const conversationButtonStyle: React.CSSProperties = {
  ...conversationButtonBaseStyle,
  border: "1px solid rgba(255, 214, 179, 0.1)",
  background: "rgba(255, 248, 240, 0.04)",
  color: "#f7f1e8",
};

const activeConversationButtonStyle: React.CSSProperties = {
  ...conversationButtonBaseStyle,
  border: "1px solid rgba(255, 196, 146, 0.38)",
  background: "linear-gradient(135deg, rgba(229, 141, 76, 0.24), rgba(212, 109, 66, 0.18))",
  color: "#fff5ef",
};

const conversationSelectButtonStyle: React.CSSProperties = {
  display: "grid",
  gap: "4px",
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
  width: "34px",
  height: "34px",
  borderRadius: "999px",
  border: "1px solid rgba(255, 214, 179, 0.14)",
  background: "rgba(17, 17, 17, 0.18)",
  color: "inherit",
  cursor: "pointer",
};

const conversationButtonTitleStyle: React.CSSProperties = {
  fontSize: "0.86rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const conversationButtonMetaStyle: React.CSSProperties = {
  color: "rgba(247, 241, 232, 0.62)",
  fontSize: "0.78rem",
};

const conversationEmptyStyle: React.CSSProperties = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "18px",
  background: "rgba(255, 248, 240, 0.04)",
  color: "rgba(247, 241, 232, 0.64)",
};

const sidebarActionsStyle: React.CSSProperties = {
  display: "grid",
  gap: "10px",
};

const ghostButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "999px",
  border: "1px solid rgba(255, 214, 179, 0.18)",
  background: "rgba(255, 248, 240, 0.04)",
  color: "#f7f1e8",
  cursor: "pointer",
};

const errorCardStyle: React.CSSProperties = {
  margin: 0,
  padding: "14px 16px",
  borderRadius: "18px",
  background: "rgba(190, 74, 65, 0.18)",
  color: "#ffd1cb",
  lineHeight: 1.5,
};

const chatPanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  borderRadius: "32px",
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(247, 241, 232, 0.12), rgba(247, 241, 232, 0.06))",
  border: "1px solid rgba(255, 214, 179, 0.16)",
  boxShadow: "0 28px 100px rgba(0, 0, 0, 0.32)",
  backdropFilter: "blur(14px)",
};

const chatHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "16px",
  padding: "22px 28px",
  borderBottom: "1px solid rgba(255, 214, 179, 0.16)",
  background: "rgba(22, 14, 11, 0.54)",
};

const chatHeaderTextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "6px",
};

const chatHeaderEyebrowStyle: React.CSSProperties = {
  margin: "0 0 6px",
  color: "rgba(247, 241, 232, 0.56)",
  fontSize: "0.72rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const chatHeaderTitleStyle: React.CSSProperties = {
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "1.35rem",
  lineHeight: 1.2,
};

const chatHeaderTitleRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, auto) auto",
  justifyContent: "start",
  alignItems: "center",
  gap: "10px",
  minWidth: 0,
};

const titleEditFormStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 420px) auto auto",
  alignItems: "center",
  gap: "8px",
  maxWidth: "min(100%, 560px)",
};

const titleEditInputStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(255, 214, 179, 0.2)",
  background: "rgba(12, 8, 7, 0.48)",
  color: "#f7f1e8",
  outline: "none",
};

const titleIconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "34px",
  height: "34px",
  borderRadius: "999px",
  border: "1px solid rgba(255, 214, 179, 0.16)",
  background: "rgba(255, 248, 240, 0.06)",
  color: "#f7f1e8",
  cursor: "pointer",
};

const titleErrorStyle: React.CSSProperties = {
  margin: 0,
  color: "#ffd1cb",
  fontSize: "0.84rem",
  lineHeight: 1.4,
};

const chatHeaderMetaStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "rgba(247, 241, 232, 0.62)",
  fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: "0.8rem",
};

const messageListStyle: React.CSSProperties = {
  overflowY: "auto",
  padding: "28px",
  display: "grid",
  gap: "16px",
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
  maxWidth: "min(720px, 100%)",
  padding: "16px 18px",
  borderRadius: "22px",
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
};

const userBubbleStyle: React.CSSProperties = {
  ...bubbleBaseStyle,
  background: "linear-gradient(135deg, #e58d4c, #bd5d32)",
  color: "#fff5ef",
  borderBottomRightRadius: "8px",
};

const assistantBubbleStyle: React.CSSProperties = {
  ...bubbleBaseStyle,
  background: "rgba(17, 17, 17, 0.52)",
  color: "#f7f1e8",
  border: "1px solid rgba(255, 214, 179, 0.12)",
  borderBottomLeftRadius: "8px",
};

const bubbleMetaStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "8px",
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  opacity: 0.72,
};

const bubbleMetaLeftStyle: React.CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "baseline",
  flexWrap: "wrap",
};

const bubbleTimestampStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.04em",
  textTransform: "none",
  opacity: 0.85,
};

const messageTextStyle: React.CSSProperties = {
  margin: 0,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
};

const fileListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "12px",
};

const attachmentLabelStyle: React.CSSProperties = {
  width: "100%",
  margin: "0 0 2px",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  opacity: 0.74,
};

const fileChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255, 255, 255, 0.1)",
  maxWidth: "100%",
};

const fileIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(255, 248, 240, 0.82)",
  flexShrink: 0,
};

const fileNameStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const composerStyle: React.CSSProperties = {
  borderTop: "1px solid rgba(255, 214, 179, 0.16)",
  padding: "22px 24px 24px",
  background: "rgba(22, 14, 11, 0.74)",
};

const attachmentToolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "12px",
  marginBottom: "12px",
};

const attachmentPickerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid rgba(255, 214, 179, 0.16)",
  background: "rgba(255, 248, 240, 0.06)",
  color: "#f7f1e8",
  cursor: "pointer",
};

const attachmentSummaryStyle: React.CSSProperties = {
  color: "rgba(247, 241, 232, 0.66)",
  fontSize: "0.85rem",
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
  gap: "10px",
  marginBottom: "14px",
};

const selectedFileChipStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  gap: "10px",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: "16px",
  background: "rgba(255, 248, 240, 0.06)",
  border: "1px solid rgba(255, 214, 179, 0.12)",
};

const selectedFileIconWrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "8px",
  background: "rgba(255, 255, 255, 0.08)",
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
  color: "rgba(247, 241, 232, 0.62)",
  fontSize: "0.78rem",
};

const selectedFileRemoveStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  borderRadius: "999px",
  border: "1px solid rgba(255, 214, 179, 0.14)",
  background: "rgba(17, 17, 17, 0.18)",
  color: "inherit",
  cursor: "pointer",
};

const composerLabelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "10px",
  fontSize: "0.8rem",
  color: "rgba(247, 241, 232, 0.72)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const composerRowStyle: React.CSSProperties = {
  display: "grid",
  gap: "12px",
  alignItems: "end",
};

const composerInputStyle: React.CSSProperties = {
  width: "100%",
  resize: "vertical",
  minHeight: "84px",
  padding: "16px",
  borderRadius: "22px",
  border: "1px solid rgba(255, 214, 179, 0.14)",
  background: "rgba(255, 248, 240, 0.08)",
  color: "#f7f1e8",
  outline: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "16px 24px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, #f0b778, #d46d42)",
  color: "#22140f",
  cursor: "pointer",
  fontWeight: 700,
};

const composerErrorStyle: React.CSSProperties = {
  margin: "10px 0 0",
  color: "#ffbeb5",
};

const emptyStateStyle: React.CSSProperties = {
  minHeight: "100%",
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  padding: "48px 20px",
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "2rem",
};

const emptyBodyStyle: React.CSSProperties = {
  margin: "12px 0 0",
  color: "rgba(247, 241, 232, 0.7)",
  maxWidth: "36ch",
  lineHeight: 1.6,
};
