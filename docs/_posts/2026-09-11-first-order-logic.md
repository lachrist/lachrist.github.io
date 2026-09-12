---
layout: post
title: "Refresher: First Order Logic"
---

The following is a brief refresher on first-order logic.
It builds upon my previous post on [propositional-logic](/blog/2026/09/10/proposition/).
Assuming good understanding of propositional logic, it should be understandable to anyone with basic mathematical training.
However, the more advanced observations assume some background in complexity theory.
Similar to propositional logic, the greatest source of confusion is mixing the base language of first-order logic with the meta language in which we discuss it.

Propositional logic is about reasoning about facts of a structure without knowing anything about the structure.
This is very much a sequential approach: first evaluate facts, then reason about their logical connections.
In contrast, first-order logic allows for a formula to request evaluating facts during its own evaluation.
The price to pay is a more complex interface between structures and first-order logic.

## Syntax of First Order Logic

It is common to define the syntax of first-order logic relative to a _signature_ $\Sigma$.
A signature defines the symbols that can be used to build terms and formulas.
It contains multiple (possibly infinitely many) sets of symbols:

| Name                     | Meta Variable         |
| ------------------------ | --------------------- |
| Constant                 | $$C$$, $$D$$, ...     |
| Function of arity $$0$$  | $$F^0$$, $$G^0$$, ... |
| Function of arity $$1$$  | $$F^1$$, $$G^1$$, ... |
| $$\ldots$$               | $$\ldots$$            |
| Function of arity $$i$$  | $$F^i$$, $$G^i$$, ... |
| Predicate of arity $$0$$ | $$P^0$$, $$Q^0$$, ... |
| Predicate of arity $$1$$ | $$P^1$$, $$Q^1$$, ... |
| $$\ldots$$               | $$\ldots$$            |
| Predicate of arity $$i$$ | $$P^i$$, $$Q^i$$, ... |

Classicaly, it is assumed that each set of symbols may be infinite but remains countable.
Considering uncountable set of symbols in the signature is possible but prevent Godel numbering and makes meta-reasoning more complicated.

Outside of the signature is an infinite supply of symbols for variables that will range over the universe of discourse:

$$
X ::= x_1 \mid x_2 \ldots y_1 \mid y_2 \ldots
$$

A term is either a variable, a constant, or a function applied to terms:

$$
T ::= X \mid C \mid F^0() \mid F^1(T) \mid F^2(T,T) \mid \ldots
$$

A formula is either a predicate applied to terms, an equality between terms, or a compound formula:

$$
\varphi ::= P^0() \mid P^1(T) \mid P^2(T,T) \mid \ldots \mid T = T \mid \neg \varphi \mid (\varphi \land \varphi) \mid (\varphi \lor \varphi) \mid (\varphi \to \varphi) \mid (\forall X \, \varphi) \mid (\exists X \, \varphi)
$$

It is important to understand that this syntax of first order logic is parametrized by a signature $$\Sigma$$.
As such, our presentation is defining a _family_ of first-order logics, one for each possible signature.
Maybe it would have cleaner to add a subscript $$\Sigma$$ to the terms and formulas to make this dependency explicit.
However, this quickly becomes cumbersome and is not common practice.

## Semantics of First Order Logic

Similar to propositional logic, the semantics of a first order logic is defined relative to a _structure_ $$M$$.
In propositional logic, the structures are simply an assignments of propositional symbols over truth values.
The structures of first-order logic is more complicated:

- A non empty set that represent the universe of discourse upon which the variables $$X$$ ranges.
- An interpretation of the predicate symbols $$P^i$$ as relations over the universe.
- An interpretation of the function symbols $$F^i$$ as functions over the universe.
- An interpretation of the constant symbols $$C$$ as elements of the universe.
- An interpretation of the equality symbol $$=$$ as the identity relation over the universe.

Similar to the syntax, the structure is also defined relative to a signature $$\Sigma$$.
As such, the signature $$\Sigma$$ can be seen a contract/interface that connects the syntax and semantics of first-order logic.

Given a structure and an assignment of the variables $$X$$ to elements of the universe, we can evaluate the truth value of firt-order formula as follows:

- Variables are evaluated to their assignment in the environment.
- Constant symbols are evaluated to their interpretation in the structure.
- Function applications are evaluated to their interpretation in the structure applied to the evaluation of their argument terms.
- Predicate applications are evaluated to their interpretation in the structure applied to the evaluation of their argument terms.
- Equality is evaluated to its interpretation in the structure applied to the evaluation of its argument terms.
- Logical connectives are evaluated using the same evaluation tables as in propositional logic.
- Quantifiers are evaluated by considering all possible assignments of the quantified variable to elements of the universe.

The satisfaction relation is then defined as follows:

$$
(M, e) \models \varphi := \llbracket \varphi \rrbracket_{(M, e)} = \mathrm{T}
$$

The main difference with propositional logic is the presence of a the initial assignment $$e$$ of the variables $$X$$ to elements of the universe.

The following Haskell code recapitulates the syntax and semantics of first-order logic:

```haskell
type Binary = T | F deriving (Eq)

type Variable = String

data Term F C
  = Variable Variable
  | Constant C
  | FunctionApplication F [Term F C]

data Formula P F C
  = PredicateApplication P [Term F C]
  | Equality (Term F C) (Term F C)
  | Negation (Formula P F C)
  | Conjunction (Formula P F C) (Formula P F C)
  | Disjunction (Formula P F C) (Formula P F C)
  | Implication (Formula P F C) (Formula P F C)
  | UniversalQuantification Variable (Formula P F C)
  | ExistentialQuantification Variable (Formula P F C)

type FunctionInterpretation F X = F -> [X] -> X
type ConstantInterpretation C X = C -> X
type EqualityInterpretation X = X -> X -> Binary
type PredicateInterpretation P X = P -> [X] -> Binary
type Environment X = Variable -> X
type Universe X = [X]
type Structure P F C X =
  ( Universe X
  , PredicateInterpretation P X
  , EqualityInterpretation X
  , FunctionInterpretation F X
  , ConstantInterpretation C X
  )

type TermInterpretation F C X = (FunctionInterpretation F X, ConstantInterpretation C X)

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

eval_term :: TermInterpretation F C X -> Environment X -> Term F C -> X
eval_term _ e (Variable v) = e v
eval_term (_, ci) e (Constant c) = ci c
eval_term i@(fi, _) e (FunctionApplication f ts) = fi f (map (eval_term i e) ts)

extend :: Environment X -> Variable -> X -> Environment X
extend e v d = \v' -> if v == v' then d else e v

any :: [Binary] -> Binary
any = foldr disjoin F

all :: [Binary] -> Binary
all = foldr conjoin T

eval_form :: Structure P F C X -> Environment X -> Formula P F C -> Binary
eval_form (_, pi, _, fi, ci) e (PredicateApplication p ts) =
  pi p (map (eval_term (fi, ci) e) ts)
eval_form (_, _, ei, fi, ci) e (Equality t1 t2) =
  ei (eval_term (fi, ci) e t1) (eval_term (fi, ci) e t2)
eval_form s e (Negation f) =
  negate (eval_form s e f)
eval_form s e (Conjunction f1 f2) =
  conjoin (eval_form s e f1) (eval_form s e f2)
eval_form s e (Disjunction f1 f2) =
  disjoin (eval_form s e f1) (eval_form s e f2)
eval_form s e (Implication f1 f2) =
  imply (eval_form s e f1) (eval_form s e f2)
eval_form s@(xs, pi, ei, fi, ci) e (UniversalQuantification v f) =
  all (map (\x -> eval_form s (extend e v x) f) xs)
eval_form s@(xs, pi, ei, fi, ci) e (ExistentialQuantification v f) =
  any (map (\x -> eval_form s (extend e v x) f) xs)

satisfies :: Structure P F C X -> Environment X -> Formula P F C -> Bool
satisfies s e f = eval_form s e f == T
```

The type variables $$P$$, $$F$$, and $$C$$ makes the signature contract between first-order formula and structures explicit.
It is however incomplete is it does not contains information about arity.
Normally, arity mismatch should entail that the formula is not well-formed.
But this is hard to encode in Haskell's type system.
As a result, in our naive evaluator, the structure is responsible to detect at runtime arity mismatch by throwing an error.
This behavior turns the satisfaction functions into a partial function whereas it was supposed to be total.

Another more fundamental way in which the satisifaction functions of our naive interpreter exhibit partial behavior is that it will never return when the universe is infinite.
While Haskell's laziness allows to enumerate the elements of infinite sets, the call to `foldr` will never return as it is eager.

Another important limitation is that programs cannot (completely) encode the elements of uncountable sets.
As a result it is impossible to accurately represent a structure withg an uncountable univsere.

The evaluator also makes it clear that our first-order logic language is by no means minimalist:

- All logical connectives/constants can be defined in terms of either the Sheffer stroke (NAND) or the Peirce arrow (NOR).
- Constants are directly equivalent to nullary functions.
- Provided that the universe is inhabited only one quantifier is necessary because:

  $$
  \forall x \, \varphi ~~\Leftrightarrow~~ \neg \exists x \, \neg \varphi
  $$

- Functions can be defined in terms of predicates, but it requires introducing temporary variables:

  $$
  F(A) = B ~~\Leftrightarrow~~ P(A,B) \Rightarrow \forall x ~ Q(P(x)) ~~\Leftrightarrow~~ \forall x \, \forall y \, p(x,y) \to q(y)
  $$

- Equality is

Next, we use the evaluator to exemplify the satisfaction relation on a finite structure representing a directed graph:

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

data PredicateSymbol = IsEdge
data FunctionSymbol = Next
data ConstantSymbol = N1C | N2C | N3C

nodes :: [Node]
nodes = [N1,N2,N3]

edges :: [(Node, Node)]
edges = [(N1,N2),(N2,N3),(N3,N1),(N1,N3)]

structure = Structure Node
structure = (u, pi, ei, fi, ci)
  where
    -- universe
    u = nodes
    -- predicate interpretation
    pi IsEdge [a,b] = if (a,b) `elem` edges then T else F
    pi IsEdge _ = error "IsEdge >> arity mismatch"
    -- equality interpretation
    ei a b = if a == b then T else F
    -- function interpretation
    f1 Next [N1] = N2
    f1 Next [N2] = N3
    f1 Next [N3] = N1
    f1 Next _ = error "Next >> arity mismatch"
    -- constant interpretation
    ci N1C = N1
    ci N2C = N2
    ci N3C = N3

default_environment :: Environment Node
default_environment _ = error "unbound variable"

-- M, { ... } |= ¬(n1 = n2)
sat1 = (satisfies structure default_environment formula) where
  formula = Negation (Equality (Constant N1C) (Constant N2C))

-- M, { x -> N1, ... } |= x = n1
sat2 = (satisfies structure environment formula) where
  environment = extend default_environment "x" N1
  formula = Equality (Variable "x") (Constant N1C)

-- M, { ... } |= ∀ x, ∃ y, is_edge(x,y)
sat3 = (satisfies structure default_environment formula) where
  formula = Universal "x" (Existential "y" (Predicate IsEdge [Variable "x", Variable "y"]))

-- M, { ... } |= ∀ x, is_edge(x, next(x))
sat4 = (satisfies structure default_environment formula) where
  formula = Universal "x" (Predicate IsEdge [Variable "x", FunctionApplication Next [Variable "x"]])
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
> \dfrac{\vdash \varphi\to\psi \qquad \vdash \varphi}
> {\vdash \psi}~(\mathrm{MP})
> $$
>
> **Universal Instantiation**
>
> $$
> \dfrac{}
> {\vdash (\forall X\,\varphi) \to \varphi[T/X]}~(\forall E)
> $$
>
> provided $T$ is free for $X$ in $\varphi$.
>
> **Quantifier Distribution**
>
> $$
> \dfrac{}
> {\vdash
> (\forall X\,(\varphi\to\psi))
> \to
> (\varphi\to(\forall X\,\psi))}
> ~(\forall D)
> $$
>
> provided that $X$ is not a free variable in $\varphi$.
>
> **Generalization**
>
> $$
> \dfrac{\vdash \varphi}
> {\vdash (\forall X\,\varphi)}~(\mathrm{G})
> $$
>
> **Equality**
>
> $$
> \dfrac{}{\vdash T=T}~(=R)
> $$
>
> $$
> \dfrac{\vdash T=U \qquad \vdash \varphi[T/X]}
> {\vdash \varphi[U/X]}~(=E)
> $$
>
> provided the substitutions are capture-avoiding.

## Natural Deduction

> **Identity**
>
> $$
> \dfrac{}{\Gamma,\varphi \vdash \varphi}~(\mathrm{Ax})
> $$
>
> **Conjunction**
>
> $$
> \dfrac{\Gamma \vdash \varphi \qquad \Gamma \vdash \psi}
> {\Gamma \vdash \varphi \land \psi}~(\land I)
> \qquad
> \dfrac{\Gamma \vdash \varphi \land \psi}
> {\Gamma \vdash \varphi}~(\land E_1)
> \qquad
> \dfrac{\Gamma \vdash \varphi \land \psi}
> {\Gamma \vdash \psi}~(\land E_2)
> $$
>
> **Disjunction**
>
> $$
> \dfrac{\Gamma \vdash \varphi}
> {\Gamma \vdash \varphi \lor \psi}~(\lor I_1)
> \qquad
> \dfrac{\Gamma \vdash \psi}
> {\Gamma \vdash \varphi \lor \psi}~(\lor I_2)
> $$
>
> $$
> \dfrac{
> \Gamma \vdash \varphi \lor \psi
> \qquad
> \Gamma,\varphi \vdash \chi
> \qquad
> \Gamma,\psi \vdash \chi
> }
> {\Gamma \vdash \chi}~(\lor E)
> $$
>
> **Implication**
>
> $$
> \dfrac{\Gamma,\varphi \vdash \psi}
> {\Gamma \vdash \varphi \to \psi}~(\to I)
> \qquad
> \dfrac{
> \Gamma \vdash \varphi \to \psi
> \qquad
> \Gamma \vdash \varphi
> }
> {\Gamma \vdash \psi}~(\to E)
> $$
>
> **Negation**
>
> $$
> \dfrac{
> \Gamma,\varphi \vdash \psi
> \qquad
> \Gamma,\varphi \vdash \neg\psi
> }
> {\Gamma \vdash \neg\varphi}~(\neg I)
> $$
>
> $$
> \dfrac{
> \Gamma \vdash \varphi
> \qquad
> \Gamma \vdash \neg\varphi
> }
> {\Gamma \vdash \psi}~(\neg E)
> $$
>
> **Classical**
>
> $$
> \dfrac{\Gamma \vdash \neg\neg\varphi}
> {\Gamma \vdash \varphi}~(\neg\neg E)
> $$
>
> **Universal Quantification**
>
> $$
> \dfrac{\Gamma \vdash \varphi}
> {\Gamma \vdash \forall X\,\varphi}~(\forall I)
> $$
>
> provided $$X \notin FV(\Gamma)$$.
>
> $$
> \dfrac{\Gamma \vdash \forall X\,\varphi}
> {\Gamma \vdash \varphi[T/X]}~(\forall E)
> $$
>
> provided $$T$$ is free for $$X$$ in $$\varphi$$.
>
> **Existential Quantification**
>
> $$
> \dfrac{\Gamma \vdash \varphi[T/X]}
> {\Gamma \vdash \exists X\,\varphi}~(\exists I)
> $$
>
> provided $$T$$ is free for $$X$$ in $$\varphi$$.
>
> $$
> \dfrac{
> \Gamma \vdash \exists X\,\varphi
> \qquad
> \Gamma,\varphi[Y/X] \vdash \psi
> }
> {\Gamma \vdash \psi}~(\exists E)
> $$
>
> provided $$Y \notin FV(\Gamma) \cup FV(\psi)$$ and $$Y$$ is fresh.

## Sequent Calculus

> **Identity**
>
> $$
> \dfrac{}{\Gamma,\varphi \vdash \varphi,\Delta}~(\mathrm{Ax})
> $$
>
> **Conjunction**
>
> $$
> \dfrac{\Gamma,\varphi,\psi \vdash \Delta}
> {\Gamma,\varphi \land \psi \vdash \Delta}~(\land L)
> \qquad
> \dfrac{\Gamma \vdash \varphi,\Delta \qquad \Gamma \vdash \psi,\Delta}
> {\Gamma \vdash \varphi \land \psi,\Delta}~(\land R)
> $$
>
> **Disjunction**
>
> $$
> \dfrac{\Gamma,\varphi \vdash \Delta \qquad \Gamma,\psi \vdash \Delta}
> {\Gamma,\varphi \lor \psi \vdash \Delta}~(\lor L)
> \qquad
> \dfrac{\Gamma \vdash \varphi,\psi,\Delta}
> {\Gamma \vdash \varphi \lor \psi,\Delta}~(\lor R)
> $$
>
> **Implication**
>
> $$
> \dfrac{\Gamma \vdash \varphi,\Delta \qquad \Gamma,\psi \vdash \Delta}
> {\Gamma,\varphi \to \psi \vdash \Delta}~(\to L)
> \qquad
> \dfrac{\Gamma,\varphi \vdash \psi,\Delta}
> {\Gamma \vdash \varphi \to \psi,\Delta}~(\to R)
> $$
>
> **Negation**
>
> $$
> \dfrac{\Gamma \vdash \varphi,\Delta}
> {\Gamma,\neg\varphi \vdash \Delta}~(\neg L)
> \qquad
> \dfrac{\Gamma,\varphi \vdash \Delta}
> {\Gamma \vdash \neg\varphi,\Delta}~(\neg R)
> $$
>
> **Universal Quantification**
>
> $$
> \dfrac{\Gamma,\varphi[T/X] \vdash \Delta}
> {\Gamma,\forall X\,\varphi \vdash \Delta}~(\forall L)
> $$
>
> provided $$T$$ is free for $$X$$ in $$\varphi$$.
>
> $$
> \dfrac{\Gamma \vdash \varphi[Y/X],\Delta}
> {\Gamma \vdash \forall X\,\varphi,\Delta}~(\forall R)
> $$
>
> provided $$Y$$ is fresh, i.e. $$Y \notin FV(\Gamma,\Delta,\varphi)$$.
>
> **Existential Quantification**
>
> $$
> \dfrac{\Gamma,\varphi[Y/X] \vdash \Delta}
> {\Gamma,\exists X\,\varphi \vdash \Delta}~(\exists L)
> $$
>
> provided $$Y$$ is fresh, i.e. $$Y \notin FV(\Gamma,\Delta,\varphi)$$.
>
> $$
> \dfrac{\Gamma \vdash \varphi[T/X],\Delta}
> {\Gamma \vdash \exists X\,\varphi,\Delta}~(\exists R)
> $$
>
> provided $$T$$ is free for $$X$$ in $$\varphi$$.
>
> **Weakening**
>
> $$
> \dfrac{\Gamma \vdash \Delta}
> {\Gamma,\varphi \vdash \Delta}~(W_L)
> \qquad
> \dfrac{\Gamma \vdash \Delta}
> {\Gamma \vdash \varphi,\Delta}~(W_R)
> $$
>
> **Contraction**
>
> $$
> \dfrac{\Gamma,\varphi,\varphi \vdash \Delta}
> {\Gamma,\varphi \vdash \Delta}~(C_L)
> \qquad
> \dfrac{\Gamma \vdash \varphi,\varphi,\Delta}
> {\Gamma \vdash \varphi,\Delta}~(C_R)
> $$
>
> **Cut**
>
> $$
> \dfrac{
> \Gamma_1 \vdash \varphi,\Delta_1
> \qquad
> \Gamma_2,\varphi \vdash \Delta_2
> }
> {\Gamma_1,\Gamma_2 \vdash \Delta_1,\Delta_2}
> ~(\mathrm{Cut})
> $$
