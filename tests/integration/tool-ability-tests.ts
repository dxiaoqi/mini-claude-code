/**
 * Tool Ability Tests
 *
 * End-to-end tests to verify that tools work correctly
 * in realistic scenarios.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDir, cleanupTestDir, createFixture, createFiles, fileExists, getFileStats } from '../utils/testHelpers.js'
import { createSessionState } from '../../src/state/SessionState.js'
import { FileReadTool } from '../../src/tools/local/FileReadTool.js'
import { FileWriteTool } from '../../src/tools/local/FileWriteTool.js'
import { FileEditTool } from '../../src/tools/local/FileEditTool.js'
import { GlobTool } from '../../src/tools/local/GlobTool.js'
import { GrepTool } from '../../src/tools/local/GrepTool.js'
import { BashTool } from '../../src/tools/local/BashTool.js'

describe('Tool Abilities', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('tool-abilities')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  describe('FileReadTool', () => {
    it('should read a file successfully', async () => {
      await createFixture(testDir, 'test.txt', 'Hello, World!')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'test.txt' }
      const result = await FileReadTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.content).toContain('Hello, World!')
      expect(result.data.totalLines).toBe(1)
    })

    it('should read specific line range', async () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5'
      await createFixture(testDir, 'multiline.txt', content)

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'multiline.txt', offset: 2, limit: 2 }
      const result = await FileReadTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.startLine).toBe(2)
      expect(result.data.endLine).toBe(3)
      expect(result.data.totalLines).toBe(5)
    })

    it('should handle missing files gracefully', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'nonexistent.txt' }
      const result = await FileReadTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.content).toContain('File not found')
    })
  })

  describe('FileWriteTool', () => {
    it('should create a new file', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'new-file.txt', content: 'Test content' }
      const result = await FileWriteTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(await fileExists(testDir, 'new-file.txt')).toBe(true)
    })

    it('should overwrite existing file', async () => {
      await createFixture(testDir, 'existing.txt', 'Original content')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'existing.txt', content: 'Updated content' }
      const result = await FileWriteTool.call(input, context, async () => ({ behavior: 'allow' }))

      const content = await readTestFile(testDir, 'existing.txt')
      expect(content).toBe('Updated content')
    })

    it('should create parent directories', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'subdir/file.txt', content: 'Content' }
      const result = await FileWriteTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(await fileExists(testDir, 'subdir/file.txt')).toBe(true)
    })
  })

  describe('FileEditTool', () => {
    it('should replace string content', async () => {
      await createFixture(testDir, 'edit.txt', 'Original content with KEYWORD')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = {
        file_path: 'edit.txt',
        old_string: 'KEYWORD',
        new_string: 'REPLACEMENT'
      }

      const result = await FileEditTool.call(input, context, async () => ({ behavior: 'allow' }))

      const content = await readTestFile(testDir, 'edit.txt')
      expect(content).toContain('REPLACEMENT')
      expect(content).not.toContain('KEYWORD')
    })

    it('should handle multiple replacements', async () => {
      await createFixture(testDir, 'multi.txt', 'FOO bar BAZ qux FOO')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = {
        file_path: 'multi.txt',
        old_string: 'FOO',
        new_string: 'FOO',
        replace_all: true,
      }

      const result = await FileEditTool.call(input, context, async () => ({ behavior: 'allow' }))

      const content = await readTestFile(testDir, 'multi.txt')
      // All FOO should be replaced
      expect(content.match(/FOO/g)).toHaveLength(2)
      // BAZ and qux should remain
      expect(content).toContain('BAZ')
      expect(content).toContain('qux')
    })

    it('should handle missing file', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = {
        file_path: 'missing.txt',
        old_string: 'old',
        new_string: 'new',
      }

      const result = await FileEditTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.content).toContain('File not found')
    })
  })

  describe('GlobTool', () => {
    it('should find files by pattern', async () => {
      await createFiles(testDir, {
        'file1.txt': 'content1',
        'file2.txt': 'content2',
        'file3.txt': 'content3',
        'subdir/file.txt': 'content',
      })

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: '*.txt' }
      const result = await GlobTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.files).toHaveLength(5)
      expect(result.data.files).toContain('subdir/file.txt')
    })

    it('should find all TypeScript files', async () => {
      await createFiles(testDir, {
        'test1.ts': '// test',
        'test2.ts': '// test',
        'test.ts': '// code',
      })

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: '**/*.ts' }
      const result = await GlobTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.files.length).toBeGreaterThanOrEqual(4)
    })

    it('should handle no matches', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: '*.nonexistent' }
      const result = await GlobTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.files).toHaveLength(0)
    })
  })

  describe('GrepTool', () => {
    it('should search for text pattern', async () => {
      await createFixture(testDir, 'search.txt', 'Line 1: target\nLine 2: target\nLine 3: other')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: 'target', path: 'search.txt' }
      const result = await GrepTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.matches.length).toBe(2)
    })

    it('should handle case-insensitive search', async () => {
      await createFixture(testDir, 'case.txt', 'Hello World\nhello world\nHELLO WORLD')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: 'hello', path: 'case.txt', ignoreCase: true }
      const result = await GrepTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.matches.length).toBe(3)
    })

    it('should handle regex patterns', async () => {
      await createFixture(testDir, 'regex.txt', 'test@test.com\nuser@test.org\nadmin@test.net')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: '@test\\.\\.(com|net)', path: 'regex.txt', ignoreCase: false }
      const result = await GrepTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.matches.length).toBe(2)
    })

    it('should handle no matches', async () => {
      await createFixture(testDir, 'nomatch.txt', 'No matches here')

      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { pattern: 'nonexistent', path: 'nomatch.txt' }
      const result = await GrepTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.matches).toHaveLength(0)
    })
  })

  describe('BashTool', () => {
    it('should execute safe read commands', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { command: 'ls' }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.exitCode).toBe(0)
      expect(result.data.stdout.length).toBeGreaterThan(0)
    })

    it('should execute safe write commands', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { command: 'echo "test" > test.txt' }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.exitCode).toBe(0)
      expect(await fileExists(testDir, 'test.txt')).toBe(true)
    })

    it('should respect timeout', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { command: 'sleep 0.1', timeout: 500 }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.timedOut).toBe(true)
    })

    it('should capture stderr', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { command: 'echo "error" >&2' }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.stderr.length).toBeGreaterThan(0)
    })

    it('should handle command errors', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { command: 'nonexistent_command' }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.exitCode).not.toBe(0)
      expect(result.data.stderr).toContain('command not found')
    })

    it('should support piped commands', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { command: 'echo "test" | grep -c test' }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }))

      expect(result.data.exitCode).toBe(0)
    })

    it('should handle background tasks', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      // Create a background task
      const input = { command: '(sleep 1 & echo "done" & wait) || echo "timeout" && sleep 2 && echo "timed out"' }
      const result = await BashTool.call(input, context, async () => ({ behavior: 'allow' }), { timeout: 5000 })

      expect(result.data.exitCode).toBe(0)
      expect(result.data.stdout).toContain('done')
    })
  })

  describe('Tool Chain Scenarios', () => {
    it('should handle read-modify-write workflow', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      // Read file
      const readInput = { file_path: 'workflow.txt' }
      const readResult = await FileReadTool.call(readInput, context, async () => ({ behavior: 'allow' }))

      // Modify file
      const editInput = {
        file_path: 'workflow.txt',
        old_string: 'original',
        new_string: 'modified',
      }
      const editResult = await FileEditTool.call(editInput, context, async () => ({ behavior: 'allow' }))

      // Verify final state
      const content = await readTestFile(testDir, 'workflow.txt')
      expect(content).toContain('modified')
    })

    it('should handle search-and-replace workflow', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      // Create test files
      await createFiles(testDir, {
        'file1.txt': 'old value 1',
        'file2.txt': 'old value 2',
        'file3.txt': 'old value 3',
      })

      // Search for files
      const searchInput = { pattern: 'old value', path: '.' }
      const searchResult = await GrepTool.call(searchInput, context, async () => ({ behavior: 'allow' }))

      expect(searchResult.data.matches).toHaveLength(3)

      // Replace in each file
      for (const match of searchResult.data.matches) {
        const editInput = {
          file_path: match.file,
          old_string: 'old value',
          new_string: 'new value',
        }
        await FileEditTool.call(editInput, context, async () => ({ behavior: 'allow' }))
      }

      // Verify replacements
      const verifyRead = await FileReadTool.call({ file_path: 'file1.txt' }, context, async () => ({ behavior: 'allow' }))
      expect(verifyRead.data.content).toContain('new value')
    })

    it('should handle create-read-edit-delete workflow', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      // Create file
      const writeInput = { file_path: 'temp.txt', content: 'temporary' }
      await FileWriteTool.call(writeInput, context, async () => ({ behavior: 'allow' }))

      // Read file
      const readInput = { file_path: 'temp.txt' }
      const readResult = await FileReadTool.call(readInput, context, async () => ({ behavior: 'allow' }))

      expect(readResult.data.content).toBe('temporary')

      // Delete file
      const deleteInput = { command: 'rm temp.txt' }
      const deleteResult = await BashTool.call(deleteInput, context, async () => ({ behavior: 'allow' }))

      expect(deleteResult.data.exitCode).toBe(0)
      expect(await fileExists(testDir, 'temp.txt')).toBe(false)
    })
  })

  describe('Error Recovery Scenarios', () => {
    it('should continue after tool timeout', async () => {
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      // Create a file that will timeout
      const writeInput = { file_path: 'large.txt', content: 'x'.repeat(1000000) }
      await FileWriteTool.call(writeInput, context, async () => ({ behavior: 'allow' }))

      // Try to read with timeout
      const readInput = { file_path: 'large.txt' }
      const readResult = await FileReadTool.call(readInput, context, async () => ({ behavior: 'allow' }), { timeout: 100 })

      // Should handle gracefully
      expect(readResult.data.content.length).toBeLessThan(1000000)
    })

    it('should handle permission denial gracefully', async () => {
      // Mock permission check to deny
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const input = { file_path: 'protected.txt' }
      const result = await FileWriteTool.call(input, context, async () => ({
        behavior: 'deny',
        reason: 'Permission denied for testing',
      }))

      expect(result.data.content).toContain('Permission denied')
    })
  })
})
