import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

import { FirmwarePlanCreate } from './firmware-plan-create'

describe('maintenance plan creation workspace', () => {
  beforeEach(() => {
    push.mockReset()
  })

  it('defaults to site-oriented scope selection while retaining individual-device mode', () => {
    const markup = renderToStaticMarkup(createElement(FirmwarePlanCreate))

    expect(markup).toContain('Create maintenance plan')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Sites<\/button>/)
    expect(markup).toMatch(
      /aria-pressed="false"[^>]*>Individual devices<\/button>/,
    )
    expect(markup).toContain('Proposed maintenance date/time')
    expect(markup).toContain('Resolve scope and preview')
  })

  it('keeps creation and proposal review separate from existing-plan operation', () => {
    const markup = renderToStaticMarkup(createElement(FirmwarePlanCreate))

    expect(markup).toContain('Back to plans')
    expect(markup).toContain('Site scope is the normal path')
    expect(markup).not.toContain('Customer approved proposed window')
    expect(push).not.toHaveBeenCalled()
  })
})
