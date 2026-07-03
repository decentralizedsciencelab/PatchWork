/**
 * Dry-run script: proves the pipeline works end-to-end without calling LLM APIs.
 *
 * Creates 3 synthetic repos (FastAPI, Django, Express) with hand-crafted code
 * containing intentional structural failures, then runs:
 *   graph construction → failure detection → metrics → JSON output
 *
 * Usage:
 *   npx ts-node src/dry-run.ts
 */

import { GraphConstructor } from './services/GraphConstructor';
import { EnhancedGraphConstructor } from './services/EnhancedGraphConstructor';
import { FailureDetector } from './services/FailureDetector';
import { MetricsCalculator } from './services/MetricsCalculator';
import { ResultSerializer } from './services/ResultSerializer';
import { RunSummary } from './services/RunSummary';
import { PipelineConfig } from './services/PipelineConfig';
import { Generation, Graph, FailureDetection, DetectionMetrics, Repository } from './types';
import { EvaluationResult } from './interfaces/IEvaluationPipeline';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

// ── Synthetic generation code per framework ─────────────────────────

const FASTAPI_CODE = `
import os
import json
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import phantom_module_xyz          # PIA: does not exist
import nonexistent_validator_pkg   # DHI: not on PyPI

app = FastAPI()
validator = nonexistent_validator_pkg.create_validator()  # SRF: call to phantom module

DATABASE_URL = os.getenv("DATABASE_URL")   # BCI: env var may be unset

class UserCreate(BaseModel):
    first_name: str
    last_name: str
    email: str

class UserResponse(BaseModel):
    id: int
    firstName: str      # CCV: field name mismatch (camelCase vs snake_case in UserCreate)
    lastName: str
    email: str

def get_db():
    db = Session()
    try:
        yield db
    finally:
        db.close()

@app.get("/users", response_model=List[UserResponse])
def list_users(db: Session = Depends(get_db)):
    return db.query("users").all()

@app.post("/users", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db.add(user)
    db.commit()
    return user

@app.get("/health")
def health_check():
    template = open("templates/health.html").read()   # RCF: file may not exist
    return {"status": "ok", "html": template}

@app.delete("/users/{user_id}")                       # SSR: no auth on destructive route
def delete_user(user_id: int, db: Session = Depends(get_db)):
    db.delete(user_id)
    db.commit()
    return {"deleted": user_id}
    print("This is unreachable")                      # CFC: unreachable code after return
`;

const DJANGO_CODE = `
import os
from django.db import models
from django.contrib.auth.models import User
from django.contrib import auth_extras           # PIA: module does not exist in Django
from django.http import JsonResponse
from django.views import View
from django.conf import settings
import stale_utils                              # DHI: not on PyPI

REDIS_URL = os.environ.get("REDIS_CLUSTER_URL") # BCI: env var not declared in .env

class BlogPost(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    author_name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

class BlogPostSerializer:
    """Manual serializer with field name mismatches."""
    def serialize(self, post):
        return {
            "title": post.title,
            "content": post.body,           # CCV: 'content' vs model field 'body'
            "authorName": post.author_name, # CCV: camelCase vs snake_case
            "createdAt": str(post.created_at),
        }

class BlogListView(View):
    def get(self, request):
        posts = BlogPost.objects.all()
        serializer = BlogPostSerializer()
        data = [serializer.serialize(p) for p in posts]
        return JsonResponse({"posts": data})

class BlogDeleteView(View):
    def delete(self, request, pk):             # SSR: no auth on destructive view
        BlogPost.objects.filter(pk=pk).delete()
        return JsonResponse({"deleted": pk})
`;

const EXPRESS_CODE = `
import express, { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import nonexistentNpmPkg from 'nonexistent-npm-pkg-xyz-999';  // DHI: not on npm
import phantomHelper from './utils/phantom_helper';            // PIA: file does not exist

const app = express();
const helper = phantomHelper.init();  // SRF: call to phantom module
const router = Router();

const REDIS_URL = process.env.REDIS_URL;       // BCI: env var may not be set
const SECRET_KEY = process.env.JWT_SECRET;      // BCI: env var may not be set

interface User {
  id: string;
  firstName: string;
  email: string;
}

interface UserRow {
  id: string;
  first_name: string;   // CCV: snake_case vs camelCase in User interface
  email: string;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    jwt.verify(token, SECRET_KEY || 'fallback');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.get('/users', authMiddleware, async (req: Request, res: Response) => {
  const result = await pool.query('SELECT * FROM users');
  res.json(result.rows);
});

router.post('/users', authMiddleware, async (req: Request, res: Response) => {
  const { firstName, email } = req.body;
  const result = await pool.query(
    'INSERT INTO users (first_name, email) VALUES ($1, $2) RETURNING *',
    [firstName, email]
  );
  res.json(result.rows[0]);
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  // SSR: no auth middleware on destructive route (siblings have auth)
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ deleted: req.params.id });
});

router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/api', router);
app.listen(3000);
`;

// ── Synthetic repository definitions ────────────────────────────────

interface DryRunRepo {
  repository: Repository;
  code: string;
  label: string;
}

function makeDryRunRepos(): DryRunRepo[] {
  return [
    {
      label: 'FastAPI (Python)',
      repository: {
        id: 'dry-run-fastapi-1',
        name: 'fastapi-user-api',
        framework: 'FastAPI',
        language: 'Python',
        fileCount: 85,
        linesOfCode: 12000,
        typeAnnotationCoverage: 65,
        testCoverage: 72,
        source: 'Curated',
      },
      code: FASTAPI_CODE,
    },
    {
      label: 'Django (Python)',
      repository: {
        id: 'dry-run-django-1',
        name: 'django-blog-api',
        framework: 'Django',
        language: 'Python',
        fileCount: 92,
        linesOfCode: 14000,
        typeAnnotationCoverage: 58,
        testCoverage: 68,
        source: 'Curated',
      },
      code: DJANGO_CODE,
    },
    {
      label: 'Express (TypeScript)',
      repository: {
        id: 'dry-run-express-1',
        name: 'express-user-api',
        framework: 'Express',
        language: 'TypeScript',
        fileCount: 110,
        linesOfCode: 18000,
        typeAnnotationCoverage: 78,
        testCoverage: 75,
        source: 'Curated',
      },
      code: EXPRESS_CODE,
    },
  ];
}

// ── Main dry-run logic ──────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log('Patchwork Dry Run — 3 Repos, No LLM, Full Pipeline');
  console.log('='.repeat(80));

  const config = new PipelineConfig();
  const basicGC = new GraphConstructor();
  const enhancedGC = new EnhancedGraphConstructor(config);
  const failureDetector = new FailureDetector();
  const metricsCalc = new MetricsCalculator();
  const serializer = new ResultSerializer();
  const summary = new RunSummary();

  const repos = makeDryRunRepos();
  const allResults: EvaluationResult[] = [];
  const stageTimings: Record<string, number[]> = {};

  for (const { label, repository, code } of repos) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Repository: ${label}  (${repository.name})`);
    console.log(`${'─'.repeat(80)}`);

    // 1. Create a synthetic Generation (bypassing LLM)
    const generationId = uuidv4();
    const generation: Generation = {
      id: generationId,
      taskId: `task-${repository.id}`,
      model: 'GPT-4o',          // label only — no API call
      promptStrategy: 'P1',
      contextFiles: [],
      generatedCode: code,
      timestamp: new Date(),
    };
    console.log(`  [gen] id=${generationId.slice(0, 8)}  code=${code.length} chars`);

    // 2. Graph construction (basic regex)
    let t0 = Date.now();
    let basicGraphs: Graph[] = [];
    try {
      basicGraphs = await basicGC.buildAllGraphs(generation);
      const dt = Date.now() - t0;
      (stageTimings['basic-graphs'] ??= []).push(dt);
      console.log(`  [basic-gc]  ${basicGraphs.length} graphs in ${dt}ms`);
      for (const g of basicGraphs) {
        console.log(`    ${g.type.padEnd(14)} nodes=${g.nodes.length}  edges=${g.edges.length}`);
        summary.addGraphResult(g);
      }
    } catch (err) {
      console.error(`  [basic-gc] CRASHED:`, err);
    }

    // 3. Graph construction (enhanced / tool-based)
    t0 = Date.now();
    let enhancedGraphs: Graph[] = [];
    try {
      enhancedGraphs = await enhancedGC.buildAllGraphs(generation);
      const dt = Date.now() - t0;
      (stageTimings['enhanced-graphs'] ??= []).push(dt);
      console.log(`  [enhanced-gc]  ${enhancedGraphs.length} graphs in ${dt}ms`);
      for (const g of enhancedGraphs) {
        console.log(`    ${g.type.padEnd(14)} nodes=${g.nodes.length}  edges=${g.edges.length}`);
      }
    } catch (err) {
      console.error(`  [enhanced-gc] CRASHED:`, err);
    }

    // Use enhanced graphs if available, otherwise fall back to basic
    const graphs = enhancedGraphs.length > 0 ? enhancedGraphs : basicGraphs;

    // 4. Failure detection
    t0 = Date.now();
    let failures: FailureDetection[] = [];
    try {
      failures = await failureDetector.detectAllFailures(generation, graphs);
      const dt = Date.now() - t0;
      (stageTimings['detection'] ??= []).push(dt);
      console.log(`  [detect]  ${failures.length} findings in ${dt}ms`);

      // Group by category
      const byCat: Record<string, number> = {};
      for (const f of failures) {
        byCat[f.category] = (byCat[f.category] || 0) + 1;
        summary.addFailureResult(f.category, f.severity, generationId);
      }
      for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${cat.padEnd(6)} ${count}`);
      }
    } catch (err) {
      console.error(`  [detect] CRASHED:`, err);
    }

    // 5. Metrics
    t0 = Date.now();
    let metrics: DetectionMetrics[] = [];
    try {
      metrics = await metricsCalc.calculateDetectionMetrics(failures, []);
      const dt = Date.now() - t0;
      (stageTimings['metrics'] ??= []).push(dt);
      console.log(`  [metrics]  ${metrics.length} categories in ${dt}ms`);
      for (const m of metrics) {
        console.log(`    ${m.category.padEnd(6)} P=${m.precision.toFixed(2)}  R=${m.recall.toFixed(2)}  F1=${m.f1Score.toFixed(2)}  TP=${m.truePositives} FP=${m.falsePositives} FN=${m.falseNegatives}`);
      }
    } catch (err) {
      console.error(`  [metrics] CRASHED:`, err);
    }

    allResults.push({
      taskId: generation.taskId,
      generations: [generation],
      graphs,
      failures,
      metrics,
    });
  }

  // ── Aggregate report ────────────────────────────────────────────
  console.log(`\n${'='.repeat(80)}`);
  console.log('Aggregate Report');
  console.log(`${'='.repeat(80)}`);

  const report = serializer.generateReport(allResults);
  console.log(`  Total repos:       ${report.summary.totalRepositories}`);
  console.log(`  Total tasks:       ${report.summary.totalTasks}`);
  console.log(`  Total generations: ${report.summary.totalGenerations}`);
  console.log(`  Total findings:    ${report.summary.totalFailures}`);
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
  const outputPath = `outputs/dry_run_${ts}.json`;

  const output = {
    timestamp: new Date().toISOString(),
    durationMs: totalDuration,
    config: {
      repos: repos.map(r => r.label),
      graphTypes: config.graphs,
      promptStrategy: 'P1',
      model: 'synthetic (no LLM call)',
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

  const allOk = expectedGraphTypes.every(gt => graphTypes.has(gt))
             && expectedCategories.every(cat => failureCategories.has(cat));

  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS MISSING — see above'}`);
  console.log(`${'='.repeat(80)}`);

  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
