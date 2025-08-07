# GSoC 2025

- [GSoC 2025](#gsoc-2025)
  - [Goals](#goals)
    - [Project goals](#project-goals)
    - [Long term personal goals for the future](#long-term-personal-goals-for-the-future)
  - [Learning the codebase, making first contributions](#learning-the-codebase-making-first-contributions)
  - [Fs2 integration](#fs2-integration)
    - [Challenges](#challenges)
    - [A "type bridge"](#a-type-bridge)
      - [Further work on type bridges](#further-work-on-type-bridges)
    - [fs2 mapping through Cyfra](#fs2-mapping-through-cyfra)
      - [Further work](#further-work)
  - [Cyfra Interpreter](#cyfra-interpreter)
    - [Simulating expressions, just one at a time](#simulating-expressions-just-one-at-a-time)
      - [Overcoming stack overflow](#overcoming-stack-overflow)
    - [Interpreting a GIO, one at a time](#interpreting-a-gio-one-at-a-time)
    - [Simulating invocations in parallel](#simulating-invocations-in-parallel)
    - [Interpreting invocations in parallel](#interpreting-invocations-in-parallel)
    - [Keeping track of reads and writes, and coalescence](#keeping-track-of-reads-and-writes-and-coalescence)
    - [Profiling branches](#profiling-branches)
    - [Future work](#future-work)
  - [Impressions and reflections](#impressions-and-reflections)

I participated in 2025's Google Summer of Code,
to contribute to [Cyfra](https://github.com/ComputeNode/cyfra/).

Cyfra is a DSL (in Scala 3) and runtime to do general programming on the GPU.
It compiles its DSL to SPIR-V assembly and runs it via Vulkan runtime on GPUs.

## Goals

### Project goals

- Add [fs2](https://fs2.io/) integration to Cyfra, so that
fs2 streams can be executed on the GPU via a pipeline.

- Create a Cyfra interpreter (to run on the CPU) that can
simulate Cyfra GPU programs for debugging and profiling.

### Long term personal goals for the future

I would like to create a GPU programming course suitable for beginners using Cyfra.

## Learning the codebase, making first contributions

During the bonding period, in order to get familiar with Cyfra, I:

- made some code refactors to the API:
  - [GArray refactor](https://github.com/ComputeNode/cyfra/pull/28)
  - [GMem refactor](https://github.com/ComputeNode/cyfra/pull/37)
- added [tests coverage](https://github.com/ComputeNode/cyfra/pull/44) and
- added [linting and Github Actions](https://github.com/ComputeNode/cyfra/pull/49).

During testing I was able to discover some bugs in the Cyfra compiler, which were fixed.

## Fs2 integration

Once the GSoC coding period started, I worked on how to run an fs2
[`Stream`](https://fs2.io/#/guide?id=building-streams) on Cyfra.

Fs2 has a `Pipe` type:

```scala
type Pipe[F[_], -I, +O] = Stream[F, I] => Stream[F, O]
```

which can then be used on a `Stream` with
[`.through`](https://www.javadoc.io/static/co.fs2/fs2-docs_2.13/3.12.0/fs2/Stream.html#through[F2[x]%3E:F[x],O2](f:fs2.Stream[F,O]=%3Efs2.Stream[F2,O2]):fs2.Stream[F2,O2]).

The idea is to create a sort of "Cyfra pipe".

### Challenges

The main challenge was the rapidly changing Cyfra API that was in development
in parallel to my project, and adapting to these changes (as an API user).

For my project in particular:

- The main challenge was the fact that, on the GPU side, we don't have Scala / JVM types.
- Therefore Cyfra has its own types in the DSL.
- But, fs2 uses Scala types, and has no knowledge of Cyfra's DSL.
  - Moreover, there is type erasure on the JVM to deal with!
  - So we have to use [tags](https://zio.dev/izumi-reflect/) for Cyfra custom types, and
  - [ClassTag](https://www.scala-lang.org/api/current/scala/reflect/ClassTag.html)
  for the Scala types.
- This caused issues when trying to allocate space on the GPU to run an fs2 stream.
- The basic data structure we use is `java.nio.ByteBuffer`.
- So, I needed a way to connect a Scala type and a Cyfra type.

I tried some approaches using
[Match types](https://docs.scala-lang.org/scala3/reference/new-types/match-types.html)
but could not make it work. Then I tried a
[typeclass](https://docs.scala-lang.org/scala3/book/ca-type-classes.html)
approach.

### A "type bridge"

```scala
trait Bridge[CyfraType <: Value: FromExpr: Tag, ScalaType: ClassTag]:
  def toByteBuffer(inBuf: ByteBuffer, chunk: Chunk[ScalaType]): ByteBuffer
  def fromByteBuffer(outBuf: ByteBuffer, arr: Array[ScalaType]): Array[ScalaType]
```

Here `Chunk` refers to [`fs2.Chunk`](https://fs2.io/#/guide?id=chunks),
a lower-level data structure that `fs2.Stream` is built on.

For example, we have these few basic bridges between Cyfra and Scala types:

```scala
// left: Cyfra type, right: Scala type
given Bridge[Int32, Int]:
  // ...
given Bridge[Float32, Float]:
  // ...
given Bridge[Vec4[Float32], fRGBA]:
  // ...
given Bridge[GBoolean, Boolean]:
  // ...
```

These bridge allows us to take a chunk of data from an fs2 `Stream`,
correctly measure the size we need to allocate for a `ByteBuffer`,
and after computation is done, putting it back into an fs2 `Stream`,
making sure everything type-checks correctly.

#### Further work on type bridges

Making these type bridges more polymorphic / generic would be very useful.

### fs2 mapping through Cyfra

After this obstacle, running an fs2 stream through a Cyfra pipe
still required some work, but it was fairly straightforward.
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

The core part of the code looks a bit like this:

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
for writing GPU programs.

#### Further work

I would like to implement more of fs2's streaming API on Cyfra, adding more methods.
This can be tricky. For example, implementing a `.filter` method requires doing a scan and
[stream compaction](https://developer.nvidia.com/gpugems/gpugems3/part-vi-gpu-computing/chapter-39-parallel-prefix-sum-scan-cuda).

We would like to generalize Cyfra pipes to any sort of data, not just fs2 `Stream`s.
That way Cyfra can be used with many types of streaming data.

## Cyfra Interpreter

I was ahead of schedule on my project;
also I had to wait a bit for some big changes to Cyfra's runtime API.
So I worked on a useful side project:
[making an interpreter](https://nrinaudo.github.io/articles/pl.html).

The interpreter was a much smoother project to work on.
It evolved gradually in stages:

- Simulating [expressions](https://github.com/ComputeNode/cyfra/blob/main/cyfra-dsl/src/main/scala/io/computenode/cyfra/dsl/Expression.scala):
the baseline of Cyfra's DSL
- Interpreting [GIO](https://github.com/ComputeNode/cyfra/blob/dev/cyfra-dsl/src/main/scala/io/computenode/cyfra/dsl/gio/GIO.scala):
Cyfra's [monad](https://en.wikipedia.org/wiki/Monad_(functional_programming))
type for GPU compute (which builds on expressions)
- Scaling the simulator to handle multiple
[invocations](https://registry.khronos.org/OpenGL-Refpages/gl4/html/gl_InvocationID.xhtml)
in parallel
- Propagating these changes to the interpreter (which builds on the simulator)
- Profiling reads in the simulator
- Profiling writes in the interpreter
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

At the end, most of them turn into `Float | Int | Boolean` or
`Vector[Float] | Vector[Int] | Vector[Boolean]`. Let's call this type `Result`.

The naive approach is to simply follow the recursive structure of the DSL. For example

```scala
case Sum(a, b) => simOne(a) + simOne(b)
```

This runs into the obvious problem of stack overflow due to recursion.

#### Overcoming stack overflow

The typical way to overcome stack overflow in cases like this is to rewrite it
using [tail recursion](https://en.wikipedia.org/wiki/Tail_call).
This can be difficult to do when the traversed structure isn't a simple list.
In our case we have an [AST](https://en.wikipedia.org/wiki/Abstract_syntax_tree).

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
def simOne(exprs: List[Expression[?]], cache: Map[TreeId, Result]): Result
```

But what about the topological sort? It's a fairly complex algorithm.
Thankfully, I did not have to implement that from scratch!
Cyfra's [compiler](https://github.com/ComputeNode/cyfra/tree/main/cyfra-compiler)
already has a topological sorter called `buildBlock`:

```scala
def buildBlock(tree: Expression[?], providedExprIds: Set[Int] = Set.empty): List[Expression[?]]
```

It consumes an `Expression` and returns a topo-sorted list of its entire AST.
Normally it is used to compile Cyfra to SPIR-V, but now it can pull double duty!

### Interpreting a GIO, one at a time

TODO

### Simulating invocations in parallel

TODO

### Interpreting invocations in parallel

TODO

### Keeping track of reads and writes, and coalescence

TODO

### Profiling branches

TODO

### Future work

There are some missing `Expression` types, such as external function calls,
`GSeq`s, and so on, which are not simulated properly yet.

The interpreter treats invocations as linear; in the future it should probably
accomodate concepts such as
[workgroups and dimensions](https://registry.khronos.org/OpenGL-Refpages/gl4/html/gl_WorkGroupSize.xhtml).

I'd like to generalize the interpreter to `GProgram`s that build on and go beyond `GIO`s.

## Impressions and reflections

The biggest struggle was the unbearable summer heat.

Putting that aside, the biggest issue was the unknown nature of the project.
A lot of things had to be figured out and required creativity.
Some of this was very abstract and general; I struggled not knowing what to do.
Without pinning down actual technical details first, I wasn't able to have a broad vision.
It's not so much an issue of problem solving skills (the "how");
it's about *not even knowing what the problem is* (the "what").
I realized that I am not very good at open-ended, research-like work.
I function much better if I am given clear tasks with details,
starting with small things where it is *known what needs to be done*.

I also struggled with the time pressure and the deadline.
Paradoxically, I ended up being ahead of schedule 😆
