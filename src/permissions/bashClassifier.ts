/**
 * Bash 分类器 — Bash 命令分类器（4 级风险评估）
 *
 * 基于正则危险模式与命令前缀白名单，将 Bash 划分为 safe_read、safe_write、
 * needs_confirmation、dangerous，为工具权限决策提供轻量依据。
 */

/**
 * Bash command classifier for permission decisions.
 * Pattern-based approach (vs original's tree-sitter AST parsing).
 * Classifies commands as safe-read / safe-write / needs-confirmation / dangerous.
 */

export type BashRiskLevel = 'safe_read' | 'safe_write' | 'needs_confirmation' | 'dangerous'

interface ClassificationResult {
  risk: BashRiskLevel
  reason: string
}

const DANGEROUS_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+[\/~]/, reason: 'Recursive force delete on root/home path' },
  { pattern: /rm\s+-[a-zA-Z]*f[a-zA-Z]*r\s+[\/~]/, reason: 'Recursive force delete on root/home path' },
  { pattern: /mkfs\./, reason: 'Filesystem formatting' },
  { pattern: /dd\s+if=/, reason: 'Raw disk write' },
  { pattern: />\s*\/dev\/sd/, reason: 'Direct device write' },
  { pattern: /chmod\s+(777|a\+rwx)\s+\//, reason: 'Open permissions on system path' },
  { pattern: /:()\s*\{\s*:\|:&\s*\};:/, reason: 'Fork bomb' },
  { pattern: /curl\s[^|]*\|\s*(bash|sh|zsh)/, reason: 'Pipe remote script to shell' },
  { pattern: /wget\s[^|]*\|\s*(bash|sh|zsh)/, reason: 'Pipe remote script to shell' },
  { pattern: />\s*\/etc\//, reason: 'Overwrite system config' },
  { pattern: /shutdown|reboot|halt|poweroff/, reason: 'System power control' },
  { pattern: /kill\s+-9\s+1\b/, reason: 'Kill init process' },
]

const SAFE_READ_PREFIXES = [
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'du', 'df', 'pwd', 'echo', 'printf', 'which', 'type', 'whereis',
  'whoami', 'uname', 'date', 'env', 'printenv', 'hostname',
  'find', 'locate', 'tree',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'git remote', 'git stash list', 'git tag',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
  'bun --version', 'cargo --version', 'go version', 'java --version',
  'rg', 'grep', 'ag', 'awk', 'sed -n', 'sort', 'uniq', 'cut', 'tr',
  'jq', 'yq', 'xmllint',
  'curl -s', 'wget -q',
  'ps', 'top -l', 'htop', 'free', 'vmstat', 'iostat', 'uptime',
]

const SAFE_WRITE_PREFIXES = [
  'mkdir', 'touch', 'cp', 'mv',
  'git add', 'git commit', 'git push', 'git pull', 'git fetch',
  'git checkout', 'git switch', 'git merge', 'git rebase',
  'git stash', 'git cherry-pick', 'git restore',
  'npm install', 'npm ci', 'npm run', 'npm test', 'npm exec', 'npx',
  'yarn add', 'yarn install', 'yarn run', 'yarn test',
  'pnpm install', 'pnpm add', 'pnpm run', 'pnpm test',
  'bun install', 'bun add', 'bun run', 'bun test',
  'pip install', 'pip3 install', 'python -m pip',
  'cargo build', 'cargo test', 'cargo run', 'cargo add',
  'go build', 'go test', 'go run', 'go get', 'go mod',
  'make', 'cmake',
  'docker build', 'docker run', 'docker compose',
  'chmod', 'chown',
  'tsc', 'eslint', 'prettier', 'biome',
]

const NEEDS_CONFIRMATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s/, reason: 'File deletion' },
  { pattern: /sudo\s/, reason: 'Elevated privileges' },
  { pattern: />\s*[^|]/, reason: 'File overwrite via redirection' },
  { pattern: /pip install.*--break-system/, reason: 'System Python modification' },
  { pattern: /git push.*--force/, reason: 'Force push' },
  { pattern: /git reset\s+--hard/, reason: 'Hard reset' },
  { pattern: /DROP\s+(TABLE|DATABASE)/i, reason: 'Database destructive operation' },
  { pattern: /DELETE\s+FROM/i, reason: 'Database deletion' },
  { pattern: /TRUNCATE/i, reason: 'Database truncation' },
]

export function classifyBashCommand(command: string): ClassificationResult {
  const trimmed = command.trim()

  // Check dangerous patterns first
  for (const { pattern, reason } of DANGEROUS_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { risk: 'dangerous', reason }
    }
  }

  // Multi-command: split on && || ; | and classify each part
  const parts = trimmed.split(/\s*(?:&&|\|\||;)\s*/)
  const subResults = parts.map(part => classifySingleCommand(part.trim()))

  // Worst risk wins
  const riskOrder: BashRiskLevel[] = ['dangerous', 'needs_confirmation', 'safe_write', 'safe_read']
  for (const risk of riskOrder) {
    const match = subResults.find(r => r.risk === risk)
    if (match) return match
  }

  return { risk: 'needs_confirmation', reason: 'Unknown command' }
}

function classifySingleCommand(command: string): ClassificationResult {
  if (!command) return { risk: 'safe_read', reason: 'Empty command' }

  // Check dangerous
  for (const { pattern, reason } of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) {
      return { risk: 'dangerous', reason }
    }
  }

  // Check needs-confirmation
  for (const { pattern, reason } of NEEDS_CONFIRMATION_PATTERNS) {
    if (pattern.test(command)) {
      return { risk: 'needs_confirmation', reason }
    }
  }

  // Check safe read
  // 使用精确前缀匹配：command 必须等于 prefix 或以 "prefix + 空格" 开头，
  // 避免 "npm --version" 首词 "npm" 误匹配 "npm install" 等写操作。
  for (const prefix of SAFE_READ_PREFIXES) {
    if (command === prefix || command.startsWith(prefix + ' ')) {
      // Extra check: read commands with pipe to destructive commands
      if (/\|\s*(rm|dd|mkfs)/.test(command)) {
        return { risk: 'needs_confirmation', reason: 'Read piped to destructive command' }
      }
      return { risk: 'safe_read', reason: `Matches safe read pattern: ${prefix}` }
    }
  }

  // Check safe write
  for (const prefix of SAFE_WRITE_PREFIXES) {
    if (command === prefix || command.startsWith(prefix + ' ')) {
      return { risk: 'safe_write', reason: `Matches safe write pattern: ${prefix}` }
    }
  }

  return { risk: 'needs_confirmation', reason: 'Unrecognized command' }
}
