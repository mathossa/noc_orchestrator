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

  it('uses a site-only searchable scope workflow', () => {
    const markup = renderToStaticMarkup(createElement(FirmwarePlanCreate))

    expect(markup).toContain('Create maintenance plan')
    expect(markup).toContain('Planning is site-based')
    expect(markup).not.toContain('Individual devices')
    expect(markup).toContain('Proposed maintenance date/time')
    expect(markup).toContain('Resolve scope and preview')
  })

  it('keeps creation and proposal review separate from existing-plan operation', () => {
    const markup = renderToStaticMarkup(createElement(FirmwarePlanCreate))

    expect(markup).toContain('Back to plans')
    expect(markup).toContain('Planning is site-based')
    expect(markup).not.toContain('Customer approved proposed window')
    expect(push).not.toHaveBeenCalled()
  })
})
