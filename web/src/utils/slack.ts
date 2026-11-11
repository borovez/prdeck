import { PhAt, PhBookmarkSimple, PhChatsCircle, PhCheckSquare, PhUsers } from '@phosphor-icons/vue'
import type { SlackKind } from '@shared/types'

export const KIND = {
  mention: { icon: PhAt, label: 'Mention' },
  dm: { icon: PhChatsCircle, label: 'Direct message' },
  group: { icon: PhUsers, label: 'Group DM' },
  saved: { icon: PhBookmarkSimple, label: 'Saved for later' },
  todo: { icon: PhCheckSquare, label: 'Marked todo' },
} as const satisfies Record<SlackKind, { icon: unknown; label: string }>
