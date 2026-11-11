import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Alert } from './Alert.vue'
export { default as AlertAction } from './AlertAction.vue'
export { default as AlertDescription } from './AlertDescription.vue'
export { default as AlertTitle } from './AlertTitle.vue'

export const alertVariants = cva('grid gap-0.5 rounded-lg border px-4 py-3 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-36 data-closable:pr-11 data-closable:has-data-[slot=alert-action]:pr-46 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*=size-])]:size-4 group/alert relative w-full', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      // Soft status tones, matching the Badge variants: tinted background and border, coloured text
      destructive: 'border-destructive/30 bg-destructive/8 text-destructive dark:bg-destructive/15 *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
      warning: 'border-warning/30 bg-warning/10 text-warning dark:bg-warning/15 *:data-[slot=alert-description]:text-foreground/80 *:[svg]:text-current',
      success: 'border-success/30 bg-success/8 text-success dark:bg-success/15 *:data-[slot=alert-description]:text-foreground/80 *:[svg]:text-current',
      info: 'border-info/30 bg-info/8 text-info dark:bg-info/15 *:data-[slot=alert-description]:text-foreground/80 *:[svg]:text-current',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type AlertVariants = VariantProps<typeof alertVariants>
