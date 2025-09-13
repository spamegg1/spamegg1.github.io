# Tarski's World

(Last updated September 2025)

Enjoy my silly design adventures and mistakes below!

## What is this?

[Recreating](https://github.com/spamegg1/tarski/) Barwise and Etchemendy's
[Tarski's World](https://www.gradegrinder.net/Products/tw-index.html)
in [Scala](https://www.scala-lang.org/)
and [Doodle](https://github.com/creativescala/doodle).

So far I have a crude approximation, but most code logic is in place:

![tarski-1](tarski-1.png)

### Who is Tarski?

[Alfred Tarski](https://en.wikipedia.org/wiki/Alfred_Tarski)
was one of the most influential logicians of the 20th century.
He is known for his work on model theory (semantics) of first order logic:
defining the concept of a model, and truth in a model.

### Approach

Many of the early decisions I made are deliberately poor choices.
For example, I started making a UI in a library that does not have any UI features.
My purpose is to learn along the way and keep breaking things.

## Parsing and interpreting First Order Logic (FOL)

### Crude attempt at self-parsing

#### The issue of free variables and substitution

### Giving up and exploring much better options: enter GAPT

### Syntax (proofs) and semantics (world)

### Implementing the world

### Implementing the interpreter, evaluating formulas in worlds

## Model, View, Controller

This "model" is not the same as the "model" from Logic above, but conceptually similar.

The initial stage of my repository was just all over the place and disorganized.
Then I remembered, there was this
[thing](https://en.wikipedia.org/wiki/Model–view–controller).

Of course I did no reading or research. Instead I started thinking about it naively.
To me it seemed like Controller was simply the "glue" between Model and Controller.
"Could it really be that simple? There's gotta be more to it than that", I thought.
But looks like it really is.

### Data: model or view? It's philosophical

### Controller: rendering

### Controller: mouse input

## Converters

Given the model I decided on, I have to convert between grid positions (`Int`)
and arbitrary points on the plane (`Double`). This is a fairly common problem.
So there must be many well-made solutions out there. But of course, screw that!
I gotta do it from scratch.

### Conditional givens, extension methods

### Converting conditionally with givens

### Deferred givens?

### Ad-hoc (typeclass) vs. subtype (inheritance) polymorphism

## Moving from Doodle to ScalaFX, proper UI

## Work in progress

Stay tuned!
