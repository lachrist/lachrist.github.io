---
layout: post
title: "Next"
---

- Mutations is the reason why OOP is obsessed about encapsulation.
  Without it, directly accessing data is fine.
  It is hard to foresee all the different context in which a data will be accessed.
  Better to pick a representation and let the behaviors directly access it.
  The open-close principle is easy:
    - Adding fields is minimally invasive.
    - Additional behaviors are implemented as new function
    - Just implement another function acting on the data.
- What about state mutations.
  Programs are interactive and carries a state.
  But the transition can be
  ```haskell
  main :: IO ()
  main = run initial_state
  
  run :: State -> IO ()
  run state = do
    input <- read
    let (state', output) = step state input
    write output
    run state'

  step :: State -> Input -> (State, Output)
  ```
  It is hard to know before hand how to model 
  
- 

- State in functional programming is rejected to the runtime.
  Event-based functional programming: 
  Starts with `main :: IO ()` its returns an action.  
- To mutate state, addition is encouraged. That is to avoid reconstructing the entire state.The cheapest state mutation is addition.

```haskell
main :: IO ()
main = do
  event <- pullEvent

loop :: State -> IO ()
loop state1 = do
  event <- pullEvent
  let (state2, events) = loop state1 event
  in do dispatch events
        loop state2

run :: State -> Event -> (State, [Event])
```

```haskell
readFile :: Path -> IO Content

readFile :: Path -> (Content -> a) -> IO ()

copy :: Path -> Path -> IO ()
copy path1 path2 = readFile path1 >>= writeFile path2
```

```haskell
class Monad m where
  return :: a -> m a
  (>>=) :: m a -> (a -> m b) -> m b  
```

```haskell
type IO a = World -> (World, a)

class
```

```js
// step :: Event -> State -> (Effect, State)
const step = (state, event) => {
  if (event.id in state.callbacks) {
    return state.callbacks[events.id](state, event);
  } else {
  }
};

const initial = { counter: 0, callbacks: null };





```


```js
{
  type: "log",
  message: "hello-world",
}
```

```js
{
  type: "setTimeout",
  timeout: 1000,
  callback: () => {},
}
```

```js
{
  type: "listen",
  port: 8080,
  callback: (request, response) => {},
}
```

```js
{
  type: "read",
  path: "file.txt",
  callback: (content) => {},
}
```

```js
// readFile :: Path -> (Content -> Effect a) -> Effect a
const readFile = (path, callback) => ({
  type: "read",
  path,
  callback,
});

const writeFile :: Path -> Content -> (() -> Effect a) -> Effect a
writeFile = (path, content, callback) => ({
  type: "write",
  path,
  content,
  callback,
});

// copy :: Path -> Path -> (() -> Effect a) -> Effect a
const copy = (path1, path2, callback) => ({
  type: "read",
  path: path1,
  callback: (content) => ({
    type: "write",
    path: path2,
    content,
    callback,
  }),
});

// copy :: Path -> Path -> (() -> Effect a) -> Effect a
const copy = (path1, path2, callback) => readFile(
  path1,
  (content) => writeFile(path2, content, callback),
);
```

```js
const then = (promise, resolve) => ({
  ...promise,
  resolve: (result) => {
    const effect = promise.resolve();
    resolve();
  },
});
const copy = (path1, path2) => bind({
  type: "read",
  path: path1,
}, (content) => ({
  type: "write",
  path: path2,
  content,
}), (error) => {
  type: "panic",
  message: error.message,
});
```


```js
setTimeout(() => {}, 1000);
const mainAsync = () => {
  await setTimeout(() => {}, 1000);
}
```



# Promise

```javascript
// Runtime (impure) //
import { readFile, writeFile } from "node:fs/promises";

// Main (pure structure) //
const content = await readFile("file.txt", "utf8");
await Promise.all([
  writeFile("copy1.txt", content, "utf8"),
  writeFile("copy2.txt", content, "utf8"),
]);
```

Treat mutations as effects and use the `async/await` notation.

```javascript
// Runtime (impure) //

const createCounter = (value) => ({ value });
const increment = async (counter) => counter.value += 1; 

// Main (pretend pure) //
const counter = createCounter(0);
await console.log(await increment(counter));
await console.log(await increment(counter));
```
