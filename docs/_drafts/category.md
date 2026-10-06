Yes, but there are a few different notions hiding inside **"models"**, and distinguishing them helps.

When we say

> **Cartesian closed categories model simply typed lambda calculus (STLC)**

we mean something close to the model-theoretic relationship between syntax and semantics:

$begin:math:display$
\\text\{syntax\} \\longrightarrow \\text\{semantic interpretation\}\.
$end:math:display$

## `⊢` versus `⊨`

In logic, you might write

$begin:math:display$
\\Gamma \\vdash \\varphi
$end:math:display$

to mean **"$begin:math:text$\\varphi$end:math:text$ is derivable from $begin:math:text$\\Gamma$end:math:text$"** using the syntactic proof rules, whereas

$begin:math:display$
\\Gamma \\models \\varphi
$end:math:display$

means **"$begin:math:text$\\varphi$end:math:text$ is true in every model satisfying $begin:math:text$\\Gamma$end:math:text$"** — a semantic statement.

There is a closely analogous picture for STLC.

A typing judgment

$begin:math:display$
\\Gamma \\vdash t \: B
$end:math:display$

is syntactic.

For example,

$begin:math:display$
x\:A \\vdash x\:A\.
$end:math:display$

Give the language a categorical interpretation. Types become objects:

$begin:math:display$
A \\mapsto \\llbracket A \\rrbracket
$end:math:display$

and a context becomes a product:

$begin:math:display$
x\:A\,y\:B
\\quad\\mapsto\\quad
\\llbracket A \\rrbracket \\times \\llbracket B \\rrbracket\.
$end:math:display$

Then a well-typed term becomes a morphism:

$begin:math:display$
\\boxed\{
\\Gamma \\vdash t\:B
\}
\\quad\\leadsto\\quad
\\boxed\{
\\llbracket\\Gamma\\rrbracket
\\xrightarrow\{\\llbracket t\\rrbracket\}
\\llbracket B\\rrbracket
\}\.
$end:math:display$

That's the sense in which a CCC is a **model** of STLC.

## `⊨` becomes especially interesting for equality

Suppose the calculus proves two programs equal:

$begin:math:display$
\\Gamma \\vdash t \= u \: B\.
$end:math:display$

Categorically, we can ask whether their denotations are the same morphism:

$begin:math:display$
\\llbracket t\\rrbracket
\=
\\llbracket u\\rrbracket\.
$end:math:display$

So we can define something analogous to semantic entailment:

$begin:math:display$
\\Gamma \\models\_\{\\mathcal C\} t\=u
$end:math:display$

to mean that $begin:math:text$t$end:math:text$ and $begin:math:text$u$end:math:text$ denote the same morphism in the categorical model $begin:math:text$\\mathcal C$end:math:text$.

Then **soundness** says:

$begin:math:display$
\\boxed\{
\\Gamma\\vdash t\=u
\\quad\\Longrightarrow\\quad
\\Gamma\\models\_\{\\mathcal C\}t\=u
\}
$end:math:display$

for every appropriate CCC model $begin:math:text$\\mathcal C$end:math:text$.

And a completeness result goes in the opposite direction:

$begin:math:display$
\\boxed\{
\\Gamma\\models\_\{\\mathcal C\}t\=u
\\text\{ for all CCC models\}
\\quad\\Longrightarrow\\quad
\\Gamma\\vdash t\=u\.
\}
$end:math:display$

So this is indeed strongly analogous to the familiar

$begin:math:display$
\\vdash
\\quad\\text\{vs\.\}\\quad
\\models
$end:math:display$

distinction from model theory.

## Does that mean CCCs "compute the same things"?

That's slightly too strong as stated.

The important result is more structural:

> **STLC is essentially the internal language of Cartesian closed categories.**

The correspondence is roughly:

| STLC syntax                                   | CCC semantics                                    |
| --------------------------------------------- | ------------------------------------------------ |
| $begin:math:text$A\,B$end:math:text$          | objects                                          |
| $begin:math:text$A\\times B$end:math:text$    | categorical product                              |
| $begin:math:text$A\\to B$end:math:text$       | exponential $begin:math:text$B\^A$end:math:text$ |
| $begin:math:text$t\:A$end:math:text$          | morphism                                         |
| $begin:math:text$\\lambda x\.t$end:math:text$ | currying                                         |
| $begin:math:text$f\\\,x$end:math:text$        | evaluation                                       |
| substitution                                  | composition                                      |

For instance, lambda abstraction

$begin:math:display$
x\:A\,y\:B\\vdash t\:C
$end:math:display$

becomes a morphism

$begin:math:display$
A\\times B\\to C\.
$end:math:display$

Abstract over $begin:math:text$y$end:math:text$:

$begin:math:display$
x\:A\\vdash\\lambda y\.t\:B\\to C\.
$end:math:display$

Categorically, closedness gives exactly:

$begin:math:display$
A\\times B\\to C
\\quad\\cong\\quad
A\\to C\^B\.
$end:math:display$

So **lambda abstraction literally corresponds to currying in the category**.

And application corresponds to

$begin:math:display$
\\operatorname\{eval\}\:C\^B\\times B\\to C\.
$end:math:display$

That's why "CCC models STLC" is stronger than merely saying "we found some mathematical objects that can represent programs."

The basic operations and equations of lambda calculus arise directly from the universal properties of the category.

## There's an even stronger viewpoint

You can construct a category **from the syntax of STLC itself**.

Take:

- types as objects;
- terms (modulo the appropriate equality) as morphisms;
- substitution as composition.

The resulting **syntactic category of terms is itself a Cartesian closed category**.

So you get a two-way relationship:

$begin:math:display$
\\boxed\{\\text\{STLC\}\}
\\quad\\longleftrightarrow\\quad
\\boxed\{\\text\{Cartesian closed categories\}\}\.
$end:math:display$

This is part of the **Curry–Howard–Lambek correspondence**.

## Connection to your resource-oriented language

If you replace ordinary reusable contexts/products with linear resources,

$begin:math:display$
\\Gamma\=A\\otimes B\,
$end:math:display$

then you'd expect judgments like

$begin:math:display$
\\Gamma\\vdash t\:C
$end:math:display$

to denote morphisms

$begin:math:display$
A\\otimes B\\to C\.
$end:math:display$

If your category is **symmetric monoidal closed**, function abstraction corresponds to

$begin:math:display$
\\operatorname\{Hom\}\(A\\otimes B\,C\)
\\cong
\\operatorname\{Hom\}\(A\,B\\multimap C\)\.
$end:math:display$

So you can potentially formulate your language at exactly these three levels:

$begin:math:display$
\\boxed\{\\text\{typing\/proof theory \}\(\\vdash\)\}
\\\;\\longleftrightarrow\\\;
\\boxed\{\\text\{programs\}\}
\\\;\\longleftrightarrow\\\;
\\boxed\{\\text\{categorical semantics \}\(\\models\)\}\.
$end:math:display$

That is probably the precise mathematical framework behind several of the symmetry/resource ideas we've been discussing.
