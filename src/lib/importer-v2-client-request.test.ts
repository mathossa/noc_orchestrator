import { afterEach, expect, it, vi } from 'vitest'
import { fetchImporterV2Read } from './importer-v2-client-request'
afterEach(() => vi.unstubAllGlobals())

it('shares concurrent workspace GETs but permits independent body readers and fresh refreshes', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', fetch)
  const first = fetchImporterV2Read('/workspace?page=2')
  const second = fetchImporterV2Read('/workspace?page=2')
  expect(fetch).toHaveBeenCalledTimes(1)
  finish(Response.json({ total: 12000 }))
  expect(await (await first).json()).toEqual({ total: 12000 })
  expect(await (await second).json()).toEqual({ total: 12000 })
  fetch.mockResolvedValueOnce(Response.json({ total: 11999 }))
  expect(await (await fetchImporterV2Read('/workspace?page=2')).json()).toEqual(
    { total: 11999 },
  )
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not merge different filters and releases failed requests for retry', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  await expect(fetchImporterV2Read('/workspace?page=1')).rejects.toThrow(
    'offline',
  )
  fetch.mockResolvedValue(Response.json({}))
  await Promise.all([
    fetchImporterV2Read('/workspace?page=1'),
    fetchImporterV2Read('/workspace?page=2'),
  ])
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('does not reuse an older in-flight response after a correction revision', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({}))
  vi.stubGlobal('fetch', fetch)
  await Promise.all([
    fetchImporterV2Read('/workspace', 'before'),
    fetchImporterV2Read('/workspace', 'after'),
  ])
  expect(fetch).toHaveBeenCalledTimes(2)
})
