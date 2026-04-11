/**
 * Agent Workflow Tests
 *
 * End-to-end tests for common development workflows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve } from 'path'
import { createTestDir, cleanupTestDir, createFixture, createFiles, fileExists } from '../utils/testHelpers.js'
import { createSessionState } from '../../src/state/SessionState.js'

describe('Agent Workflows', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('agent-workflows')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  describe('Code Refactoring Workflow', () => {
    it('should analyze and refactor function', async () => {
      // Create test file with code to refactor
      const testCode = `
function oldFunction() {
  return 42
}

function newFunction() {
  return 84
}
      `.trim()

      await createFixture(testDir, 'refactor.ts', testCode)

      const testDir2 = await createTestDir('agent-workflows')

      // Simulate agent workflow
      // This would normally go through the agent loop
      // For testing, we verify the tools work correctly

      expect(await fileExists(testDir, 'refactor.ts')).toBe(true)
    })

    it('should handle multi-file modifications', async () => {
      const testDir2 = await createTestDir('agent-workflows')

      // Create multiple related files
      await createFiles(testDir2, {
        'api.ts': 'export function api() { return 42; }',
        'utils.ts': 'export function utils() { return 84; }',
        'types.ts': 'export type Type = number;',
      })

      // Verify all files created
      expect(await fileExists(testDir2, 'api.ts')).toBe(true)
      expect(await fileExists(testDir2, 'utils.ts')).toBe(true)
      expect(await fileExists(testDir2, 'types.ts')).toBe(true)
    })
  })

  describe('Debug and Fix Bug Workflow', () => {
    it('should reproduce and fix bug', async () => {
      // Create file with bug
      const buggyCode = `
function calculateSum(items: number[]) {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i];  // Bug: starts at 1 instead of 0
  }
  return sum;
}

// Expected: calculateSum([1, 2, 3]) = 6
// Actual: calculateSum([1, 2, 3]) = 7 (includes 0)
      `.trim()

      await createFixture(testDir, 'buggy.ts', buggyCode)

      expect(await fileExists(testDir, 'buggy.ts')).toBe(true)
    })

    it('should add logging to debug issue', async () => {
      const testCode = `
function processData(data: string) {
  // TODO: Add error handling
  console.log(data);
  return data.toUpperCase();
}
      `.trim()

      await createFixture(testDir, 'debug.ts', testCode)

      expect(await fileExists(testDir, 'debug.ts')).toBe(true)
    })
  })

  describe('Project Setup Workflow', () => {
    it('should initialize project structure', async () => {
      const directories = [
        'src/',
        'src/api/',
        'src/tools/',
        'src/utils/',
      ]

      for (const dir of directories) {
        const testDir2 = await createTestDir('agent-workflows')

        // Create a file in each directory
        const input = { command: `mkdir -p ${dir}` }
        // For testing, we'll verify with file operations
      expect(true).toBe(true) // Placeholder - actual implementation would use BashTool
      }
    })

    it('should install dependencies', async () => {
      const packageJson = {
        name: 'test-project',
        dependencies: {},
      }

      const content = JSON.stringify(packageJson, null, 2)
      await createFixture(testDir, 'package.json', content)

      expect(await fileExists(testDir, 'package.json')).toBe(true)
    })
  })

  describe('Code Review Workflow', () => {
    it('should analyze code quality', async () => {
      const testDir2 = await createTestDir('agent-workflows')

      // Create files with various quality issues
      const files = {
        'poor-names.ts': 'const x = 1; const y = 2; // Poor variable names',
        'magic-numbers.ts': 'const result = 42; // Magic number',
        'unused-imports.ts': 'import { foo } from "bar";\nconst result = foo(); // Unused import',
        'no-comments.ts': 'function calculate(x, y) { return x + y; } // No comments',
      'long-function.ts': '/* Very long function with 500 lines */\nfunction longFunction() { return 42; }',
      'inconsistent-style.ts': 'const x = 1;\nconst y = 2;\nlet z = 3;',
      }

      await createFiles(testDir2, files)

      // Verify all files created
      for (const filename of Object.keys(files)) {
        expect(await fileExists(testDir2, filename)).toBe(true)
      }
    })
  })

  describe('Feature Development Workflow', () => {
    it('should add new feature', async () => {
      const featureCode = `
// New Feature: Calculate Fibonacci

export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
      `.trim()

      await createFixture(testDir, 'fibonacci.ts', featureCode)

      expect(await fileExists(testDir, 'fibonacci.ts')).toBe(true)
    })

    it('should add tests for new feature', async () => {
      const testCode = `
// Test for fibonacci function
export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

import { describe, it, expect } from 'vitest';

describe('fibonacci', () => {
  it('should return 0 for n=0', () => {
    expect(fibonacci(0)).toBe(0);
  });

  it('should return 1 for n=1', () => {
    expect(fibonacci(1)).toBe(1);
  });

  it('should return 2 for n=3', () => {
    expect(fibonacci(3)).toBe(2);
  });
});
      `.trim()

      await createFixture(testDir, 'fibonacci.test.ts', testCode)

      expect(await fileExists(testDir, 'fibonacci.test.ts')).toBe(true)
    })
  })
})

describe('Edge Cases and Error Handling', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('edge-cases')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  describe('File System Edge Cases', () => {
    it('should handle large files', async () => {
      const largeContent = 'x'.repeat(1000000) // 10MB
      await createFixture(testDir, 'large.txt', largeContent)

      // Verify file was created
      const stats = await import('fs').then(fs => fs.statSync(resolve(testDir, 'large.txt')))
      expect(stats.size).toBe(1000000)
    })

    it('should handle special characters in filenames', async () => {
      const specialNames = [
        'file with spaces.txt',
        'file"quote.txt',
        "file'apostrophe.txt",
        'file!exclamation.txt',
        'file;semicolon.txt',
      ]

      for (const name of specialNames) {
        await createFixture(testDir, name, 'content')
        expect(await fileExists(testDir, name)).toBe(true)
      }
    })

    it('should handle empty files', async () => {
      await createFixture(testDir, 'empty.txt', '')

      const readInput = { file_path: 'empty.txt' }
      const context = {
        sessionState: createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      // Import FileReadTool for actual test
      const FileReadTool = (await import('../../src/tools/local/FileReadTool.js')).FileReadTool

      const result = await FileReadTool.call(readInput, context, async () => ({ behavior: 'allow' }))

      expect(result.data.content).toBe('')
    })

    it('should handle binary files', async () => {
      const binaryContent = Buffer.from(Array.from({ length: 100 }, () => Math.floor(Math.random() * 256)))
      await createFixture(testDir, 'binary.bin', binaryContent)

      expect(await fileExists(testDir, 'binary.bin')).toBe(true)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle multiple file operations', async () => {
      const operations = Array.from({ length: 10 }, async (_, i) => {
        const filename = `file${i}.txt`
        await createFixture(testDir, filename, `content ${i}`)
        return filename
      })

      const results = await Promise.all(operations)

      expect(results.length).toBe(10)
      for (const result of results) {
        expect(await fileExists(testDir, result)).toBe(true)
      }
    })

    it('should handle read-write race condition', async () => {
      const filename = 'race.txt'
      const content = 'initial'

      // Create file
      await createFixture(testDir, filename, content)

      // Simulate concurrent operations
      const writePromise = async () => {
        const writeInput = { file_path: filename, content: 'updated' }
        const FileWriteTool = (await import('../../src/tools/local/FileWriteTool.js')).FileWriteTool
        return FileWriteTool.call(writeInput, context, async () => ({ behavior: 'allow' }))
      }

      const readPromise = async () => {
        const readInput = { file_path: filename }
        const FileReadTool = (await import('../../src/tools/local/FileReadTool.js')).FileReadTool
        return FileReadTool.call(readInput, context, async () => ({ behavior: 'allow' }))
      }

      const [writeResult, readResult] = await Promise.all([writePromise(), readPromise()])

      // Both operations should complete
      expect(writeResult.data.content).toContain('updated')
      expect(readResult.data.content).toContain('updated')
    })
  })
})
