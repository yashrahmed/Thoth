import { useEffect, useRef, useState } from "react";

type ConversationResponse = {
  readonly id: string;
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
  readonly fileIds: ReadonlyArray<string>;
  readonly files: ReadonlyArray<ChatFile>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type MessagePageResponse = {
  readonly items: ReadonlyArray<ChatMessage>;
  readonly pageNum: number;
  readonly pageSize: number;
};

const CONV_AGENT_URL = import.meta.env.VITE_CONV_AGENT_URL?.trim() || "http://localhost:3001";
const MESSAGE_PAGE_SIZE = 50;
const CONVERSATION_PAGE_SIZE = 40;

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
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
      const url = new URL("/conversations", CONV_AGENT_URL);
      url.searchParams.set("pageNum", "1");
      url.searchParams.set("pageSize", String(CONVERSATION_PAGE_SIZE));

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
      const response = await fetch(new URL("/conversations", CONV_AGENT_URL), {
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
      const url = new URL(`/conversations/${id}/chat`, CONV_AGENT_URL);
      url.searchParams.set("pageNum", "1");
      url.searchParams.set("pageSize", String(MESSAGE_PAGE_SIZE));

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
    await loadMessages(id);
  }

  async function deleteConversation(id: string): Promise<void> {
    setDeletingConversationId(id);
    setError("");

    try {
      const response = await fetch(new URL(`/conversations/${id}`, CONV_AGENT_URL), {
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

      const response = await fetch(new URL(`/conversations/${conversationId}/chat`, CONV_AGENT_URL), {
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

  return (
    <div style={shellStyle}>
      <style>{globalStyles}</style>
      <div className="chat-frame" style={frameStyle}>
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
            <StatusRow label="Conversation" value={conversationId || "Starting..."} mono />
            <StatusRow label="State" value={booting ? "Booting" : sending ? "Sending" : refreshing ? "Syncing" : "Ready"} />
          </div>

          <section style={conversationSectionStyle}>
            <div style={conversationSectionHeaderStyle}>
              <p style={sectionEyebrowStyle}>Threads</p>
              <span style={sectionMetaStyle}>{loadingConversations ? "Loading..." : `${conversations.length} total`}</span>
            </div>

            <div style={conversationListStyle}>
              {conversations.length === 0 ? (
                <p style={conversationEmptyStyle}>No saved conversations yet.</p>
              ) : (
                conversations.map((conversation) => {
                  const isActive = conversation.id === conversationId;

                  return (
                    <div key={conversation.id} style={isActive ? activeConversationButtonStyle : conversationButtonStyle}>
                      <button
                        type="button"
                        onClick={() => {
                          void selectConversation(conversation.id);
                        }}
                        style={conversationSelectButtonStyle}
                      >
                        <span style={conversationButtonTitleStyle}>{formatConversationLabel(conversation.id)}</span>
                        <span style={conversationButtonMetaStyle}>{formatTimestamp(conversation.updatedAt)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteConversation(conversation.id);
                        }}
                        disabled={deletingConversationId === conversation.id}
                        aria-label={`Delete conversation ${conversation.id}`}
                        style={deleteConversationButtonStyle}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <div style={sidebarActionsStyle}>
            <button
              type="button"
              onClick={() => {
                void createConversation();
              }}
              style={ghostButtonStyle}
            >
              New Conversation
            </button>
            <button
              type="button"
              onClick={() => {
                void loadConversations();
                if (conversationId) {
                  void loadMessages(conversationId);
                }
              }}
              disabled={(!conversationId || refreshing) && !loadingConversations}
              style={ghostButtonStyle}
            >
              Refresh
            </button>
          </div>

          {error ? <p style={errorCardStyle}>{error}</p> : null}
        </aside>

        <main style={chatPanelStyle}>
          <div ref={scrollerRef} style={messageListStyle}>
            {booting ? (
              <EmptyState title="Starting conversation" body="The UI is creating a fresh conversation and waiting for the service." />
            ) : messages.length === 0 ? (
              <EmptyState title="No messages yet" body="Send the first prompt to start the thread." />
            ) : (
              messages.map((message) => {
                const attachmentIds = message.fileIds.length > 0 ? message.fileIds : message.files.map((file) => file.id);

                return (
                <article key={message.id} style={message.type === "user" ? userBubbleWrapStyle : assistantBubbleWrapStyle}>
                  <div style={message.type === "user" ? userBubbleStyle : assistantBubbleStyle}>
                    <div style={bubbleMetaStyle}>
                      <span>{message.type === "user" ? "You" : "Assistant"}</span>
                      <span>#{message.sequenceNumber}</span>
                    </div>
                    {message.content ? <p style={messageTextStyle}>{message.content}</p> : null}
                    {attachmentIds.length > 0 ? (
                      <div style={fileListStyle}>
                        <p style={attachmentLabelStyle}>Attachments</p>
                        {attachmentIds.map((fileId) => (
                          <FileAttachmentView key={fileId} fileId={fileId} files={message.files} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              )})
            )}
          </div>

          <form onSubmit={(event) => void sendMessage(event)} style={composerStyle}>
            <label htmlFor="chat-input" style={composerLabelStyle}>
              Message
            </label>
            <div style={attachmentToolbarStyle}>
              <label style={attachmentPickerStyle}>
                <input type="file" multiple onChange={handleFileSelection} disabled={booting || sending} style={visuallyHiddenInputStyle} />
                Attach Files
              </label>
              {selectedFiles.length > 0 ? (
                <span style={attachmentSummaryStyle}>
                  {selectedFiles.length} file
                  {selectedFiles.length === 1 ? "" : "s"} selected
                </span>
              ) : null}
            </div>
            {selectedFiles.length > 0 ? (
              <div style={selectedFileListStyle}>
                {selectedFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} style={selectedFileChipStyle}>
                    <div style={selectedFileMetaStyle}>
                      <span style={selectedFileNameStyle}>{file.name}</span>
                      <span style={selectedFileSizeStyle}>{formatFileSize(file.size)}</span>
                    </div>
                    <button type="button" onClick={() => removeSelectedFile(index)} style={selectedFileRemoveStyle} aria-label={`Remove ${file.name}`}>
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="composer-row" style={composerRowStyle}>
              <textarea
                id="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask Thoth something practical."
                rows={3}
                disabled={booting || sending}
                style={composerInputStyle}
              />
              <button type="submit" disabled={booting || sending} style={primaryButtonStyle}>
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
            {composerError ? <p style={composerErrorStyle}>{composerError}</p> : null}
          </form>
        </main>
      </div>
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

function FileAttachmentView(props: { readonly fileId: string; readonly files: ReadonlyArray<ChatFile> }) {
  const file = props.files.find((item) => item.id === props.fileId);

  if (!file) {
    return <span style={missingFileChipStyle}>Attachment unavailable</span>;
  }

  const url = new URL(file.canonicalUrl, CONV_AGENT_URL).toString();

  if (file.mimeType.startsWith("image/")) {
    return <img src={url} alt={file.filename} style={inlineImageStyle} />;
  }

  if (file.mimeType.startsWith("audio/")) {
    return (
      <audio controls style={audioPlayerStyle}>
        <source src={url} type={file.mimeType} />
      </audio>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" style={fileChipStyle}>
      {file.filename}
    </a>
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

function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
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
  fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: "0.86rem",
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
  gridTemplateRows: "minmax(0, 1fr) auto",
  borderRadius: "32px",
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(247, 241, 232, 0.12), rgba(247, 241, 232, 0.06))",
  border: "1px solid rgba(255, 214, 179, 0.16)",
  boxShadow: "0 28px 100px rgba(0, 0, 0, 0.32)",
  backdropFilter: "blur(14px)",
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

const messageTextStyle: React.CSSProperties = {
  margin: 0,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
};

const inlineImageStyle: React.CSSProperties = {
  display: "block",
  maxWidth: "100%",
  borderRadius: "16px",
  marginTop: "8px",
};

const audioPlayerStyle: React.CSSProperties = {
  width: "100%",
  marginTop: "8px",
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
  textDecoration: "none",
};

const missingFileChipStyle: React.CSSProperties = {
  ...fileChipStyle,
  color: "rgba(247, 241, 232, 0.74)",
  cursor: "default",
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
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "10px",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: "16px",
  background: "rgba(255, 248, 240, 0.06)",
  border: "1px solid rgba(255, 214, 179, 0.12)",
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
