---
layout: post
title: "Category Theory: Programs as Morphisms"
---

In category theory, morphisms are arrows between objects in a category.
This abstract concept offers a unified way to reason about many mathematical structures.
It also provides a useful way to think about programs.

The central idea is to model programs as morphisms that describe their input-to-output behavior.
With a suitable choice of category, this behavior may include nontermination or side effects.
The question remains: what are the objects of the category?

It would be tempting to say that objects are values.
For instance, in a low-level language, objects could be sequences of bytes.
In a higher-level language, they could be integers, strings, or compound data structures.
Under this interpretation, each morphism would represent a particular program execution.
For instance, a morphism from $$2$$ to $$3$$ might denote the execution of the increment program on $$2$$.
A program would then be represented by a possibly infinite family of morphisms, one for each possible input value.

This model is too detailed to reason about programs as a whole.
Instead, we would like to model a program as a single morphism.
A natural choice is to take types as objects, interpreting them as sets of values rather than individual values.
For instance, the increment program could be modeled as a single morphism from the set of integers to itself.
More general models may require objects with additional structure to account for nontermination or effects.

The power of this approach is to provide a unified framework for interpreting programming languages as ways of expressing morphisms.
In such an interpretation, a type system ensures that well-typed programs denote morphisms with the appropriate source and target objects.

Perhaps the most straightforward way of expressing morphisms is through what we might call _morphism expressions_.
The idea is that the structure of a category lets us construct certain morphisms from others.
The simplest example is composition, which is part of the definition of a category.
If $$f$$ is a morphism from $$A$$ to $$B$$ and $$g$$ is a morphism from $$B$$ to $$C$$, then their composition $$g \circ f$$ is a morphism from $$A$$ to $$C$$.
For instance:

$$\mathrm{getAge} : \mathrm{Person} \to \mathrm{Int}$$

$$\mathrm{toStringInt} : \mathrm{Int} \to \mathrm{String}$$

$$\mathrm{toStringInt} \circ \mathrm{getAge} : \mathrm{Person} \to \mathrm{String}$$

A more interesting example is the categorical product, when the category has this additional structure.
Given morphisms $$f$$ from $$A$$ to $$B$$ and $$g$$ from $$A$$ to $$C$$, the pairing $$\langle f, g \rangle$$ is a morphism from $$A$$ to $$B \times C$$.
It is the unique morphism whose first and second projections recover $$f$$ and $$g$$, respectively.
For instance:

$$\langle \mathrm{getAge}, \mathrm{getName} \rangle : \mathrm{Person} \to \mathrm{Int} \times \mathrm{String}$$

To improve ergonomics, programming languages offer syntax beyond explicit morphism expressions.
This syntax can still be given a categorical interpretation.
For instance:

- Statements that modify state can (in a simple terminating model) be represented as morphisms from states to states, with sequencing represented by composition.
- Free variables can be handled by including their types in a product forming the domain. An expression of type $$C$$ with free variables of types $$A$$ and $$B$$ is then interpreted as a morphism $$A \times B \to C$$.
- Exception-throwing functions can be modeled using a coproduct in their codomain: $$A \to B + E$$ represents a computation that returns either a result of type $$B$$ or an exception of type $$E$$. Sequencing such computations requires composition that propagates exceptions.
