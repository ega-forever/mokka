const path = require('path');
module.exports = {
  entry: './src/components/consensus/main.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist_web'),
    library: 'Mokka',
    libraryTarget: 'umd'
  }
};