import { useColorMode } from '@vueuse/core'

/** 'auto' follows the OS; toggles the `.dark` class on <html> that the shadcn tokens key off. */
export const useTheme = () => useColorMode({ storageKey: 'prdeck-theme', emitAuto: true })
