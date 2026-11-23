# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-23

First public version.

### Added

- Particle life simulation in WebGPU compute shaders: 2 to 12 species, a K x K attraction
  matrix, short-range repulsion, velocity half-life friction, a toroidal world and a fixed
  20 ms timestep. Scales from 1,024 to 1,048,576 particles.
- Neighbour search through a uniform grid rebuilt every step on the GPU: clear, atomic count,
  multi-level exclusive scan, scatter, then forces from the 3 x 3 neighbouring bins.
- Brute-force O(N²) path kept as a baseline (`?method=brute`).
- Float64 CPU reference of every pass, with unit tests against an O(N²) step and Playwright
  tests comparing GPU output to it on a real GPU.
- HDR rendering: additive glow sprites in an `rgba16float` buffer, per-channel tone mapping,
  optional motion trails, a minimum sprite size with brightness compensation, and seamless
  drawing of the torus when zoomed out.
- Control panel with nine presets, a heatmap matrix editor, symmetric mode, particle and
  species steppers, physics and look sliders, and a pointer tool to pull, push or pan.
- Full state in the URL hash (seed, physics, matrix, look) with exact round-tripping.
- Keyboard shortcuts and a help overlay, a GPU timing HUD using timestamp queries, and a
  friendly page when WebGPU is unavailable.
- Benchmark (`npm run bench`) and media capture (`npm run capture`) scripts.
- CI (typecheck, unit tests, build, end-to-end) and GitHub Pages deployment.

[0.1.0]: https://github.com/AutumnTrace/tidepool/releases/tag/v0.1.0
