import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  FirmwarePlanningWorkspace,
  MissingServerFiltersNotice,
} from './firmware-planning-workspace'

describe('firmware planning workspace', () => {
  it('makes unsupported server-side plan filters explicit instead of filtering one page', () => {
    const markup = renderToStaticMarkup(
      createElement(MissingServerFiltersNotice),
    )
    expect(markup).toContain('Vendor and model-family filtering')
    expect(markup).toContain('no server-side capability')
    expect(markup).toContain('misleading')
  })

  it('keeps terminal history separately accessible from active creation work', () => {
    const history = renderToStaticMarkup(
      createElement(FirmwarePlanningWorkspace, {
        initialView: 'history',
      }),
    )
    expect(history).toContain('Completed / cancelled history')
    expect(history).toContain('Historical plans')
    expect(history).toContain('Not available yet')
    expect(history).not.toContain('Create from selected devices')

    const active = renderToStaticMarkup(
      createElement(FirmwarePlanningWorkspace, {
        initialView: 'active',
      }),
    )
    expect(active).toContain('Create from selected devices')
    expect(active).toContain('Selection is explicit')
    expect(active).toContain('Preview selected devices')
  })
})
