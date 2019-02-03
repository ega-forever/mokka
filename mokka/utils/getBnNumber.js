module.exports = (number = 0)=>{
  number = number.toString(2);
  return number.padStart(64, '0');
};