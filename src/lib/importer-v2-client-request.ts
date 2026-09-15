// Share only pending GETs. Completed responses are never cached: a correction
// must always see fresh workspace/QA state. Clone for independent body readers.
const pending = new Map<string, Promise<Response>>()

export async function fetchImporterV2Read(url: string, revision = ''): Promise<Response> {
  const key = `${revision}\0${url}`
  let request = pending.get(key)
  if (!request) {
    request = fetch(url, { cache: 'no-store' })
    pending.set(key, request)
  }
  try {
    return (await request).clone()
  } finally {
    if (pending.get(key) === request) pending.delete(key)
  }
}
