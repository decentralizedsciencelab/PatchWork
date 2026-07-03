import { DetectionMetrics, FingerprintingMetrics } from '../types';

export class DetectionMetricsModel implements DetectionMetrics {
  constructor(
    public category: string,
    public precision: number,
    public recall: number,
    public f1Score: number,
    public truePositives: number,
    public falsePositives: number,
    public falseNegatives: number
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.category || typeof data.category !== 'string') {
      errors.push('DetectionMetrics category must be a non-empty string');
    }

    if (typeof data.precision !== 'number' || data.precision < 0 || data.precision > 1) {
      errors.push('DetectionMetrics precision must be a number between 0 and 1');
    }

    if (typeof data.recall !== 'number' || data.recall < 0 || data.recall > 1) {
      errors.push('DetectionMetrics recall must be a number between 0 and 1');
    }

    if (typeof data.f1Score !== 'number' || data.f1Score < 0 || data.f1Score > 1) {
      errors.push('DetectionMetrics f1Score must be a number between 0 and 1');
    }

    if (typeof data.truePositives !== 'number' || data.truePositives < 0 || !Number.isInteger(data.truePositives)) {
      errors.push('DetectionMetrics truePositives must be a non-negative integer');
    }

    if (typeof data.falsePositives !== 'number' || data.falsePositives < 0 || !Number.isInteger(data.falsePositives)) {
      errors.push('DetectionMetrics falsePositives must be a non-negative integer');
    }

    if (typeof data.falseNegatives !== 'number' || data.falseNegatives < 0 || !Number.isInteger(data.falseNegatives)) {
      errors.push('DetectionMetrics falseNegatives must be a non-negative integer');
    }

    // Validate metric calculations
    const calculatedPrecision = data.truePositives + data.falsePositives > 0 
      ? data.truePositives / (data.truePositives + data.falsePositives) 
      : 0;
    const calculatedRecall = data.truePositives + data.falseNegatives > 0 
      ? data.truePositives / (data.truePositives + data.falseNegatives) 
      : 0;
    const calculatedF1 = calculatedPrecision + calculatedRecall > 0 
      ? 2 * (calculatedPrecision * calculatedRecall) / (calculatedPrecision + calculatedRecall) 
      : 0;

    const tolerance = 0.0001;
    if (Math.abs(data.precision - calculatedPrecision) > tolerance) {
      errors.push('DetectionMetrics precision does not match calculated value from counts');
    }
    if (Math.abs(data.recall - calculatedRecall) > tolerance) {
      errors.push('DetectionMetrics recall does not match calculated value from counts');
    }
    if (Math.abs(data.f1Score - calculatedF1) > tolerance) {
      errors.push('DetectionMetrics f1Score does not match calculated value from precision and recall');
    }

    return errors;
  }

  static fromJSON(json: string): DetectionMetricsModel {
    const data = JSON.parse(json);
    const errors = DetectionMetricsModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`DetectionMetrics validation failed: ${errors.join(', ')}`);
    }

    return new DetectionMetricsModel(
      data.category,
      data.precision,
      data.recall,
      data.f1Score,
      data.truePositives,
      data.falsePositives,
      data.falseNegatives
    );
  }

  toJSON(): string {
    return JSON.stringify({
      category: this.category,
      precision: this.precision,
      recall: this.recall,
      f1Score: this.f1Score,
      truePositives: this.truePositives,
      falsePositives: this.falsePositives,
      falseNegatives: this.falseNegatives
    });
  }
}

export class FingerprintingMetricsModel implements FingerprintingMetrics {
  constructor(
    public modelPair: string,
    public jensenShannonDivergence: number,
    public rateRatios: Record<string, number>,
    public promptSensitivityVariance: number
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.modelPair || typeof data.modelPair !== 'string') {
      errors.push('FingerprintingMetrics modelPair must be a non-empty string');
    }

    if (typeof data.jensenShannonDivergence !== 'number' || 
        data.jensenShannonDivergence < 0 || data.jensenShannonDivergence > 1) {
      errors.push('FingerprintingMetrics jensenShannonDivergence must be a number between 0 and 1');
    }

    if (!data.rateRatios || typeof data.rateRatios !== 'object' || Array.isArray(data.rateRatios)) {
      errors.push('FingerprintingMetrics rateRatios must be an object');
    } else {
      Object.entries(data.rateRatios).forEach(([key, value]) => {
        if (typeof value !== 'number' || value < 0) {
          errors.push(`FingerprintingMetrics rateRatios['${key}'] must be a non-negative number`);
        }
      });
    }

    if (typeof data.promptSensitivityVariance !== 'number' || data.promptSensitivityVariance < 0) {
      errors.push('FingerprintingMetrics promptSensitivityVariance must be a non-negative number');
    }

    return errors;
  }

  static fromJSON(json: string): FingerprintingMetricsModel {
    const data = JSON.parse(json);
    const errors = FingerprintingMetricsModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`FingerprintingMetrics validation failed: ${errors.join(', ')}`);
    }

    return new FingerprintingMetricsModel(
      data.modelPair,
      data.jensenShannonDivergence,
      data.rateRatios,
      data.promptSensitivityVariance
    );
  }

  toJSON(): string {
    return JSON.stringify({
      modelPair: this.modelPair,
      jensenShannonDivergence: this.jensenShannonDivergence,
      rateRatios: this.rateRatios,
      promptSensitivityVariance: this.promptSensitivityVariance
    });
  }
}