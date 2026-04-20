# Blino - Agent Ability Tests

Test suite to evaluate and validate the capabilities of the /blino agent.

## Agent Loop 能力评估 (Agent Loop Capability Evaluation)

### 概述

Agent Loop 能力评估系统用于测试Agent是否真正具备**问题解决的完整能力**，包括：

1. **理解问题** (Understand Problem) - 正确理解和识别问题
2. **主动检索** (Active Retrieval) - 主动查找相关信息
3. **深度分析** (Deep Analysis) - 分析根本原因和多种方案
4. **生成方案** (Generate Solution) - 生成可运行的解决方案
5. **评估迭代** (Evaluate & Iterate) - 验证和迭代改进

### 快速开始

```bash
# 运行Agent Loop能力评估
npm run eval:agent

# 查看详细报告
# 报告会生成在临时目录中
```

### 评估维度

| 维度 | 说明 | 评分 (0-10) |
|------|------|-------------|
| **理解能力** | 能否准确理解问题需求和上下文 | 识别问题、理解预期 |
| **检索能力** | 能否主动查找相关信息和文件 | 使用搜索工具、找到关键文件 |
| **分析能力** | 能否深入分析问题原因 | 比较方案、逻辑分析 |
| **生成能力** | 能否生成高质量可运行的方案 | 代码正确、符合需求 |
| **评估能力** | 能否验证和迭代改进 | 运行测试、反思调整 |

### 测试场景

预定义的测试场景包括：

1. **简单Bug修复** (simple-bug-fix)
   - 修复循环索引问题
   - 预期轮次：3-5
   - 难度：★★☆☆☆

2. **功能实现** (feature-implementation)
   - 实现REST API端点
   - 预期轮次：5-8
   - 难度：★★★☆☆

3. **代码重构** (code-refactoring)
   - 提取重复代码
   - 预期轮次：4-7
   - 难度：★★☆☆☆

4. **复杂问题调试** (debug-complex-issue)
   - 调试内存泄漏
   - 预期轮次：6-10
   - 难度：★★★★☆

### 能力等级

| 等级 | 分数 | 说明 |
|------|------|------|
| **S - 卓越** | 45-50 | Agent具备卓越的问题解决能力，能高效处理复杂问题 |
| **A - 优秀** | 35-44 | Agent具备良好的问题解决能力，能独立完成大部分任务 |
| **B - 良好** | 25-34 | Agent具备基本的问题解决能力，需要少量指导 |
| **C - 合格** | 15-24 | Agent能解决简单问题，复杂问题需要大量帮助 |
| **D - 需要改进** | 0-14 | Agent的问题解决能力不足，需要重大改进 |

### 评估报告

运行评估后会生成详细报告，包括：

- **总体评分** - 各能力维度的得分和总分
- **等级评定** - 基于总分的等级（S/A/B/C/D）
- **执行轨迹** - Agent的完整执行过程记录
- **能力分析** - 对每个能力的详细分析和改进建议
- **效率评估** - 使用轮次和效率评分

### 自定义测试场景

可以创建自定义测试场景：

```typescript
import type { TestScenario } from './evaluators/agentExecutor.js'

const customScenario: TestScenario = {
  id: 'my-custom-test',
  name: '我的自定义测试',
  problem: '描述要测试的问题...',
  initialFiles: {
    'src/example.ts': '// 初始代码',
  },
  expectedBehavior: [
    '期望的行为1',
    '期望的行为2',
  ],
  maxTurns: 10,
  allowBash: true,
}
```

## Test Categories

### 1. Tool Ability Tests (`tests/integration/tool-ability-tests.ts`)

Tests individual tools to ensure they work correctly:

- **File Operations**
  - Read files with line ranges
  - Write new files
  - Edit files (string replacement, multiple replacements)
  - File discovery (Glob patterns)
  - Content search (Grep patterns)
  - Error handling (missing files, permission errors)

- **Bash Execution**
  - Safe commands (ls, cat, grep)
  - Write commands (mkdir, cp, mv, echo)
  - Timeout handling
  - Output parsing (stdout/stderr)
  - Piped commands
  - Background tasks
  - Command classification accuracy

- **Tool Chains**
  - Read-modify-write workflows
  - Search-and-replace workflows
- Multi-file operations

### 2. Agent Workflow Tests (`tests/integration/agent-workflow-tests.ts`)

Tests common development workflows:

- **Code Refactoring**
  - Analyze code structure
  - Make targeted changes
  - Preserve functionality

- **Debug and Fix Bug**
  - Reproduce issues
  - Add logging
  - Verify fixes

- **Project Setup**
  - Initialize project structure
  - Install dependencies

- **Code Review**
  - Analyze code quality
  - Identify issues

- **Feature Development**
  - Implement new features
  - Add tests for features

### 3. Security Tests (`tests/integration/security-tests.ts`)

Validate security mechanisms:

- **Bash Classification**
  - Safe commands correctly classified
  - Dangerous commands blocked
  - Risk level accuracy
  - Edge cases handled

- **Path Security**
  - Absolute path protection
  - Path traversal prevention
  - Symlink attacks

- **Input Validation**
  - Large input handling
  - Special character handling
  - Null/empty input validation

- **Resource Limits**
  - File size limits respected
  - Concurrent operations safe
  - Memory leak prevention

- **Permission System**
  - Permission rules enforced
  - Privilege escalation blocked

- **Audit Logging**
  - All executions logged
  - Permission decisions logged
  - Security events tracked

### 4. Performance Tests (`tests/integration/performance-tests.ts`)

Verify efficient operation:

- **Tool Performance**
  - Small file operations fast
  - Large files handled efficiently
  - Glob searches performant

- **Memory Management**
  - Large results don't cause issues
  - Result size limits respected
  - No memory leaks in long sessions

- **Concurrency**
  - Parallel operations efficient
  - No corruption from concurrent writes
  - Proper locking where needed

- **Scalability**
  - Large projects handled efficiently
- - Deep directory structures
- - Long-running operations

### 5. Agent Evaluation (`tests/integration/agent-evaluation.ts`)

Evaluate agent intelligence:

- **Code Understanding**
  - Project structure comprehension
  - Code pattern recognition
  - Language-specific knowledge

- **Task Execution**
  - Simple tasks completed
  - Complex tasks broken down
  - Task dependencies respected

- **Error Handling**
  - Errors handled gracefully
  - Recovery strategies work
  - Helpful error messages

- **Context Management**
  - Conversation history maintained
  - Long conversations handled
  - Context limits respected

- **Tool Selection**
  - Appropriate tools chosen
  - Inappropriate tools avoided

- **Task Planning**
  - Tasks properly decomposed
  - Execution order correct
  - Dependencies identified

- **Learning & Adaptation**
  - Learns from feedback
- Adapts to preferences
- Improves over time

## Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test tool-ability-tests
npm test agent-workflow-tests
npm test security-tests
npm test performance-tests
npm test agent-evaluation

# Run with coverage
npm run test:coverage

# Run UI
npm run test:ui
```

## Test Utilities

### `tests/utils/testHelpers.ts`

Common utilities for writing tests:

- `createTestDir()` - Create isolated test directories
- `cleanupTestDir()` - Clean up test artifacts
- `createTestFile()` - Create test fixtures
- `createFixture()` - Create standard fixtures
- `readTestFile()` - Read from test directory
- `fileExists()` - Verify file exists
- `getFileStats()` - Get file statistics
- `createFiles()` - Batch create multiple files

## Test Structure

```
tests/
├── utils/
│   └── testHelpers.ts
├── unit/
│   ├── permissions/
│   │   └── bashClassifier.test.ts (39 tests)
│   ├── state/
│   │   └── SessionState.test.ts (17 tests)
├── integration/
│   ├── tool-ability-tests.ts
│   ├── agent-workflow-tests.ts
│   ├── security-tests.ts
│   ├── performance-tests.ts
│   └── agent-evaluation.ts
└── README.md
```

## Adding New Tests

When adding new tests:

1. **Choose the right category**
   - Individual tool: `tests/unit/tools/`
   - Tool ability: `tests/integration/tool-ability-tests.ts`
   - Workflow: `tests/integration/agent-workflow-tests.ts`

2. **Follow the pattern**
   ```typescript
   describe('FeatureName', () => {
     it('should do something', async () => {
       // Arrange
       const context = setupTestContext()

       // Act
       const result = await tool.call(input, context, ...)

       // Assert
       expect(result).toBe(expected)
     })
   })
   ```

3. **Use test utilities**
   - Create isolated test directories
- Create fixtures for test data
- Clean up after tests
- Use `beforeAll` and `afterAll` for setup/cleanup

4. **Test edge cases**
   - Success paths
- - Error paths
- - Boundary conditions
- - Security concerns

## Coverage Goals

- **Tools**: 90%+ coverage for all tools
- **Security**: 100% coverage for security-critical paths
- **Performance**: All critical paths tested
- **Workflows**: Common development patterns covered

## Future Enhancements

1. **Visual Reports**
   - HTML test reports with charts
   - Performance comparison over time
   - Security trend analysis

2. **Benchmarking**
   - Automated performance baselines
   - Regression detection
   - Performance threshold alerts

3. **Intelligence Tests**
   - More complex problem-solving tasks
   - Multi-step reasoning validation
   - Code understanding metrics

4. **Integration Tests**
   - Full end-to-end agent flows
   - Multi-user scenarios
   - API integration tests
   - MCP integration tests

This test suite provides comprehensive validation of the agent's capabilities across multiple dimensions: correctness, security, performance, and intelligence.
