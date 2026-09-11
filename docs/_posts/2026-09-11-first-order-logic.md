---
layout: post
title: "Refresher: First Order Logic"
---

The following is a brief refresher on first-order logic.
It builds upon my previous post on [propositional-logic](/blog/2026/09/10/proposition/).
Assuming good understanding of propositional logic, it should be understandable to anyone with basic mathematical training.
However, the more advanced observations assume some background in complexity theory.
Similar to propositional logic, the greatest source of confusion is mixing the base language of first-order logic with the meta language in which we discuss it.

## Syntax of First Order Logic

We assume infinite supply of symbols for variables ranging over a domain of discourse:

$$
X ::= x_1 \mid x_2 \ldots y_1 \mid y_2 \ldots
$$

We assume an infinite supply of symbols for constants:

$$
C ::= c_1 \mid c_2 \mid \ldots d_1 \mid d_2 \ldots
$$

We assume an infinite supply of symbols for function whose arity is indicated by a superscript:

$$
F^0 ::= f^0_1 \mid f^0_2 \mid \ldots g^0_1 \mid g^0_2 \ldots
\\[2mm]
F^1 ::= f^1_1 \mid f^1_2 \mid \ldots g^1_1 \mid g^1_2 \ldots
\\[2mm]
\ldots
\\[2mm]
F^i ::= f^i_1 \mid f^i_2 \mid \ldots g^i_1 \mid g^i_2 \ldots
$$

A term is either a variable, a constant, or a function applied to terms:

$$
T ::= X \mid C \mid F^0() \mid F^1(T) \mid F^2(T,T) \mid \ldots
$$

We assume an infinite supply of symbols for predicates whose arity is indicated by a superscript:

$$
P^0 ::= p^0_1 \mid p^0_2 \mid \ldots q^0_1 \mid q^0_2 \ldots
\\[2mm]
P^1 ::= p^1_1 \mid p^1_2 \mid \ldots q^1_1 \mid q^1_2 \ldots
\\[2mm]
\ldots
\\[2mm]
P^i ::= p^i_1 \mid p^i_2 \mid \ldots q^i_1 \mid q^i_2 \ldots
$$

$$
\varphi ::= P^0() \mid P^1(T) \mid P^2(T,T) \mid \ldots \mid T = T \mid \neg \varphi \mid (\varphi \land \varphi) \mid (\varphi \lor \varphi) \mid (\varphi \to \varphi) \mid (\forall X \, \varphi) \mid (\exists X \, \varphi)
$$

A formula is either:

- a predicate applied to terms,
- an equality between terms,
- or a compound formula built from other formulas using logical connectives and quantifiers.

## Semantics of First Order Logic

In propositional logic, the structures are simply an assignments of propositional symbols over truth values.
The structures of first-order logic is much more complicated:

- A non empty set that represent the universe of discourse upon which the variables $X$ ranges.
- An interpretation of the predicate symbols $P^i$ as relations over the universe.
- An interpretation of the function symbols $F^i$ as functions over the universe.
- An interpretation of the constant symbols $C$ as elements of the universe.
- An interpretation of the equality symbol $=$ as the identity relation over the universe.

Given a structure and an initial assignment of the variables $X$ to elements of the universe, we can evaluate the truth value of firt-order formula as follows:

- Constant symbols are evaluated to their interpretation in the structure.
- Function symbols are evaluated to their interpretation in the structure applied to the evaluation of their argument terms.
- Predicate symbols are evaluated to their interpretation in the structure applied to the evaluation of their argument terms.
- The equality symbol is evaluated to the identity relation applied to the evaluation of its argument terms.
- The logical connectives are evaluated using the same evaluation tables as in propositional logic.
- The quantifiers are evaluated by considering all possible assignments of the quantified variable to elements of the universe.

The satisfaction relation is then defined as follows:

$$
(M, e) \models \varphi := \llbracket \varphi \rrbracket_{M, e} = \mathrm{T}
$$

The following Haskell code recapitulates the syntax and semantics of first-order logic:

```haskell
type Binary = T | F deriving (Eq)

type PredicateSymbol = (String, Integer)
type FunctionSymbol = (String, Integer)
type ConstantSymbol = String
type Variable = String

data Term
  = Variable Variable
  | Constant ConstantSymbol
  | FunctionApplication FunctionSymbol [Term]

data Formula
  = PredicateApplication PredicateSymbol [Term]
  | Equality Term Term
  | Negation Formula
  | Conjunction Formula Formula
  | Disjunction Formula Formula
  | Implication Formula Formula
  | UniversalQuantification Variable Formula
  | ExistentialQuantification Variable Formula

type FunctionInterpretation D = FunctionSymbol -> [D] -> D
type ConstantInterpretation D = ConstantSymbol -> D
type EqualityInterpretation D = D -> D -> Binary
type PredicateInterpretation D = PredicateSymbol -> [D] -> Binary
type Environment D = Variable -> D
type Universe D = [D]
type Structure D =
  ( Universe D
  , PredicateInterpretation D
  , EqualityInterpretation D
  , FunctionInterpretation D
  , ConstantInterpretation D
  )

negate :: Binary -> Binary
negate T = F
negate F = T

conjoin :: Binary -> Binary -> Binary
conjoin T T = T
conjoin _ _ = F

disjoin :: Binary -> Binary -> Binary
disjoin F F = F
disjoin _ _ = T

imply :: Binary -> Binary -> Binary
imply T F = F
imply _ _ = T

eval_term :: (FunctionInterpretation D, ConstantInterpretation D) -> Environment D -> Term -> D
eval_term _ e (Variable x) = e x
eval_term (_, ci) e (Constant c) = ci c
eval_term i@(fi, _) e (FunctionApplication f ts)
  | length ts == snd f = fi f (map (eval_term i e) ts)
  | otherwise = error "function arity mismatch"

extend :: Environment D -> Variable -> D -> Environment D
extend e v d = \v' -> if v == v' then d else e v

any :: [Binary] -> Binary
any = foldr disjoin F

all :: [Binary] -> Binary
all = foldr conjoin T

eval_form :: Structure D -> Environment D -> Formula -> Binary
eval_form (_, pi, _, fi, ci) e (PredicateApplication p ts)
  | length ts /= snd p = error "predicate arity mismatch"
  | otherwise = pi p (map (eval_term (fi, ci) e) ts)
eval_form (_, _, ei, fi, ci) e (Equality t1 t2) = ei (eval_term (fi, ci) e t1) (eval_term (fi, ci) e t2)
eval_form s e (Negation f) = negate (eval_form s e f)
eval_form s e (Conjunction f1 f2) = conjoin (eval_form s e f1) (eval_form s e f2)
eval_form s e (Disjunction f1 f2) = disjoin (eval_form s e f1) (eval_form s e f2)
eval_form s e (Implication f1 f2) = imply (eval_form s e f1) (eval_form s e f2)
eval_form s@(xs, pi, ei, fi, ci) e (UniversalQuantification v f) =
  all $ map (\x -> eval_form s (extend e v x) f) xs
eval_form s@(xs, pi, ei, fi, ci) e (ExistentialQuantification v f) =
  any $ map (\x -> eval_form s (extend e v x) f) xs

satisfies :: Structure D -> Environment D -> Formula -> Bool
satisfies s e f = eval_form s e f == T
```

There are several divergances between this naive evaluator and actual first-order logic.
First it cannot even express structures with an uncountable universe.
Haskell's laziness allows us to enumerate the elements of infinite sets, but it cannot enumerate the elements of uncountable sets.
But maybe more crucially, the evaluation will loop forever when the universe is infinite and the formula contains a quantifier.
This makes the evaluator into a partial function whereas the satisfaction relation is a total function.

The other (less interesting) case where the evaluator exhibit partiality is when the formula contains arity mismatches.
In our formalization, these mismatches would be impossible because the arity of predicate/function symbols is part of their definition.
But the Haskell type system is not capable of enforcing this property in a simple manner.

The evaluator also makes it clear that our first-order logic language is by no means minimalist:

- All logical connectives/constants can be defined in terms of either the Sheffer stroke (NAND) or the Peirce arrow (NOR).
- Constants are directly equivalent to nullary functions.
- Provided that the universe is inhabited only one quantifier is necessary because:

  $$
  \forall x, \varphi ~~\Leftrightarrow~~ \neg \exists x, \neg \varphi
  $$

- Functions can even be defined in terms of predicates, but it requires introducing temporary variables:

  $$
  f(a) = b ~~\Leftrightarrow~~ p(a,b) \to \forall x ~ q(f(x)) ~~\Leftrightarrow~~ \forall x \, \forall y \, p(x,y) \to q(y)
  $$

Next, we use the evaluator to exemplify the satisfaction relation on finite structures representing a directed graph:

```
N2 ---------+
^           |
|           v
N1 <------- N3
|           ^
|           |
+-----------+
```

```haskell
data Node = N1 | N2 | N3 deriving (Eq)

edges :: [(Node, Node)]
edges = [(N1,N2),(N2,N3),(N3,N1),(N1,N3)]

structure = Structure Node
structure = (u, pi, ei, fi, ci)
  where
    -- universe
    u = [N1,N2,N3]
    -- predicate interpretation
    pi (("is_edge", 2)) [a,b] = if (a,b) `elem` edges then T else F
    pi _ _ = error "not implemented"
    -- equality interpretation
    ei a b = if a == b then T else F
    -- function interpretation
    f1 ("next", 1) [N1] = N2
    f1 ("next", 1) [N2] = N3
    f1 ("next", 1) [N3] = N1
    f1 _ _ = error "not implemented"
    -- constant interpretation
    ci "n1" = N1
    ci "n2" = N2
    ci "n3" = N3
    ci _ = error "not implemented"

-- M, { ... } |= ¬(n1 = n2)
sat1 = (satisfies structure environment formula) where
  environment _ = error "should never happen (no free variables)"
  formula = Negation (Equality (Constant "n1") (Constant "n2"))

-- M, { x -> N1, ... } |= x = n1
sat2 = (satisfies structure environment formula) where
  environment "x" = N1
  environment _ = error "should never happen"
  formula = Equality (Variable "x") (Constant "n1")

-- M, { ... } |= ∀ x, ∃ y, is_edge(x,y)
sat3 = (satisfies structure environment formula) where
  environment _ = error "should never happen (no free variables)"
  formula = Universal "x" (Existential "y" (Predicate ("is_edge", 2) [Variable "x", Variable "y"]))

-- M, { ... } |= ∀ x, is_edge(x, next(x))
sat4 = (satisfies structure environment formula) where
  environment _ = error "should never happen (no free variables)"
  formula = Universal "x" (Predicate ("is_edge", 2) [Variable "x", FunctionApplication ("next", 1) [Variable "x"]])
```

## Hilbert-Style Deduction System

> **Propositional Logic**
>
> $$
> \dfrac{}{\vdash \varphi \to (\psi \to \varphi)}~(K)
> $$
>
> $$
> \dfrac{}{\vdash (\varphi\to(\psi\to\chi))\to((\varphi\to\psi)\to(\varphi\to\chi))}~(S)
> $$
>
> $$
> \dfrac{}{\vdash (\neg\varphi\to\neg\psi)\to(\psi\to\varphi)}~(C)
> $$
>
> $$
> \dfrac{\vdash \varphi\to\psi \qquad \vdash \varphi}{\vdash \psi}~(\mathrm{MP})
> $$
>
> **Universal Instantiation**
>
> $$
> \dfrac{}{\vdash (\forall X \, \varphi) \to \varphi[T/X]}~(\forall E)
> $$
>
> provided $$T$$ is free for $$X$$ in $$\varphi$$.
>
> **Quantifier Distribution**
>
> $$
> \dfrac{}{\vdash
> (\forall X \, (\varphi\to\psi))
> \to
> (\varphi\to(\forall X \, \psi))}
> ~(\forall D)
> $$
>
> provided that $$X$$ is not a free variable in $$\varphi$$.
>
> **Generalization**
>
> $$
> \dfrac{\vdash \varphi}{\vdash (\forall X \, \varphi)}~(\mathrm{G})
> $$
