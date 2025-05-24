---
layout: page
title: Dissertation
---

# Provenance-Based Dynamic Analysis in Managed Languages

**My dissertation is currently under review, and I expect to defend it this summer.**

## Abstract

Information-flow analyses, such as taint analysis and symbolic execution, rely on tracking how data propagates during program execution. In low-level languages, these analyses are typically performed in a location-centric manner by instrumenting programs to mirror the runtime state. This dissertation proposes an alternative instrumentation-based approach that is value-centric and tailored for high-level languages. Our approach is grounded in the insight that differentiating values based on their provenance significantly simplifies the implementation of information-flow analyses. While such differentiation is straightforward for mutable reference types, immutable primitive types are often subject to performance optimizations that restrict comparison to structural equality. To address this issue, our primary objective is to transparently promote primitive values to references through program instrumentation.

Our approach is realized through two core techniques. First, we sidestep the complexity of instrumenting the full target language by operating on a minimal core variant, using transpilation and retropilation to bridge between the core and full languages. This enables us to maintain the presence of promoted primitives in both the stack and scope. Second, to maintain the presence of promoted primitives within the store, we employ a transitive access control system known as the membrane pattern, which is based on value virtualization.

We implemented our approach in JavaScript. Our minimal core variant of JavaScript features 57% fewer AST node types than the full language. These nodes are also simpler and more explicit, which facilitates analysis and transformation. To assess the expressiveness of our approach, we developed several representative information-flow analyses, each comprising fewer than 200 lines of code. To validate its the transparency, we evaluated it against Test262, the official ECMAScript conformance test suite, achieving a 99.7% pass rate. To assess its runtime overhead, we evaluated it using the Octane benchmark suite and observed a 10X to 1000X performance overhead. As a result, our approach is currently ill-suited for analyzing long-running, computation-intensive programs or time-sensitive applications. Improving performance is left as future work.
