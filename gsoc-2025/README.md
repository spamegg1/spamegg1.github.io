# GSoC 2025

- [GSoC 2025](#gsoc-2025)
  - [Where is the code?](#where-is-the-code)
  - [Goals](#goals)
    - [Project goals](#project-goals)
    - [Long term personal goals for the future](#long-term-personal-goals-for-the-future)
  - [Learning the codebase, making first contributions](#learning-the-codebase-making-first-contributions)
  - [Fs2 integration](#fs2-integration)
    - [Initial version](#initial-version)
    - [Challenges](#challenges)
    - [A "type bridge"](#a-type-bridge)
      - [Further work on type bridges](#further-work-on-type-bridges)
    - [fs2 mapping through Cyfra](#fs2-mapping-through-cyfra)
    - [fs2 filtering through Cyfra](#fs2-filtering-through-cyfra)
      - [Challenges in filter](#challenges-in-filter)
      - [Approach](#approach)
      - [Mapping the predicate](#mapping-the-predicate)
      - [Implementing parallel prefix sum](#implementing-parallel-prefix-sum)
        - [Upsweep](#upsweep)
        - [Downsweep (inclusive)](#downsweep-inclusive)
      - [Implementing stream compaction](#implementing-stream-compaction)
    - [Further work](#further-work)
  - [Cyfra Interpreter](#cyfra-interpreter)
    - [Progress](#progress)
    - [Simulating expressions, just one at a time](#simulating-expressions-just-one-at-a-time)
      - [Overcoming stack overflow](#overcoming-stack-overflow)
    - [Interpreting a GIO, one at a time](#interpreting-a-gio-one-at-a-time)
    - [Simulating invocations in parallel](#simulating-invocations-in-parallel)
    - [Interpreting invocations in parallel](#interpreting-invocations-in-parallel)
    - [Keeping track of reads and writes, and coalescence](#keeping-track-of-reads-and-writes-and-coalescence)
      - [Coalesce profiles](#coalesce-profiles)
    - [Profiling branches](#profiling-branches)
    - [Future work](#future-work)
  - [Reflections](#reflections)

I participated in 2025's Google Summer of Code,
to contribute to [Cyfra](https://github.com/ComputeNode/cyfra/).

Cyfra is a DSL (in Scala 3) and runtime to do general programming on the GPU.
It compiles its DSL to SPIR-V assembly and runs it via Vulkan runtime on GPUs.

## Where is the code?

My major contributions (merged into `dev`) can be found at:

- [Fs2 interop](https://github.com/ComputeNode/cyfra/pull/63)
- [Cyfra interpreter](https://github.com/ComputeNode/cyfra/pull/62)

My minor contributions (merged into `main`):

- [GArray refactor](https://github.com/ComputeNode/cyfra/pull/28)
- [GMem refactor](https://github.com/ComputeNode/cyfra/pull/37)
- [tests coverage](https://github.com/ComputeNode/cyfra/pull/44)
- [linting and Github Actions](https://github.com/ComputeNode/cyfra/pull/49)

## Goals

### Project goals

- Add [fs2](https://fs2.io/) integration to Cyfra, so that
fs2 streams can be executed on the GPU via a pipeline.

- Create a Cyfra interpreter (to run on the CPU) that can
simulate Cyfra GPU programs for debugging and profiling.

### Long term personal goals for the future

I would like to create a GPU programming course suitable for beginners using Cyfra.

## Learning the codebase, making first contributions

During the bonding period, in order to get familiar with Cyfra,
I made some code refactors and additions:

- I [refactored GArray](https://github.com/ComputeNode/cyfra/pull/28)
- and [GMem](https://github.com/ComputeNode/cyfra/pull/37)
- I also [added testing coverage](https://github.com/ComputeNode/cyfra/pull/44) and
- [changed syntax and Github Actions](https://github.com/ComputeNode/cyfra/pull/49).

During testing I was able to discover some bugs in the Cyfra compiler, which were fixed.

Much of these changes, especially involving `GMem`, became legacy and were archived,
as the Cyfra runtime was redesigned from the ground up.

## Fs2 integration

Once the GSoC coding period started, I worked on how to run an fs2
[`Stream`](https://fs2.io/#/guide?id=building-streams) on Cyfra.

Fs2 has a `Pipe` type:

```scala
type Pipe[F[_], -I, +O] = Stream[F, I] => Stream[F, O]
```

which can then be used on a `Stream` with
[`.through`](https://www.javadoc.io/static/co.fs2/fs2-docs_2.13/3.12.0/fs2/Stream.html#through[F2[x]%3E:F[x],O2](f:fs2.Stream[F,O]=%3Efs2.Stream[F2,O2]):fs2.Stream[F2,O2]).

The analogy is obvious: a stream runs through a pipe, gets transformed to a new stream.
This is very similar to a `.map` method, but instead of a function that transforms
individual elements, it works with a function that transforms the whole stream.

The idea is to create a sort of "Cyfra pipe".
So the computations happen on the Cyfra side, executed on the GPU.
Then the stream goes back to fs2 / Scala land.

To get a better idea, look at this basic unit test:

```scala
test("fs2 through gPipeMap, just ints"):
  val inSeq = (0 until 256).toSeq                  // just some numbers
  val stream = Stream.emits(inSeq)                 // fs2 stream
  val pipe = gPipeMap[Pure, Int32, Int](_ + 1)     // Cyfra pipe, done on GPU
  val result = stream.through(pipe).compile.toList // resulting fs2 stream
  val expected = inSeq.map(_ + 1)                  // same, on Scala/CPU, for comparison
  result
    .zip(expected)
    .foreach: (res, exp) =>
      assert(res == exp, s"Expected $exp, got $res")
```

### Initial version

Initially I had a working version that used the older Cyfra runtime (now archived).
The older runtime's `GMem` was not polymorphic, it needed separate classes for each type.
Which meant implementing the pipe multiple times, for each data type. For example:

```scala
// using the now-legacy, older runtime
extension (stream: Stream[Pure, Int]) // not generic
  def gPipeInt(fn: Int32 => Int32)(using GContext): Stream[Pure, Int] =
    val gf: GFunction[Empty, Int32, Int32] = GFunction(fn)
    stream
      .chunkMin(256)
      .flatMap: chunk =>
        val gmem = IntMem(chunk.toArray) // non-polymorphic memory
        val res = gmem.map(gf).asInstanceOf[IntMem].toArray
        Stream.emits(res)
```

We would have to do one of these for every pair of `Stream[F, O1] => Stream[F, O2]`
that we wanted to have. It was obvious that the runtime needed to be redesigned.

### Challenges

The main challenge was the changing Cyfra Runtime API that was in development
in parallel to my project, and adapting to these changes (as an API user).
The runtime is even more complicated than my projects, so I won't explain it much here.

Another challenge was the high conceptual difficulty of the problem.
The solution required high level, abstract, imaginative thinking.
Without some small concrete details to grab onto, I struggled a lot with this.

In particular:

- On the GPU side, we don't have Scala / JVM types.
- Therefore Cyfra has its own types in the DSL.
- But, fs2 uses Scala types, and has no knowledge of Cyfra's DSL.
  - Moreover, there is type erasure on the JVM to deal with!
  - So we have to use [tags](https://zio.dev/izumi-reflect/) for Cyfra custom types, and
  - [ClassTag](https://www.scala-lang.org/api/current/scala/reflect/ClassTag.html)
  for the Scala types.
- This caused issues when trying to allocate space on the GPU to run an fs2 stream.
- The basic data structure we use is `java.nio.ByteBuffer`.
- So, I needed a way to connect a Scala type and a Cyfra type.
  - The data needs to be sized correctly, and fed as just bytes,
  - and it needs to be type-safe, as much as possible.

I tried some approaches using
[Match types](https://docs.scala-lang.org/scala3/reference/new-types/match-types.html)
but could not make it work. Then I tried a
[typeclass](https://docs.scala-lang.org/scala3/book/ca-type-classes.html) approach.

### A "type bridge"

After thinking a lot and getting stuck for some time, eventually this idea emerged:

```scala
trait Bridge[CyfraType <: Value: FromExpr: Tag, ScalaType: ClassTag]:
  def toByteBuffer(inBuf: ByteBuffer, chunk: Chunk[ScalaType]): ByteBuffer
  def fromByteBuffer(outBuf: ByteBuffer, arr: Array[ScalaType]): Array[ScalaType]
```

Here `Chunk` refers to [`fs2.Chunk`](https://fs2.io/#/guide?id=chunks),
a lower-level data structure that `fs2.Stream` is built on.

This bridge lets us convert data back and forth between Cyfra and Scala types,
so data can be passed around in buffers.

We create
[`given` instances](https://docs.scala-lang.org/scala3/reference/contextual/givens.html)
of these bridges to be used implicitly. That's how Scala handles type classes.
For example, we have these few basic bridges between Cyfra and Scala types:

```scala
// left: Cyfra type, right: Scala type
given Bridge[Int32, Int]:
  def toByteBuffer(inBuf: ByteBuffer, chunk: Chunk[Int]): ByteBuffer =
    inBuf.asIntBuffer().put(chunk.toArray[Int]).flip()
    inBuf
  def fromByteBuffer(outBuf: ByteBuffer, arr: Array[Int]): Array[Int] =
    outBuf.asIntBuffer().get(arr).flip()
    arr
given Bridge[Float32, Float]:
  // ...
given Bridge[Vec4[Float32], fRGBA]:
  // ...
given Bridge[GBoolean, Boolean]:
  // ...
```

These bridges allow us to take a chunk of data from an fs2 `Stream`,
correctly measure the size we need to allocate for a `ByteBuffer`,
and after the computation is done, put it back into an fs2 `Stream`,
making sure everything type-checks correctly.

This approach is much more generic; if someone wants a pipe for a `Stream[F, O]`,
all they have to implement is a given instance between the two appropriate types
(instead of implementing the whole pipe, like before in the legacy version).

#### Further work on type bridges

Making these type bridges even more polymorphic / generic would be very useful.
The bridge should be able to work with more general data structures than just `fs2.Chunk`.

### fs2 mapping through Cyfra

After this big obstacle, running an fs2 stream through a Cyfra pipe
still required a lot of work, but it was fairly straightforward.
The type signature looks very scary, but it's actually not that bad:

```scala
object GPipe:
  def gPipeMap[
    F[_],
    C1 <: Value: FromExpr: Tag,
    C2 <: Value: FromExpr: Tag,
    S1: ClassTag,
    S2: ClassTag
  ](f: C1 => C2)(
    using cr: CyfraRuntime,
    bridge1: Bridge[C1, S1],
    bridge2: Bridge[C2, S2]
  ): Pipe[F, S1, S2]
```

There is a lot more involved, but the core part of the code looks a bit like this:

```scala
stream
  .chunkMin(params.inSize)
  .flatMap: chunk =>
    bridge1.toByteBuffer(inBuf, chunk)
    region.runUnsafe(
      init = ProgramLayout(
        in = GBuffer[C1](inBuf),
        out = GBuffer[C2](outBuf)
      ),
      onDone = layout => layout.out.read(outBuf)
    )
    Stream.emits(bridge2.fromByteBuffer(outBuf, new Array[S2](params.inSize)))
```

As you can see, we are using the type bridges to put the data in / out of buffers.
We start with a `Stream` on the fs2 side, and we end up with another `Stream`.
The `region`, `ProgramLayout` and `GBuffer` refer to parts of Cyfra's API
for writing GPU programs, using the redesigned runtime.

### fs2 filtering through Cyfra

Here we are still using the type bridges from before, but the discussion
will focus more on how to stitch together multiple GPU programs in Cyfra.

In normal Scala land, the signature looks like this:

```scala
object GPipe:
  // ...
  def gPipeFilter[
    F[_],
    C <: Value: Tag: FromExpr,
    S: ClassTag
  ](predicate: C => GBoolean)(
    using cr: CyfraRuntime,
    bridge: Bridge[C, S]
  ): Pipe[F, S, S] =
    (stream: Stream[F, S]) => ???
```

#### Challenges in filter

Implementing a filter method on the GPU, in parallel, is quite tricky.
Thankfully there is good literature on the subject (although mostly in CUDA C/C++):

[Parallel prefix sum](https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda)

For example, let's say we want to filter even numbers:

```scala
List(1, 2, 4, 3, 3, 1, 4, 8, 2, 5, 7) // filters to:
List(., 2, 4, ., ., ., 4, 8, 2, ., .) // compacts to:
List(2, 4, 4, 8, 2)
```

On the CPU/JVM we can do this easily, but on the GPU it's not so simple.
The GPU works on large fixed blocks in parallel, not sequentially.

- The resulting collection size is unknown ahead of time.
- The indices of the filtered elements are also unknown.
- We cannot simply create a new empty collection and keep appending to it sequentially,
  like we do on the CPU.
- We need to take advantage of GPU's parallelism anyway.
- Implementing prefix sum is quite challenging.
- Then implementing stream compaction is also challenging.

#### Approach

The literature guides us to the following approach:

- Map the predicate over the collection to get a sequence of 0s and 1s:

```scala
List(1, 2, 4, 3, 3, 1, 4, 8, 2, 5, 7) // maps to:
List(0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0)
```

- Run parallel prefix sum on the result (I opted for inclusive sum):

```scala
List(1, 2, 4, 3, 3, 1, 4, 8, 2, 5, 7) // maps to:
List(0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0) // scans to:
List(0, 1, 2, 2, 2, 2, 3, 4, 5, 5, 5) // these are inclusive prefix sums
```

- The last number in the prefix sum result is the size of the filtered collection
  (in this case, 5).
- The filtered elements are those that are, in the prefix sum results,
  1 greater than the previous entry:

```scala
List(1, 2, 4, 3, 3, 1, 4, 8, 2, 5, 7) // original
//      X  X           X  X  X        // filtered elements
List(0, 1, 2, 2, 2, 2, 3, 4, 5, 5, 5) // (inclusive) prefix sum
```

- In the compacted final collection, *the prefix sum result minus 1 becomes the index*:

```scala
List(1, 2, 4, 3, 3, 1, 4, 8, 2, 5, 7) // original
//      X  X           X  X  X        // filtered elements
List(0, 1, 2, 2, 2, 2, 3, 4, 5, 5, 5) // (prefix sum - 1) gives us the indices
List(2, 4, 4, 8, 2)
//   0  1  2  3  4: the indices come from the prefix sum, minus 1
```

#### Mapping the predicate

The initial portion is just like the map from before.
We apply `predicate` to Cyfra values; but instead of `GBoolean` we'll return `Int32`.

This is what Cyfra's `GProgram` API looks like; it needs definitions of memory layouts,
the input and output buffers, their sizes as parameters, the size of a
[workgroup](https://registry.khronos.org/OpenGL-Refpages/gl4/html/gl_WorkGroupSize.xhtml)
(static or dynamic), and so on.
Then we provide the code in Cyfra land that is executed for each invocation in parallel:

```scala
val predicateProgram = GProgram[Params, Layout](
  layout = params =>
    Layout(
      in = GBuffer[C](params.inSize),     // collection to be filtered
      out = GBuffer[Int32](params.inSize) // predicate results, as 0/1
    ),
  dispatch = (layout, params) => GProgram.StaticDispatch((params.inSize, 1, 1)),
): layout =>
  val invocId = GIO.invocationId                // each thread, or rather, GPU array index
  val element = GIO.read[C](layout.in, invocId) // read input at that index
  val result  = when(predicate(element))(1: Int32).otherwise(0)
  GIO.write[Int32](layout.out, invocId, result) // write result to output buffer at index
```

Here `when` and `.otherwise` are the if/else expressions of Cyfra's DSL.
You can read more on that in the Interpreter project below.

Then this GPU program is handed to an execution handler to be performed.

#### Implementing parallel prefix sum

This is one of the hardest parts of the project!
It consists of two parts, both of which are recursive: upsweep and downsweep.
I will illustrate with a small example of an array with 8 elements.
For simplicity, each array position holds a value of 1:

|index|  0|  1|  2|  3|  4|  5|  6|  7|
|:---:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|value|  1|  1|  1|  1|  1|  1|  1|  1|

Since <k-x>8 = 2^3</k-x> there are 3 phases of upsweep, 2 of downsweep.
In general, if the array size is <k-x>2^n</k-x>, there are `n` and `n-1` phases.
The final result of the prefix sum should be: `1, 2, 3, 4, 5, 6, 7, 8`.

$8 = 2^3$

##### Upsweep

We do some additions on subintervals recursively.
The mid point of an interval gets added to its end point:

|interval size|index|  0|  1|  2|  3|  4|  5|  6|  7|
|:-----------:|:---:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|            2|     |  1|  1|  1|  1|  1|  1|  1|  1|
|phase 1      |     | 🡦 | 🡣 | 🡦 | 🡣 | 🡦 | 🡣 | 🡦 | 🡣 |
|            4|     |  1|  2|  1|  2|  1|  2|  1|  2|
|phase 2      |     |   | 🡦 |   | 🡣 |   | 🡦 |   | 🡣 |
|            8|     |  1|  2|  1|  4|  1|  2|  1|  4|
|phase 3      |     |   |   |   | 🡦 |   |   |   | 🡣 |
|result       |     |  1|  2|  1|  4|  1|  2|  1|  8|

TODO (Cyfra code)

##### Downsweep (inclusive)

Downsweep starts from the result of upsweep. Interval sizes go back in reverse.
The end-point of an interval gets added to the mid point of the interval next to it:

|interval size|index|  0|  1|  2|  3|  4|  5|  6|  7|
|:-----------:|:---:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
|4            |     |  1|  2|  1|  4|  1|  2|  1|  8|
|phase 1      |     |   |   |   | 🡦 |   | 🡣 |   |   |
| 2           |     |  1|  2|  1|  4|  1|  6|  1|  8|
|phase 2      |     |   | 🡦 | 🡣 | 🡦 | 🡣 | 🡦 | 🡣 |  |
|result       |     |  1|  2|  3|  4|  5|  6|  7|  8|

TODO (Cyfra code)

#### Implementing stream compaction

TODO

### Further work

I would like to finish off the filter method, and implement more of fs2's streaming
[API](https://www.javadoc.io/doc/co.fs2/fs2-docs_2.13/3.12.0/fs2/Stream.html) on Cyfra,
adding more methods. This can be very tricky as we saw with the filter example.

Currently we are mostly dealing with "pure" fs2 streams without side effects.
In the future we should find a way to do the side effects of the effect type `F[_]`.
For example, how can we print some text on the GPU? Is it even possible?
Some side effects might be impossible, but a partial solution might work.

We would like to generalize Cyfra pipes to any sort of data, not just fs2 `Stream`s.
That way Cyfra can be used with many types of streaming data.

Getting good performance will be tricky; we need to minimize the CPU<->GPU back and forth.
To chain multiple stream operations, we need to keep the data on the GPU.
Cyfra's new runtime API has the right building blocks to facilitate this.

## Cyfra Interpreter

My other project is to [make an interpreter](https://nrinaudo.github.io/articles/pl.html)
for Cyfra that can run on the CPU and simulate GPU computations.

### Progress

Since making an interpreter is a well-understood problem,
and the GPU was not involved here, this project was easier and went more smoothly.

It evolved gradually in stages:

- Simulating [expressions](https://github.com/ComputeNode/cyfra/blob/main/cyfra-dsl/):
the baseline of Cyfra's DSL (see `Expression.scala`)
- Interpreting [GIO](https://github.com/ComputeNode/cyfra/blob/dev/cyfra-dsl/):
Cyfra's [monad](https://en.wikipedia.org/wiki/Monad_(functional_programming))
type for GPU compute (see `gio/GIO.scala`)
- Scaling the simulator to handle multiple
[invocations](https://registry.khronos.org/OpenGL-Refpages/gl4/html/gl_InvocationID.xhtml)
- Propagating these changes to the interpreter (which builds on the simulator)
- Profiling reads in the simulator, writes in the interpreter
- Profiling whether reads/writes "coalesce" (use contiguous buffer addresses)
- Profiling branching paths in if/else expressions, measuring idle periods.

### Simulating expressions, just one at a time

Cyfra's DSL has *a lot* of `Expression` types!

```scala
def simOne(e: Expression[?]) = e match
  case CurrentElem(tid: Int)        => ???
  case AggregateElem(tid: Int)      => ???
  case Negate(a)                    => ???
  case Sum(a, b)                    => ???
  case Diff(a, b)                   => ???
  case Mul(a, b)                    => ???
  case Div(a, b)                    => ???
  case Mod(a, b)                    => ???
  case ScalarProd(a, b)             => ???
  case DotProd(a, b)                => ???
  case BitwiseAnd(a, b)             => ???
  case BitwiseOr(a, b)              => ???
  case BitwiseXor(a, b)             => ???
  case BitwiseNot(a)                => ???
  case ShiftLeft(a, by)             => ???
  case ShiftRight(a, by)            => ???
  case GreaterThan(a, b)            => ???
  case LessThan(a, b)               => ???
  case GreaterThanEqual(a, b)       => ???
  case LessThanEqual(a, b)          => ???
  case Equal(a, b)                  => ???
  case And(a, b)                    => ???
  case Or(a, b)                     => ???
  case Not(a)                       => ???
  case ExtractScalar(a, i)          => ???
  case ToFloat32(a)                 => ???
  case ToInt32(a)                   => ???
  case ToUInt32(a)                  => ???
  case ConstFloat32(value)          => ???
  case ConstInt32(value)            => ???
  case ConstUInt32(value)           => ???
  case ConstGB(value)               => ???
  case ComposeVec2(a, b)            => ???
  case ComposeVec3(a, b, c)         => ???
  case ComposeVec4(a, b, c, d)      => ???
  case value: FloatType             => ???
  case value: IntType               => ???
  case value: UIntType              => ???
  case GBoolean(source)             => ???
  case Vec2(tree)                   => ???
  case Vec3(tree)                   => ???
  case Vec4(tree)                   => ???
  case ReadBuffer(buffer, index)    => ???
  case ReadUniform(uniform)         => ???
  case WhenExpr(when, thenCode, otherConds, otherCaseCodes, otherwise) => ???
  case ExtFunctionCall(fn, args)    => ???
  case FunctionCall(fn, body, args) => ???
  case InvocationId                 => ???
  case Pass(value)                  => ???
  case Dynamic(source)              => ???
  case e: GArrayElem[?]             => ???
  case e: FoldSeq[?, ?]             => ???
  case e: ComposeStruct[?]          => ???
  case e: GetField[?, ?]            => ???
```

Most of these are self-explanatory: doing basic arithmetic, logic, vector algebra etc.
At the end, they turn into `Float | Int | Boolean` or
`Vector[Float] | Vector[Int] | Vector[Boolean]`.
Let's call this type `Result`.

`ReadBuffer` refers to each invocation on the GPU reading a different buffer address,
whereas `ReadUniform` refers to the "uniform" section of GPU memory
that does not depend on the invocation id.
Since we don't have access to the GPU here, we'll fake the buffers with some arrays:

```scala
case class SimData(
  bufMap: Map[GBuffer[?], Array[Result]],
  uniMap: Map[GUniform[?], Result]
)
```

The most interesting is `WhenExpr`, which is like an `if / else if / else` chain;
this is where some invocations will execute a branch, while others will remain idle.

The naive approach is to simply follow the recursive structure of the DSL:

```scala
case Sum(a, b) => simOne(a) + simOne(b)
```

This runs into the obvious problem of stack overflow due to recursion.

#### Overcoming stack overflow

The typical way to overcome stack overflow in cases like this is to rewrite it
using [tail recursion](https://en.wikipedia.org/wiki/Tail_call).
This can be difficult to do when the traversed structure isn't a simple list.
In our case we have an [AST](https://en.wikipedia.org/wiki/Abstract_syntax_tree).
Each expression on the tree has an id number called `treeid`.

One common approach is to turn the tree into a list, so that it is
[topologically sorted](https://en.wikipedia.org/wiki/Topological_sorting).
This way, when an expression appears somewhere in the list, every sub-expression that
it needs will already have been calculated, because they are earlier in the list:

```scala
List(..., a, b, ..., Sum(a, b), ...) // a,b are guaranteed to appear earlier than the Sum
```

So we can evaluate the list in order, cache earlier results in a map, then look them up.
Since it's a simple list, it can be made tail-recursive very easily!

```scala
@annotation.tailrec
def simIterate(exprs: List[Expression[?]], cache: Map[TreeId, Result]): Result
```

But what about the topological sort? It's a non-trivial algorithm.
Thankfully, I did not have to implement that from scratch!
Cyfra's [compiler](https://github.com/ComputeNode/cyfra/tree/main/cyfra-compiler)
already has a topological sorter called `buildBlock`:

```scala
def buildBlock(tree: Expression[?], providedExprIds: Set[Int] = Set.empty): List[Expression[?]]
```

It consumes an `Expression` and returns a topo-sorted list of its entire AST.
Normally it is used to compile Cyfra to SPIR-V, but now it can pull double duty!
Then `simOne` can use it with `simIterate`:

```scala
def simOne(e: Expression[?]) = simIterate(buildBlock(e), Map())
```

### Interpreting a GIO, one at a time

In contrast, there are very few `GIO[T]` types:

```scala
case Pure(value)                       => ???
case WriteBuffer(buffer, index, value) => ???
case WriteUniform(uniform, value)      => ???
case FlatMap(gio, next)                => ???
case Repeat(n, f)                      => ???
```

In fact, `FlatMap` and `Repeat` just sequence the other operations,
and `Pure` just simulates a side-effect-free value.
So the only important ones here are the two write operations.

This is mainly because, the monad is supposed to model
the side effecting operations (like writing data).
You might be thinking that reading is also a side effect, but here by side effect
we mean "altering the state of the outside world", in other words, writing.

So we do the side effect and write data to the (fake) buffer.

```scala
def interpretWriteBuffer(gio: WriteBuffer[?], data: SimData): (Result, SimData) = gio match
  case WriteBuffer(buffer, index, value) =>
    val index = Simulate.sim(index)                   // get the write index
    val writeVal = Simulate.sim(value, indexSc)       // get the value to be written
    val newData = data.write(buffer, index, writeVal) // write value to (fake) buffer
    (valueToWrite, newData)                           // return value and updated data
```

`WriteUniform` is similar.

### Simulating invocations in parallel

Now we need to mimic the GPU's behavior of progressing hundreds of
invocations together along a computation. Going back to our sum example, you can think of
earlier sub-expressions evaluating to different results on different invocations
(because they will read values from different buffer addresses):

|Expr       |invoc0|invoc1|invoc2|...|
|----------:|:----:|:----:|:----:|:-:|
|`a`        |     2|    -3|     7|...|
|`b`        |     1|    -2|     5|...|
|`Sum(a, b)`|     3|    -5|    12|...|

So we need a cache of previous results for each invocation.
This naturally lends itself to a map of maps:

```scala
type Cache   = Map[TreeId, Result]
type Records = Map[InvocId, Cache]
```

So now we need to look up results for each invocation, use them to compute,
then record the new results for each invocation, and keep moving along
(the code here is a bit simplified for demonstration purposes):

```scala
def simOne(e: Expression[?], records: Records): Records = e match
  // all the expression cases... here's one example
  case Sum(a, b) =>
    records.map: (invocId, cache) =>
      val aResult = cache(a.treeid)   // look up previous results, per invocation
      val bResult = cache(b.treeid)
      val result  = aResult + bResult // sum the results
      invocId -> cache.updated(e.treeid, result)
  // ...

@annotation.tailrec
def simIterate(blocks: List[Expression[?]], records: Records): Records = blocks match
  case head :: next =>
    val newRecords = simOne(head, records)
    simIterate(next, newRecords)
  case Nil => records
```

### Interpreting invocations in parallel

Very similar, with a little redesign.
Here we are starting to keep track of writes, which will be explained later below
(again, the code here is a bit simplified for demonstration purposes):

```scala
def interpretWriteBuffer(gio: WriteBuffer[?], records: Records, data: SimData): (Records, SimData) = gio match
  case WriteBuffer(buffer, index, value) =>
    val indices = Simulate.sim(index, records)        // get index to write for each invoc
    val values = Simulate.sim(value, records)         // get value to write for each invoc
    val newData = data.write(buffer, indices, values) // write all data
    val writes = indices.map: (invocId, index) =>     // track writes
      invocId -> (buffer, index, values(invocId))
    val newRecords = records.addWrites(writes)        // add writes to records
    (newRecords, newData)
```

### Keeping track of reads and writes, and coalescence

It is useful for debugging and profiling purposes to track reads and writes.
For this, we will have to do some redesigning.
We have to expand our `Records` to cache not just `Result`s but reads/writes as well:

```scala
enum Read:
  case ReadBuf(id: TreeId, buffer: GBuffer[?], index: Int, value: Result)
  case ReadUni(id: TreeId, uniform: GUniform[?], value: Result)

enum Write:
  case WriteBuf(buffer: GBuffer[?], index: Int, value: Result)
  case WriteUni(uni: GUniform[?], value: Result)

// each invocation has its own Record instance
case class Record(cache: Cache, writes: List[Write], reads: List[Read])

type Records = Map[InvocId, Record] // used to be just Cache, now full Record
```

Along with our simulation data, the stuff we have to keep track of is growing.
For technical reasons, we also need to track the `Results` of the last expression.
So let's collect them in one place and pass it around in the code:

```scala
type Results = Map[InvocId, Result] // for each invoc, the result of last expr evaluated
case class SimContext(results: Results, records: Records, data: SimData)
```

We update the code we had before accordingly.
Now we consume and return `SimContext` instead.
For example (again, simplified):

```scala
def simOne(e: Expression[?], sc: SimContext): SimContext = e match
  // ... other cases
  case ReadBuffer(buffer, index) => simReadBuffer(e, sc)  // reads will be tracked here
  case ReadUniform(uniform)      => simReadUniform(e, sc) // reads will be tracked here
  // ... other cases

@annotation.tailrec
def simIterate(blocks: List[Expression[?]], sc: SimContext): SimContext = blocks match
  case head :: next =>
    val newSc = simOne(head, sc) // reads tracked here if needed
    simIterate(next, newSc)
  case Nil => sc
```

Similarly for the interpreter and writes.

#### Coalesce profiles

Now we want to check if reads / writes of many invocations happen on contiguous addresses.
This type of analysis can be very useful for performance profiling.
If invocations read/write contiguously on the GPU memory, the performance is higher.
If they are jumping over a bunch of memory addresses, performance will be lower.

We need to track some read / write profiles. So, a bit more redesign.
Add one more field to our `SimContext`:

```scala
case class SimContext(results: Results, records: Records, data: SimData, profiles: List[Coalesce])
```

The addresses are contiguous if, when ordered
from smallest to largest, they increase by 1 at each step:

```scala
List(23, 24, 25, 26, 27)
```

Another way to say this is: the number of elements equals the max minus the min plus 1:

```scala
List(23, 24, 25, 26, 27) // 5 elements, 27 - 23 + 1 = 5
```

If they jumped over an address, then it's not the case:

```scala
// jump over 26
List(23, 24, 25, 27, 28) // 5 elements, 28 - 23 + 1 = 6 != 5
```

But is this logic correct? We are assuming that the addresses are distinct.
If two invocations try to write to the same address, like a
[race condition](https://wlandau.github.io/gpu/lectures/cudac-atomics/cudac-atomics.pdf),
then this could give us a false positive:

```scala
// 25 listed twice, but also jump over 26
List(23, 24, 25, 25, 27) // 5 elements, 27 - 23 + 1 = 5
```

So we also need to check for race conditions: addresses should be distinct for writes.
Reading from the same address should be OK.
Then we implement this logic to check addresses for races and coalescence:

```scala
enum Profile:
  case ReadProfile(id: TreeId, addresses: Seq[Int])
  case WriteProfile(buffer: GBuffer[?], addresses: Seq[Int])

enum Coalesce:
  case RaceCondition(profile: Profile)
  case Coalesced(startAddress: Int, endAddress: Int, profile: Profile)
  case NotCoalesced(profile: Profile)

object Coalesce:
  def apply(addresses: Seq[Int], profile: Profile): Coalesce =
    val size = addresses.length
    val distinct = addresses.distinct.length == size
    val (start, end) = (addresses.min, addresses.max)
    val coalesced = end - start + 1 == size
    profile match
      case WriteProfile(_, _) =>
        if !distinct then RaceCondition(profile)
        else if coalesced then Coalesced(start, end, profile)
        else NotCoalesced(profile)
      case ReadProfile(_, _, _) =>
        if coalesced && distinct then Coalesced(start, end, profile)
        else NotCoalesced(profile)
```

Then we add some logic to both the simulator and the interpreter
so that they can create and add instances of these profiles. For example:

```scala
def simReadBuffer(e: ReadBuffer[?], sc: SimContext): SimContext =
  val SimContext(results, records, data, profs) = sc // pattern matching to de-structure
  e match
    case ReadBuffer(buffer, index) =>
      // get read addresses, read the values, record the read operations
      val indices    = records.view.mapValues(_.cache(index.tree.treeid)).toMap
      val readValues = indices.view.mapValues(i => data.lookup(buffer, i)).toMap
      val newRecords = records.map: (invocId, record) =>
        val read = ReadBuf(e.treeid, buffer, indices(invocId), readValues(invocId))
        invocId -> record.addRead(read)

      // check if the read addresses coalesced or not
      val addresses = indices.values.toSeq
      val profile   = ReadProfile(e.treeid, addresses)
      val coalesce  = Coalesce(addresses, profile)

      SimContext(readValues, newRecords, data, coalesce :: profs) // return new context
```

Similar for writes and uniforms.

### Profiling branches

Recall the if / else if / else expressions of the DSL:

```scala
case class WhenExpr[T <: Value: Tag](
  when: GBoolean,                    // if
  thenCode: Scope[T],                // then
  otherConds: List[Scope[GBoolean]], // list of else if's
  otherCaseCodes: List[Scope[T]],    // list of then's
  otherwise: Scope[T],               // else
) extends Expression[T]
```

Invocations can evaluate `when` differently from each other.
Those that evaluate `true` will follow that branch and evaluate `thenCode`,
but others will have to idle and wait.
They perform a ["noop"](https://en.wikipedia.org/wiki/NOP_(code)) in that case.
Then the waiting invocations will try the next "else if" branch, and so on.

Here's a conceptual example with 4 invocations and 5 logic branches.
Invocation 1 enters the first branch immediately, the others wait.
Then invocations 0 and 2 evaluate `true` in the first `else if` branch.
Invocation 3 never evaluates `true`,
it keeps waiting all the way until the final `else` (here named `otherwise`):

|         |inv 0|inv 1|inv 2|inv 3|
|:-------:|:---:|:---:|:---:|:---:|
|when     |noop |enter|noop |noop |
|else1    |enter|noop |enter|noop |
|else2    |noop |noop |noop |noop |
|else3    |noop |noop |noop |noop |
|otherwise|noop |noop |noop |enter|

It is helpful to track the periods of idleness, which expression it happens on,
for which invocation, and for how long (and redesign our `Record` to include this):

```scala
case class Record(cache: Cache, writes: List[Write], reads: List[Read], idles: List[Idle])
case class Idle(treeid: TreeId, invocId: InvocId, length: Int)
```

We add the necessary logic to the simulator, where `WhenExpr` is simulated.
The code is quite complicated so I'll skip it here.

### Future work

There are some missing `Expression` types, such as external function calls,
`GSeq`s, and so on, which are not simulated properly yet.

The interpreter treats invocations as one linear sequence;
in the future it should accomodate more general concepts such as
[workgroups and dimensions](https://registry.khronos.org/OpenGL-Refpages/gl4/html/gl_WorkGroupSize.xhtml).

I'd like to generalize the interpreter to `GProgram`s that build on and go beyond `GIO`s.

## Reflections

The biggest struggle was the unbearable summer heat.

Putting that aside, the biggest issue was the unknown nature of the project.
A lot of things had to be figured out and required creativity.
Some of this was very abstract and general; I struggled not knowing what to do.
My mentor was very helpful in this regard (thank you so much again!).
He gave me small tasks to get me started and ideas to get me unstuck.

I also struggled with the time pressure and the deadline.
Not because I was behind in my work, but from fear of failure,
due to the unknown factors of the problems mentioned above.
It was very stressful and I was very anxious.
I realized I worried needlessly, and I need to learn not to worry so much.
Paradoxically, I ended up being ahead of schedule 😆
