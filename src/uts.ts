/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

type InstantiatedMetrics<TMetrics extends TMetricMin> = {
  [K in keyof TMetrics]: ReturnType<TMetrics[K]>;
};

/**
 * The Bin is used internally in the query system and holds analysis for
 * a group.
 */
export class Bin<TMetrics extends TMetricMin, TGroup> {
  private columns: (keyof TMetrics)[];
  private metrics: InstantiatedMetrics<TMetrics>;
  private _size = 0;

  /**
   * The bin holds data for a group of time series metrics.
   * @param  {Object} metrics
   * @param  {Object} group   arbitrary object describing the grouping of
   *                          the contained metrics.
   */
  constructor(metrics: TMetrics, private readonly group: TGroup) {
    this.columns = Object.keys(metrics);

    const instantiated: Partial<InstantiatedMetrics<TMetrics>> = {};
    for (const col of this.columns) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instantiated[col] = metrics[col]() as any;
    }

    this.metrics = instantiated as InstantiatedMetrics<TMetrics>;
  }

  /**
   * Returns the number of points in this bin.
   * @return {Number}
   */
  size(): number {
    return this._size;
  }

  /**
   * Adds new data to the bin.
   * @param  {Point} point
   * @return {Bin}
   */
  push(point: Point): this {
    this._size++;

    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i];
      this.metrics[col].push(point);
    }

    return this;
  }

  /**
   * Serializes the bin to a results object.
   * @return {Object}
   */
  toObject(): BinResult<TMetrics, TGroup> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = { results: {} };

    if (this.group !== undefined) {
      out.group = this.group;
    }

    for (const col of this.columns) {
      out.results[col] = this.metrics[col].serialize();
    }

    return out;
  }
}

/**
 * Parent class of groupers.
 */
export abstract class Group<TGroup> {
  protected _where: { [col: string]: Comparator | Comparator[] } = {};

  /**
   * Sets the `where` object this query is being called with.
   * @param  {Object} where
   * @return {Group}
   */
  public where(where: { [col: string]: Comparator | Comparator[] }): this {
    this._where = where;
    return this;
  }

  protected getWhere(column: string): Comparator[] {
    const clause = this._where[column];
    if (!clause) {
      return [];
    }

    return Array.isArray(clause) ? clause : [clause];
  }

  /**
   * Returns a list of bins with points added to them.
   */
  abstract binify<TMetrics extends TMetricMin>(
    data: Point[],
    metrics: TMetrics,
  ): Bin<TMetrics, TGroup>[];
}

export interface IIntervalGroup {
  start: number;
  width: number;
}

/**
 * The IntervalGrouper groups data based on time.
 */
class IntervalGrouper extends Group<IIntervalGroup> {
  /**
   * @param  {Number} interval the size, in milliseconds, of each group bin
   * @param  {Boolean} fill    whether to zero-fill bins that don't have data
   */
  constructor(private interval: number, private fill: boolean, private now: number) {
    super();
  }

  binify<TMetrics extends TMetricMin>(
    data: Point[],
    metrics: TMetrics,
  ): Bin<TMetrics, IIntervalGroup>[] {
    let start: number;
    const timeBound = this.getWhere('time').find(time => time.is === '>');
    if (timeBound) {
      start = timeBound.than;
    } else {
      start = data[0].getTime();
    }

    const { interval, now } = this;
    const count = Math.floor((now - start) / interval) + 1;

    let bins = new Array<Bin<TMetrics, IIntervalGroup>>();
    for (let i = 0; i < count; i++) {
      bins.push(
        new Bin(metrics, {
          start: now - (i + 1) * interval,
          width: interval,
        }),
      );
    }

    for (let i = 0; i < data.length; i++) {
      const time = data[i].getTime();
      if (time > now) {
        break;
      }

      bins[Math.floor((now - time) / interval)].push(data[i]);
    }

    if (!this.fill) {
      bins = bins.filter(b => b.size() > 0);
    }

    return bins;
  }
}

/**
 * The AnyGrouper is the "base" grouper that just shoves all the data into
 * a single bin.
 */
class AnyGrouper extends Group<undefined> {
  binify<TMetrics extends TMetricMin>(
    data: Point[],
    metrics: TMetrics,
  ): Bin<TMetrics, undefined>[] {
    const bin = new Bin(metrics, undefined);
    for (let i = 0; i < data.length; i++) {
      bin.push(data[i]);
    }

    return [bin];
  }
}

export type PointData = {
  [column: string]: number;
};

/**
 * A Point is the minimal item of data within a Series. It stores one or more
 * properties that can be analyzed, as well as the time it was inserted.
 */
export class Point {
  /**
   * Creates a new point for insertion into a time series.
   * @param data
   * @param time insertion time in milliseconds
   */
  constructor(private data: PointData, time = Date.now()) {
    this.data['time'] = time;
  }

  /**
   * Gets a property from the point, returning the default value if
   * it doens't exist.
   */
  public get(prop: string): number | undefined;
  public get(prop: string, defaultValue: number): number;
  public get(prop: string, defaultValue?: number): number | undefined {
    return this.has(prop) ? this.data[prop] : defaultValue;
  }

  /**
   * Returns true if this point contains the provided property.
   */
  public has(prop: string) {
    return this.data.hasOwnProperty(prop);
  }

  /**
   * Returns the time this point was inserted at.
   * @return {Number} milliseconds timestamp
   */
  public getTime(): number {
    return this.data['time'];
  }

  /**
   * Clones and converts the point to a plain object.
   */
  public toObject(): PointData {
    const out: PointData = {};
    Object.keys(this.data).forEach(key => (out[key] = this.data[key]));
    return out;
  }
}

export type BinaryOperator = '>' | '<' | '=';

/**
 * The Comparator can be passed into the series query to compare values
 * to each other.
 */
export interface Comparator {
  is: BinaryOperator;
  than: number;
}

/**
 * BinResults are returned from time series queries.
 */
export interface BinResult<TMetrics extends TMetricMin, TGroup> {
  group?: TGroup;
  results: { [K in keyof TMetrics]: TMetrics[K] extends () => Aggregate<infer R> ? R : unknown };
}

type TMetricMin = { [col: string]: () => Aggregate<unknown> };

/**
 * Series contains a logical grouping of results that can be aggregated.
 */
export class Series {
  private interval = 0;
  private data = new Array<Point>();

  /**
   * Sets how long data will be stored in the provided series.
   * @param {Number} ttl duration in milliseconds
   *                     If zero, all data will be kept
   */
  public setRetention(ttl: number) {
    clearInterval(this.interval);

    if (ttl === 0) {
      return;
    }

    this.interval = setInterval(() => {
      const threshold = Date.now() - ttl;

      let i = 0;
      while (this.data[i] && this.data[i].getTime() < threshold) {
        i++;
      }

      if (i > 0) {
        this.data = this.data.slice(i);
      }
    }, 1000);
  }

  /**
   * Inserts new data into the series at the specified time,
   * defaulting to the current time if not provided.
   */
  public insert(data: Point | PointData, time?: number) {
    this.data.push(data instanceof Point ? data : new Point(data, time));
    return this;
  }

  /**
   * Coverts a comparator `where` from a query into a predicate function.
   * @param  {Object} cmp
   * @return {Function}
   */
  private buildComparator(cmp: {
    [col: string]: Comparator | Comparator[];
  }): (pt: Point) => boolean {
    const fns = Object.keys(cmp).reduce((allFns, col) => {
      let comparators = cmp[col];
      if (!Array.isArray(cmp[col])) {
        comparators = [<Comparator>comparators];
      }

      const cmpFns = (<Comparator[]>comparators).map(comp => {
        const comparator = comp.is;
        const value = comp.than;

        return (pt: Point): boolean => {
          const v = pt.get(col);
          if (v === undefined) {
            return false;
          }

          switch (comparator) {
            case '>':
              return v > value;
            case '<':
              return v < value;
            case '=':
              return v === value;
            default:
              throw new Error(`Unknown comparator '${comparator}'`);
          }
        };
      });

      return [...allFns, ...cmpFns];
    }, [] as ((pt: Point) => boolean)[]);

    return pt => {
      for (let i = 0; i < fns.length; i++) {
        if (!fns[i](pt)) {
          return false;
        }
      }

      return true;
    };
  }

  /**
   * deleteBy removes series data that matches the comparison. If no
   * comparator is given, then all data is removed.
   */
  public remove(query?: { [col: string]: Comparator | Comparator[] }): this {
    if (!query) {
      this.data = [];
      return this;
    }

    const comparator = this.buildComparator(query);
    this.data = this.data.filter(pt => !comparator(pt));
    return this;
  }

  /**
   * Runs a query against the time series.
   * @example
   *
   *   db.series('bandwidth').query({
   *     metrics: {
   *       mean: db.mean('bits'),
   *     },
   *     where: {
   *         time: { is: '>', than: Date.now() - 5 * 60 * 100 }
   *     },
   *     group: db.interval(30 * 1000, true),
   *   });
   *
   *   // returns:
   *
   *   [{
   *     group: { start: 1459513952592, end: 1459513982592 },
   *     metrics: {
   *       mean: 3511
   *     }
   *   }, {
   *     // ...
   *   }]
   */
  public query<TMetrics extends TMetricMin, TGroup = undefined>(options: {
    metrics: TMetrics;
    where?: { [col: string]: Comparator | Comparator[] };
    group?: Group<TGroup>;
  }): BinResult<TMetrics, TGroup>[] {
    options.where = options.where || {};
    options.group = options.group || ((new AnyGrouper() as unknown) as Group<TGroup>);

    const data = this.data.filter(this.buildComparator(options.where));
    return options.group
      .where(options.where)
      .binify(data, options.metrics)
      .map(bin => bin.toObject());
  }

  /**
   * Frees resources associated with the time series. Subsequent attempted
   * usages of the series will throw an error.
   */
  public destroy() {
    clearInterval(this.interval);
  }
}

export interface Aggregate<R> {
  /**
   * Adds a new point to the aggregate.
   */
  push(point: Point): void;

  /**
   * Returns the aggregate's result for returning in the query results.
   */
  serialize(): R;
}

class Mapper<R> implements Aggregate<R[]> {
  private readonly data: R[] = [];

  /**
   * Mapper returns the results of a mapping function on the points.
   */
  constructor(private fn: (pt: Point) => R) {}

  public push(pt: Point) {
    this.data.push(this.fn(pt));
  }

  public serialize(): R[] {
    return this.data;
  }
}

class Reducer<R> implements Aggregate<R> {
  private result: R;

  /**
   * Mapper returns the results of a mapping function on the points.
   */
  constructor(private fn: (current: R, pt: Point) => R, initial: R) {
    this.result = initial;
  }

  public push(pt: Point) {
    this.result = this.fn(this.result, pt);
  }

  public serialize() {
    return this.result;
  }
}

class Average implements Aggregate<number> {
  private sum = 0;
  private count = 0;

  /**
   * Average computes the arithmetic mean of the specified column.
   */
  constructor(private column: string) {}

  public push(pt: Point) {
    if (pt.has(this.column)) {
      this.sum += pt.get(this.column, 0);
      this.count += 1;
    }
  }

  public serialize() {
    return this.count === 0 ? 0 : this.sum / this.count;
  }
}

class Derivative implements Aggregate<Point[]> {
  private lastChange = 0;
  private lastValue?: number;
  private lastTime?: number;
  private leadingTime?: number;

  private points = new Array<Point>();

  /**
   * Derivative plots changes in a column's value.
   */
  constructor(private column: string, private interval: number) {}

  public push(pt: Point) {
    const value = pt.get(this.column);
    if (value === undefined) {
      return;
    }

    const time = pt.getTime();
    if (this.lastTime === undefined || this.lastValue === undefined) {
      this.lastTime = time;
      this.lastValue = value;
    }

    while (this.lastTime + this.interval < time) {
      this.pushPoint(this.lastTime + this.interval);
    }

    this.lastChange += value - this.lastValue;
    this.lastValue = value;
    this.leadingTime = time;
  }

  private pushPoint(time: number) {
    this.points.push(new Point({ [this.column]: this.lastChange }, time));

    this.lastChange = 0;
    this.lastTime = time;
  }

  public serialize() {
    if (this.leadingTime !== undefined) {
      this.pushPoint(this.leadingTime);
    }

    return this.points;
  }
}

/**
 * TSDB is a miniature time-series database in plain Js. It functions as follows:
 *  - The database has many Series, identified by their name as strings.
 *  - You can push data to each Series.
 *  - Later, you can query for data in the Series. Data is always passed
 *    through a grouper when you query if (even if it groups all points
 *    together) and you can also attach aggregators to it.
 *      - Each group creates a bunch of "bins", and pushed each data point
 *        in the query to one or more bins.
 *      - Each bin stores one or more aggregators, like "mean", which analyze
 *        data in that bin
 *      - At the end of the query, the grouper returns the bins it created
 *        which are then serialized and passed back to the caller.
 */
export class TSDB {
  private _series: { [name: string]: Series } = {};
  private _defaultRetention = 0;

  /**
   * Sets the default series retention time in milliseconds.
   */
  public defaultRetention(ttl: number) {
    this._defaultRetention = ttl;
  }

  /**
   * Returns a new Series, creating one if it did not already exist.
   * @param  {String} name
   * @return {Series}
   */
  public series(name: string): Series {
    if (!this._series.hasOwnProperty(name)) {
      this._series[name] = new Series();
      this._series[name].setRetention(this._defaultRetention);
    }

    return this._series[name];
  }

  /**
   * Tears down the database.
   */
  public destroy() {
    Object.keys(this._series).forEach(s => this._series[s].destroy());
    this._series = {};
  }

  /**
   * Creates an analysis which runs a custom mapping function on points,
   * returning the mapping results. If the `mapper` is a string, it'll
   * extract the specified column from the results, lodash style.
   */
  public static map(mapper: string): () => Aggregate<(number | undefined)[]>;
  public static map<T = number>(mapper: (pt: Point) => T): () => Aggregate<T[]>;
  public static map<T = number>(
    mapper: string | ((pt: Point) => T),
  ): () => Aggregate<(T | undefined)[]> {
    let fn: (pt: Point) => T | number | undefined;
    if (typeof mapper === 'function') {
      fn = mapper;
    } else {
      fn = pt => pt.get(mapper);
    }

    return () => new Mapper(fn) as Aggregate<(T | undefined)[]>;
  }

  /**
   * Creates an analysis which runs a custom mapping function on points,
   * returning the mapping results. If the `mapper` is a string, it'll
   * extract the specified column from the results, lodash style.
   */
  public static reduce<T>(fn: (current: T, pt: Point) => T, initial: T): () => Aggregate<T> {
    return () => new Reducer(fn, initial);
  }

  /**
   * Creates a mean metric analysis passed into Series.Query
   */
  public static mean(column: string): () => Aggregate<number> {
    return () => new Average(column);
  }

  /**
   * Creates a max metric analysis passed into Series.Query
   */
  public static max(column: string): () => Aggregate<number> {
    return this.reduce((max, pt) => Math.max(pt.get(column, -Infinity), max), 0);
  }

  /**
   * Creates a min metric analysis passed into Series.Query
   */
  public static min(column: string): () => Aggregate<number> {
    return this.reduce((min, pt) => Math.min(pt.get(column, Infinity), min), 0);
  }

  /**
   * Creates an analysis which returns points that plot changes in a column,
   * within a specified interval.
   */
  public static derivative(column: string, interval: number): () => Aggregate<Point[]> {
    return () => new Derivative(column, interval);
  }

  /**
   * Creates an analysis that gets the most recent
   * value of the specified column.
   */
  public static last(column: string): () => Aggregate<number | undefined> {
    return this.reduce<number | undefined>((_, pt) => pt.get(column), undefined);
  }

  /**
   * Creates a sum metric analysis passed into Series.Query
   */
  public static sum(column: string): () => Aggregate<number> {
    return this.reduce((sum, pt) => sum + pt.get(column, 0), 0);
  }

  /**
   * Creates a count analysis passed into Series.Query. By default, counts
   * all columns, or you can pass a column to only count points that have
   * that column.
   */
  public static count(column = '*'): () => Aggregate<number> {
    return this.reduce((sum, pt) => {
      if (column === '*' || pt.get(column) !== undefined) {
        return sum + 1;
      }
      return sum;
    }, 0);
  }

  /**
   * Creates a new grouper based on time intervals.
   */
  public static interval(
    interval: number,
    fill = true,
    now: number = Date.now(),
  ): Group<IIntervalGroup> {
    return new IntervalGrouper(interval, fill, now);
  }
}
