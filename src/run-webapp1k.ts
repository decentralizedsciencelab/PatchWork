/**
 * WebApp1K Evaluation — Run the 8-graph failure detection pipeline on
 * WebApp1K benchmark samples (React/JSX single-file components).
 *
 * Usage:
 *   npx ts-node src/run-webapp1k.ts                # default: 200 scenarios
 *   npx ts-node src/run-webapp1k.ts --limit=2      # quick smoke test
 *   npx ts-node src/run-webapp1k.ts --limit=1000   # full dataset
 *
 * Features:
 *   - Checkpoint/resume: writes progress to outputs/webapp1k_checkpoint.json
 *   - Aggregates results by model and by WebApp1K category
 *   - Prints model x category summary table at the end
 */

import { EnhancedGraphConstructor } from './services/EnhancedGraphConstructor';
import { FailureDetector } from './services/FailureDetector';
import { PipelineConfig } from './services/PipelineConfig';
import { Generation, Graph, FailureDetection } from './types';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// ── CLI flags ────────────────────────────────────────────────────────

const limitFlag = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitFlag ? parseInt(limitFlag.split('=')[1] || '200', 10) : 200;

// ── File paths ───────────────────────────────────────────────────────

const INPUT_PATH = path.join(process.cwd(), 'outputs', 'webapp1k_generations.json');
const CHECKPOINT_PATH = path.join(process.cwd(), 'outputs', 'webapp1k_checkpoint.json');
const OUTPUT_PATH = path.join(process.cwd(), 'outputs', 'webapp1k_pipeline_results.json');

// ── WebApp1K data shape ──────────────────────────────────────────────

interface WebApp1KGeneration {
  code: string;
  errors: string | null;
  passed: boolean;
}

interface WebApp1KScenario {
  index: number;
  category: string;
  scenario: string;
  successCase: string;
  failureCase: string;
  githubUrl: string;
  generations: Record<string, WebApp1KGeneration>;
}

// ── Checkpoint ───────────────────────────────────────────────────────

interface CheckpointEntry {
  scenarioIndex: number;
  modelName: string;
  generationId: string;
  graphs: Graph[];
  failures: FailureDetection[];
}

interface Checkpoint {
  startedAt: string;
  limit: number;
  entries: CheckpointEntry[];
}

function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf-8');
      const ck = JSON.parse(raw) as Checkpoint;
      // Only reuse checkpoint if limit matches
      if (ck.limit === LIMIT) return ck;
      console.log(`  [checkpoint] Limit mismatch (${ck.limit} vs ${LIMIT}), starting fresh`);
    }
  } catch {
    // Corrupt checkpoint — start fresh
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint): void {
  fs.mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

function isEntryComplete(checkpoint: Checkpoint | null, scenarioIndex: number, modelName: string): boolean {
  if (!checkpoint) return false;
  return checkpoint.entries.some(e => e.scenarioIndex === scenarioIndex && e.modelName === modelName);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log(`WebApp1K Evaluation — 8-Graph Failure Detection Pipeline`);
  console.log(`  Limit: ${LIMIT} scenarios`);
  console.log('='.repeat(80));

  // 1. Load data
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`FATAL: Input file not found: ${INPUT_PATH}`);
    process.exit(1);
  }
  const rawData: WebApp1KScenario[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
  const scenarios = rawData.slice(0, LIMIT);
  const modelNames = Object.keys(scenarios[0]?.generations ?? {}).sort();
  const totalGenerations = scenarios.length * modelNames.length;

  console.log(`  Scenarios loaded: ${scenarios.length} / ${rawData.length}`);
  console.log(`  Models: ${modelNames.length} — ${modelNames.join(', ')}`);
  console.log(`  Total generations to process: ${totalGenerations}`);

  // 2. Instantiate pipeline components
  const config = new PipelineConfig();
  const enhancedGC = new EnhancedGraphConstructor(config);
  const failureDetector = new FailureDetector();

  // 3. Load or create checkpoint
  let checkpoint = loadCheckpoint();
  let skippedFromCheckpoint = 0;
  if (checkpoint) {
    skippedFromCheckpoint = checkpoint.entries.length;
    console.log(`  [checkpoint] Resuming — ${skippedFromCheckpoint} entries already completed`);
  } else {
    checkpoint = { startedAt: new Date().toISOString(), limit: LIMIT, entries: [] };
  }

  // 4. Per-scenario, per-model loop
  const stageTimings: Record<string, number[]> = {};
  let processedCount = skippedFromCheckpoint;
  let errorCount = 0;

  for (const scenario of scenarios) {
    for (const modelName of modelNames) {
      // Skip if already completed
      if (isEntryComplete(checkpoint, scenario.index, modelName)) {
        continue;
      }

      const genData = scenario.generations[modelName];
      if (!genData || !genData.code) {
        errorCount++;
        continue;
      }

      // Create a Generation object — use 'as any' because the model names
      // from WebApp1K are not in the strict union type
      const generationId = uuidv4();
      const generation: Generation = {
        id: generationId,
        taskId: `webapp1k-${scenario.index}-${scenario.scenario}`,
        model: modelName as Generation['model'],
        promptStrategy: 'P1',
        contextFiles: [],
        generatedCode: genData.code,
        timestamp: new Date(),
      };

      // Build graphs
      let graphs: Graph[] = [];
      try {
        const t0 = Date.now();
        graphs = await enhancedGC.buildAllGraphs(generation);
        const dt = Date.now() - t0;
        (stageTimings['graphs'] ??= []).push(dt);
      } catch (err) {
        console.error(`  [graphs] CRASH s=${scenario.index} m=${modelName}:`, err);
        errorCount++;
      }

      // Detect failures
      let failures: FailureDetection[] = [];
      try {
        const t0 = Date.now();
        failures = await failureDetector.detectAllFailures(generation, graphs);
        const dt = Date.now() - t0;
        (stageTimings['detection'] ??= []).push(dt);
      } catch (err) {
        console.error(`  [detect] CRASH s=${scenario.index} m=${modelName}:`, err);
        errorCount++;
      }

      // Save to checkpoint
      checkpoint.entries.push({
        scenarioIndex: scenario.index,
        modelName,
        generationId,
        graphs,
        failures,
      });
      processedCount++;

      // Save checkpoint every 50 entries
      if (processedCount % 50 === 0) {
        saveCheckpoint(checkpoint);
        const pct = ((processedCount / totalGenerations) * 100).toFixed(1);
        console.log(`  [progress] ${processedCount}/${totalGenerations} (${pct}%) — ${checkpoint.entries.length} checkpointed`);
      }
    }
  }

  // Final checkpoint save
  saveCheckpoint(checkpoint);
  console.log(`\n  Processing complete: ${processedCount} generations, ${errorCount} errors`);

  // 5. Aggregate results

  // Build lookup: scenarioIndex -> category
  const indexToCategory = new Map<number, string>();
  const indexToScenario = new Map<number, string>();
  for (const s of scenarios) {
    indexToCategory.set(s.index, s.category);
    indexToScenario.set(s.index, s.scenario);
  }

  // Aggregate by model
  const byModel: Record<string, {
    totalGenerations: number;
    totalFailures: number;
    failuresByCategory: Record<string, number>;
    failuresBySeverity: Record<string, number>;
    graphStats: Record<string, { nodes: number; edges: number; count: number }>;
    passedCount: number;
    failedCount: number;
  }> = {};

  // Aggregate by WebApp1K category
  const byAppCategory: Record<string, {
    totalGenerations: number;
    totalFailures: number;
    failuresByDetectionCategory: Record<string, number>;
  }> = {};

  // Model x AppCategory matrix: model -> appCategory -> failure count
  const modelCategoryMatrix: Record<string, Record<string, number>> = {};

  for (const entry of checkpoint.entries) {
    const appCategory = indexToCategory.get(entry.scenarioIndex) ?? 'unknown';

    // --- by model ---
    if (!byModel[entry.modelName]) {
      byModel[entry.modelName] = {
        totalGenerations: 0,
        totalFailures: 0,
        failuresByCategory: {},
        failuresBySeverity: {},
        graphStats: {},
        passedCount: 0,
        failedCount: 0,
      };
    }
    const ms = byModel[entry.modelName]!;
    ms.totalGenerations++;
    ms.totalFailures += entry.failures.length;

    // Check original passed/failed status
    const origScenario = scenarios.find(s => s.index === entry.scenarioIndex);
    const origGen = origScenario?.generations[entry.modelName];
    if (origGen?.passed) ms.passedCount++;
    else ms.failedCount++;

    for (const f of entry.failures) {
      ms.failuresByCategory[f.category] = (ms.failuresByCategory[f.category] ?? 0) + 1;
      ms.failuresBySeverity[f.severity] = (ms.failuresBySeverity[f.severity] ?? 0) + 1;
    }
    for (const g of entry.graphs) {
      if (!ms.graphStats[g.type]) {
        ms.graphStats[g.type] = { nodes: 0, edges: 0, count: 0 };
      }
      const gs = ms.graphStats[g.type]!;
      gs.nodes += g.nodes.length;
      gs.edges += g.edges.length;
      gs.count++;
    }

    // --- by app category ---
    if (!byAppCategory[appCategory]) {
      byAppCategory[appCategory] = {
        totalGenerations: 0,
        totalFailures: 0,
        failuresByDetectionCategory: {},
      };
    }
    const ac = byAppCategory[appCategory]!;
    ac.totalGenerations++;
    ac.totalFailures += entry.failures.length;
    for (const f of entry.failures) {
      ac.failuresByDetectionCategory[f.category] = (ac.failuresByDetectionCategory[f.category] ?? 0) + 1;
    }

    // --- model x category matrix ---
    if (!modelCategoryMatrix[entry.modelName]) {
      modelCategoryMatrix[entry.modelName] = {};
    }
    modelCategoryMatrix[entry.modelName]![appCategory] = (modelCategoryMatrix[entry.modelName]![appCategory] ?? 0) + entry.failures.length;
  }

  // Failure category distribution (across all)
  const allFailureCats: Record<string, number> = {};
  for (const entry of checkpoint.entries) {
    for (const f of entry.failures) {
      allFailureCats[f.category] = (allFailureCats[f.category] ?? 0) + 1;
    }
  }

  // 6. Save results
  const totalDuration = Date.now() - startTime;
  const output = {
    timestamp: new Date().toISOString(),
    durationMs: totalDuration,
    config: {
      limit: LIMIT,
      scenariosProcessed: scenarios.length,
      modelsEvaluated: modelNames,
      totalGenerations: checkpoint.entries.length,
      graphTypes: config.graphs,
      promptStrategy: 'P1',
      errors: errorCount,
    },
    stageTimings: Object.fromEntries(
      Object.entries(stageTimings).map(([k, v]) => [k, {
        avgMs: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
        maxMs: Math.max(...v),
        minMs: Math.min(...v),
        runs: v.length,
      }])
    ),
    failureCategoryDistribution: allFailureCats,
    byModel,
    byAppCategory,
    modelCategoryMatrix,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${OUTPUT_PATH}`);

  // 7. Print summary tables

  // --- Table 1: Model summary ---
  console.log(`\n${'='.repeat(80)}`);
  console.log('Model Summary');
  console.log(`${'='.repeat(80)}`);

  const modelHeader = 'Model'.padEnd(36) +
    'Gens'.padStart(6) +
    'Fails'.padStart(7) +
    'Avg'.padStart(7) +
    'Pass%'.padStart(7) +
    'Errors'.padStart(8) +
    'Warns'.padStart(8);
  console.log(modelHeader);
  console.log('-'.repeat(79));

  for (const model of modelNames) {
    const ms = byModel[model];
    if (!ms) continue;
    const avg = (ms.totalFailures / ms.totalGenerations).toFixed(2);
    const passRate = ((ms.passedCount / ms.totalGenerations) * 100).toFixed(1);
    const errors = ms.failuresBySeverity['error'] ?? 0;
    const warns = ms.failuresBySeverity['warning'] ?? 0;
    console.log(
      model.padEnd(36) +
      String(ms.totalGenerations).padStart(6) +
      String(ms.totalFailures).padStart(7) +
      avg.padStart(7) +
      passRate.padStart(7) +
      String(errors).padStart(8) +
      String(warns).padStart(8)
    );
  }

  // --- Table 2: Failure category breakdown per model ---
  console.log(`\n${'='.repeat(80)}`);
  console.log('Failure Categories by Model');
  console.log(`${'='.repeat(80)}`);

  const detCategories = Object.keys(allFailureCats).sort();
  const catHeader = 'Model'.padEnd(36) + detCategories.map(c => c.padStart(6)).join('') + '  Total'.padStart(7);
  console.log(catHeader);
  console.log('-'.repeat(36 + detCategories.length * 6 + 7));

  for (const model of modelNames) {
    const ms = byModel[model];
    if (!ms) continue;
    let row = model.padEnd(36);
    for (const cat of detCategories) {
      row += String(ms.failuresByCategory[cat] ?? 0).padStart(6);
    }
    row += String(ms.totalFailures).padStart(7);
    console.log(row);
  }

  // --- Table 3: Model x App Category matrix (failure counts) ---
  console.log(`\n${'='.repeat(80)}`);
  console.log('Model x App Category Matrix (avg failures per generation)');
  console.log(`${'='.repeat(80)}`);

  const appCategories = Object.keys(byAppCategory).sort();
  // Shorten category names for display
  const shortCat = (c: string) => c.slice(0, 8);

  const matHeader = 'Model'.padEnd(30) + appCategories.map(c => shortCat(c).padStart(9)).join('');
  console.log(matHeader);
  console.log('-'.repeat(30 + appCategories.length * 9));

  for (const model of modelNames) {
    const matrix = modelCategoryMatrix[model] ?? {};
    let row = model.padEnd(30);
    for (const cat of appCategories) {
      const genCount = checkpoint.entries.filter(e => e.modelName === model && indexToCategory.get(e.scenarioIndex) === cat).length;
      const avg = genCount > 0 ? (matrix[cat] ?? 0) / genCount : 0;
      row += avg.toFixed(1).padStart(9);
    }
    console.log(row);
  }

  // --- Table 4: Overall failure category distribution ---
  console.log(`\n${'='.repeat(80)}`);
  console.log('Overall Failure Category Distribution');
  console.log(`${'='.repeat(80)}`);
  const totalFailures = Object.values(allFailureCats).reduce((a, b) => a + b, 0);
  for (const [cat, count] of Object.entries(allFailureCats).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / totalFailures) * 100).toFixed(1);
    console.log(`  ${cat.padEnd(8)} ${String(count).padStart(8)}  (${pct}%)`);
  }
  console.log(`  ${'TOTAL'.padEnd(8)} ${String(totalFailures).padStart(8)}`);

  // --- Table 5: Graph statistics ---
  console.log(`\n${'='.repeat(80)}`);
  console.log('Graph Statistics (totals across all generations)');
  console.log(`${'='.repeat(80)}`);
  const allGraphStats: Record<string, { nodes: number; edges: number; count: number }> = {};
  for (const entry of checkpoint.entries) {
    for (const g of entry.graphs) {
      if (!allGraphStats[g.type]) {
        allGraphStats[g.type] = { nodes: 0, edges: 0, count: 0 };
      }
      const gs = allGraphStats[g.type]!;
      gs.nodes += g.nodes.length;
      gs.edges += g.edges.length;
      gs.count++;
    }
  }
  console.log('  ' + 'Type'.padEnd(14) + 'Count'.padStart(8) + 'Nodes'.padStart(10) + 'Edges'.padStart(10) + 'Avg Nodes'.padStart(12));
  console.log('  ' + '-'.repeat(54));
  for (const [type, stats] of Object.entries(allGraphStats).sort((a, b) => a[0].localeCompare(b[0]))) {
    const avgNodes = (stats.nodes / stats.count).toFixed(1);
    console.log('  ' +
      type.padEnd(14) +
      String(stats.count).padStart(8) +
      String(stats.nodes).padStart(10) +
      String(stats.edges).padStart(10) +
      avgNodes.padStart(12)
    );
  }

  // --- Stage timing summary ---
  console.log(`\nStage Timings (ms):`);
  for (const [stage, times] of Object.entries(stageTimings)) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    console.log(`  ${stage.padEnd(20)} avg=${avg.toFixed(0)}  max=${max}  runs=${times.length}`);
  }

  console.log(`\nTotal duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`${'='.repeat(80)}`);

  // Clean up checkpoint on successful completion
  try { fs.unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
  console.log('Checkpoint cleaned up.');

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
