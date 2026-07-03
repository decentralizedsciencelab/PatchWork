/**
 * Collects statistics over the lifetime of an evaluation run and produces a
 * structured end-of-run summary.
 */

import { FailureCategory, LegacyCategory, Graph } from '../types';

// ── Public result types ──────────────────────────────────────────────

export interface GraphResultEntry {
  graphType: Graph['type'];
  generationId: string;
  nodeCount: number;
  edgeCount: number;
  timestamp: string;
}

export interface FailureResultEntry {
  category: FailureCategory | LegacyCategory;
  severity: 'error' | 'warning';
  generationId: string;
  timestamp: string;
}

export type ToolExecutionOutcome = 'success' | 'failure' | 'timeout';

export interface ToolExecutionEntry {
  scriptName: string;
  outcome: ToolExecutionOutcome;
  durationMs: number;
  timestamp: string;
}

export interface RunSummaryData {
  /** Total graphs built, broken down by graph type. */
  graphsByType: Record<string, number>;
  /** Total failures detected, broken down by failure category. */
  failuresByCategory: Record<string, number>;
  /** Tool execution counts by outcome. */
  toolExecutions: {
    success: number;
    failure: number;
    timeout: number;
    total: number;
  };
  /** Wall-clock duration of the run in milliseconds (null if not yet ended). */
  durationMs: number | null;
  /** ISO timestamps for the start and (optional) end of the run. */
  startedAt: string;
  endedAt: string | null;
}

// ── RunSummary class ─────────────────────────────────────────────────

export class RunSummary {
  private graphResults: GraphResultEntry[] = [];
  private failureResults: FailureResultEntry[] = [];
  private toolExecutions: ToolExecutionEntry[] = [];
  private readonly startTime: Date;
  private endTime: Date | null = null;

  constructor() {
    this.startTime = new Date();
  }

  // ── Mutators ──────────────────────────────────────────────────────

  addGraphResult(graph: Graph): void {
    this.graphResults.push({
      graphType: graph.type,
      generationId: graph.generationId,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      timestamp: new Date().toISOString(),
    });
  }

  addFailureResult(
    category: FailureCategory | LegacyCategory,
    severity: 'error' | 'warning',
    generationId: string,
  ): void {
    this.failureResults.push({
      category,
      severity,
      generationId,
      timestamp: new Date().toISOString(),
    });
  }

  addToolExecution(
    scriptName: string,
    outcome: ToolExecutionOutcome,
    durationMs: number,
  ): void {
    this.toolExecutions.push({
      scriptName,
      outcome,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  }

  /** Mark the run as completed so that `getSummary()` includes a duration. */
  end(): void {
    this.endTime = new Date();
  }

  // ── Query ─────────────────────────────────────────────────────────

  getSummary(): RunSummaryData {
    // Graphs by type
    const graphsByType: Record<string, number> = {};
    for (const entry of this.graphResults) {
      const key = entry.graphType;
      graphsByType[key] = (graphsByType[key] ?? 0) + 1;
    }

    // Failures by category
    const failuresByCategory: Record<string, number> = {};
    for (const entry of this.failureResults) {
      const key = entry.category;
      failuresByCategory[key] = (failuresByCategory[key] ?? 0) + 1;
    }

    // Tool execution stats
    let successCount = 0;
    let failureCount = 0;
    let timeoutCount = 0;
    for (const entry of this.toolExecutions) {
      switch (entry.outcome) {
        case 'success':
          successCount++;
          break;
        case 'failure':
          failureCount++;
          break;
        case 'timeout':
          timeoutCount++;
          break;
      }
    }

    const endedAt = this.endTime ? this.endTime.toISOString() : null;
    const durationMs = this.endTime
      ? this.endTime.getTime() - this.startTime.getTime()
      : null;

    return {
      graphsByType,
      failuresByCategory,
      toolExecutions: {
        success: successCount,
        failure: failureCount,
        timeout: timeoutCount,
        total: successCount + failureCount + timeoutCount,
      },
      durationMs,
      startedAt: this.startTime.toISOString(),
      endedAt,
    };
  }
}
