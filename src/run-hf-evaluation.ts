/**
 * Track A: Open-Source Model External Validation
 *
 * Generates code using Qwen2.5-Coder-32B-Instruct via HuggingFace Inference
 * API, then runs the full graph-construction + failure-detection pipeline.
 * Results are directly comparable to the GPT-4o / Claude frontier dataset.
 *
 * Features:
 *   - Checkpoint/resume: writes progress to outputs/hf_eval_checkpoint.json
 *   - Rate limiting: 2 s delay between API calls (HF rate limits)
 *   - Retry with exponential backoff (3 attempts)
 *   - --dry flag: 1 repo, 1 task for smoke testing
 *   - --limit=N flag: cap total tasks
 *
 * Usage:
 *   npx ts-node src/run-hf-evaluation.ts              # full run
 *   npx ts-node src/run-hf-evaluation.ts --dry         # smoke test (1 task)
 *   npx ts-node src/run-hf-evaluation.ts --limit=5     # first 5 tasks
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { EnhancedGraphConstructor } from './services/EnhancedGraphConstructor';
import { FailureDetector } from './services/FailureDetector';
import { MetricsCalculator } from './services/MetricsCalculator';
import { ResultSerializer } from './services/ResultSerializer';
import { RunSummary } from './services/RunSummary';
import { PipelineConfig } from './services/PipelineConfig';
import { RepositoryManager } from './services/RepositoryManager';
import { TaskGenerator } from './services/TaskGenerator';
import { HuggingFaceEvaluator } from './services/HuggingFaceEvaluator';
import { Generation, Graph, FailureDetection, DetectionMetrics, Task } from './types';
import { EvaluationResult } from './interfaces/IEvaluationPipeline';
import * as fs from 'fs';

// ── CLI flags ────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry');
const limitFlag = process.argv.find(a => a.startsWith('--limit='));
const taskLimit = limitFlag ? parseInt(limitFlag.split('=')[1] ?? '0', 10) : 0;

// ── Checkpoint helpers ───────────────────────────────────────────────

const CHECKPOINT_PATH = 'outputs/hf_eval_checkpoint.json';

interface CheckpointEntry {
  repoId: string;
  taskId: string;
  result: EvaluationResult;
}

interface Checkpoint {
  startedAt: string;
  entries: CheckpointEntry[];
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
      return JSON.parse(raw) as Checkpoint;
    }
  } catch {
    // Corrupt checkpoint — start fresh
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

function isTaskComplete(checkpoint: Checkpoint | null, repoId: string, taskId: string): boolean {
  if (!checkpoint) return false;
  return checkpoint.entries.some(e => e.repoId === repoId && e.taskId === taskId);
}

// ── Rate limiter ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Retry with exponential backoff ───────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt === maxAttempts) break;

      let delayMs = 1000 * Math.pow(2, attempt - 1);
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { headers?: Record<string, string> } }).response;
        const retryAfter = resp?.headers?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) delayMs = parsed * 1000;
        }
      }

      console.warn(`    [retry] attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log(`Patchwork Track A — HuggingFace Qwen2.5-Coder-32B External Validation${isDryRun ? ' (DRY)' : ''}`);
  console.log('='.repeat(80));

  // ── Validate HF token ──────────────────────────────────────────
  const hfToken = process.env['HUGGING_FACE_HUB_TOKEN'] ?? '';
  if (!hfToken) {
    console.error('FATAL: HUGGING_FACE_HUB_TOKEN is not set. Add it to .env or export it.');
    process.exit(1);
  }

  // ── Instantiate components ────────────────────────────────────
  const config = new PipelineConfig();
  const enhancedGC = new EnhancedGraphConstructor(config);
  const failureDetector = new FailureDetector();
  const metricsCalc = new MetricsCalculator();
  const serializer = new ResultSerializer();
  const summary = new RunSummary();
  const repoManager = new RepositoryManager();
  const taskGenerator = new TaskGenerator();
  const hfEvaluator = new HuggingFaceEvaluator(hfToken);

  // ── Test HF connectivity ──────────────────────────────────────
  console.log('\nTesting HuggingFace API connectivity...');
  const connected = await hfEvaluator.testConnection();
  if (!connected) {
    console.warn('  Warning: HF connectivity test failed — proceeding anyway (may fail on first call)');
  } else {
    console.log('  HF API reachable');
  }

  // ── Select repos (same 10 as frontier) ────────────────────────
  const allCurated = await repoManager.loadCuratedRepos();
  const pythonRepos = allCurated.filter(r => r.language === 'Python').slice(0, 5);
  const tsRepos = allCurated.filter(r => r.language === 'TypeScript').slice(0, 5);
  let repos = [...pythonRepos, ...tsRepos];

  if (isDryRun) {
    repos = repos.slice(0, 1);
    console.log(`  [dry] Using 1 repo: ${repos[0]!.name}`);
  }

  console.log(`  Repos selected: ${repos.length} (${pythonRepos.length} Python, ${tsRepos.length} TS)`);

  // ── Load or create checkpoint ─────────────────────────────────
  let checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`  [checkpoint] Resuming — ${checkpoint.entries.length} tasks already completed`);
  } else {
    checkpoint = { startedAt: new Date().toISOString(), entries: [] };
  }

  // ── Per-repo, per-task loop ───────────────────────────────────
  const allResults: EvaluationResult[] = [
    ...checkpoint.entries.map(e => e.result),
  ];
  const stageTimings: Record<string, number[]> = {};
  let apiCalls = 0;
  let skippedFromCheckpoint = 0;
  let totalTasksSoFar = checkpoint.entries.length;

  for (const repo of repos) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Repository: ${repo.name}  (${repo.language} / ${repo.framework})`);
    console.log(`${'─'.repeat(80)}`);

    // Generate 6 tasks: 3 L1 + 2 L2 + 1 L3
    const l1Tasks = await taskGenerator.generateL1Tasks(repo);
    const l2Tasks = await taskGenerator.generateL2Tasks(repo);
    const l3Tasks = await taskGenerator.generateL3Tasks(repo);
    let tasks: Task[] = [...l1Tasks, ...l2Tasks, ...l3Tasks];

    if (isDryRun) {
      tasks = tasks.slice(0, 1);
    }

    console.log(`  Tasks: ${tasks.length} (${l1Tasks.length} L1, ${l2Tasks.length} L2, ${l3Tasks.length} L3)`);

    for (const task of tasks) {
      // Respect --limit flag
      if (taskLimit > 0 && totalTasksSoFar >= taskLimit) {
        console.log(`  [limit] Reached --limit=${taskLimit}, stopping.`);
        break;
      }

      // Skip if already completed from checkpoint
      if (isTaskComplete(checkpoint, repo.id, task.id)) {
        skippedFromCheckpoint++;
        console.log(`  [skip] ${task.id.slice(0, 8)} (from checkpoint)`);
        continue;
      }

      console.log(`\n  Task ${task.id.slice(0, 8)}  ${task.complexity}  "${task.specification.slice(0, 60)}"`);

      // 1. HF API call with retry
      let generation: Generation;
      try {
        const t0 = Date.now();
        generation = await withRetry(() =>
          hfEvaluator.generateWithHF(task, 'P1'),
        );
        const dt = Date.now() - t0;
        (stageTimings['api-call'] ??= []).push(dt);
        apiCalls++;
        console.log(`    [hf-api]  ${generation.generatedCode.length} chars in ${dt}ms`);
      } catch (err) {
        console.error(`    [hf-api] FAILED after retries:`, err);
        continue;
      }

      // 2. Graph construction (enhanced)
      let graphs: Graph[] = [];
      try {
        const t0 = Date.now();
        graphs = await enhancedGC.buildAllGraphs(generation);
        const dt = Date.now() - t0;
        (stageTimings['graphs'] ??= []).push(dt);
        console.log(`    [graphs]  ${graphs.length} graphs in ${dt}ms`);
        for (const g of graphs) {
          console.log(`      ${g.type.padEnd(14)} nodes=${g.nodes.length}  edges=${g.edges.length}`);
          summary.addGraphResult(g);
        }
      } catch (err) {
        console.error(`    [graphs] CRASHED:`, err);
      }

      // 3. Failure detection
      let failures: FailureDetection[] = [];
      try {
        const t0 = Date.now();
        failures = await failureDetector.detectAllFailures(generation, graphs);
        const dt = Date.now() - t0;
        (stageTimings['detection'] ??= []).push(dt);
        console.log(`    [detect]  ${failures.length} findings in ${dt}ms`);

        const byCat: Record<string, number> = {};
        for (const f of failures) {
          byCat[f.category] = (byCat[f.category] || 0) + 1;
          summary.addFailureResult(f.category, f.severity, generation.id);
        }
        for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
          console.log(`      ${cat.padEnd(6)} ${count}`);
        }
      } catch (err) {
        console.error(`    [detect] CRASHED:`, err);
      }

      // 4. Metrics
      let metrics: DetectionMetrics[] = [];
      try {
        const t0 = Date.now();
        metrics = await metricsCalc.calculateDetectionMetrics(failures, []);
        const dt = Date.now() - t0;
        (stageTimings['metrics'] ??= []).push(dt);
        console.log(`    [metrics] ${metrics.length} categories in ${dt}ms`);
      } catch (err) {
        console.error(`    [metrics] CRASHED:`, err);
      }

      const result: EvaluationResult = {
        taskId: task.id,
        generations: [generation],
        graphs,
        failures,
        metrics,
      };
      allResults.push(result);
      totalTasksSoFar++;

      // 5. Checkpoint
      checkpoint.entries.push({ repoId: repo.id, taskId: task.id, result });
      saveCheckpoint(checkpoint);

      // 6. Rate limit — 2 s delay for HF (stricter than OpenAI)
      await sleep(2000);
    }

    if (taskLimit > 0 && totalTasksSoFar >= taskLimit) break;
  }

  // ── Aggregate report ──────────────────────────────────────────
  summary.end();

  console.log(`\n${'='.repeat(80)}`);
  console.log('Aggregate Report — Qwen2.5-Coder-32B');
  console.log(`${'='.repeat(80)}`);

  const report = serializer.generateReport(allResults);
  console.log(`  Total repos:       ${report.summary.totalRepositories}`);
  console.log(`  Total tasks:       ${report.summary.totalTasks}`);
  console.log(`  Total generations: ${report.summary.totalGenerations}`);
  console.log(`  Total findings:    ${report.summary.totalFailures}`);
  console.log(`  API calls made:    ${apiCalls}`);
  console.log(`  Skipped (cached):  ${skippedFromCheckpoint}`);

  // Failure rate comparison
  const totalGens = report.summary.totalGenerations;
  const totalFindings = report.summary.totalFailures;
  const failureRate = totalGens > 0 ? ((totalFindings / totalGens) * 100).toFixed(1) : '0.0';
  console.log(`\n  Failure rate: ${failureRate}%  (compare: GPT-4o=7.3%, Claude=4.2%)`);

  console.log(`\n  Findings by category:`);
  for (const [cat, count] of Object.entries(report.summary.failuresByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(6)} ${count}`);
  }

  // ── Stage timing summary ──────────────────────────────────────
  console.log(`\nStage Timings (ms):`);
  for (const [stage, times] of Object.entries(stageTimings)) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(`  ${stage.padEnd(20)} avg=${avg.toFixed(0)}  max=${max}  runs=${times.length}`);
  }

  const totalDuration = Date.now() - startTime;
  console.log(`\nTotal duration: ${totalDuration}ms`);

  // ── Write output ──────────────────────────────────────────────
  fs.mkdirSync('outputs', { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, '-');
  const outputPath = `outputs/hf_eval_${ts}.json`;

  const output = {
    timestamp: new Date().toISOString(),
    durationMs: totalDuration,
    config: {
      repos: repos.map(r => `${r.name} (${r.language}/${r.framework})`),
      repoCount: repos.length,
      tasksPerRepo: isDryRun ? 1 : 6,
      totalTasks: allResults.length,
      graphTypes: config.graphs,
      promptStrategy: 'P1',
      model: 'Qwen2.5-Coder-32B',
      hfModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      isDryRun,
    },
    stageTimings: Object.fromEntries(
      Object.entries(stageTimings).map(([k, v]) => [k, {
        avgMs: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
        maxMs: Math.max(...v),
        runs: v.length,
      }])
    ),
    comparison: {
      qwen_failureRate: failureRate,
      gpt4o_failureRate: '7.3%',
      claude_failureRate: '4.2%',
    },
    report,
    runSummary: summary.getSummary(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // ── Clean up checkpoint on successful full run ────────────────
  if (!isDryRun && !taskLimit) {
    try { fs.unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
    console.log('Checkpoint cleaned up.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
