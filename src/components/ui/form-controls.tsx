import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const controlClass =
  'w-full rounded-md border border-[var(--border-strong)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50'

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <legend className="px-1 text-sm font-semibold text-[var(--foreground)]">{title}</legend>
      {description ? <p className="mb-4 text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
}: {
  label: string
  htmlFor: string
  description?: string
  error?: string
  children: ReactNode
}) {
  const descriptionId = description ? `${htmlFor}-description` : undefined
  const errorId = error ? `${htmlFor}-error` : undefined

  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-[var(--muted-strong)]">
        {label}
      </label>
      {children}
      {description ? (
        <p id={descriptionId} className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-[#f0a0a0]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlClass} h-10 ${className}`} {...props} />
}

export function SelectInput({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlClass} h-10 ${className}`} {...props}>
      {children}
    </select>
  )
}

export function TextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${controlClass} min-h-28 py-2.5 ${className}`} {...props} />
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4">{children}</div>
}
