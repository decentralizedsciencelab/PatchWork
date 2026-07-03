/**
 * Run evaluation on local GPU models
 * Generates the same failure detection stats (DHI, BCI, RCF, CCV)
 * for Qwen, CodeLlama, and StarCoder2
 */

import { LocalModelEvaluator } from './services/LocalModelEvaluator';
import { TaskGenerator } from './services/TaskGenerator';
import { GraphConstructor } from './services/GraphConstructor';
import { FailureDetector } from './services/FailureDetector';
import { MetricsCalculator } from './services/MetricsCalculator';
import { RepositoryManager } from './services/RepositoryManager';
import { Task, Generation } from './types';
import * as fs from 'fs';

async function main() {
  console.log('='.repeat(80));
  console.log('Local GPU Model Evaluation - Patchwork System');
  console.log('='.repeat(80));

  // Initialize components
  const evaluator = new LocalModelEvaluator('http://10.96.50.180:8000');
  const repoManager = new RepositoryManager();
  const taskGenerator = new TaskGenerator();
  const graphConstructor = new GraphConstructor();
  const failureDetector = new FailureDetector();
  const metricsCalculator = new MetricsCalculator();

  // Test connection
  console.log('\n1. Testing connection to GPU model server...');
  const isConnected = await evaluator.testConnection();
  if (!isConnected) {
    console.error('❌ Failed to connect to local model server at http://10.96.50.180:8000');
    console.error('Make sure the model server is running on the GPU machine');
    process.exit(1);
  }
  console.log('✓ Connected to GPU model server');

  // List available models
  const availableModels = await evaluator.listModels();
  console.log('✓ Available models:', availableModels);

  // Configuration - smaller test run
  const models: Array<'Qwen-7B' | 'CodeLlama-34B' | 'StarCoder2-15B'> = [
    'Qwen-7B',
    // 'CodeLlama-34B',  // Comment out for faster testing
    'StarCoder2-15B'
  ];

  const promptStrategies: Array<'P1' | 'P2'> = ['P1', 'P2'];  // Reduced from P1-P4 for speed
  const numReposPerModel = 2;  // Reduced from 7 for testing
  const tasksPerRepo = 3;  // Reduced from 6 for testing

  console.log(`\n2. Configuration:`);
  console.log(`   Models: ${models.join(', ')}`);
  console.log(`   Strategies: ${promptStrategies.join(', ')}`);
  console.log(`   Repositories: ${numReposPerModel}`);
  console.log(`   Tasks per repo: ${tasksPerRepo}`);
  console.log(`   Total generations: ${models.length * promptStrategies.length * numReposPerModel * tasksPerRepo}`);

  // Load repositories (same as original evaluation)
  console.log('\n3. Loading repositories...');
  await repoManager.loadRepositoriesFromSWEBench();
  const repos = repoManager.getRepositories().slice(0, numReposPerModel);
  console.log(`✓ Loaded ${repos.length} repositories`);

  // Results storage
  const allGenerations: Generation[] = [];
  const allFailures: any[] = [];

  // Run evaluation for each model
  for (const model of models) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Evaluating: ${model}`);
    console.log(`${'='.repeat(80)}`);

    for (const promptStrategy of promptStrategies) {
      console.log(`\n  Strategy: ${promptStrategy}`);

      for (const repo of repos) {
        console.log(`\n    Repository: ${repo.name}`);

        // Generate tasks
        const tasks = await taskGenerator.generateTasksForRepository(repo);
        const selectedTasks = tasks.slice(0, tasksPerRepo);

        // Generate code for each task
        for (const task of selectedTasks) {
          try {
            console.log(`      Task: ${task.description.substring(0, 50)}...`);

            // Generate code
            const generation = await evaluator.generateWithPrompt(
              task,
              model,
              promptStrategy
            );
            allGenerations.push(generation);
            console.log(`      ✓ Generated (${generation.generatedCode.length} chars)`);

            // Construct graphs
            const graphs = await graphConstructor.constructGraphs(
              generation.generatedCode,
              repo
            );

            // Detect failures
            const failures = await failureDetector.detectFailures(
              generation,
              graphs,
              repo
            );

            allFailures.push(...failures.map(f => ({
              ...f,
              model,
              promptStrategy,
              repository: repo.name
            })));

            if (failures.length > 0) {
              const categories = failures.map(f => f.category).join(', ');
              console.log(`      ⚠️  Failures detected: ${categories}`);
            } else {
              console.log(`      ✓ No failures`);
            }

          } catch (error) {
            console.error(`      ❌ Error: ${error}`);
          }
        }
      }
    }
  }

  // Calculate metrics
  console.log(`\n${'='.repeat(80)}`);
  console.log('Calculating Metrics');
  console.log(`${'='.repeat(80)}`);

  // Group failures by category
  const failuresByCategory: Record<string, number> = {};
  const failuresByModel: Record<string, number> = {};
  const failuresByStrategy: Record<string, number> = {};

  allFailures.forEach(failure => {
    // By category
    failuresByCategory[failure.category] = (failuresByCategory[failure.category] || 0) + 1;

    // By model
    failuresByModel[failure.model] = (failuresByModel[failure.model] || 0) + 1;

    // By strategy
    failuresByStrategy[failure.promptStrategy] = (failuresByStrategy[failure.promptStrategy] || 0) + 1;
  });

  // Print results
  console.log(`\nTotal Generations: ${allGenerations.length}`);
  console.log(`Total Failures: ${allFailures.length}`);

  console.log(`\n📊 Failures by Category (compare with Claude/GPT-4o):`);
  console.log('──────────────────────────────────────');
  Object.entries(failuresByCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat.padEnd(25)} ${count}`);
  });

  console.log(`\n📊 Failures by Model:`);
  console.log('──────────────────────────────────────');
  Object.entries(failuresByModel).sort((a, b) => b[1] - a[1]).forEach(([model, count]) => {
    console.log(`  ${model.padEnd(25)} ${count}`);
  });

  console.log(`\n📊 Failures by Prompting Strategy:`);
  console.log('──────────────────────────────────────');
  Object.entries(failuresByStrategy).sort((a, b) => b[1] - a[1]).forEach(([strat, count]) => {
    console.log(`  ${strat.padEnd(25)} ${count}`);
  });

  // Save detailed results
  const results = {
    timestamp: new Date().toISOString(),
    config: {
      models,
      promptStrategies,
      numRepos: numReposPerModel,
      tasksPerRepo
    },
    summary: {
      totalGenerations: allGenerations.length,
      totalFailures: allFailures.length,
      failuresByCategory,
      failuresByModel,
      failuresByStrategy
    },
    failures: allFailures,
    generations: allGenerations.map(g => ({
      id: g.id,
      model: g.model,
      promptStrategy: g.promptStrategy,
      codeLength: g.generatedCode.length
    }))
  };

  const outputPath = `outputs/local_models_${new Date().toISOString().replace(/:/g, '-')}.json`;
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to: ${outputPath}`);

  console.log(`\n${'='.repeat(80)}`);
  console.log('Evaluation Complete!');
  console.log(`${'='.repeat(80)}`);
}

main().catch(console.error);
