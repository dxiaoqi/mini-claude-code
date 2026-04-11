/**
 * Test Helpers
 *
 * Common utilities for writing tests.
 */
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

/**
 * Create a temporary test directory.
 */
export async function createTestDir(name: string): Promise<string> {
  const baseDir = process.cwd()
  const testDir = resolve(baseDir, '.test-tmp', name)

  // Clean up if exists
  try {
    await rm(testDir, { recursive: true })
  } catch {
    // Ignore
  }

  await mkdir(testDir, { recursive: true })
  return testDir
}

/**
 * Clean up test directories.
 */
export async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true })
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a test file with content.
 */
export async function createTestFile(
  testDir: string,
  filename: string,
  content: string
): Promise<string> {
  const filePath = resolve(testDir, filename)
  await writeFile(filePath, content, 'utf-8')
  return filePath
}

/**
 * Create a test fixture file.
 */
export async function createFixture(
  testDir: string,
  filename: string,
  content: string
): Promise<void> {
  await createTestFile(testDir, `fixtures/${filename}`, content)
}

/**
 * Read a file from test directory.
 */
export async function readTestFile(
  testDir: string,
  filename: string
): Promise<string> {
  const filePath = resolve(testDir, filename)
  return await readFile(filePath, 'utf-8')
}

/**
 * Create multiple files at once.
 */
export async function createFiles(
  testDir: string,
  files: Record<string, string>
): Promise<void> {
  for (const [filename, content] of Object.entries(files)) {
    await createTestFile(testDir, filename, content)
  }
}

/**
 * Verify file exists.
 */
export async function fileExists(
  testDir: string,
  filename: string
): Promise<boolean> {
  try {
    await stat(resolve(testDir, filename))
    return true
  } catch {
    return false
  }
}

/**
 * Get file stats.
 */
export async function getFileStats(
  testDir: string,
  filename: string
): Promise<{ size: number; isFile: boolean }> {
  try {
    const stats = await stat(resolve(testDir, filename))
    return { size: stats.size, isFile: stats.isFile() }
  } catch {
    return { size: 0, isFile: false }
  }
}
