import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[#3B82F6] text-white',
        secondary: 'border-transparent bg-[#F3F4F6] text-[#111827]',
        destructive: 'border-transparent bg-[#EF4444] text-white',
        outline: 'text-[#111827]',
        success: 'border-transparent bg-[#10B981] text-white',
        warning: 'border-transparent bg-[#F59E0B] text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
