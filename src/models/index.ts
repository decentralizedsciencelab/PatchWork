// Export all data models
export { RepositoryModel } from './Repository';
export { TaskModel } from './Task';
export { GenerationModel } from './Generation';
export { GraphModel, GraphNodeModel, GraphEdgeModel } from './Graph';
export { FailureDetectionModel, CodeLocationModel } from './FailureDetection';
export { DetectionMetricsModel, FingerprintingMetricsModel } from './Metrics';

// Validation utilities
export class ValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`);
    this.name = 'ValidationError';
  }
}

export class SerializationUtils {
  /**
   * Safely parse JSON with validation
   */
  static safeParseJSON<T>(
    json: string, 
    validator: (data: any) => string[]
  ): { success: true; data: T } | { success: false; errors: string[] } {
    try {
      const data = JSON.parse(json);
      const errors = validator(data);
      
      if (errors.length > 0) {
        return { success: false, errors };
      }
      
      return { success: true, data };
    } catch (error) {
      return { 
        success: false, 
        errors: [`JSON parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`] 
      };
    }
  }

  /**
   * Safely stringify with error handling
   */
  static safeStringify(data: any): { success: true; json: string } | { success: false; error: string } {
    try {
      const json = JSON.stringify(data);
      return { success: true, json };
    } catch (error) {
      return { 
        success: false, 
        error: `JSON stringification failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Validate data integrity for round-trip serialization
   */
  static validateRoundTrip<T>(
    original: T,
    serializer: (data: T) => string,
    deserializer: (json: string) => T,
    comparator?: (a: T, b: T) => boolean
  ): { success: true } | { success: false; error: string } {
    try {
      const serialized = serializer(original);
      const deserialized = deserializer(serialized);
      
      const isEqual = comparator 
        ? comparator(original, deserialized)
        : JSON.stringify(original) === JSON.stringify(deserialized);
      
      if (!isEqual) {
        return { 
          success: false, 
          error: 'Round-trip serialization failed: deserialized data does not match original' 
        };
      }
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Round-trip validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
}