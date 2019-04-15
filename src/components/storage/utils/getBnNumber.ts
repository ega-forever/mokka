export default (nmb: number = 0) => {
  const strNumber = nmb.toString(2);
  return strNumber.padStart(64, '0');
};
