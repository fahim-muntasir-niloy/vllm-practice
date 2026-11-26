import type { FC } from 'react'
import logo from '@/assets/logo.png'

const mask = `url("${logo}") center / contain no-repeat`

/** The app logo, painted in the current text colour so it works on any background. */
export const Logo: FC<{ className?: string }> = ({ className = '' }) => (
  <span
    aria-hidden
    className={`inline-block shrink-0 bg-current ${className}`}
    style={{ mask, WebkitMask: mask }}
  />
)
