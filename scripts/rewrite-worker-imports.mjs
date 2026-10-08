import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'

const root = resolve('.worker-dist')

async function filesUnder(path) {
  const entries = await readdir(path)
  const result = []
  for (const entry of entries) {
    const full = resolve(path, entry)
    if ((await stat(full)).isDirectory()) result.push(...await filesUnder(full))
    else if (full.endsWith('.js')) result.push(full)
  }
  return result
}

function modulePath(fromFile, aliasPath) {
  const target = resolve(root, 'src', aliasPath)
  const withExtension = extname(target) ? target : `${target}.js`
  let value = relative(dirname(fromFile), withExtension).split(sep).join('/')
  if (!value.startsWith('.')) value = `./${value}`
  return value
}

for (const file of await filesUnder(root)) {
  const source = await readFile(file, 'utf8')
  const rewritten = source.replace(
    /(['"])@\/([^'"]+)\1/g,
    (_match, quote, aliasPath) => `${quote}${modulePath(file, aliasPath)}${quote}`,
  )
  if (rewritten !== source) await writeFile(file, rewritten)
}
