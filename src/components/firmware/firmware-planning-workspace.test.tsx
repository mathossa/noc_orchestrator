import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MissingServerFiltersNotice,
  StatePill,
} from './firmware-planning-workspace'

describe('firmware planning workspace components', () => {
  it('makes unsupported server-side plan filters explicit instead of filtering one page', () => {
    const markup = renderToStaticMarkup(
      createElement(MissingServerFiltersNotice),
    )
    expect(markup).toContain('Vendor and model-family filtering')
    expect(markup).toContain('no server-side capability')
    expect(markup).toContain('misleading')
  })

  it('marks stale active planning state prominently', () => {
    const markup = renderToStaticMarkup(
      createElement(StatePill, { state: 'SCHEDULED', stale: true }),
    )
    expect(markup).toContain('Scheduled')
    expect(markup).toContain('stale')
  })
})
