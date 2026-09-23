'use client'

import { useEffect, useRef, type ReactNode, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/** Native GET form enhanced with one navigation after typing pauses. */
export function InventorySearchForm({ path, children }: { path: string; children: ReactNode }) {
  const router = useRouter()
  const params = useSearchParams()
  const queryString = params.toString()
  const formRef = useRef<HTMLFormElement>(null)
  const composing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHref = useRef<string | null>(null)
  function clearTimer() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => () => clearTimer(), [path])
  useEffect(() => {
    const form = formRef.current
    if (!form || timer.current) return
    const current = new URLSearchParams(queryString)
    for (const control of Array.from(form.elements)) {
      if (control instanceof HTMLInputElement && control.name === 'q') control.value = current.get('q') ?? ''
      if (control instanceof HTMLSelectElement) control.value = current.get(control.name) ?? ''
    }
    lastHref.current = path + (queryString ? '?' + queryString : '')
  }, [path, queryString])

  function navigate(form: HTMLFormElement) {
    clearTimer()
    const params = new URLSearchParams()
    for (const [key, value] of new FormData(form)) {
      if (typeof value === 'string' && value.trim()) params.set(key, value.trim())
    }
    const href = path + (params.size ? '?' + params.toString() : '')
    if (lastHref.current === href) return
    lastHref.current = href
    router.replace(href, { scroll: false })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    navigate(event.currentTarget)
  }
  return <form ref={formRef} action={path} method="get" className="mb-5" onSubmit={submit}
    onCompositionStart={() => { composing.current = true; clearTimer() }}
    onCompositionEnd={(event) => {
      composing.current = false
      const form = event.currentTarget
      clearTimer()
      timer.current = setTimeout(() => navigate(form), 400)
    }}
    onChange={(event) => {
      if (composing.current) return
      if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'q') return
      const form = event.currentTarget
      clearTimer()
      timer.current = setTimeout(() => navigate(form), 400)
    }}>
    {children}
  </form>
}
