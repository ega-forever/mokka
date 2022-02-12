const path = require('path');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin")

module.exports = {
  entry: './src/consensus/main.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new NodePolyfillPlugin(),
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      reportFilename: path.join(__dirname, 'webpack_report.html')
    })
  ],
  resolve: {
    extensions: ['.ts', '.js']
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist', 'web'),
    library: 'Mokka',
    libraryTarget: 'umd'
  }
};