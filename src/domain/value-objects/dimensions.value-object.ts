import { InvariantViolationError } from "@domain/errors/domain.error";

export class InvalidDimensionsError extends InvariantViolationError {}

export interface DimensionsProps {
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

export class Dimensions {
  private static readonly SCALE = 2;
  private static readonly MIN_CM = 0.01;
  private static readonly MAX_CM = 1000;

  private constructor(
    public readonly lengthCm: number,
    public readonly widthCm: number,
    public readonly heightCm: number,
  ) {
    Object.freeze(this);
  }

  static create(props: DimensionsProps): Dimensions {
    const fields: ReadonlyArray<readonly [keyof DimensionsProps, number]> = [
      ["lengthCm", props.lengthCm],
      ["widthCm", props.widthCm],
      ["heightCm", props.heightCm],
    ];

    for (const [field, value] of fields) {
      Dimensions.assertValid(field, value);
    }

    return new Dimensions(props.lengthCm, props.widthCm, props.heightCm);
  }

  private static assertValid(
    field: keyof DimensionsProps,
    value: number,
  ): void {
    if (!Number.isFinite(value)) {
      throw new InvalidDimensionsError(`${field} must be a finite number`);
    }

    if (value < Dimensions.MIN_CM) {
      throw new InvalidDimensionsError(
        `${field} must be at least ${Dimensions.MIN_CM} cm`,
      );
    }

    if (value > Dimensions.MAX_CM) {
      throw new InvalidDimensionsError(
        `${field} must not exceed ${Dimensions.MAX_CM} cm`,
      );
    }

    if (!Dimensions.hasValidScale(value)) {
      throw new InvalidDimensionsError(
        `${field} must have at most ${Dimensions.SCALE} decimal places`,
      );
    }
  }

  private static hasValidScale(value: number): boolean {
    const [, decimals = ""] = value.toString().split(".");
    return decimals.length <= Dimensions.SCALE;
  }

  volumeCm3(): number {
    return Number(
      (this.lengthCm * this.widthCm * this.heightCm).toFixed(Dimensions.SCALE),
    );
  }

  equals(other: Dimensions): boolean {
    return (
      this.lengthCm === other.lengthCm &&
      this.widthCm === other.widthCm &&
      this.heightCm === other.heightCm
    );
  }

  toPrimitives(): DimensionsProps {
    return {
      lengthCm: this.lengthCm,
      widthCm: this.widthCm,
      heightCm: this.heightCm,
    };
  }
}
