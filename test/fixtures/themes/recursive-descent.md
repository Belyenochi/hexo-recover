---
title: Writing a Recursive Descent Parser
date: 2018-09-06 21:39:10
categories: [Compilers]
tags: [parser, javascript]
---

This post walks through parsing an LL(1) grammar by recursive descent and compares it with a table-driven parser.

<!-- more -->

## 1 Grammar

Every non-terminal becomes a procedure. The grammar below has **two** productions, one of them *optional*.

```javascript
class Parser {
  constructor(input) { this.input = input; this.cursor = 0; }
  run() { return this.parseS() && this.cursor === this.input.length; }
}
```

- match the current token
- on failure, **backtrack** to the saved cursor
  - unless the grammar is LL(1), in which case a single lookahead decides

| construct | table-driven | recursive descent |
|---|---|---|
| stack | explicit | call stack |
| errors | at table miss | at procedure |

![parse tree](/images/diagram.png)

> The table is the program; the procedures are the table, unrolled.
