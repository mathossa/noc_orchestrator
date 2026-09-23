'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './button'

/** Native modal semantics provide focus trapping, Escape, and focus restoration. */
export function Modal({
  title,
  children,
  onClose,
  panel = false,
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  panel?: boolean
  busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const trigger = document.activeElement
    if (!dialog.open) dialog.showModal()

    return () => {
      // React removes an unmounted dialog from the top layer itself. Calling
      // dialog.close() here can fire onClose while Strict Mode is replaying
      // effects, which races the parent state that controls this component.
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
      className={`border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] shadow-xl backdrop:bg-black/60 ${panel ? 'fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-2xl' : 'm-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg rounded-lg'}`}
    >
      <div className="flex h-full max-h-[inherit] flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] p-4">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <Button
            autoFocus
            disabled={busy}
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            Close
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </dialog>
  )
}
