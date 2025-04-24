const babel = require('@rollup/plugin-babel');
const resolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const terser = require('@rollup/plugin-terser');
const peerDepsExternal = require('rollup-plugin-peer-deps-external');
const postcss = require('rollup-plugin-postcss');

const packageJson = require('./package.json');

module.exports = {
  input: 'src/index.js',
  output: [
    {
      file: packageJson.main,
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: packageJson.module,
      format: 'esm',
      sourcemap: true,
    },
  ],
  plugins: [
    peerDepsExternal(),
    resolve({
      extensions: ['.js', '.jsx'],
    }),
    commonjs({
      include: 'node_modules/**',
      transformMixedEsModules: true
    }),
    babel({
      babelHelpers: 'bundled',
      exclude: 'node_modules/**',
      presets: [
        '@babel/preset-env',
        ['@babel/preset-react', { runtime: 'automatic' }]
      ]
    }),
    postcss({
      extensions: ['.css'],
      minimize: true,
      extract: false, // Keep CSS in JS bundle
      modules: false,
      inject: { insertAt: 'top' } // Inject styles into head tag
    }),
    terser(),
  ],
  external: ['react', 'react-dom', 'lucide-react'], // Explicitly add lucide-react
};