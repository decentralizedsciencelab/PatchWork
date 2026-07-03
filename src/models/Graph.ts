import { Graph, GraphNode, GraphEdge } from '../types';

export class GraphNodeModel implements GraphNode {
  constructor(
    public id: string,
    public label: string,
    public type: string,
    public properties: Record<string, any>
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.id || typeof data.id !== 'string') {
      errors.push('GraphNode id must be a non-empty string');
    }

    if (!data.label || typeof data.label !== 'string') {
      errors.push('GraphNode label must be a non-empty string');
    }

    if (!data.type || typeof data.type !== 'string') {
      errors.push('GraphNode type must be a non-empty string');
    }

    if (!data.properties || typeof data.properties !== 'object' || Array.isArray(data.properties)) {
      errors.push('GraphNode properties must be an object');
    }

    return errors;
  }
}

export class GraphEdgeModel implements GraphEdge {
  constructor(
    public source: string,
    public target: string,
    public type: string,
    public properties: Record<string, any>
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.source || typeof data.source !== 'string') {
      errors.push('GraphEdge source must be a non-empty string');
    }

    if (!data.target || typeof data.target !== 'string') {
      errors.push('GraphEdge target must be a non-empty string');
    }

    if (!data.type || typeof data.type !== 'string') {
      errors.push('GraphEdge type must be a non-empty string');
    }

    if (!data.properties || typeof data.properties !== 'object' || Array.isArray(data.properties)) {
      errors.push('GraphEdge properties must be an object');
    }

    return errors;
  }
}

export class GraphModel implements Graph {
  constructor(
    public id: string,
    public generationId: string,
    public type: 'import' | 'call' | 'dependency' | 'schema' | 'config' | 'cfg' | 'resource' | 'routing',
    public nodes: GraphNode[],
    public edges: GraphEdge[],
    public metadata: Record<string, any>
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.id || typeof data.id !== 'string') {
      errors.push('Graph id must be a non-empty string');
    }

    if (!data.generationId || typeof data.generationId !== 'string') {
      errors.push('Graph generationId must be a non-empty string');
    }

    const validTypes = ['import', 'call', 'dependency', 'schema', 'config', 'cfg', 'resource', 'routing'];
    if (!validTypes.includes(data.type)) {
      errors.push(`Graph type must be one of: ${validTypes.join(', ')}`);
    }

    if (!Array.isArray(data.nodes)) {
      errors.push('Graph nodes must be an array');
    } else {
      data.nodes.forEach((node: any, index: number) => {
        const nodeErrors = GraphNodeModel.validate(node);
        nodeErrors.forEach(error => errors.push(`Node ${index}: ${error}`));
      });
    }

    if (!Array.isArray(data.edges)) {
      errors.push('Graph edges must be an array');
    } else {
      data.edges.forEach((edge: any, index: number) => {
        const edgeErrors = GraphEdgeModel.validate(edge);
        edgeErrors.forEach(error => errors.push(`Edge ${index}: ${error}`));
      });
    }

    if (!data.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
      errors.push('Graph metadata must be an object');
    }

    // Validate edge references
    if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
      const nodeIds = new Set(data.nodes.map((node: any) => node.id));
      data.edges.forEach((edge: any, index: number) => {
        if (!nodeIds.has(edge.source)) {
          errors.push(`Edge ${index}: source node '${edge.source}' not found in nodes`);
        }
        if (!nodeIds.has(edge.target)) {
          errors.push(`Edge ${index}: target node '${edge.target}' not found in nodes`);
        }
      });
    }

    return errors;
  }

  static fromJSON(json: string): GraphModel {
    const data = JSON.parse(json);
    const errors = GraphModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`Graph validation failed: ${errors.join(', ')}`);
    }

    return new GraphModel(
      data.id,
      data.generationId,
      data.type,
      data.nodes,
      data.edges,
      data.metadata
    );
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      generationId: this.generationId,
      type: this.type,
      nodes: this.nodes,
      edges: this.edges,
      metadata: this.metadata
    });
  }
}