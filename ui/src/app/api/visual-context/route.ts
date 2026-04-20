/**
 * GET /api/visual-context
 * Returns the visual protocol content for Artifacts mode system prompt injection.
 * The prompt is structured so the OVERRIDE RULES appear first (highest priority)
 * to prevent the agent from using tools when it should generate inline visuals.
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

function readSkill(relativePath: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'skill-pack', relativePath), 'utf-8')
  } catch {
    return ''
  }
}

export async function GET() {
  const visualProtocol = readSkill('visual-protocol.md')

  if (!visualProtocol) {
    return NextResponse.json({ content: null }, { status: 404 })
  }

  // ⚠️ Override rules come FIRST — highest priority for the agent to read.
  // This prevents the agent from using tools (bash/graphviz/dot) for visual generation.
  const overrideRules = `\
## ⚠️ ARTIFACTS MODE — VISUAL GENERATION OVERRIDE RULES (HIGHEST PRIORITY)

These rules override all other tool-use instincts:

1. **NEVER use Bash, ShellTool, or any tool to install graphviz, dot, plantuml, mermaid, or any diagram software.**
2. **NEVER use FileWrite, FileEdit, or any file tool to produce diagram files (.dot, .svg, .png, .puml).**
3. **When the user asks for a diagram, chart, architecture diagram, flowchart, or any visual:**
   - ALWAYS generate it inline using \`<visual type="svg">\` or \`<visual type="html">\` tags.
   - Output the complete SVG or HTML directly inside the visual tag.
   - Do NOT say "let me install..." or "let me run..." — just output the visual.
4. **Tool calls are still allowed for tasks that are NOT about visual generation:**
   - Reading source code to understand the project (before drawing a diagram) → OK
   - Installing packages, running tests, editing files → OK
   - Generating diagram output → NOT OK, use visual protocol instead.
5. **Correct response pattern for "generate a diagram" requests:**
   a. (Optional) Use read-only tools (FileRead, Glob, Grep) to gather context.
   b. Output the diagram directly as \`<visual type="svg">...</visual>\`.
   c. Add a brief \`<text>\` explanation after the visual.`

  const content = [
    overrideRules,
    '---',
    '## Visual Output Protocol (Format Specification)',
    visualProtocol,
  ].join('\n\n')

  return NextResponse.json({ content })
}
