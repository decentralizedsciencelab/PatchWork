/**
 * Phase 2.1 Scaled Pilot Run — 10 repos, 60 tasks, Claude P1.
 *
 * Calls Claude to generate code for 60 tasks across 10 curated repos
 * (5 Python + 5 TypeScript), then runs graph construction, failure
 * detection, and metrics on each generation.
 *
 * Features:
 *   - Checkpoint/resume: writes progress to outputs/phase2_checkpoint.json
 *   - Rate limiting: 1 s delay between API calls
 *   - Retry with exponential backoff (3 attempts)
 *   - --dry flag: 1 repo, 1 task, verify API connectivity
 *
 * Usage:
 *   npx ts-node src/run-phase2.ts          # full run (60 tasks)
 *   npx ts-node src/run-phase2.ts --dry    # smoke test (1 task)
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
import { ModelEvaluator } from './services/ModelEvaluator';
import { Generation, Graph, FailureDetection, DetectionMetrics, Task } from './types';
import { EvaluationResult } from './interfaces/IEvaluationPipeline';
import * as fs from 'fs';

// ── CLI flags ────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry');

type ModelChoice = 'GPT-4o' | 'Claude-3.5-Sonnet';
const modelFlag = process.argv.find(a => a.startsWith('--model='));
const selectedModel: ModelChoice = modelFlag?.split('=')[1] === 'gpt4o' ? 'GPT-4o' : 'Claude-3.5-Sonnet';
const modelTag = selectedModel === 'GPT-4o' ? 'gpt4o' : 'claude';

// ── Checkpoint helpers ───────────────────────────────────────────────

const CHECKPOINT_PATH = `outputs/phase2_${modelTag}_checkpoint.json`;

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

      // Respect Retry-After header if present (axios wraps it)
      let delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
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
  console.log(`Patchwork Phase 2.1 — Scaled Pilot Run${isDryRun ? ' (DRY)' : ''}  [${selectedModel}]`);
  console.log('='.repeat(80));

  // ── Validate API key ────────────────────────────────────────────
  const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const openaiKey = process.env['OPENAI_API_KEY'] ?? '';
  if (selectedModel === 'Claude-3.5-Sonnet' && !anthropicKey) {
    console.error('FATAL: ANTHROPIC_API_KEY is not set. Add it to .env or export it.');
    process.exit(1);
  }
  if (selectedModel === 'GPT-4o' && !openaiKey) {
    console.error('FATAL: OPENAI_API_KEY is not set. Add it to .env or export it.');
    process.exit(1);
  }

  // ── Instantiate components ──────────────────────────────────────
  const config = new PipelineConfig();
  const enhancedGC = new EnhancedGraphConstructor(config);
  const failureDetector = new FailureDetector();
  const metricsCalc = new MetricsCalculator();
  const serializer = new ResultSerializer();
  const summary = new RunSummary();
  const repoManager = new RepositoryManager();
  const taskGenerator = new TaskGenerator();
  const modelEvaluator = new ModelEvaluator(openaiKey, anthropicKey);

  // ── Select repos ────────────────────────────────────────────────
  const allCurated = await repoManager.loadCuratedRepos();
  const pythonRepos = allCurated.filter(r => r.language === 'Python').slice(0, 5);
  const tsRepos = allCurated.filter(r => r.language === 'TypeScript').slice(0, 5);
  let repos = [...pythonRepos, ...tsRepos];

  if (isDryRun) {
    repos = repos.slice(0, 1);
    console.log(`  [dry] Using 1 repo: ${repos[0]!.name}`);
  }

  console.log(`  Repos selected: ${repos.length} (${pythonRepos.length} Python, ${tsRepos.length} TS)`);

  // ── Load or create checkpoint ───────────────────────────────────
  let checkpoint = loadCheckpoint();
  if (checkpoint) {
    console.log(`  [checkpoint] Resuming — ${checkpoint.entries.length} tasks already completed`);
  } else {
    checkpoint = { startedAt: new Date().toISOString(), entries: [] };
  }

  // ── Per-repo, per-task loop ─────────────────────────────────────
  const allResults: EvaluationResult[] = [
    ...checkpoint.entries.map(e => e.result),
  ];
  const stageTimings: Record<string, number[]> = {};
  let apiCalls = 0;
  let skippedFromCheckpoint = 0;

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
      // Skip if already completed from checkpoint
      if (isTaskComplete(checkpoint, repo.id, task.id)) {
        skippedFromCheckpoint++;
        console.log(`  [skip] ${task.id.slice(0, 8)} (from checkpoint)`);
        continue;
      }

      console.log(`\n  Task ${task.id.slice(0, 8)}  ${task.complexity}  "${task.specification.slice(0, 60)}"`);

      // 1. API call with retry
      let generation: Generation;
      try {
        const t0 = Date.now();
        generation = await withRetry(() =>
          modelEvaluator.generateWithPrompt(task, selectedModel, 'P1'),
        );
        const dt = Date.now() - t0;
        (stageTimings['api-call'] ??= []).push(dt);
        apiCalls++;
        console.log(`    [api]     ${generation.generatedCode.length} chars in ${dt}ms`);
      } catch (err) {
        console.error(`    [api] FAILED after retries:`, err);
        continue; // skip this task but keep going
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

      // 5. Checkpoint
      checkpoint.entries.push({ repoId: repo.id, taskId: task.id, result });
      saveCheckpoint(checkpoint);

      // 6. Rate limit — 1 s delay before next API call
      await sleep(1000);
    }
  }

  // ── Aggregate report ────────────────────────────────────────────
  summary.end();

  console.log(`\n${'='.repeat(80)}`);
  console.log('Aggregate Report');
  console.log(`${'='.repeat(80)}`);

  const report = serializer.generateReport(allResults);
  console.log(`  Total repos:       ${report.summary.totalRepositories}`);
  console.log(`  Total tasks:       ${report.summary.totalTasks}`);
  console.log(`  Total generations: ${report.summary.totalGenerations}`);
  console.log(`  Total findings:    ${report.summary.totalFailures}`);
  console.log(`  API calls made:    ${apiCalls}`);
  console.log(`  Skipped (cached):  ${skippedFromCheckpoint}`);
  console.log(`  Findings by category:`);
  for (const [cat, count] of Object.entries(report.summary.failuresByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(6)} ${count}`);
  }
  console.log(`  Graph stats:`);
  for (const [type, stats] of Object.entries(report.graphStats)) {
    console.log(`    ${type.padEnd(14)} nodes=${stats.nodes}  edges=${stats.edges}`);
  }

  // ── Stage timing summary ────────────────────────────────────────
  console.log(`\nStage Timings (ms):`);
  for (const [stage, times] of Object.entries(stageTimings)) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(`  ${stage.padEnd(20)} avg=${avg.toFixed(0)}  max=${max}  runs=${times.length}`);
  }

  const totalDuration = Date.now() - startTime;
  console.log(`\nTotal duration: ${totalDuration}ms`);

  // ── Write output ────────────────────────────────────────────────
  fs.mkdirSync('outputs', { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, '-');
  const outputPath = `outputs/phase2_${modelTag}_${ts}.json`;

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
      model: selectedModel,
      isDryRun,
    },
    stageTimings: Object.fromEntries(
      Object.entries(stageTimings).map(([k, v]) => [k, {
        avgMs: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
        maxMs: Math.max(...v),
        runs: v.length,
      }])
    ),
    report,
    runSummary: summary.getSummary(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // ── Checklist ───────────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log('Pipeline Checklist');
  console.log(`${'='.repeat(80)}`);

  const graphTypes = new Set<string>(allResults.flatMap(r => r.graphs.map(g => g.type)));
  const failureCategories = new Set<string>(allResults.flatMap(r => r.failures.map(f => f.category)));
  const expectedGraphTypes = ['import', 'call', 'dependency', 'schema', 'config', 'cfg', 'resource', 'routing'];
  const expectedCategories = ['SRF', 'PIA', 'DHI', 'BCI', 'RCF', 'CFC', 'CCV', 'SSR'];

  for (const gt of expectedGraphTypes) {
    const ok = graphTypes.has(gt);
    console.log(`  ${ok ? 'PASS' : 'MISS'} graph:${gt}`);
  }
  for (const cat of expectedCategories) {
    const ok = failureCategories.has(cat);
    console.log(`  ${ok ? 'PASS' : 'MISS'} detect:${cat}`);
  }

  const graphOk = expectedGraphTypes.every(gt => graphTypes.has(gt));
  const failOk = expectedCategories.every(cat => failureCategories.has(cat));
  const allOk = graphOk && failOk;

  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS MISSING — see above'}`);
  console.log(`${'='.repeat(80)}`);

  // Clean up checkpoint on successful full run (not dry run)
  if (!isDryRun && allOk) {
    try { fs.unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
    console.log('Checkpoint cleaned up.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
