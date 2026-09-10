---
layout: post
title: "Refresher: First Order Logic"
---

The following is a brief refresher on first-order logic.
It iterate on my previous post on [propositional-logic](/blog/2026/09/10/proposition/).
Assuming good understanding of propositional logic, it should be understandable to anyone with basic mathematical training.
However, the more advanced observations assume some background in complexity theory.
Similar to propositional logic, the greatest source of confusion is mixing the base language of first-order logic with the meta language in which we discuss it.

## Syntax of First Order Logic

$$
X ::= x_1 \mid x_2 \ldots y_1 \mid y_2 \ldots
$$

$$
C ::= c_1 \mid c_2 \mid \ldots d_1 \mid d_2 \ldots
$$

$$
F^0 ::= f^0_1 \mid f^0_2 \mid \ldots g^0_1 \mid g^0_2 \ldots
\\2[mm]
F^1 ::= f^1_1 \mid f^1_2 \mid \ldots g^1_1 \mid g^1_2 \ldots
\\2[mm]
F^i ::= f^i_1 \mid f^i_2 \mid \ldots g^i_1 \mid g^i_2 \ldots
$$

$$
T ::= X \mid C \mid F^0() \mid F^1(T) \mid F^2(T,T) \mid \ldots
$$

$$
P^0 ::= p^0_1 \mid p^0_2 \mid \ldots q^0_1 \mid q^0_2 \ldots
\\2[mm]
P^1 ::= p^1_1 \mid p^1_2 \mid \ldots q^1_1 \mid q^1_2 \ldots
\\2[mm]
P^i ::= p^i_1 \mid p^i_2 \mid \ldots q^i_1 \mid q^i_2 \ldots
$$

$$
\varphi ::= P^0() \mid P^1(T) \mid P^2(T,T) \mid \ldots \mid T = T \mid \neg \varphi \mid (\varphi \land \varphi) \mid (\varphi \lor \varphi) \mid (\varphi \to \varphi) \mid (\forall X, \varphi) \mid (\exists X, \varphi)
$$

## Semantics of Propositional Logic

```haskell
type Binary = T | F
type PredicateMetaVariable = (String, Integer)
type FunctionMetaVariable = (String, Integer)
type ConstantMetaVariable = String
type BaseVariable = String
data Term
  = Variable BaseVariable
  | Constant ConstantMetaVariable
  | FunctionApplication FunctionMetaVariable [Term]
data Formula
  = PredicateApplication PredicateMetaVariable [Term]
  | Equality Term Term
  | Negation Formula
  | Conjunction Formula Formula
  | Disjunction Formula Formula
  | Implication Formula Formula
  | UniversalQuantification BaseVariable Formula
  | ExistentialQuantification BaseVariable Formula
type FunctionInterpretation D = (FunctionMetaVariable -> ([D] -> D))
type ConstantInterpretation D = (ConstantMetaVariable -> D)
type EqualityInterpretation D = (D -> D -> Binary)
type PredicateInterpretation D = (PredicateMetaVariable -> ([D] -> Binary))
type Environment D = (BaseVariable -> D)
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
eval_term i@(fi, _) e (FunctionApplication f ts) = fi f (map (eval_term i e) ts)

extend :: Environment D -> BaseVariable -> D -> Environment D
extend e x d = \y -> if y == x then d else e y

eval_form :: Structure D -> Environment D -> Formula -> Binary
eval_form (u, pi, _, fi, ci) e (PredicateApplication p ts) = pi p (map (eval_term (fi, ci) e) ts)
eval_form (u, pi, ei, fi, ci) e (Equality t1 t2) = ei (eval_term (fi, ci) e t1) (eval_term (fi, ci) e t2)
eval_form m e (Negation f) = negate (eval_form m e f)
eval_form m e (Conjunction f1 f2) = conjoin (eval_form m e f1) (eval_form m e f2)
eval_form m e (Disjunction f1 f2) = disjoin (eval_form m e f1) (eval_form m e f2)
eval_form m e (Implication f1 f2) = imply (eval_form m e f1) (eval_form m e f2)
eval_form (u, pi, ei, fi, ci) e (UniversalQuantification x f) =
  if all (\d -> eval_form (u, pi, ei, fi, ci) (extend e x d) f == T) u then T else F
eval_form (u, pi, ei, fi, ci) e (ExistentialQuantification x f) =
  if any (\d -> eval_form (u, pi, ei, fi, ci) (extend e x d) f == T) u then T else F

satisfy ::
```

The semantics of a logical language is usually described as a relation between models and formulas.
We write $$M \models \varphi$$ to mean that the model $$M$$ satisfies the formula $$\varphi$$ (or, equivalently, that $$\varphi$$ holds in $$M$$).
Thus, the truth of a formula is expressed relative to a model, which reflects Tarski's conception of truth:

> "Snow is white" is true if and only if snow is white.

In propositional logic, the satisfaction relation can be defined by evaluating propositional formulas over a binary alphabet (often $$\mathrm{T}$$ and $$\mathrm{F}$$).
A model corresponds to an assignment of all the propositional variables to either symbol of this alphabet.
A formula is evaluated as follows:

- If present in the language, the constants $$\top$$ and $$\bot$$ are evaluated to $$\mathrm{T}$$ and $$\mathrm{F}$$, respectively.
- The value of a variable is directly given by the model.
- The value of a compound formula is defined using evaluation tables.

Given an evaluation function $$\llbracket\rrbracket$$, we then define the satisfaction relation as:

$$
M \models \varphi := \llbracket \varphi \rrbracket_M = \mathrm{T}
$$

Note that we should not confuse the truth value of a formula with the truth value of the satisfaction relation.
The former belongs to the base language, while the latter belongs to the meta language.
This distinction can perhaps be better observed in the following Haskell evaluator for propositional logic.

```haskell
type Variable = String -- Infinite, but recursively enumerable
data Formula
  = Atom Variable         -- p, q, ...
  | Neg Formula           -- ¬φ
  | And Formula Formula   -- (φ ∧ φ)
  | Or Formula Formula    -- (φ ∨ φ)
  | Imply Formula Formula -- (φ → φ)
data Value = T | F
type Model = Variable -> Value

-- Only linear complexity with the size of the formula
eval :: Model -> Formula -> Value
eval m (Atom v) = m v
eval m (Neg f) = case (eval m f) of
  T -> F
  F -> T
eval m (And f1 f2) = case (eval m f1, eval m f2) of
  (T, T) -> T
  (T, F) -> F
  (F, T) -> F
  (F, F) -> F
eval m (Or f1 f2) = case (eval m f1, eval m f2) of
  (T, T) -> T
  (T, F) -> T
  (F, T) -> T
  (F, F) -> F
eval m (Imply f1 f2) = case (eval m f1, eval m f2) of
  (T, T) -> T
  (T, F) -> F
  (F, T) -> T
  (F, F) -> T

satisfies :: Model -> Formula -> Bool
satisfies model formula = case eval model formula of
  T -> True
  F -> False
```

In our evaluator, Haskell is the meta language in which we define the base language of propositional logic.
The truth value of a propositional formula belongs to the custom `Value` data type,
while the truth value of the satisfaction relation belongs to the built-in `Bool` data type.

The table below illustrates the evaluation of several formulas under different models:

| $$\varphi$$                                          |    $$M(p)$$    |    $$M(q)$$    | $$\ldots$$ | $$\llbracket\varphi\rrbracket_M$$ |
| ---------------------------------------------------- | :------------: | :------------: | :--------: | :-------------------------------: |
| $$p$$                                                | $$\mathrm{T}$$ |   $$\ldots$$   | $$\ldots$$ |          $$\mathrm{T}$$           |
|                                                      | $$\mathrm{F}$$ |   $$\ldots$$   | $$\ldots$$ |          $$\mathrm{F}$$           |
| $$p \leftrightarrow q := (p \to q) \land (q \to p)$$ | $$\mathrm{T}$$ | $$\mathrm{T}$$ | $$\ldots$$ |          $$\mathrm{T}$$           |
|                                                      | $$\mathrm{F}$$ | $$\mathrm{T}$$ | $$\ldots$$ |          $$\mathrm{F}$$           |
|                                                      | $$\mathrm{T}$$ | $$\mathrm{F}$$ | $$\ldots$$ |          $$\mathrm{F}$$           |
|                                                      | $$\mathrm{F}$$ | $$\mathrm{F}$$ | $$\ldots$$ |          $$\mathrm{T}$$           |
| $$\top := p \lor \neg p$$                            | $$\mathrm{T}$$ |   $$\ldots$$   | $$\ldots$$ |          $$\mathrm{T}$$           |
|                                                      | $$\mathrm{F}$$ |   $$\ldots$$   | $$\ldots$$ |          $$\mathrm{T}$$           |
| $$\bot := p \land \neg p$$                           | $$\mathrm{T}$$ |   $$\ldots$$   | $$\ldots$$ |          $$\mathrm{F}$$           |
|                                                      | $$\mathrm{F}$$ |   $$\ldots$$   | $$\ldots$$ |          $$\mathrm{F}$$           |

Note that all models satisfy $$\top$$, while no model satisfies $$\bot$$.
We say that $$\top$$ is a tautology, while $$\bot$$ is a contradiction.

## Satisfiability and Validity

In general (not just in propositional logic), the satisfaction relation allows us to define two important concepts:

| Condition                         | Property              | Definition                                |
| --------------------------------- | --------------------- | ----------------------------------------- |
| $$\exists M,\ M \models \varphi$$ | **Satisfiable (SAT)** | At least one model satisfies $$\varphi$$. |
| $$\forall M,\ M \models \varphi$$ | **Valid (VAL)**       | All models satisfy $$\varphi$$.           |

Because the universe of models is inhabited, we only have these three categories of formulas to consider:

- VAL (therefore SAT): The formula holds for all models.
- SAT + !VAL: The formula holds for some models but not others.
- !SAT (therefore !VAL): The formula doesn't hold in any models.

Importantly, in propositional logic, negation is truth-complementing.
That is, we can move negation in either direction between the meta language and the base language:

$$M \not\models \varphi ~~\Leftrightarrow~~ M \models \neg\varphi$$

Therefore, we have:

$$\text{VAL}(\varphi) ~~\Leftrightarrow~~ !\text{SAT}(\neg\varphi)$$

$$\text{SAT}(\varphi) ~~\Leftrightarrow~~ !\text{VAL}(\neg\varphi)$$

This enables us to reduce the decision problems SAT and !VAL to one another, and VAL and !SAT to one another.

Note that not every logic has truth-complementing negation
(e.g., [intuitionistic logic](https://en.wikipedia.org/wiki/intuitionistic_logic)).

We now explore how to effectively decide propositional SAT/VAL.
Naively, we can simply evaluate the formula under every conceivable model.
The technical difficulty is that there are infinitely many models because the set of propositional variables is infinite.
However, a given formula $$\varphi$$ depends only on the finitely many variables that actually occur in it.
Two models that agree on those variables necessarily give $$\varphi$$ the same truth value.
Thus, if $$\varphi$$ contains $$n$$ distinct variables, there are "only" $$2^n$$ relevant classes of models to consider.
A naive SAT/VAL algorithm enumerates one representative assignment from each of these classes and evaluates $$\varphi$$ under it.

This algorithm for deciding propositional SAT/VAL performs poorly, as its worst-case running time grows exponentially with the formula length.
Sophisticated techniques can improve practical performance, but even the best algorithms to date still have exponential worst-case running times
(e.g., [CDCL](https://en.wikipedia.org/wiki/Conflict-driven_clause_learning)).

## SAT/!VAL Certification

Given the difficulty of deciding whether a formula is SAT/VAL, it is useful to ask:
"How can we easily convince someone that a formula is SAT, VAL, !SAT, or !VAL?"

The easier cases are SAT and !VAL.
For SAT, it suffices to provide an example model that satisfies the formula.
Dually, for !VAL, it suffices to provide a counterexample model that does not satisfy the formula.

For instance, $$\varphi := (p \lor q) \to p$$ is both SAT and !VAL:

| Model          | $$p$$          | $$q$$          | $$\varphi$$    | Demonstrates |
| -------------- | -------------- | -------------- | -------------- | ------------ |
| Example        | $$\mathrm{T}$$ | $$\mathrm{F}$$ | $$\mathrm{T}$$ | SAT          |
| Counterexample | $$\mathrm{F}$$ | $$\mathrm{T}$$ | $$\mathrm{F}$$ | !VAL         |

An important class of problems in complexity theory is _NP_.
By definition, _NP_ consists of decision problems for which we can always produce polynomial-size certificates.
These certificates must allow a "yes" answer to be verified in polynomial time relative to the input size.

The certificate for SAT/!VAL corresponds to an assignment to the variables that appear in the formula.
Verification consists of evaluating the formula under this assignment, which takes time linear in the formula length.
Therefore, SAT/!VAL is in NP.

More surprisingly, every problem in NP can be reduced to SAT in polynomial time
(cf. the [Cook-Levin theorem](https://en.wikipedia.org/wiki/Cook%E2%80%93Levin_theorem)).
Such problems are called _NP-complete_, and they represent the "hardest" problems in NP.
It is widely believed, but not proven, that there is no polynomial-time algorithm for NP-complete problems.

## VAL/!SAT Certification

We saw that SAT/!VAL certificates are about proving the presence of certain models (this only requires exhibiting one).
In contrast, VAL/!SAT certificates are about proving the absence of certain models, which is less obvious.
This is precisely the goal of deduction systems.
A deduction system generally recursively defines what a derivation is and which formula it certifies as VAL/!SAT.
The admissible leaves of a derivation are defined by axiom rules.
The admissible branches of a derivation are defined by inference rules.

Given a deduction system, when there exists a derivation for $$\varphi$$, we write $$\vdash \varphi$$.
We define two important concepts related to validity:

| Property               | Condition                                | Meaning                          |
| ---------------------- | ---------------------------------------- | -------------------------------- |
| **(VAL) Soundness**    | $$\vdash \varphi ~\to~ \models \varphi$$ | Every provable formula is valid. |
| **(VAL) Completeness** | $$\models \varphi ~\to~ \vdash \varphi$$ | Every valid formula is provable. |

If negation is not truth-complementing, we must also define these concepts separately for unsatisfiability:

| Property                | Condition                                                       | Meaning                                     |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| **(!SAT) Soundness**    | $$\vdash_{\mathrm{!SAT}} \varphi ~\to~ \mathrm{!SAT}(\varphi)$$ | Every refutable formula is unsatisfiable.   |
| **(!SAT) Completeness** | $$\mathrm{!SAT}(\varphi) ~\to~ \vdash_{\mathrm{!SAT}} \varphi$$ | Every unsatisfiable formula can be refuted. |

In standard propositional proof systems, proofs can be validated in polynomial time relative to their size.
The hard part is finding proofs whose size isn't exponential in the size of the formula.
For classical propositional logic, we do not know whether there is a proof system with polynomial-time verification in which every valid formula has a proof of polynomial size.
Therefore, we do not know whether propositional VAL/!SAT is in NP.

An important property of VAL/!SAT formulas in classical propositional logic is that they are closed under uniform substitution.
That is, a VAL/!SAT formula remains VAL/!SAT after consistently replacing its propositional variables with arbitrary formulas.
The replacement formula may even contain propositional variables that appear elsewhere in the formula.
For instance:

| Original                            | $$p := q$$                          | $$p := p \lor q$$                                     |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| $$p \to p$$<br>VAL (+SAT)           | $$q \to q$$<br>VAL (+SAT)           | $$(p \lor q) \to (p \lor q)$$<br>VAL (+SAT)           |
| $$p \land \neg p$$<br>!SAT (+!VAL)  | $$q \land \neg q$$<br>!SAT (+!VAL)  | $$(p \lor q) \land \neg(p \lor q)$$<br>!SAT (+!VAL)   |
| $$(p \land q) \to p$$<br>VAL (+SAT) | $$(q \land q) \to q$$<br>VAL (+SAT) | $$((p \lor q) \land q) \to (p \lor q)$$<br>VAL (+SAT) |

This enables rules to apply to an infinite range of concrete cases through the use of meta variables.
More concretely, rules feature formula _schemas_ rather than actual propositional formulas.
For instance, the formula schema $$\varphi \to \varphi$$ stands for $$p \to p$$, $$(p \land q) \to (p \land q)$$, etc.
We can even allow meta-variables to remain in derivations, turning the derivations themselves into schemas.

In contrast, SAT/!VAL formulas are _not_ closed under substitution.
This explains why SAT/!VAL certificates based on assignments must apply to actual propositional formulas rather than schemas.
For instance:

| Original                          | $$p := q$$                         |
| --------------------------------- | ---------------------------------- |
| $$p \lor \neg q$$<br>SAT + !VAL   | $$q \lor \neg q$$<br>VAL (+SAT)    |
| $$p \land \neg q$$<br> SAT + !VAL | $$q \land \neg q$$<br>!SAT (+!VAL) |

The reason why VAL/!SAT is preserved under substitution while SAT/!VAL isn't is that the former makes a universal claim, while the latter makes an existential claim.
If the replacement formula contains variables that already appear elsewhere in the formula, we may reduce the effective universe of models.
This may affect the existential claim, but never the universal claim.

## Hilbert-Style Deduction

In Hilbert-style deduction systems, the judgments in a derivation tree are simply formulas.
These systems typically feature multiple axiom rules but few inference rules.
For propositional logic, a classic Hilbert system is KSC with modus ponens (MP):

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

It can be shown that KSC+MP is sound and complete for propositional logic:

$$
\vdash_{KSC+\mathrm{MP}} \varphi ~\to~ \models \varphi
$$

For instance, the identity tautology $$p\to p$$ can be proved with KS+MP as follows:

$$
\scriptsize
\dfrac{
  \dfrac{
    \dfrac{}{
      \vdash p \to ((p\to p)\to p)
    }~(K)
    \qquad
    \dfrac{}{
      \vdash(p\to((p\to p)\to p))\to((p\to(p\to p))\to(p\to p))
    }~(S)
  }{
    \vdash(p\to(p\to p))\to(p\to p)
  }~(\mathrm{MP})
  \qquad
  \dfrac{}{
    \vdash p\to(p\to p)
  }~(K)
}{
  \vdash p\to p
}~(\mathrm{MP})
$$

Note that the proof does not use the C axiom.
This proof is called constructive: it uses only principles accepted in intuitionistic logic.
Classical proofs may additionally use the C axiom, which allows a formula to be established from its double negation.

## Natural Deduction

Hilbert-style systems provide a small and elegant foundation for formal propositional deduction.
However, their proofs can quickly become difficult to read and unintuitive, even for simple tautologies.
Readability can often be improved by shaping formulas as:

$$
\left(\bigwedge_{\gamma \in \Gamma} \gamma\right) \to \varphi
$$

However, manipulating schemas of this form is awkward in Hilbert-style systems, which often aim for minimalism.
To address this issue, natural deduction systems shift this structure from the base language to the meta language.
In natural deduction, proof trees manipulate judgments of the form:

$$
\Gamma \vdash \varphi
$$

This syntactic structure is called a _sequent_.
The elements of $$\Gamma$$ are called the antecedents (or assumptions) and $$\varphi$$ is called the succedent (or the conclusion).
The judgments of Hilbert-style systems can be viewed as a special case of sequents with empty antecedents.

Natural deduction has only one axiom rule and provides inference rules for introducing and eliminating each logical connective:

> **Identity**
>
> $$
> \dfrac{}{\Gamma,\varphi \vdash \varphi}~(\mathrm{Ax})
> $$
>
> **Conjunction**
>
> $$
> \dfrac{\Gamma \vdash \varphi \qquad \Gamma \vdash \psi}{\Gamma \vdash \varphi \land \psi}(\land I)
> \qquad
> \dfrac{\Gamma \vdash \varphi \land \psi}{\Gamma \vdash \varphi}(\land E_1)
> \qquad
> \dfrac{\Gamma \vdash \varphi \land \psi}{\Gamma \vdash \psi}~(\land E_2)
> $$
>
> **Disjunction**
>
> $$
> \dfrac{\Gamma \vdash \varphi}{\Gamma \vdash \varphi \lor \psi}(\lor I_1)
> \qquad
> \dfrac{\Gamma \vdash \psi}{\Gamma \vdash \varphi \lor \psi}(\lor I_2)
> \qquad
> \dfrac{\Gamma \vdash \varphi \lor \psi \qquad \Gamma,\varphi \vdash \chi \qquad \Gamma,\psi \vdash \chi}{\Gamma \vdash \chi}~(\lor E)
> $$
>
> **Implication**
>
> $$
> \dfrac{\Gamma,\varphi \vdash \psi}{\Gamma \vdash \varphi \to \psi}(\to I)
> \qquad
> \dfrac{\Gamma \vdash \varphi \to \psi \qquad \Gamma \vdash \varphi}{\Gamma \vdash \psi}(\to E)
> $$
>
> **Negation**
>
> $$
> \dfrac{\Gamma,\varphi \vdash \psi \qquad \Gamma,\varphi \vdash \neg\psi}{\Gamma \vdash \neg\varphi}(\neg I)
> \qquad
> \dfrac{\Gamma \vdash \varphi \qquad \Gamma \vdash \neg\varphi}{\Gamma \vdash \psi}(\neg E)
> $$
>
> **Classical**
>
> $$
> \dfrac{\Gamma \vdash \neg\neg\varphi}{\Gamma \vdash \varphi}~(\neg\neg E)
> $$

Like KSC+MP, natural deduction is sound and complete for propositional logic:

$$
\vdash_{ND} \varphi ~~\Leftrightarrow~~ \vdash_{KSC+MP} \varphi ~~\Leftrightarrow~~ \models \varphi
$$

This result can be generalized to sequents with assumptions:

$$
\Gamma \vdash_{ND} \varphi ~~\Leftrightarrow~~ \models \left(\bigwedge_{\gamma \in \Gamma} \gamma\right) \to \varphi
$$

For instance, Clavius's law $$\vdash (\neg \alpha \to \alpha) \to \alpha$$ can be proved as follows:

$$
\scriptsize
\dfrac{
  \dfrac{
    \dfrac{
      \dfrac{
        \dfrac{}{\neg \alpha , (\neg \alpha \to \alpha) \vdash \neg \alpha}
        (\mathrm{Ax})
        \qquad
        \dfrac{}{\neg \alpha , (\neg \alpha \to \alpha) \vdash \neg \alpha \to \alpha}
        (\mathrm{Ax})
      }{
        \neg \alpha , (\neg \alpha \to \alpha) \vdash \alpha
      }(\to E)
      \qquad
      \dfrac{}{\neg \alpha , (\neg \alpha \to \alpha) \vdash \neg \alpha}
      (\mathrm{Ax})
    }{
      (\neg \alpha \to \alpha) \vdash \neg\neg \alpha
    }\mathrlap{(\neg I)}
  }{
    (\neg \alpha \to \alpha) \vdash \alpha
  }\mathrlap{(\neg\neg E)}
}{
  \vdash (\neg \alpha \to \alpha) \to \alpha
}\mathrlap{~(\to I)}
$$

The use of the $$\neg\neg E$$ rule is what makes this proof classical rather than intuitionistic.

## Sequent Calculus

While natural deduction aims at improving the readability of derivations, sequent calculus aims at reasoning about them structurally.
To facilitate this, sequent calculus improves symmetry by generalizing the sequents of natural deduction to allow multiple alternative conclusions.
Hence, the judgments of sequent calculus are sequents of the form: $$\Gamma \vdash \Delta$$.

> **Identity**
>
> $$
> \dfrac{}{\Gamma,\varphi \vdash \varphi,\Delta}~(\mathrm{Ax})
> $$
>
> **Conjunction**
>
> $$
> \dfrac{\Gamma,\varphi,\psi \vdash \Delta}{\Gamma,\varphi \land \psi \vdash \Delta}(\land L)
> \qquad
> \dfrac{\Gamma \vdash \varphi,\Delta \qquad \Gamma \vdash \psi,\Delta}{\Gamma \vdash \varphi \land \psi,\Delta}(\land R)
> $$
>
> **Disjunction**
>
> $$
> \dfrac{\Gamma,\varphi \vdash \Delta \qquad \Gamma,\psi \vdash \Delta}{\Gamma,\varphi \lor \psi \vdash \Delta}(\lor L)
> \qquad
> \dfrac{\Gamma \vdash \varphi,\psi,\Delta}{\Gamma \vdash \varphi \lor \psi,\Delta}(\lor R)
> $$
>
> **Implication**
>
> $$
> \dfrac{\Gamma \vdash \varphi,\Delta \qquad \Gamma,\psi \vdash \Delta}{\Gamma,\varphi \to \psi \vdash \Delta}(\to L)
> \qquad
> \dfrac{\Gamma,\varphi \vdash \psi,\Delta}{\Gamma \vdash \varphi \to \psi,\Delta}(\to R)
> $$
>
> **Negation**
>
> $$
> \dfrac{\Gamma \vdash \varphi,\Delta}{\Gamma,\neg\varphi \vdash \Delta}(\neg L)
> \qquad
> \dfrac{\Gamma,\varphi \vdash \Delta}{\Gamma \vdash \neg\varphi,\Delta}(\neg R)
> $$
>
> **Weakening**
>
> $$
> \dfrac{\Gamma \vdash \Delta}{\Gamma,\varphi \vdash \Delta}(W_L)
> \qquad
> \dfrac{\Gamma \vdash \Delta}{\Gamma \vdash \varphi,\Delta}(W_R)
> $$
>
> **Contraction**
>
> $$
> \dfrac{\Gamma,\varphi,\varphi \vdash \Delta}{\Gamma,\varphi \vdash \Delta}(C_L)
> \qquad
> \dfrac{\Gamma \vdash \varphi,\varphi,\Delta}{\Gamma \vdash \varphi,\Delta}(C_R)
> $$
>
> **Cut**
>
> $$
> \frac{\Gamma_1 \vdash \varphi,\Delta_1 \qquad \Gamma_2,\varphi \vdash \Delta_2}{\Gamma_1, \Gamma_2 \vdash \Delta_1, \Delta_2}
> $$

Like the other deduction systems, sequent calculus (called LK by Gentzen) is sound and complete for propositional logic:

$$
\Gamma \vdash_{LK} \Delta ~~\Leftrightarrow~~ \models \left(\bigwedge_{\gamma \in \Gamma} \gamma\right) \to \left(\bigvee_{\delta \in \Delta} \delta\right)
$$

In particular, we have:

$$
\vdash_{LK} \varphi ~~\Leftrightarrow~~ \models \varphi
$$

Note that the premises of the rules of sequent calculus only feature formula schemas that are present in the conclusion.
This property is called analytic; it constrains the space of possible proofs and therefore helps with proof search.

The only exception is the cut rule, which allows removing a formula when it appears both in the antecedents and the succedents of the premises.
We can see the cut rule as a modularity mechanism that enables combining sub-proofs that are connected only by a common formula.
This corresponds to the idea of a lemma: an intermediate result that does not appear in the final conclusion.
Fortunately for proof search, cuts can be automatically eliminated from proofs.
This central result of sequent calculus is called the cut-elimination theorem.

A textbook example of the cut rule is the proof of transitivity of implication:

$$
\dfrac{
  \dfrac{
    \dfrac{
      p \vdash p
      \qquad
      q \vdash q
    }{
      p,p \to q \vdash q
    }(\to L)
    \qquad
    \dfrac{
      q \vdash q
      \qquad
      r \vdash r
    }{
      q,q \to r \vdash r
    }(\to L)
  }{
    p,p \to q,q \to r \vdash r
  }(\mathrm{Cut})
}{
  p \to q,q \to r \vdash p \to r
}(\to R)
$$

Here is the cut-free version of the same tautology:

$$
\dfrac{
  \dfrac{
    p \vdash p
    \qquad
    \dfrac{
      q \vdash q
      \qquad
      r \vdash r
    }{
      q,q \to r \vdash r
    }(\to L)
  }{
    p,p \to q,q \to r \vdash r
  }(\to L)
}{
  p \to q,q \to r \vdash p \to r
}(\to R)
$$

Note that the cut-free proof is actually shorter than the one with cut.
This is because the lemma ($$q$$) was trivial.
The cut rule shines when the lemma is non-trivial, which is hard to exhibit in short proofs.

Unlike KSC+MP and ND, sequent calculus does not feature an intuitionistic subset of rules.
Instead, intuitionistic sequent calculus (called LJ by Gentzen) can be obtained by restricting the shape of the sequents to have at most one succedent formula.
Having multiple alternative succedents is indeed not compatible with intuitionistic logic because it would allow obtaining a conclusion by eliminating all the alternatives.

## Recap

We started by recursively defining what a propositional formula $$\varphi$$ is:

$$
\varphi ::= p \mid q \mid \ldots \mid \neg \varphi \mid (\varphi \land \varphi) \mid (\varphi \lor \varphi) \mid (\varphi  \varphi)
$$

We then gave meaning to this language by evaluating formulas relative to a model $$M$$:

$$
\llbracket\varphi\rrbracket_M \in \{\mathrm{T}, \mathrm{F}\}
$$

We used this evaluation to define Tarski's notion of truth for a formula:

$$
M \models \varphi ~~\Leftrightarrow~~ \llbracket\varphi\rrbracket_M = \mathrm{T}
$$

This gives us the tools to define the satisfiability and validity of a formula:

$$
\mathrm{SAT}(\varphi) ~~:=~~ \exists M, M \models \varphi \\
\mathrm{VAL}(\varphi) ~~:=~~ \forall M, M \models \varphi \\
\left(\models\varphi ~~:=~~ \mathrm{VAL}(\varphi)\right)
$$

We noted that negation in propositional logic complements the truth value:

$$
M \models \neg\varphi ~~\Leftrightarrow~~ M \not\models \varphi
$$

This enables us to reduce the decision problems SAT and !VAL to one another, and VAL and !SAT to one another.

We noted that a certificate for SAT/!VAL may simply consist of a model, which can be verified in linear time.
We stated the Cook-Levin theorem: any problem that admits a polynomial certificate can be reduced to SAT.
By definition, this means that SAT is NP-complete which is a class of problems widely believed not to admit polynomial-time algorithms.

In contrast, a certificate for VAL/!SAT must prove the absence of a model, which is less straightforward.
In logic, this is done via a deduction system that recursively defines what a derivation is.
The best algorithms known to date for VAL/!SAT still take exponential time in the worst case and may generate exponential-size derivations.
Hence, we do not know whether VAL/!SAT is in NP.

Finally, we presented three types of deduction systems:

| Deduction system        | Judgments                 |
| ----------------------- | ------------------------- |
| Hilbert-style deduction | $$\vdash \varphi$$        |
| Natural deduction       | $$\Gamma \vdash \varphi$$ |
| Sequent calculus        | $$\Gamma \vdash \Delta$$  |

All of them are equivalent in the sense that they are sound and complete for propositional logic:

$$
\vdash \varphi ~~\Leftrightarrow~~ \models \varphi
$$
