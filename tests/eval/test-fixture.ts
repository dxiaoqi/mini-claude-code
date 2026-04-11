import { generateMonorepo } from './fixtures/generators/monorepo.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, statSync } from 'node:fs'

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'test-fixture-'))
  await generateMonorepo(dir, { withBugs: true, withMissingFeatures: true })

  function tree(d: string, prefix = '') {
    readdirSync(d).filter(e => !['node_modules', '.git'].includes(e)).forEach(e => {
      const full = join(d, e)
      const isDir = statSync(full).isDirectory()
      console.log(prefix + (isDir ? '📁 ' : '📄 ') + e)
      if (isDir) tree(full, prefix + '  ')
    })
  }

  tree(dir)
  console.log('\n✅ Fixture generated at:', dir)
  console.log('Files with bugs:')
  console.log('  packages/core/src/utils.ts  → off-by-one in paginate()')
  console.log('  packages/api/src/routes/users.ts → wrong response format')
  console.log('  packages/auth/src/jwt.ts    → missing TokenExpiredError handling')
  console.log('Missing features:')
  console.log('  packages/api/src/routes/users.ts → PUT/DELETE not implemented')
  console.log('  packages/auth/src/middleware.ts  → requireAuth throws "Not implemented"')
}

main().catch(console.error)
