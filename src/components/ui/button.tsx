import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-[var(--accent)] bg-[var(--accent)] text-[#07111d] hover:brightness-110',
  secondary:
    'border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
  danger: 'border-[#8f4747] bg-[#512b2b] text-[#ffd7d7] hover:bg-[#653333]',
  ghost: 'border-transparent bg-transparent text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]',
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  )
}
