/**
 * Rerun failure detection pipeline on existing frontier model generations.
 *
 * Loads the 336 generations from 5 full_results JSON files in outputs/,
 * reruns graph construction, failure detection, and metrics on each,
 * then saves results and prints a summary.
 *
 * Features:
 *   - Checkpoint/resume: saves progress after each generation
 *   - --limit=N flag: process only the first N generations (for testing)
 *
 * Usage:
 *   npx ts-node src/rerun-frontier.ts                # full run (336 generations)
 *   npx ts-node src/rerun-frontier.ts --limit=5      # test with 5 generations
 */

import { EnhancedGraphConstructor } from './services/EnhancedGraphConstructor';
import { FailureDetector } from './services/FailureDetector';
import { MetricsCalculator } from './services/MetricsCalculator';
import { PipelineConfig } from './services/PipelineConfig';
import { Generation, Graph, FailureDetection, DetectionMetrics } from './types';
import * as fs from 'fs';
import * as path from 'path';

// ── CLI flags ────────────────────────────────────────────────────────

const limitFlag = process.argv.find(a => a.startsWith('--limit='));
const limit = limitFlag ? parseInt(limitFlag.split('=')[1]!, 10) : Infinity;

// ── Input files ──────────────────────────────────────────────────────

const INPUT_FILES = [
  'outputs/full_results_2026-01-05T09-19-35-148Z.json',
  'outputs/full_results_2026-01-05T09-31-10-875Z.json',
  'outputs/full_results_2026-01-05T10-45-53-451Z.json',
  'outputs/full_results_2026-01-05T16-08-41-298Z.json',
  'outputs/full_results_2026-01-05T16-35-08-790Z.json',
];

const OUTPUT_PATH = 'outputs/phase3/rerun_frontier_phase3.json';
const CHECKPOINT_PATH = 'outputs/phase3/rerun_frontier_phase3_checkpoint.json';

// ── Types for raw data ──────────────────────────────────────────────

interface RawGeneration {
  id: string;
  taskId: string;
  model: string;
  promptStrategy: string;
  contextFiles: string[];
  generatedCode: string;
  timestamp: string;
}

interface RawEvaluationResult {
  taskId: string;
  generations: RawGeneration[];
  graphs: any[];
  failures: any[];
  metrics: any[];
}

interface RerunResult {
  generationId: string;
  taskId: string;
  model: string;
  promptStrategy: string;
  codeLength: number;
  graphs: Graph[];
  failures: FailureDetection[];
  metrics: DetectionMetrics[];
  durationMs: number;
}

interface Checkpoint {
  startedAt: string;
  completedIds: string[];
  results: RerunResult[];
}

// ── Checkpoint helpers ──────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log(`Patchwork — Rerun Frontier Failure Detection`);
  console.log(`  limit: ${limit === Infinity ? 'ALL' : limit}`);
  console.log('='.repeat(80));

  // 1. Load all generations from the 5 input files
  const allGenerations: RawGeneration[] = [];
  for (const file of INPUT_FILES) {
    const fullPath = path.resolve(file);
    if (!fs.existsSync(fullPath)) {
      console.error(`  WARN: File not found: ${fullPath}`);
      continue;
    }
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(raw) as RawEvaluationResult[];
    let fileGenCount = 0;
    for (const entry of data) {
      for (const gen of entry.generations) {
        if (gen.generatedCode && gen.generatedCode.trim().length > 0) {
          allGenerations.push(gen);
          fileGenCount++;
        }
      }
    }
    console.log(`  Loaded ${fileGenCount} generations from ${path.basename(file)}`);
  }

  console.log(`  Total generations with code: ${allGenerations.length}`);

  // Apply limit
  const toProcess = allGenerations.slice(0, limit);
  console.log(`  Processing: ${toProcess.length} generations`);

  // 2. Instantiate pipeline components
  const config = new PipelineConfig();
  const enhancedGC = new EnhancedGraphConstructor(config);
  const failureDetector = new FailureDetector();
  const metricsCalc = new MetricsCalculator();

  // 3. Load or create checkpoint
  let checkpoint = loadCheckpoint();
  const completedSet = new Set<string>();
  if (checkpoint) {
    for (const id of checkpoint.completedIds) {
      completedSet.add(id);
    }
    console.log(`  [checkpoint] Resuming — ${checkpoint.completedIds.length} generations already completed`);
  } else {
    checkpoint = { startedAt: new Date().toISOString(), completedIds: [], results: [] };
  }

  // 4. Process each generation
  const stageTimings: Record<string, number[]> = {};
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const rawGen = toProcess[i]!;

    // Skip if already completed
    if (completedSet.has(rawGen.id)) {
      skipped++;
      continue;
    }

    processed++;
    const genIdx = i + 1;
    console.log(`\n  [${genIdx}/${toProcess.length}] gen=${rawGen.id.slice(0, 16)}  model=${rawGen.model}  strategy=${rawGen.promptStrategy}  code=${rawGen.generatedCode.length} chars`);

    // Coerce raw data into the Generation interface
    const generation: Generation = {
      id: rawGen.id,
      taskId: rawGen.taskId,
      model: rawGen.model as Generation['model'],
      promptStrategy: rawGen.promptStrategy as Generation['promptStrategy'],
      contextFiles: rawGen.contextFiles || [],
      generatedCode: rawGen.generatedCode,
      timestamp: new Date(rawGen.timestamp),
    };

    const genStart = Date.now();

    // 4a. Graph construction
    let graphs: Graph[] = [];
    try {
      const t0 = Date.now();
      graphs = await enhancedGC.buildAllGraphs(generation);
      const dt = Date.now() - t0;
      (stageTimings['graphs'] ??= []).push(dt);
      console.log(`    [graphs]  ${graphs.length} graphs in ${dt}ms`);
      for (const g of graphs) {
        console.log(`      ${g.type.padEnd(14)} nodes=${g.nodes.length}  edges=${g.edges.length}`);
      }
    } catch (err) {
      console.error(`    [graphs] CRASHED:`, err);
      errors++;
    }

    // 4b. Failure detection
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
      }
      for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
        console.log(`      ${cat.padEnd(6)} ${count}`);
      }
    } catch (err) {
      console.error(`    [detect] CRASHED:`, err);
      errors++;
    }

    // 4c. Metrics
    let metrics: DetectionMetrics[] = [];
    try {
      const t0 = Date.now();
      metrics = await metricsCalc.calculateDetectionMetrics(failures, []);
      const dt = Date.now() - t0;
      (stageTimings['metrics'] ??= []).push(dt);
      console.log(`    [metrics] ${metrics.length} categories in ${dt}ms`);
    } catch (err) {
      console.error(`    [metrics] CRASHED:`, err);
      errors++;
    }

    const durationMs = Date.now() - genStart;

    const result: RerunResult = {
      generationId: rawGen.id,
      taskId: rawGen.taskId,
      model: rawGen.model,
      promptStrategy: rawGen.promptStrategy,
      codeLength: rawGen.generatedCode.length,
      graphs,
      failures,
      metrics,
      durationMs,
    };

    // 4d. Checkpoint
    checkpoint.results.push(result);
    checkpoint.completedIds.push(rawGen.id);
    completedSet.add(rawGen.id);
    saveCheckpoint(checkpoint);
  }

  // 5. Save final results
  const totalDuration = Date.now() - startTime;

  // Aggregate summary stats
  const allResults = checkpoint.results;

  const findingsByCategory: Record<string, number> = {};
  const findingsByModel: Record<string, number> = {};
  const findingsByStrategy: Record<string, number> = {};
  const findingsBySeverity: Record<string, number> = {};
  let totalFindings = 0;
  let totalGraphs = 0;

  for (const r of allResults) {
    totalGraphs += r.graphs.length;
    for (const f of r.failures) {
      totalFindings++;
      findingsByCategory[f.category] = (findingsByCategory[f.category] || 0) + 1;
      findingsByModel[r.model] = (findingsByModel[r.model] || 0) + 1;
      findingsByStrategy[r.promptStrategy] = (findingsByStrategy[r.promptStrategy] || 0) + 1;
      findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] || 0) + 1;
    }
  }

  const output = {
    timestamp: new Date().toISOString(),
    durationMs: totalDuration,
    config: {
      inputFiles: INPUT_FILES,
      totalGenerations: allResults.length,
      limit: limit === Infinity ? 'ALL' : limit,
    },
    summary: {
      totalGenerations: allResults.length,
      totalGraphs,
      totalFindings,
      findingsByCategory,
      findingsByModel,
      findingsByStrategy,
      findingsBySeverity,
    },
    stageTimings: Object.fromEntries(
      Object.entries(stageTimings).map(([k, v]) => [k, {
        avgMs: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
        maxMs: Math.max(...v),
        minMs: Math.min(...v),
        runs: v.length,
      }])
    ),
    results: allResults,
  };

  fs.mkdirSync('outputs/phase3', { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${OUTPUT_PATH}`);

  // 6. Print summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('Summary');
  console.log(`${'='.repeat(80)}`);
  console.log(`  Total generations processed: ${allResults.length}`);
  console.log(`  Skipped (from checkpoint):   ${skipped}`);
  console.log(`  Errors:                      ${errors}`);
  console.log(`  Total graphs built:          ${totalGraphs}`);
  console.log(`  Total findings:              ${totalFindings}`);
  console.log(`  Duration:                    ${totalDuration}ms`);

  console.log(`\n  Findings by Category:`);
  for (const [cat, count] of Object.entries(findingsByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(8)} ${count}`);
  }

  console.log(`\n  Findings by Model:`);
  for (const [model, count] of Object.entries(findingsByModel).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${model.padEnd(22)} ${count}`);
  }

  console.log(`\n  Findings by Prompt Strategy:`);
  for (const [ps, count] of Object.entries(findingsByStrategy).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${ps.padEnd(8)} ${count}`);
  }

  console.log(`\n  Findings by Severity:`);
  for (const [sev, count] of Object.entries(findingsBySeverity).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${sev.padEnd(10)} ${count}`);
  }

  // Stage timing summary
  console.log(`\n  Stage Timings (ms):`);
  for (const [stage, times] of Object.entries(stageTimings)) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(`    ${stage.padEnd(20)} avg=${avg.toFixed(0)}  max=${max}  runs=${times.length}`);
  }

  console.log(`\n${'='.repeat(80)}`);

  // Clean up checkpoint on full successful run
  if (limit === Infinity && errors === 0) {
    try { fs.unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
    console.log('Checkpoint cleaned up.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
