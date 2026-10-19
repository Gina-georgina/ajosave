"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtimeUpdates } from "@/hooks/useRealtimeUpdates";
import type { CircleMessage, ReactionCount, ReactionEmoji } from "@/types";
import { ALLOWED_REACTIONS } from "@/types";
import { format } from "date-fns";
import styles from "./CircleChat.module.css";

interface CircleChatProps {
  circleId: string;
  isActiveMember: boolean;
  currentUserId: string;
}

const LIMIT = 50;

const fetchMessages = async (
  circleId: string,
  limit: number,
  before?: string
): Promise<CircleMessage[]> => {
  const url = `/api/circles/${circleId}/chat?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load messages");
  const json = await res.json();
  return json.data as CircleMessage[];
};

const sendMessage = async (
  circleId: string,
  content: string,
  parentMessageId?: string
): Promise<CircleMessage> => {
  const res = await fetch(`/api/circles/${circleId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, parentMessageId }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  const json = await res.json();
  return json.data as CircleMessage;
};

const fetchThread = async (
  circleId: string,
  messageId: string
): Promise<CircleMessage[]> => {
  const res = await fetch(`/api/circles/${circleId}/chat/${messageId}/thread`);
  if (!res.ok) throw new Error("Failed to load thread");
  const json = await res.json();
  return json.data as CircleMessage[];
};

const toggleReaction = async (
  circleId: string,
  messageId: string,
  emoji: ReactionEmoji,
  alreadyReacted: boolean
): Promise<ReactionCount[]> => {
  const method = alreadyReacted ? "DELETE" : "POST";
  const res = await fetch(`/api/circles/${circleId}/chat/${messageId}/reactions`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error("Failed to update reaction");
  const json = await res.json();
  return json.data as ReactionCount[];
};

function deduplicateById(messages: CircleMessage[]): CircleMessage[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// ── Reaction bar sub-component ─────────────────────────────────────────────

interface ReactionBarProps {
  message: CircleMessage;
  circleId: string;
  onUpdate: (messageId: string, reactions: ReactionCount[]) => void;
}

function ReactionBar({ message, circleId, onUpdate }: ReactionBarProps) {
  const handleReact = async (emoji: ReactionEmoji) => {
    const existing = message.reactions?.find((r) => r.emoji === emoji);
    const alreadyReacted = existing?.reacted ?? false;
    try {
      const updated = await toggleReaction(circleId, message.id, emoji, alreadyReacted);
      onUpdate(message.id, updated);
    } catch {
      // silently ignore — non-critical
    }
  };

  return (
    <div className={styles.reactionBar} aria-label="Reactions">
      {/* Existing reaction counts */}
      {(message.reactions ?? []).map((r) => (
        <button
          key={r.emoji}
          className={[styles.reactionBtn, r.reacted ? styles.reactionBtnActive : ""].join(" ")}
          onClick={() => handleReact(r.emoji)}
          aria-label={`${r.emoji} ${r.count} reaction${r.count !== 1 ? "s" : ""}${r.reacted ? ", remove reaction" : ", add reaction"}`}
          aria-pressed={r.reacted}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span className={styles.reactionCount}>{r.count}</span>
        </button>
      ))}

      {/* Add-reaction picker (min 4 allowed emojis) */}
      <div className={styles.emojiPicker} role="group" aria-label="Add reaction">
        {ALLOWED_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            className={styles.emojiPickerBtn}
            onClick={() => handleReact(emoji)}
            aria-label={`React with ${emoji}`}
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Thread side-panel ──────────────────────────────────────────────────────

interface ThreadPanelProps {
  circleId: string;
  parentMessage: CircleMessage;
  currentUserId: string;
  isActiveMember: boolean;
  onClose: () => void;
}

function ThreadPanel({
  circleId,
  parentMessage,
  currentUserId,
  isActiveMember,
  onClose,
}: ThreadPanelProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: replies = [], isLoading } = useQuery<CircleMessage[]>({
    queryKey: ["thread", circleId, parentMessage.id],
    queryFn: () => fetchThread(circleId, parentMessage.id),
    staleTime: 15_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies.length]);

  const mutation = useMutation<CircleMessage, Error, string>({
    mutationFn: (content) => sendMessage(circleId, content, parentMessage.id),
    onSuccess: () => {
      setInput("");
      setSendError(null);
      queryClient.invalidateQueries({ queryKey: ["thread", circleId, parentMessage.id] });
      queryClient.invalidateQueries({ queryKey: ["circle-chat", circleId] });
    },
    onError: (err) => setSendError(err.message),
  });

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || mutation.isPending) return;
    mutation.mutate(trimmed);
  };

  return (
    <div className={styles.threadPanel} role="complementary" aria-label="Thread replies">
      <div className={styles.threadHeader}>
        <h3 className={styles.threadTitle}>Thread</h3>
        <button
          className={styles.threadClose}
          onClick={onClose}
          aria-label="Close thread"
        >
          ✕
        </button>
      </div>

      {/* Parent message */}
      <div className={styles.threadParent}>
        <span className={styles.displayName}>{parentMessage.displayName}</span>
        <p className={styles.content}>{parentMessage.content}</p>
      </div>

      <div className={styles.threadDivider} aria-hidden="true">
        {replies.length} {replies.length === 1 ? "reply" : "replies"}
      </div>

      {/* Replies */}
      <div className={styles.threadReplies} role="log" aria-live="polite" aria-label="Replies">
        {isLoading && <p className={styles.empty}>Loading…</p>}
        {!isLoading && replies.length === 0 && (
          <p className={styles.empty}>No replies yet. Be the first!</p>
        )}
        {replies.map((reply) => (
          <article
            key={reply.id}
            className={[
              styles.message,
              reply.userId === currentUserId ? styles.messageSelf : "",
            ].join(" ")}
          >
            <header className={styles.messageHeader}>
              <span className={styles.displayName}>{reply.displayName}</span>
              <time
                className={styles.timestamp}
                dateTime={String(reply.createdAt)}
                title={format(new Date(reply.createdAt), "PPpp")}
              >
                {format(new Date(reply.createdAt), "MMM d, h:mm a")}
              </time>
            </header>
            <p className={styles.content}>{reply.content}</p>
          </article>
        ))}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {isActiveMember && (
        <div className={styles.inputArea}>
          {sendError && <p className={styles.error} role="alert">{sendError}</p>}
          <div className={styles.inputRow}>
            <textarea
              className={styles.textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Reply…"
              aria-label="Reply input"
              rows={2}
              maxLength={1000}
              disabled={mutation.isPending}
            />
            <button
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={mutation.isPending || !input.trim()}
              aria-busy={mutation.isPending}
              aria-label="Send reply"
            >
              {mutation.isPending ? "…" : "Reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function CircleChat({
  circleId,
  isActiveMember,
  currentUserId,
}: CircleChatProps) {
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<CircleMessage[]>([]);
  const [extraMessages, setExtraMessages] = useState<CircleMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [postError, setPostError] = useState<string | null>(null);
  const [threadMessage, setThreadMessage] = useState<CircleMessage | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    data: queryData,
    isLoading,
    isError,
    error: queryError,
  } = useQuery<CircleMessage[], Error>({
    queryKey: ["circle-chat", circleId],
    queryFn: () => fetchMessages(circleId, LIMIT),
    enabled: isActiveMember,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (queryData) {
      setMessages(queryData);
      setHasMore(queryData.length === LIMIT);
    }
  }, [queryData]);

  const allMessages = deduplicateById([...messages, ...extraMessages]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [allMessages.length]);

  const handleChatMessage = useCallback(
    (data: CircleMessage) => {
      setExtraMessages((prev) => {
        const alreadyInBase = messages.some((m) => m.id === data.id);
        const alreadyInExtra = prev.some((m) => m.id === data.id);
        if (alreadyInBase || alreadyInExtra) return prev;
        return [...prev, data];
      });
    },
    [messages]
  );

  useRealtimeUpdates({ circleId, onChatMessage: handleChatMessage });

  const mutation = useMutation<CircleMessage, Error, string>({
    mutationFn: (content: string) => sendMessage(circleId, content),
    onSuccess: () => {
      setInputValue("");
      setPostError(null);
      queryClient.invalidateQueries({ queryKey: ["circle-chat", circleId] });
    },
    onError: (err) => {
      setPostError(err.message || "Failed to send message");
    },
  });

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || mutation.isPending) return;
    setPostError(null);
    mutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [loadEarlierError, setLoadEarlierError] = useState<string | null>(null);

  const handleLoadEarlier = async () => {
    if (messages.length === 0) return;
    const oldest = messages[0];
    const scrollContainer = listRef.current;
    const prevScrollHeight = scrollContainer?.scrollHeight ?? 0;
    const prevScrollTop = scrollContainer?.scrollTop ?? 0;

    setIsLoadingEarlier(true);
    setLoadEarlierError(null);

    try {
      const older = await fetchMessages(circleId, LIMIT, String(oldest.createdAt));
      setMessages((prev) => deduplicateById([...older, ...prev]));
      setHasMore(older.length === LIMIT);
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop =
            prevScrollTop + (scrollContainer.scrollHeight - prevScrollHeight);
        }
      });
    } catch (err) {
      setLoadEarlierError(
        err instanceof Error ? err.message : "Failed to load earlier messages"
      );
    } finally {
      setIsLoadingEarlier(false);
    }
  };

  // Update reactions in local state after a toggle
  const handleReactionUpdate = (messageId: string, reactions: ReactionCount[]) => {
    const updateInList = (list: CircleMessage[]) =>
      list.map((m) => (m.id === messageId ? { ...m, reactions } : m));
    setMessages((prev) => updateInList(prev));
    setExtraMessages((prev) => updateInList(prev));
  };

  return (
    <section className={styles.outerContainer} aria-label="Circle chat">
      <div className={[styles.chatColumn, threadMessage ? styles.chatColumnNarrow : ""].join(" ")}>
        <h2 className={styles.heading}>Circle Chat</h2>

        {isLoading && (
          <div className={styles.loading} aria-busy="true" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Loading messages…</span>
          </div>
        )}

        {isError && (
          <p className={styles.error} role="alert">
            {(queryError as Error)?.message ?? "Failed to load messages"}
          </p>
        )}

        {!isLoading && !isError && (
          <div
            ref={listRef}
            className={styles.messageList}
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {hasMore && (
              <div className={styles.loadEarlier}>
                <button
                  className={styles.loadEarlierBtn}
                  onClick={handleLoadEarlier}
                  disabled={isLoadingEarlier}
                  aria-busy={isLoadingEarlier}
                >
                  {isLoadingEarlier ? "Loading…" : "Load earlier messages"}
                </button>
                {loadEarlierError && (
                  <p className={styles.error} role="alert">{loadEarlierError}</p>
                )}
              </div>
            )}

            {allMessages.length === 0 && (
              <p className={styles.empty}>No messages yet. Be the first to say something!</p>
            )}

            {allMessages.map((msg) => (
              <article
                key={msg.id}
                className={[
                  styles.message,
                  msg.userId === currentUserId ? styles.messageSelf : "",
                  threadMessage?.id === msg.id ? styles.messageHighlighted : "",
                ].join(" ")}
              >
                <header className={styles.messageHeader}>
                  <span className={styles.displayName}>{msg.displayName}</span>
                  <time
                    className={styles.timestamp}
                    dateTime={String(msg.createdAt)}
                    title={format(new Date(msg.createdAt), "PPpp")}
                  >
                    {format(new Date(msg.createdAt), "MMM d, h:mm a")}
                  </time>
                </header>

                <p className={styles.content}>{msg.content}</p>

                {/* Reactions */}
                <ReactionBar
                  message={msg}
                  circleId={circleId}
                  onUpdate={handleReactionUpdate}
                />

                {/* Thread reply button */}
                <div className={styles.messageActions}>
                  <button
                    className={styles.threadBtn}
                    onClick={() =>
                      setThreadMessage((prev) => (prev?.id === msg.id ? null : msg))
                    }
                    aria-expanded={threadMessage?.id === msg.id}
                    aria-label={`Open thread${msg.replyCount ? ` (${msg.replyCount} ${msg.replyCount === 1 ? "reply" : "replies"})` : ""}`}
                  >
                    💬{" "}
                    {msg.replyCount
                      ? `${msg.replyCount} ${msg.replyCount === 1 ? "reply" : "replies"}`
                      : "Reply"}
                  </button>
                </div>
              </article>
            ))}

            <div ref={bottomRef} aria-hidden="true" />
          </div>
        )}

        {isActiveMember ? (
          <div className={styles.inputArea}>
            {postError && (
              <p className={styles.error} role="alert">{postError}</p>
            )}
            <div className={styles.inputRow}>
              <textarea
                className={styles.textarea}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send)"
                aria-label="Message input"
                aria-multiline="true"
                rows={2}
                maxLength={1000}
                disabled={mutation.isPending}
              />
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={mutation.isPending || !inputValue.trim()}
                aria-busy={mutation.isPending}
                aria-label="Send message"
              >
                {mutation.isPending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.readOnlyNotice} role="status">
            Only active members can post messages
          </p>
        )}
      </div>

      {/* Thread side-panel */}
      {threadMessage && (
        <ThreadPanel
          circleId={circleId}
          parentMessage={threadMessage}
          currentUserId={currentUserId}
          isActiveMember={isActiveMember}
          onClose={() => setThreadMessage(null)}
        />
      )}
    </section>
  );
}
