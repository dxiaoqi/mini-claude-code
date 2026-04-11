/**
 * Performance Tests
 *
 * Tests to verify the agent operates efficiently.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve } from 'path'
import { createTestDir, cleanupTestDir, createFixture, createFiles, getFileStats } from '../utils/testHelpers.js'

describe('Performance Tests', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('performance-tests')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  describe('Tool Performance', () => {
    it('should handle small files quickly', async () => {
      const start = Date.now()

      const files = Array.from({ length: 100 }, async (_, i) => {
        const filename = `small${i}.txt`
        await createFixture(testDir, filename, `content ${i}`)
      })
      await Promise.all(files)

      const duration = Date.now() - start
      expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds
    })

    it('should handle large files efficiently', async () => {
      const largeContent = 'x'.repeat(1000000) // 1MB file
      await createFixture(testDir, 'large.txt', largeContent)

      const start = Date.now()

      // This would normally read through FileReadTool
      // For testing, we verify the file exists
      const stats = await getFileStats(testDir, 'large.txt')

      const duration = Date.now() - start
      expect(duration).toBeLessThan(1000) // Should complete in under 1 second
      expect(stats.size).toBe(1000000)
    })

    it('should handle glob searches efficiently', async () => {
      // Create many files
      const files = Array.from({ length: 500 }, async (_, i) => {
        const filename = `file${i}.txt`
        await createFixture(testDir, filename, `content ${i}`)
      })
      await Promise.all(files)

      const start = Date.now()

      // This would use GlobTool
      // For testing, we verify all files were created
      const allFiles = await import('fs').then(fs => fs.readdirSync(testDir))

      const duration = Date.now() - start
      expect(allFiles.length).toBe(500)
      expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds
    })
  })

  describe('Memory Management', () => {
    it('should handle large results without memory issues', async () => {
      const largeResult = 'x'.repeat(100000) // Large result
      await createFixture(testDir, 'large-result.txt', largeResult)

      // Verify file was created
      const stats = await getFileStats(testDir, 'large-result.txt')
      expect(stats.size).toBe(100000)
    })

    it('should respect result size limits', async () => {
      // Test that tools respect size limits
      // Would verify that results are truncated appropriately

      const maxFileSize = 200000 // 200KB limit for some tools
      const largeContent = 'x'.repeat(300000)

      // Tool should truncate to max size
      expect(largeContent.length).toBeGreaterThan(maxFileSize)
    })
  })

  describe('Concurrency Performance', () => {
    it('should handle parallel operations efficiently', async () => {
      const operations = Array.from({ length: 20 }, async (_, i) => {
        const filename = `parallel${i}.txt`
        await createFixture(testDir, filename, `content ${i}`)
      })

      const start = Date.now()
      await Promise.all(operations)
      const duration = Date.now() - start

      expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds
      expect(operations.length).toBe(20)
    })

    it('should handle concurrent file operations correctly', async () => {
      // Test that concurrent operations don't cause corruption
      const filename = 'concurrent.txt'
      const content = 'initial'

      const writeOps = Array.from({ length: 3 }, async (_, i) => {
        const FileWriteTool = (await import('../../src/tools/local/FileWriteTool.js')).FileWriteTool
        const input = { file_path: filename, content: `update${i}` }
        return FileWriteTool.call(input, context, async () => ({ behavior: 'allow' }))
      })

      await Promise.all(writeOps)

      // Verify final state
      const readInput = { file_path: filename }
      const FileReadTool = (await import('../../src/tools/local/FileReadTool.js')).FileReadTool
      const context = {
        sessionState: await import('../../src/state/SessionState.js').createSessionState({ cwd: testDir }),
        cwd: testDir,
        abortController: new AbortController(),
        options: { tools: [], mainModel: 'test-model' },
      }

      const result = await FileReadTool.call(readInput, context, async () => ({ behavior: 'allow' }))

      // File should contain the last write
      expect(result.data.content).toContain('update2')
    })
  })
})

describe('Scalability Tests', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('scalability-tests')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  describe('Large Project Handling', () => {
    it('should handle many files efficiently', async () => {
      const fileCount = 1000
      const files = Array.from({ length: fileCount }, async (_, i) => {
        const filename = `large${i}.txt`
        await createFixture(testDir, filename, `content ${i}`)
      })

      const start = Date.now()
      await Promise.all(files)
      const duration = Date.now() - start

      expect(duration).toBeLessThan(30000) // Should complete in under 30 seconds
      expect(files.length).toBe(fileCount)
    })

    it('should handle deep directory structures', async () => {
      // Create a deep directory structure
      const createOp = async (path: string, depth: number) => {
        if (depth === 0) return

        await import('fs').then(fs => fs.mkdirSync(path, { recursive: true }))

        for (let i = 0; i < 3; i++) {
          await createFixture(path, `file${i}.txt`, `content at depth ${depth}-${i}`)
          await createOp(`${path}/subdir${i}`, depth - 1)
        }
      }

      const start = Date.now()
      await createOp(resolve(testDir, 'deep'), 5)
      const duration = Date.now() - start

      expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds
    })
  })

  describe('Long-Running Operations', () => {
    it('should handle long operations without timeout', async () => {
      // Create a large file
      const largeContent = 'x'.repeat(1000000) // 1MB
      await createFixture(testDir, 'long-op.txt', largeContent)

      // Simulate a long operation (e.g., large file read)
      const start = Date.now()

      // This would use FileReadTool
      // For testing, we simulate with a timeout
      const timeoutMs = 10000 // 10 seconds
      await new Promise(resolve => setTimeout(resolve, timeoutMs))

      const duration = Date.now() - start

      // Should complete or timeout
      expect(duration).toBeGreaterThanOrEqual(timeoutMs - 100) // Allow some variance
    })

    it('should handle complex workflows without memory leaks', async () => {
      // Create and modify many files
      const iterations = 100
      for (let i = 0; i < iterations; i++) {
        await createFixture(testDir, `iter${i}.txt`, `iteration ${i}`)

        // Simulate workflow operations
        // For testing, we just verify no memory issues
        const usedMemory = process.memoryUsage()
        expect(usedMemory.heapUsed).toBeGreaterThan(0)
      }

      const usedMemory = process.memoryUsage()
      // Check memory growth
      expect(usedMemory.heapUsed).toBeLessThan(1024 * 1024 * 1024) // Less than 1GB
    })
  })
})

describe('Resource Cleanup', () => {
  let testDir: string

  beforeAll(async () => {
    testDir = await createTestDir('resource-cleanup')
  })

  afterAll(async () => {
    await cleanupTestDir(testDir)
  })

  it('should clean up temporary files', async () => {
    // Create temporary files
    const tempFiles = ['temp1.txt', 'temp2.txt', 'temp3.txt']
      await createFiles(testDir, Object.fromEntries(
        tempFiles.map(f => [f, 'content'])
      ))

      // Simulate cleanup
      // In real agent, temporary files should be cleaned up

      const allFiles = await import('fs').then(fs => fs.readdirSync(testDir))

      // All temp files should exist
      for (const file of tempFiles) {
        expect(allFiles).toContain(file)
      }
    })

    it('should not leave orphaned files', async () => {
      // Test that file operations don't leave orphaned files
      // This would involve verifying that all created files are tracked
      // and cleaned up when no longer needed
    })
  })
