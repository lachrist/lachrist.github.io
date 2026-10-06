---
layout: post
title: "Category Theory: Terminal and Initial Object"
---

In category theory, objects should be considered as "black boxes".
We don't know what they are; we can only name them and reason about their relationships with other objects through morphisms.
In other words, we can specify what an object is by specifying how it relates to _all_ the other objects in the category.
This way of specifying objects via _universal property_ is called _universal construction_.
This powerful framework forces us to abstract away from "implementation" details and focus on the essence of what we are studying.
Below, we present the universal properties of the terminal and initial objects, which are two primary examples of universal constructions.

## Definition of the Terminal Object

In a category $$\mathcal{C}$$, an object $$T$$ is said to be _terminal_ when for every object $$X$$ in $$\mathcal{C}$$, there exists a unique morphism $$f : X \to T$$.
Given that every object of a category must have an identity morphism, we can already say that the terminal object has a unique endomorphism, which is the identity morphism $$id_T : T \to T$$.

<pre class="mermaid">
    flowchart LR
        X["Any object X"] -->|"unique morphism ∃!"| T["Terminal object T"]
        T -->|"only endomorphism: id_T"| T
</pre>

## Definition of the Initial Object
