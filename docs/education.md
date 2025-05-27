---
layout: page
title: Education
---

## Ph.D. Dissertation - Computer Science

**My dissertation is currently under review, with the defense scheduled for mid-September.**

**Provenance-Based Dynamic Analysis in Managed Languages**

Information-flow analyses, such as taint analysis and symbolic execution, rely on tracking how data propagates during program execution. In low-level languages, these analyses are typically performed in a location-centric manner by instrumenting programs to mirror the runtime state. This dissertation proposes an alternative instrumentation-based approach that is value-centric and tailored for high-level languages. Our approach is grounded in the insight that differentiating values based on their provenance significantly simplifies the implementation of information-flow analyses. While such differentiation is straightforward for mutable reference types, immutable primitive types are often subject to performance optimizations that restrict comparison to structural equality. To address this issue, our primary objective is to transparently promote primitive values to references through program instrumentation.

Our approach is realized through two core techniques. First, we sidestep the complexity of instrumenting the full target language by operating on a minimal core variant, using transpilation and retropilation to bridge between the core and full languages. This enables us to maintain the presence of promoted primitives in both the stack and scope. Second, to maintain the presence of promoted primitives within the store, we employ a transitive access control system known as the membrane pattern, which is based on value virtualization.

We implemented our approach in JavaScript. Our minimal core variant of JavaScript features 57% fewer AST node types than the full language. These nodes are also simpler and more explicit, which facilitates analysis and transformation. To assess the expressiveness of our approach, we developed several representative information-flow analyses, each comprising fewer than 200 lines of code. To validate its the transparency, we evaluated it against Test262, the official ECMAScript conformance test suite, achieving a 99.7% pass rate. To assess its runtime overhead, we evaluated it using the Octane benchmark suite and observed a 10X to 1000X performance overhead. As a result, our approach is currently ill-suited for analyzing long-running, computation-intensive programs or time-sensitive applications. Improving performance is left as future work.

## Master of Science in Engineering – Computer Science

[**Diploma - Short**](https://github.com/lachrist/lachrist.github.io/blob/main/docs/assets/diploma-master-short.pdf?raw=true)

[**Diploma – Full**](https://github.com/lachrist/lachrist.github.io/blob/main/docs/assets/diploma-master.pdf?raw=true)

[**Thesis: Iterative Typing**](https://github.com/lachrist/lachrist.github.io/blob/main/docs/assets/thesis-master.pdf?raw=true)

Types have been introduced into programming languages to increase safety and the abstraction level; with typing, programmers no longer directly manipulate byte strings but data of a certain type instead. Type systems must make a compromise between static safety and expressiveness; static safety being the ability to detect errors based on static code analysis and expressiveness being the ability to denote concepts. Traditionally, programming languages are separated into two classes: statically typed languages and dynamically typed languages. The first class emphasizes early error detection and catches many errors during static code analysis. The second emphasizes expressiveness but catches errors very late, right before calls to built-in functions. The gap between those two classes is considerable and we argue that the best of those two worlds can be combined. The compromise this thesis defends is called iterative typing. In essence, iterative typing is static typing that delays as few checks as possible for runtime. When uncertainty occurs during static code analysis, static typing typically makes assumptions that allow the analysis to continue but inhibit the expressiveness of the language. In the same situation, iterative typing inserts annotations into the code so the uncertainty can be precisely resolved at runtime, when more information will be available. Iterative typing shines when type deduction depends on the executed branch of a conditional structure as is the case for dispatch on types and deserialization patterns. As a validation of iterative typing, we present three case studies of practical interest; although the exposed solutions are implemented in a dynamic way, iterative typing is able to catch errors early on.

## Bachelor of Science in Engineering – Civil Engineering

[**Diploma – Short**](https://github.com/lachrist/lachrist.github.io/blob/main/docs/assets/diploma-bachelor-short.pdf?raw=true)

[**Diploma – Full**](https://github.com/lachrist/lachrist.github.io/blob/main/docs/assets/diploma-bachelor.pdf?raw=true)

