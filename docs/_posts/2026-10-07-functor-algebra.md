---
layout: post
title: "Category Theory: Functor Algebra"
---

Given a category $$\mathcal{C}$$ and an endo-functor $$$F : \mathcal{C} \to \mathcal{C}$$$, an $$F$$-algebra is a pair $$(A, \alpha)$$ where:

- $$A$$ is an object of $$\mathcal{C}$$, and is called the carrier of the algebra.
- $$\alpha : F(A) \to A$$ is a morphism in $$\mathcal{C}$$, called the structure map of the algebra.

## Example: Boolean Conjunction Algebra

- The category $$\mathcal{C}$$ is the category of sets, $$\mathbf{Set}$$ where objects are sets and morphisms are functions between sets.
- The endo-functor $$F : \mathbf{Set} \to \mathbf{Set}$$ is the cartesian product $$F(X) = X \times X$$.
- The carrier $$A$$ of the algebra is the boolean set $$A = \mathbf{Bool} = \{ \text{True}, \text{False} \}$$.
- The structure map $$\alpha : F(A) \to A$$ is defined as the boolean conjunction operation: $$\alpha (x, y) = x \land y$$.
- The algebra
