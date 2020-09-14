# μts [![Build Status](https://travis-ci.org/mixer/uts.svg?branch=master)](https://travis-ci.org/mixer/uts) ![npm](https://img.shields.io/npm/dt/uts.svg) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/uts.svg)

μts is a miniature time-series database utility suitable for embedded or frontend web applications, weighing in at about 1.5 KB minified and gzipped.

This was originally written [at Mixer](https://github.com/mixer/uts).

### Installation

```
npm install --save uts
```

### Usage

Reading the source and the [tests](./test.js) are the best way to see what it can do.

μts is schemaless, data is arranged in points, which contain one more columns, within series. Aggregations can be run which operate on points or columns. Currently supported aggregations are:

 -  `db.max(column: string)` extracts the maximum value for the column
 -  `db.minimum(column: string)` extracts the minimum value for the column
 -  `db.mean(column: string)` calculates the mean for the column
 -  `db.top(column: string)` returns the most recent value in the column
 -  `db.derivative(column: string)` calculates the change in a column
 -  `db.map(column: string)` extracts a list of column values from points in the series
 -  `db.map(iterator: (pt: Point) => any)` can extract any data you want from points in the series!
 -  `db.reduce(iterator: (current: T, pt: Point) => T, initial: T)` can reduce a column to a single data point.

```js
import { TSDB } from "uts";

const db = new TSDB();

db.series('bandwidth').query({
  metrics: {
    mean: db.mean('bits'),
  },
  where: {
      time: { is: '>', than: Date.now() - 5 * 60 * 100 }
  },
  group: db.interval(30 * 1000, true),
});

// returns =>

[
  {
    group: { start: 1459513952592, end: 1459513982592 },
    results: {
      mean: 3511
    }
  }
]
```

# Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
