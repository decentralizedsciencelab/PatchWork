/**
 * Track B: BaxBench Django External Validation
 *
 * Generates Django solutions for BaxBench tasks using GPT-4o, then runs
 * the full graph-construction + failure-detection pipeline.
 *
 * Prerequisites:
 *   - Run scripts/run-baxbench.py first to export outputs/baxbench_django_tasks.json
 *   - OPENAI_API_KEY must be set
 *
 * Usage:
 *   npx ts-node src/run-baxbench-eval.ts              # all 28 tasks
 *   npx ts-node src/run-baxbench-eval.ts --dry         # 1 task, print generated code
 *   npx ts-node src/run-baxbench-eval.ts --limit=5     # first 5 tasks
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { EnhancedGraphConstructor } from './services/EnhancedGraphConstructor';
import { FailureDetector } from './services/FailureDetector';
import { MetricsCalculator } from './services/MetricsCalculator';
import { ResultSerializer } from './services/ResultSerializer';
import { RunSummary } from './services/RunSummary';
import { PipelineConfig } from './services/PipelineConfig';
import { Generation, Graph, FailureDetection, DetectionMetrics } from './types';
import { EvaluationResult } from './interfaces/IEvaluationPipeline';
import * as fs from 'fs';

// ── CLI flags ────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry');
const limitFlag = process.argv.find(a => a.startsWith('--limit='));
const taskLimit = limitFlag ? parseInt(limitFlag.split('=')[1] ?? '0', 10) : 0;
const modelFlag = process.argv.find(a => a.startsWith('--model='));
const selectedModel = modelFlag ? modelFlag.split('=')[1] ?? 'gpt-4o' : 'gpt-4o';

// ── Types ────────────────────────────────────────────────────────────

interface BaxBenchTask {
  id: string;
  env_id: string;
  text_specification: string;
  api_specification: string;
  scenario_instructions: string;
  env_instructions: string;
  code_filename: string | null;
  needs_db: boolean;
  needs_secret: boolean;
  env_multifile: boolean;
}

interface BaxBenchData {
  source: string;
  filter: string;
  total_tasks: number;
  tasks: BaxBenchTask[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.warn(`    [retry] attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function buildDjangoPrompt(task: BaxBenchTask): string {
  let prompt = `You are a senior Django developer. Generate a complete Django project for the following specification.\n\n`;
  prompt += `## Application Description\n${task.text_specification}\n\n`;

  if (task.scenario_instructions) {
    prompt += `## Scenario Instructions\n${task.scenario_instructions}\n\n`;
  }

  if (task.env_instructions) {
    prompt += `## Environment Instructions\n${task.env_instructions}\n\n`;
  }

  if (task.api_specification) {
    // Truncate long API specs to stay within token limits
    const apiSpec = task.api_specification.length > 3000
      ? task.api_specification.slice(0, 3000) + '\n...(truncated)'
      : task.api_specification;
    prompt += `## API Specification (OpenAPI 3.0.3)\n${apiSpec}\n\n`;
  }

  prompt += `## Requirements\n`;
  prompt += `- Generate a multi-file Django project with: models.py, views.py, urls.py, settings.py\n`;
  if (task.needs_db) {
    prompt += `- Include database models and migrations setup\n`;
  }
  if (task.needs_secret) {
    prompt += `- Include proper secret/environment variable handling (SECRET_KEY, etc.)\n`;
  }
  prompt += `- Use proper Django patterns and configuration\n`;
  prompt += `\nGenerate the complete code for all files.`;

  return prompt;
}

async function callGPT4o(prompt: string, apiKey: string): Promise<string> {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 4000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    },
  );
  return response.data.choices[0].message.content;
}

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 120000,
      },
    );
    return response.data.content[0].text;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      console.error(`  [claude-api] Status: ${err.response.status}`);
      console.error(`  [claude-api] Body:`, JSON.stringify(err.response.data));
    }
    throw err;
  }
}

async function callQwen(prompt: string, apiKey: string): Promise<string> {
  const response = await axios.post(
    'https://router.huggingface.co/v1/chat/completions',
    {
      model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 4000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    },
  );
  return response.data.choices[0].message.content;
}

async function callModel(prompt: string, model: string): Promise<string> {
  if (model === 'claude') {
    const key = process.env['ANTHROPIC_API_KEY'] ?? '';
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    return callClaude(prompt, key);
  }
  if (model === 'qwen') {
    const key = process.env['HUGGING_FACE_HUB_TOKEN'] ?? '';
    if (!key) throw new Error('HUGGING_FACE_HUB_TOKEN not set');
    return callQwen(prompt, key);
  }
  const key = process.env['OPENAI_API_KEY'] ?? '';
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return callGPT4o(prompt, key);
}

// ── Checkpoint ───────────────────────────────────────────────────────

const CHECKPOINT_PATH = `outputs/baxbench_eval_${selectedModel}_checkpoint.json`;

interface Checkpoint {
  startedAt: string;
  entries: Array<{ taskId: string; result: EvaluationResult }>;
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8')) as Checkpoint;
    }
  } catch { /* start fresh */ }
  return null;
}

function saveCheckpoint(cp: Checkpoint): void {
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('='.repeat(80));
  const modelLabel = selectedModel === 'claude' ? 'Claude Sonnet 4.5' : selectedModel === 'qwen' ? 'Qwen2.5-Coder-32B' : 'GPT-4o';
  console.log(`Track B — BaxBench Django External Validation [${modelLabel}]${isDryRun ? ' (DRY)' : ''}`);
  console.log('='.repeat(80));

  // Validate API key for selected model
  if (selectedModel === 'claude') {
    if (!process.env['ANTHROPIC_API_KEY']) {
      console.error('FATAL: ANTHROPIC_API_KEY not set.');
      process.exit(1);
    }
  } else if (selectedModel === 'qwen') {
    if (!process.env['HUGGING_FACE_HUB_TOKEN']) {
      console.error('FATAL: HUGGING_FACE_HUB_TOKEN not set.');
      process.exit(1);
    }
  } else {
    if (!process.env['OPENAI_API_KEY']) {
      console.error('FATAL: OPENAI_API_KEY not set.');
      process.exit(1);
    }
  }

  const dataPath = 'outputs/baxbench_django_tasks.json';
  if (!fs.existsSync(dataPath)) {
    console.error('FATAL: outputs/baxbench_django_tasks.json not found.');
    console.error('Run: python3 scripts/run-baxbench.py first.');
    process.exit(1);
  }

  const baxData: BaxBenchData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  let tasks = baxData.tasks;

  if (isDryRun) {
    tasks = tasks.slice(0, 1);
  } else if (taskLimit > 0) {
    tasks = tasks.slice(0, taskLimit);
  }

  console.log(`\nBaxBench Django tasks: ${tasks.length}`);
  console.log(`  needs_db:     ${tasks.filter(t => t.needs_db).length}`);
  console.log(`  needs_secret: ${tasks.filter(t => t.needs_secret).length}`);

  // Components
  const config = new PipelineConfig();
  const enhancedGC = new EnhancedGraphConstructor(config);
  const failureDetector = new FailureDetector();
  const metricsCalc = new MetricsCalculator();
  const serializer = new ResultSerializer();
  const summary = new RunSummary();

  let checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`  [checkpoint] Resuming — ${checkpoint.entries.length} tasks done`);
  } else {
    checkpoint = { startedAt: new Date().toISOString(), entries: [] };
  }

  const completedIds = new Set(checkpoint.entries.map(e => e.taskId));
  const allResults: EvaluationResult[] = [...checkpoint.entries.map(e => e.result)];
  let apiCalls = 0;

  for (const task of tasks) {
    if (completedIds.has(task.id)) {
      console.log(`  [skip] ${task.id} (checkpoint)`);
      continue;
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Task: ${task.id}  db=${task.needs_db}  secret=${task.needs_secret}`);
    console.log(`  "${task.text_specification.slice(0, 100)}..."`);

    // 1. Generate Django code
    const prompt = buildDjangoPrompt(task);
    let generatedCode: string;
    try {
      const t0 = Date.now();
      generatedCode = await withRetry(() => callModel(prompt, selectedModel));
      apiCalls++;
      console.log(`  [${selectedModel}] ${generatedCode.length} chars in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(`  [${selectedModel}] FAILED:`, err);
      continue;
    }

    // Dry run: print the code and stop
    if (isDryRun) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('Generated Code (inspect for settings.py / env patterns):');
      console.log('='.repeat(80));
      console.log(generatedCode);
      console.log('='.repeat(80));

      // Quick checks
      const hasSettings = generatedCode.toLowerCase().includes('settings.py') || generatedCode.includes('DATABASES');
      const hasEnvVar = /os\.environ|os\.getenv|env\(|SECRET_KEY/.test(generatedCode);
      const hasModels = generatedCode.includes('models.Model') || generatedCode.includes('models.py');

      console.log(`\nQuick checks:`);
      console.log(`  Has settings.py / DATABASES: ${hasSettings}`);
      console.log(`  Has os.environ / SECRET_KEY: ${hasEnvVar}`);
      console.log(`  Has Django models:           ${hasModels}`);

      if (!hasSettings && !hasEnvVar) {
        console.log(`\n  WARNING: No env var patterns found. BCI detector likely won't fire.`);
      }
      return;
    }

    // 2. Create generation object
    const generation: Generation = {
      id: `baxbench_${task.id}`,
      taskId: task.id,
      model: selectedModel === 'claude' ? 'Claude-3.5-Sonnet' : selectedModel === 'qwen' ? 'Qwen2.5-Coder-32B' : 'GPT-4o',
      promptStrategy: 'P1',
      contextFiles: [],
      generatedCode,
      timestamp: new Date(),
    };

    // 3. Graph construction
    let graphs: Graph[] = [];
    try {
      const t0 = Date.now();
      graphs = await enhancedGC.buildAllGraphs(generation);
      console.log(`  [graphs]  ${graphs.length} types in ${Date.now() - t0}ms`);
      for (const g of graphs) {
        if (g.nodes.length > 0 || g.edges.length > 0) {
          console.log(`    ${g.type.padEnd(14)} n=${g.nodes.length} e=${g.edges.length}`);
        }
        summary.addGraphResult(g);
      }
    } catch (err) {
      console.error(`  [graphs] CRASHED:`, err);
    }

    // 4. Failure detection
    let failures: FailureDetection[] = [];
    try {
      const t0 = Date.now();
      failures = await failureDetector.detectAllFailures(generation, graphs);
      console.log(`  [detect]  ${failures.length} findings in ${Date.now() - t0}ms`);
      const byCat: Record<string, number> = {};
      for (const f of failures) {
        byCat[f.category] = (byCat[f.category] || 0) + 1;
        summary.addFailureResult(f.category, f.severity, generation.id);
      }
      for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${cat.padEnd(6)} ${count}`);
      }
    } catch (err) {
      console.error(`  [detect] CRASHED:`, err);
    }

    // 5. Metrics
    let metrics: DetectionMetrics[] = [];
    try {
      metrics = await metricsCalc.calculateDetectionMetrics(failures, []);
    } catch { /* ignore */ }

    const result: EvaluationResult = {
      taskId: task.id,
      generations: [generation],
      graphs,
      failures,
      metrics,
    };
    allResults.push(result);
    checkpoint.entries.push({ taskId: task.id, result });
    saveCheckpoint(checkpoint);

    await sleep(1000); // Rate limit
  }

  // ── Report ────────────────────────────────────────────────────────
  summary.end();
  const report = serializer.generateReport(allResults);
  const totalGens = report.summary.totalGenerations;
  const totalFindings = report.summary.totalFailures;
  const failureRate = totalGens > 0 ? ((totalFindings / totalGens) * 100).toFixed(1) : '0.0';

  console.log(`\n${'='.repeat(80)}`);
  console.log('BaxBench Django — Results');
  console.log('='.repeat(80));
  console.log(`  Tasks:     ${allResults.length}`);
  console.log(`  Findings:  ${totalFindings}`);
  console.log(`  Rate:      ${failureRate}%`);
  console.log(`  API calls: ${apiCalls}`);

  if (Object.keys(report.summary.failuresByCategory).length > 0) {
    console.log(`\n  By category:`);
    for (const [cat, count] of Object.entries(report.summary.failuresByCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat.padEnd(6)} ${count}`);
    }
  }

  // ── Save ──────────────────────────────────────────────────────────
  fs.mkdirSync('outputs', { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, '-');
  const outputPath = `outputs/baxbench_eval_${selectedModel}_${ts}.json`;
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'BaxBench',
    filter: 'Python-Django',
    totalTasks: allResults.length,
    totalFindings,
    failureRate: `${failureRate}%`,
    failuresByCategory: report.summary.failuresByCategory,
    report,
    runSummary: summary.getSummary(),
  }, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  if (!isDryRun && !taskLimit) {
    try { fs.unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
