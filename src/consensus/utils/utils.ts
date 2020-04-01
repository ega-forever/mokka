export const getCombinations = (elements, n, pairs = [], pair = []) => {
  return elements.reduce((accumulator, val, index) => {

    pair.push(val);

    if (n > 1) {
      getCombinations(elements.slice(index + 1), n - 1, accumulator, pair);
    } else {
      accumulator.push([...pair]);
    }

    pair.pop();
    return accumulator;
  }, pairs);
};
