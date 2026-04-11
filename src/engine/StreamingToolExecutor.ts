/**
 * 流式工具执行器 — 流式并行工具执行器
 *
 * 在流式 API 响应尚未结束时即根据 tool_use 块启动工具执行，跟踪各工具 pending
 * 与完成状态，并与可中断行为及 UI 提交门控对齐（贴近上游 Claude Code 设计）。
 */
import type {
  AssistantMessage,
  CanUseToolFn,
  Tool,
  ToolContext,
  ToolResult,
  ToolResultBlock,
  ToolUseBlock,
} from '../types.js'
import { findToolByName } from '../tools/registry.js'
import { takeSnapshot } from '../state/fileHistory.js'
import { resolve, isAbsolute } from 'node:path'
import { handleSilentError } from '../errors/handlers.js'

interface TrackedTool {
  block: ToolUseBlock
  tool: Tool | undefined
  status: 'pending' | 'executing' | 'completed' | 'error'
  promise: Promise<ToolResultBlock> | null
  result: ToolResultBlock | null
}

/**
 * StreamingToolExecutor: starts executing tools as soon as they appear
 * in the stream, before the API response completes.
 *
 * Matches original Claude Code's design:
 *   - Tools start executing during streaming
 *   - interruptBehavior is checked for user interrupts
 *   - setHasInterruptibleToolInProgress controls UI submit behavior
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolDefinitions: Tool[]
  private toolContext: ToolContext
  private canUseTool: CanUseToolFn
  private assistantMessage: AssistantMessage
  private hasErrored = false
  private discarded = false

  constructor(
    toolDefinitions: Tool[],
    toolContext: ToolContext,
    canUseTool: CanUseToolFn,
    assistantMessage: AssistantMessage,
  ) {
    this.toolDefinitions = toolDefinitions
    this.toolContext = toolContext
    this.canUseTool = canUseTool
    this.assistantMessage = assistantMessage
  }

  /**
   * Add a tool_use block and start executing it immediately.
   */
  addTool(block: ToolUseBlock): void {
    const tool = findToolByName(block.name, this.toolDefinitions)
    const tracked: TrackedTool = {
      block,
      tool,
      status: 'pending',
      promise: null,
      result: null,
    }

    this.tools.push(tracked)

    tracked.promise = this.executeTool(tracked)
    this.updateInterruptibleState()
  }

  hasTools(): boolean {
    return this.tools.length > 0
  }

  /**
   * Wait for all tools to complete and return results.
   */
  async getRemainingResults(): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = []

    for (const tracked of this.tools) {
      if (tracked.result) {
        results.push(tracked.result)
        continue
      }

      if (tracked.promise) {
        try {
          const result = await tracked.promise
          results.push(result)
        } catch (err) {
          results.push({
            type: 'tool_result',
            tool_use_id: tracked.block.id,
            content: `Tool execution error: ${(err as Error).message}`,
            is_error: true,
          })
        }
      }
    }

    return results
  }

  /**
   * Discard all pending results (e.g. on fallback model switch).
   */
  discard(): void {
    this.discarded = true
  }

  private async executeTool(tracked: TrackedTool): Promise<ToolResultBlock> {
    tracked.status = 'executing'

    const { block, tool } = tracked

    if (!tool) {
      tracked.status = 'error'
      const result: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Error: Unknown tool "${block.name}"`,
        is_error: true,
      }
      tracked.result = result
      return result
    }

    // Check abort/discard
    const abortReason = this.getAbortReason(tracked)
    if (abortReason) {
      tracked.status = 'error'
      const result: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Tool cancelled: ${abortReason}`,
        is_error: true,
      }
      tracked.result = result
      return result
    }

    // Permission check
    const permResult = await this.canUseTool(tool, block.input, this.assistantMessage)
    if (permResult.behavior === 'deny') {
      tracked.status = 'error'
      const result: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Permission denied: ${'reason' in permResult ? permResult.reason : 'denied'}`,
        is_error: true,
      }
      tracked.result = result
      return result
    }

    // Take file snapshot before write operations
    if (!tool.isReadOnly?.(block.input as never)) {
      const filePath = (block.input as Record<string, unknown>).file_path as string
        ?? (block.input as Record<string, unknown>).notebook_path as string
      if (filePath) {
        const absPath = isAbsolute(filePath) ? filePath : resolve(this.toolContext.cwd, filePath)
        await takeSnapshot(this.toolContext.sessionState, absPath, tool.name).catch(err => {
          handleSilentError(err, {
            sessionId: this.toolContext.sessionState.sessionId,
            toolName: tool.name,
            filePath: absPath,
            context: 'snapshot',
          })
        })
      }
    }

    try {
      const toolResult = await tool.call(
        block.input as never,
        this.toolContext,
        this.canUseTool,
        this.assistantMessage,
      )

      const resultBlock = tool.mapToolResultToToolResultBlockParam
        ? tool.mapToolResultToToolResultBlockParam(toolResult.data as never, block.id)
        : {
            tool_use_id: block.id,
            type: 'tool_result' as const,
            content: typeof toolResult.data === 'string'
              ? toolResult.data
              : JSON.stringify(toolResult.data),
          }

      tracked.status = 'completed'
      tracked.result = resultBlock as ToolResultBlock
      return tracked.result
    } catch (err) {
      this.hasErrored = true
      tracked.status = 'error'
      const result: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Tool execution error: ${(err as Error).message}`,
        is_error: true,
      }
      tracked.result = result
      return result
    } finally {
      this.updateInterruptibleState()
    }
  }

  private getAbortReason(tracked: TrackedTool): string | null {
    if (this.discarded) return 'streaming_fallback'
    if (this.hasErrored) return 'sibling_error'

    const signal = this.toolContext.abortController.signal
    if (signal.aborted) {
      if (signal.reason === 'interrupt') {
        return this.getToolInterruptBehavior(tracked) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      return 'user_interrupted'
    }

    return null
  }

  private getToolInterruptBehavior(tracked: TrackedTool): 'cancel' | 'block' {
    if (!tracked.tool?.interruptBehavior) return 'block'
    try {
      return tracked.tool.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    const allCancellable = executing.length > 0 &&
      executing.every(t => this.getToolInterruptBehavior(t) === 'cancel')

    this.toolContext.setHasInterruptibleToolInProgress?.(allCancellable)
  }
}
