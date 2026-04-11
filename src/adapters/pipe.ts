/**
 * adapters/pipe.ts — 管道模式适配器
 *
 * 从 stdin 读入、向 stdout 写出，工具调用默认自动批准。
 */
import type {
  PermissionRequest,
  PermissionResponse,
  StreamEvent,
  ToolResult,
  UIAdapter,
} from '../types.js'

/**
 * Pipe mode adapter: reads from stdin, writes to stdout, auto-approves tools.
 */
export class PipeAdapter implements UIAdapter {
  private output = ''

  onStreamEvent(event: StreamEvent): void {
    if (event.type === 'text_delta') {
      process.stdout.write(event.text)
      this.output += event.text
    }
    if (event.type === 'message_end' && this.output) {
      process.stdout.write('\n')
    }
  }

  onToolStart(): void {}
  onToolEnd(): void {}
  onError(error: Error): void {
    process.stderr.write(`Error: ${error.message}\n`)
  }

  async *getUserInput(): AsyncGenerator<string> {
    // Not used in pipe mode
  }

  async requestPermission(_request: PermissionRequest): Promise<PermissionResponse> {
    return { decision: 'allow' }
  }
}
