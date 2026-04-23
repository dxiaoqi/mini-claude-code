/**
 * 将内置 skill-creator 模板写入项目 `.blino/skills/skill-creator.md`
 *（供 `blino init` 与 HTTP POST 使用）。
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBlinoDir } from './paths.js'

const TEMPLATE_REL = join('templates', 'blino-skills', 'skill-creator.md')

function getTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/utils -> .. -> dist -> .. -> package root
  return resolve(here, '..', '..', TEMPLATE_REL)
}

export interface InstallSkillCreatorResult {
  ok: boolean
  path: string
  created: boolean
  message: string
}

/**
 * @param force 为 true 时覆盖已存在的同名文件
 */
export async function installSkillCreator(
  projectRoot: string,
  options?: { force?: boolean },
): Promise<InstallSkillCreatorResult> {
  const destDir = resolve(projectRoot, getBlinoDir(), 'skills')
  const destPath = join(destDir, 'skill-creator.md')

  let src: string
  try {
    src = await readFile(getTemplatePath(), 'utf-8')
  } catch (e) {
    return {
      ok: false,
      path: destPath,
      created: false,
      message: `Template not found at ${getTemplatePath()}: ${(e as Error).message}`,
    }
  }

  try {
    await mkdir(destDir, { recursive: true })
  } catch (e) {
    return {
      ok: false,
      path: destPath,
      created: false,
      message: `Failed to create ${destDir}: ${(e as Error).message}`,
    }
  }

  if (!options?.force) {
    try {
      await readFile(destPath, 'utf-8')
      return {
        ok: true,
        path: destPath,
        created: false,
        message: 'skill-creator.md already exists (use --force to overwrite)',
      }
    } catch {
      // not exists, continue
    }
  }

  try {
    await writeFile(destPath, src, 'utf-8')
  } catch (e) {
    return {
      ok: false,
      path: destPath,
      created: false,
      message: (e as Error).message,
    }
  }

  return {
    ok: true,
    path: destPath,
    created: true,
    message: options?.force
      ? 'Wrote built-in skill-creator (overwrite)'
      : 'Wrote built-in skill-creator',
  }
}
