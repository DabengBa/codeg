"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConversationRuntime } from "@/contexts/conversation-runtime-context"
import { ContentPartsRenderer } from "./content-parts-renderer"
import {
  adaptMessageTurns,
  type AdaptedContentPart,
  type UserImageDisplay,
  type UserResourceDisplay,
} from "@/lib/adapters/ai-elements-adapter"
import { TurnStats } from "./turn-stats"
import { LiveTurnStats } from "./live-turn-stats"
import { UserResourceLinks } from "./user-resource-links"
import { UserImageAttachments } from "./user-image-attachments"
import { useSessionStats } from "@/contexts/session-stats-context"
import { AgentPlanOverlay } from "@/components/chat/agent-plan-overlay"
import { SessionLocatorOverlay } from "@/components/chat/session-locator-overlay"
import { MessageThread } from "@/components/ai-elements/message-thread"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  buildPlanKey,
  extractLatestPlanEntriesFromMessages,
} from "@/lib/agent-plan"
import type { AgentType, ConnectionStatus, SessionStats } from "@/lib/types"
import {
  VirtualizedMessageThread,
  type VirtualizedMessageThreadHandle,
} from "@/components/message/virtualized-message-thread"
import {
  buildSessionLocatorItems,
  type SessionLocatorRawTurn,
  type SessionLocatorTarget,
} from "@/lib/session-locator"
import { cn } from "@/lib/utils"
import { useStickToBottomContext } from "use-stick-to-bottom"

interface MessageListViewProps {
  conversationId: number
  agentType: AgentType
  connStatus?: ConnectionStatus | null
  isActive?: boolean
  sendSignal?: number
  sessionStats?: SessionStats | null
  detailLoading?: boolean
  detailError?: string | null
  hideEmptyState?: boolean
}

interface ResolvedMessageGroup {
  id: string
  role: "user" | "assistant" | "system"
  parts: AdaptedContentPart[]
  resources: UserResourceDisplay[]
  images: UserImageDisplay[]
  usage?: import("@/lib/types").TurnUsage | null
  duration_ms?: number | null
  model?: string | null
  models?: string[]
}

type ThreadRenderItem =
  | {
      key: string
      kind: "turn"
      group: ResolvedMessageGroup
      phase: "persisted" | "optimistic" | "streaming"
    }
  | {
      key: string
      kind: "typing"
    }

interface HighlightedLocatorTarget {
  turnId: string
  partIndex: number | null
  token: number
}

const LOCATOR_HIGHLIGHT_DURATION_MS = 1800
const LOCATOR_TARGET_TOP_OFFSET_PX = 88
const LOCATOR_TARGET_ALIGNMENT_TOLERANCE_PX = 12
const LOCATOR_TARGET_VISIBILITY_PADDING_PX = 24
const LOCATOR_TARGET_MAX_ALIGNMENT_ATTEMPTS = 36
const LOCATOR_ALIGNMENT_FRAME_DELAY = 2

const HistoricalMessageGroup = memo(function HistoricalMessageGroup({
  group,
  dimmed = false,
  highlightedPartIndex = null,
  highlightTurn = false,
  highlightToken,
}: {
  group: ResolvedMessageGroup
  dimmed?: boolean
  highlightedPartIndex?: number | null
  highlightTurn?: boolean
  highlightToken?: number
}) {
  return (
    <div
      className={cn(
        dimmed && "opacity-70",
        highlightTurn &&
          highlightToken !== undefined &&
          "rounded-2xl bg-primary/10 ring-2 ring-primary/35 shadow-md shadow-primary/10 transition-[background-color,box-shadow,ring-color] duration-700 dark:bg-primary/15"
      )}
      data-turn-id={group.id}
    >
      <Message from={group.role}>
        {group.role === "user" && group.images.length > 0 ? (
          <UserImageAttachments images={group.images} className="self-end" />
        ) : null}
        <MessageContent>
          <ContentPartsRenderer
            parts={group.parts}
            role={group.role}
            highlightedPartIndex={highlightedPartIndex}
            highlightToken={highlightToken}
          />
        </MessageContent>
        {group.role === "user" && group.resources.length > 0 ? (
          <UserResourceLinks resources={group.resources} className="self-end" />
        ) : null}
      </Message>
      {group.role === "assistant" && (
        <TurnStats
          usage={group.usage}
          duration_ms={group.duration_ms}
          model={group.model}
          models={group.models}
        />
      )}
    </div>
  )
})

const PendingTypingIndicator = memo(function PendingTypingIndicator() {
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex items-center gap-1.5 py-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_infinite]" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </MessageContent>
    </Message>
  )
})

const AutoScrollOnSend = memo(function AutoScrollOnSend({
  signal,
}: {
  signal: number
}) {
  const { scrollToBottom } = useStickToBottomContext()
  const lastSignalRef = useRef(signal)

  useEffect(() => {
    if (signal === lastSignalRef.current) return
    lastSignalRef.current = signal

    scrollToBottom()
    const rafId = requestAnimationFrame(() => {
      scrollToBottom()
    })
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [scrollToBottom, signal])

  return null
})

export function MessageListView({
  conversationId,
  agentType,
  connStatus,
  isActive = true,
  sendSignal = 0,
  sessionStats = null,
  detailLoading = false,
  detailError = null,
  hideEmptyState = false,
}: MessageListViewProps) {
  const t = useTranslations("Folder.chat.messageList")
  const sharedT = useTranslations("Folder.chat.shared")
  const { getSession, getTimelineTurns } = useConversationRuntime()
  const session = getSession(conversationId)
  const liveMessage = session?.liveMessage ?? null
  const timelineTurns = getTimelineTurns(conversationId)

  const { setSessionStats } = useSessionStats()
  const rootRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<VirtualizedMessageThreadHandle | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locatorJumpTokenRef = useRef(0)
  const [highlightedTarget, setHighlightedTarget] =
    useState<HighlightedLocatorTarget | null>(null)

  useEffect(() => {
    if (isActive) {
      setSessionStats(sessionStats)
    }
  }, [isActive, sessionStats, setSessionStats])

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  const shouldUseSmoothResize = !(
    isActive &&
    !detailLoading &&
    timelineTurns.length
  )

  const adapterText = useMemo(
    () => ({
      attachedResources: sharedT("attachedResources"),
      toolCallFailed: sharedT("toolCallFailed"),
    }),
    [sharedT]
  )

  const sessionSyncState = session?.syncState ?? "idle"

  const { threadItems, nonStreamingAdapted } = useMemo(() => {
    const allTurns = timelineTurns.map((item) => item.turn)
    const streamingIndices = new Set<number>()
    timelineTurns.forEach((item, i) => {
      if (item.phase === "streaming") streamingIndices.add(i)
    })
    const allAdapted = adaptMessageTurns(
      allTurns,
      adapterText,
      streamingIndices.size > 0 ? streamingIndices : undefined
    )

    // Collect non-streaming adapted messages for plan extraction
    const nonStreaming = allAdapted.filter(
      (_, index) => timelineTurns[index].phase !== "streaming"
    )

    // Map each adapted message directly to a render item (1:1).
    // Backend group_into_turns() already ensures each turn is a complete unit.
    const items: ThreadRenderItem[] = allAdapted.map((msg, i) => {
      const phase = timelineTurns[i].phase
      const role = msg.role === "tool" ? "assistant" : msg.role
      return {
        key: `${phase}-${msg.id}-${i}`,
        kind: "turn" as const,
        group: {
          id: msg.id,
          role,
          parts: msg.content,
          resources: msg.userResources ?? [],
          images: msg.userImages ?? [],
          usage: msg.usage,
          duration_ms: msg.duration_ms,
          model: msg.model,
        },
        phase,
      }
    })

    const lastPhase = timelineTurns[timelineTurns.length - 1]?.phase ?? null
    if (
      lastPhase === "optimistic" &&
      (connStatus === "prompting" || sessionSyncState === "awaiting_persist")
    ) {
      items.push({ key: "pending-typing", kind: "typing" })
    }

    return { threadItems: items, nonStreamingAdapted: nonStreaming }
  }, [adapterText, connStatus, sessionSyncState, timelineTurns])

  const historicalPlanEntries = useMemo(
    () => extractLatestPlanEntriesFromMessages(nonStreamingAdapted),
    [nonStreamingAdapted]
  )
  const historicalPlanKey = useMemo(
    () => buildPlanKey(historicalPlanEntries),
    [historicalPlanEntries]
  )

  const locatorRawTurns = useMemo<SessionLocatorRawTurn[]>(
    () =>
      threadItems.flatMap((item, threadIndex) => {
        if (item.kind !== "turn") return []

        return [
          {
            turnId: item.group.id,
            role: item.group.role,
            phase: item.phase,
            threadIndex,
            parts: item.group.parts,
            resourceCount: item.group.resources.length,
            imageCount: item.group.images.length,
          },
        ]
      }),
    [threadItems]
  )

  const sessionLocatorItems = useMemo(
    () =>
      buildSessionLocatorItems(
        locatorRawTurns.filter((turn) => {
          if (turn.role === "system") return false
          if (turn.phase === "streaming") return false
          if (turn.phase === "optimistic") return turn.role === "user"
          return true
        })
      ),
    [locatorRawTurns]
  )

  const renderThreadItem = useCallback(
    (item: ThreadRenderItem) => {
      switch (item.kind) {
        case "turn": {
          const isHighlightedTurn = highlightedTarget?.turnId === item.group.id
          return (
            <HistoricalMessageGroup
              group={item.group}
              dimmed={item.phase === "optimistic"}
              highlightedPartIndex={
                isHighlightedTurn ? highlightedTarget.partIndex : null
              }
              highlightTurn={isHighlightedTurn}
              highlightToken={
                isHighlightedTurn ? highlightedTarget.token : undefined
              }
            />
          )
        }
        case "typing":
          return <PendingTypingIndicator />
        default:
          return null
      }
    },
    [highlightedTarget]
  )

  const emptyState = useMemo(
    () =>
      hideEmptyState ? null : (
        <div className="px-4 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            {t("emptyConversation")}
          </p>
        </div>
      ),
    [hideEmptyState, t]
  )

  const agentPlanOverlayKey = liveMessage?.id ?? `history-${conversationId}`
  const sessionLocatorKey = `conversation-${conversationId}`
  const handleJumpToTarget = useCallback((target: SessionLocatorTarget) => {
    locatorJumpTokenRef.current += 1
    const activeJumpToken = locatorJumpTokenRef.current

    const nextHighlight: HighlightedLocatorTarget = {
      turnId: target.turnId,
      partIndex: target.partIndex,
      token: Date.now(),
    }

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }

    setHighlightedTarget(null)
    threadRef.current?.scrollToIndex(target.threadIndex, {
      align: "start",
      behavior: "auto",
    })

    let attempts = 0

    const finalizeHighlight = () => {
      if (locatorJumpTokenRef.current !== activeJumpToken) return

      setHighlightedTarget(nextHighlight)
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedTarget((current) =>
          current?.token === nextHighlight.token ? null : current
        )
      }, LOCATOR_HIGHLIGHT_DURATION_MS)
    }

    const scheduleAlignment = (callback: () => void) => {
      let remainingFrames = LOCATOR_ALIGNMENT_FRAME_DELAY

      const tick = () => {
        if (locatorJumpTokenRef.current !== activeJumpToken) return
        if (remainingFrames <= 0) {
          callback()
          return
        }

        remainingFrames -= 1
        requestAnimationFrame(tick)
      }

      requestAnimationFrame(tick)
    }

    const alignTarget = () => {
      if (locatorJumpTokenRef.current !== activeJumpToken) return

      const root = rootRef.current
      const scrollElement = threadRef.current?.getScrollElement()
      if (!root || !scrollElement) {
        finalizeHighlight()
        return
      }

      const turnElement = Array.from(
        root.querySelectorAll<HTMLElement>("[data-turn-id]")
      ).find((element) => element.dataset.turnId === target.turnId)

      const targetElement =
        target.partIndex === null
          ? turnElement
          : (turnElement?.querySelector<HTMLElement>(
              `[data-content-part-index="${target.partIndex}"]`
            ) ?? turnElement)

      if (targetElement) {
        const scrollRect = scrollElement.getBoundingClientRect()
        const targetRect = targetElement.getBoundingClientRect()
        const nextTop =
          scrollElement.scrollTop +
          (targetRect.top - scrollRect.top) -
          LOCATOR_TARGET_TOP_OFFSET_PX
        const anchorTop = scrollRect.top + LOCATOR_TARGET_TOP_OFFSET_PX
        const distanceFromAnchor = targetRect.top - anchorTop
        const isVisible =
          targetRect.bottom >=
            scrollRect.top + LOCATOR_TARGET_VISIBILITY_PADDING_PX &&
          targetRect.top <=
            scrollRect.bottom - LOCATOR_TARGET_VISIBILITY_PADDING_PX
        const isAligned =
          Math.abs(distanceFromAnchor) <= LOCATOR_TARGET_ALIGNMENT_TOLERANCE_PX

        if (isVisible && isAligned) {
          finalizeHighlight()
          return
        }

        scrollElement.scrollTo({
          top: Math.max(0, nextTop),
          behavior: "auto",
        })
      }

      attempts += 1
      if (attempts < LOCATOR_TARGET_MAX_ALIGNMENT_ATTEMPTS) {
        scheduleAlignment(alignTarget)
      } else {
        finalizeHighlight()
      }
    }

    scheduleAlignment(alignTarget)
  }, [])

  const hasRenderableContent = threadItems.length > 0 || Boolean(liveMessage)

  if (detailLoading && !hasRenderableContent) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </div>
    )
  }

  if (detailError && !hasRenderableContent) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-destructive text-sm">
            {t("error", { message: detailError })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col">
      <MessageThread
        className="flex-1 min-h-0"
        resize={shouldUseSmoothResize ? "smooth" : undefined}
      >
        <AutoScrollOnSend signal={sendSignal} />
        <VirtualizedMessageThread
          ref={threadRef}
          items={threadItems}
          getItemKey={(item) => item.key}
          renderItem={renderThreadItem}
          emptyState={emptyState}
          estimateSize={180}
          overscan={10}
        />
      </MessageThread>
      {liveMessage && connStatus === "prompting" && (
        <LiveTurnStats
          message={liveMessage}
          agentType={agentType}
          isStreaming={connStatus === "prompting"}
        />
      )}
      <SessionLocatorOverlay
        items={sessionLocatorItems}
        locatorKey={sessionLocatorKey}
        onJumpToTarget={handleJumpToTarget}
      />
      <AgentPlanOverlay
        key={agentPlanOverlayKey}
        message={liveMessage ?? null}
        entries={historicalPlanEntries}
        planKey={historicalPlanKey}
        defaultExpanded={connStatus === "prompting"}
      />
    </div>
  )
}
