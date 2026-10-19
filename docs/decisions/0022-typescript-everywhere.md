---
status: accepted
date: 2026-10-18
decision-makers: human (exact words in journal D22)
journal: D22
---

# 0022. TypeScript everywhere: Node server and browser app

## Context and Problem Statement

The PDF lets the builder choose the language, preferring a C#/.NET backend with a TypeScript frontend, and asks for the
choice to be explained (C-3, REQ-20). The deadline leaves about four hours. Which stack?

## Decision Drivers

* Deadline 2026-10-19 03:00 CDT
* Vendor SDK support (R02)
* REQ-20: explain the choice

## Considered Options

* Do nothing
* .NET/C# server + TypeScript browser
* Python server + TypeScript browser
* TypeScript server and browser

## Decision Outcome

Chosen option: "TypeScript server and browser", because one language and first-class vendor SDKs give the shortest path
in four hours. The human answered "A: TypeScript everywhere — yes".

### Consequences

* Good: one toolchain, shared types for the stage contracts.
* Bad: differs from the partner's preferred backend; explained in the write-up.

### Confirmation

The stage contracts keep a .NET server port contained.

## More Information

Journal D22; R02; PRD C-3.
