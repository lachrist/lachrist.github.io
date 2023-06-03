
```js
const insert = (map, key, val) => new Map([...map, [key, val]]);

const insertFaster = (map, key, val) => {
  const copy = new Map(map);
  copy.set(key, val);
  return copy;
};
```