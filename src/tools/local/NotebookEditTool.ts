/**
 * NotebookEditTool — Jupyter Notebook 编辑工具
 *
 * 针对 `.ipynb` 文件提供单元格级操作：edit（编辑）、insert（插入）、delete（删除）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { PermissionResult, Tool, ToolResult } from '../../types.js'

const inputSchema = z.object({
  notebook_path: z.string().describe('Path to the .ipynb notebook file'),
  cell_index: z.number().describe('0-based index of the cell to edit or insert at'),
  action: z.enum(['edit', 'insert', 'delete']).describe('Action: edit existing cell, insert new cell, or delete cell'),
  new_source: z.string().optional().describe('New cell content (for edit/insert)'),
  cell_type: z.enum(['code', 'markdown']).optional().describe('Cell type for insert (default: code)'),
})

type Input = z.infer<typeof inputSchema>

interface Output {
  notebookPath: string
  action: string
  cellIndex: number
  success: boolean
  message: string
  totalCells: number
}

export const NotebookEditTool: Tool<Input, Output> = {
  name: 'NotebookEdit',
  aliases: ['NotebookEditTool'],
  description: 'Edit Jupyter notebook (.ipynb) cells. Supports editing, inserting, and deleting cells.',

  inputSchema,
  shouldDefer: true,

  isReadOnly() { return false },
  isConcurrencySafe() { return false },

  interruptBehavior() { return 'block' },

  async checkPermissions(input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: `Allow editing notebook: ${input.notebook_path}`,
    }
  },

  async call(input, context): Promise<ToolResult<Output>> {
    const filePath = isAbsolute(input.notebook_path)
      ? input.notebook_path
      : resolve(context.cwd, input.notebook_path)

    try {
      const raw = await readFile(filePath, 'utf-8')
      const notebook = JSON.parse(raw)

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return {
          data: {
            notebookPath: filePath, action: input.action, cellIndex: input.cell_index,
            success: false, message: 'Invalid notebook format: no cells array', totalCells: 0,
          },
        }
      }

      const cells: Array<{ cell_type: string; source: string[]; metadata: Record<string, unknown>; outputs?: unknown[] }> = notebook.cells

      switch (input.action) {
        case 'edit': {
          if (input.cell_index < 0 || input.cell_index >= cells.length) {
            return {
              data: {
                notebookPath: filePath, action: 'edit', cellIndex: input.cell_index,
                success: false, message: `Cell index ${input.cell_index} out of range (0-${cells.length - 1})`,
                totalCells: cells.length,
              },
            }
          }
          cells[input.cell_index].source = (input.new_source || '').split('\n').map((l, i, arr) =>
            i < arr.length - 1 ? l + '\n' : l
          )
          break
        }

        case 'insert': {
          const idx = Math.min(Math.max(0, input.cell_index), cells.length)
          const newCell = {
            cell_type: input.cell_type || 'code',
            source: (input.new_source || '').split('\n').map((l, i, arr) =>
              i < arr.length - 1 ? l + '\n' : l
            ),
            metadata: {},
            ...(input.cell_type !== 'markdown' ? { outputs: [], execution_count: null } : {}),
          }
          cells.splice(idx, 0, newCell)
          break
        }

        case 'delete': {
          if (input.cell_index < 0 || input.cell_index >= cells.length) {
            return {
              data: {
                notebookPath: filePath, action: 'delete', cellIndex: input.cell_index,
                success: false, message: `Cell index ${input.cell_index} out of range`,
                totalCells: cells.length,
              },
            }
          }
          cells.splice(input.cell_index, 1)
          break
        }
      }

      await writeFile(filePath, JSON.stringify(notebook, null, 1) + '\n', 'utf-8')

      return {
        data: {
          notebookPath: filePath,
          action: input.action,
          cellIndex: input.cell_index,
          success: true,
          message: `Successfully ${input.action}ed cell at index ${input.cell_index}`,
          totalCells: cells.length,
        },
      }
    } catch (err) {
      return {
        data: {
          notebookPath: filePath, action: input.action, cellIndex: input.cell_index,
          success: false, message: `Error: ${(err as Error).message}`, totalCells: 0,
        },
      }
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.message,
      is_error: !output.success,
    }
  },
}
