"use client"

import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useDbMessageDetail } from "@/hooks/use-db-message-detail"
import { useConversationRuntime } from "@/contexts/conversation-runtime-context"
import { ContentPartsRenderer } from "./content-parts-renderer"
import {
  adaptMessageTurns,
  type AdaptedContentPart,
  type MessageGroup,
  type UserImageDisplay,
  type UserResourceDisplay,
  groupAdaptedMessages,
  extractUserResourcesFromText,
} from "@/lib/adapters/ai-elements-adapter"
import { TurnStats } from "./turn-stats"
import { LiveTurnStats } from "./live-turn-stats"
import { UserResourceLinks } from "./user-resource-links"
import { UserImageAttachments } from "./user-image-attachments"
import { useSessionStats } from "@/contexts/session-stats-context"
import { AgentPlanOverlay } from "@/components/chat/agent-plan-overlay"
import { MessageThread } from "@/components/ai-elements/message-thread"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  buildPlanKey,
  extractLatestPlanEntriesFromMessages,
} from "@/lib/agent-plan"
import type { ConnectionStatus } from "@/lib/types"
import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"
import { useStickToBottomContext } from "use-stick-to-bottom"

interface MessageListViewProps {
  conversationId: number
  connStatus?: ConnectionStatus | null
  isActive?: boolean
  sendSignal?: number
}

interface ResolvedMessageGroup extends MessageGroup {
  parts: AdaptedContentPart[]
  resources: UserResourceDisplay[]
  images: UserImageDisplay[]
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

function fallbackExtractUserResources(
  group: MessageGroup,
  attachedResourcesText: string
): {
  parts: AdaptedContentPart[]
  resources: UserResourceDisplay[]
  images: UserImageDisplay[]
} {
  if (group.role !== "user") {
    return {
      parts: group.parts,
      resources: group.userResources ?? [],
      images: group.userImages ?? [],
    }
  }

  const parsedResources: UserResourceDisplay[] = []
  const parsedParts: AdaptedContentPart[] = []

  for (const part of group.parts) {
    if (part.type !== "text") {
      parsedParts.push(part)
      continue
    }
    const extracted = extractUserResourcesFromText(part.text)
    if (extracted.resources.length > 0) {
      parsedResources.push(...extracted.resources)
      if (extracted.text.length > 0) {
        parsedParts.push({ type: "text", text: extracted.text })
      }
    } else {
      parsedParts.push(part)
    }
  }

  const resources = [...(group.userResources ?? []), ...parsedResources]
  const dedupedResources: UserResourceDisplay[] = []
  const seen = new Set<string>()
  for (const resource of resources) {
    const key = `${resource.name}::${resource.uri}`
    if (seen.has(key)) continue
    seen.add(key)
    dedupedResources.push(resource)
  }

  if (parsedParts.length === 0 && dedupedResources.length > 0) {
    parsedParts.push({ type: "text", text: attachedResourcesText })
  }

  return {
    parts: parsedParts,
    resources: dedupedResources,
    images: group.userImages ?? [],
  }
}

function resolveMessageGroup(
  group: MessageGroup,
  attachedResourcesText: string
): ResolvedMessageGroup {
  const resolved = fallbackExtractUserResources(group, attachedResourcesText)
  return {
    ...group,
    parts: resolved.parts,
    resources: resolved.resources,
    images: resolved.images,
  }
}

const HistoricalMessageGroup = memo(function HistoricalMessageGroup({
  group,
  dimmed = false,
}: {
  group: ResolvedMessageGroup
  dimmed?: boolean
}) {
  return (
    <div className={dimmed ? "opacity-70" : undefined}>
      <Message from={group.role}>
        {group.role === "user" && group.images.length > 0 ? (
          <UserImageAttachments images={group.images} className="self-end" />
        ) : null}
        <MessageContent>
          <ContentPartsRenderer parts={group.parts} role={group.role} />
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
  connStatus,
  isActive = true,
  sendSignal = 0,
}: MessageListViewProps) {
  const t = useTranslations("Folder.chat.messageList")
  const sharedT = useTranslations("Folder.chat.shared")
  const { detail, loading, error } = useDbMessageDetail(conversationId)
  const { getSession, getTimelineTurns } = useConversationRuntime()
  const session = getSession(conversationId)
  const liveMessage = session?.liveMessage ?? null
  const timelineTurns = getTimelineTurns(conversationId)

  const { setSessionStats } = useSessionStats()
  const sessionStats = detail?.session_stats ?? null

  useEffect(() => {
    if (isActive) {
      setSessionStats(sessionStats)
    }
  }, [isActive, sessionStats, setSessionStats])

  const shouldUseSmoothResize = !(isActive && !loading && timelineTurns.length)
  const attachedResourcesText = sharedT("attachedResources")

  const groupedTimeline = useMemo(
    () =>
      timelineTurns.reduce<
        Array<{
          phase: "persisted" | "optimistic" | "streaming"
          turns: typeof timelineTurns
        }>
      >((acc, item) => {
        const current = acc[acc.length - 1]
        if (current && current.phase === item.phase) {
          current.turns.push(item)
          return acc
        }
        acc.push({
          phase: item.phase,
          turns: [item],
        })
        return acc
      }, []),
    [timelineTurns]
  )

  const threadItems = useMemo<ThreadRenderItem[]>(() => {
    const items: ThreadRenderItem[] = []
    for (
      let chunkIndex = 0;
      chunkIndex < groupedTimeline.length;
      chunkIndex++
    ) {
      const chunk = groupedTimeline[chunkIndex]
      const adapted = adaptMessageTurns(
        chunk.turns.map((item) => item.turn),
        {
          attachedResources: sharedT("attachedResources"),
          toolCallFailed: sharedT("toolCallFailed"),
        }
      )
      const groups = groupAdaptedMessages(adapted).map((group) =>
        resolveMessageGroup(group, attachedResourcesText)
      )
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex]
        items.push({
          key: `${chunk.phase}-${chunkIndex}-${group.id}-${groupIndex}`,
          kind: "turn",
          group,
          phase: chunk.phase,
        })
      }
    }
    const lastPhase = timelineTurns[timelineTurns.length - 1]?.phase ?? null
    if (connStatus === "prompting" && lastPhase === "optimistic") {
      items.push({ key: "pending-typing", kind: "typing" })
    }
    return items
  }, [
    attachedResourcesText,
    connStatus,
    groupedTimeline,
    sharedT,
    timelineTurns,
  ])

  const historicalMessages = useMemo(
    () =>
      adaptMessageTurns(
        timelineTurns
          .filter((item) => item.phase !== "streaming")
          .map((item) => item.turn),
        {
          attachedResources: sharedT("attachedResources"),
          toolCallFailed: sharedT("toolCallFailed"),
        }
      ),
    [sharedT, timelineTurns]
  )
  const historicalPlanEntries = useMemo(
    () => extractLatestPlanEntriesFromMessages(historicalMessages),
    [historicalMessages]
  )
  const historicalPlanKey = useMemo(
    () => buildPlanKey(historicalPlanEntries),
    [historicalPlanEntries]
  )

  const renderThreadItem = useCallback((item: ThreadRenderItem) => {
    switch (item.kind) {
      case "turn":
        return (
          <HistoricalMessageGroup
            group={item.group}
            dimmed={item.phase === "optimistic"}
          />
        )
      case "typing":
        return <PendingTypingIndicator />
      default:
        return null
    }
  }, [])

  const emptyState = useMemo(
    () => (
      <div className="px-4 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          {t("emptyConversation")}
        </p>
      </div>
    ),
    [t]
  )

  const agentPlanOverlayKey = liveMessage?.id ?? `history-${conversationId}`

  const hasRenderableContent = threadItems.length > 0 || Boolean(liveMessage)

  if (loading && !hasRenderableContent) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </div>
    )
  }

  if (error && !hasRenderableContent) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-destructive text-sm">
            {t("error", { message: error })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <MessageThread
        className="flex-1 min-h-0"
        resize={shouldUseSmoothResize ? "smooth" : undefined}
      >
        <AutoScrollOnSend signal={sendSignal} />
        <VirtualizedMessageThread
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
          isStreaming={connStatus === "prompting"}
        />
      )}
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
