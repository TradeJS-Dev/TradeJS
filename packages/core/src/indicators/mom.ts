interface Params {
  period: number;
  values: number[];
}

export class MOM {
  private period: number;
  private values: number[];

  constructor({ period, values }: Params) {
    this.period = period;
    this.values = values;
  }

  nextValue(price: number): number | undefined {
    this.values.push(price);
    if (this.values.length > this.period) {
      const momentum =
        price - this.values[this.values.length - this.period - 1];
      return momentum;
    }
    return undefined;
  }
}
