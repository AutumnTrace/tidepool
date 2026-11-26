# Devlog

Notes from building tidepool: the things that didn't go as planned, and the numbers that changed my mind. Everything here happened in this build; the measurements are from the machine in the README (RTX 5070, Chrome 157, Windows 11).

## Getting a real GPU into the tests

The plan was Playwright driving the installed Chrome (`channel: 'chrome'`), headless if possible. My first probe opened `about:blank` and asked for an adapter: `navigator.gpu` was simply undefined. WebGPU is only exposed in secure contexts, and that blank page didn't count. Loading the app from `http://localhost` (which is treated as secure) gave a real adapter straight away, vendor `nvidia`, architecture `blackwell`, `isFallbackAdapter` false, with `--enable-unsafe-webgpu` and no other flags. So the tests and benchmarks run headless.

Every page load prints a console warning that `powerPreference` is ignored by `requestAdapter()` on Windows ([crbug.com/369219127](https://crbug.com/369219127)). On this machine there's only one real GPU so it doesn't matter, but on a laptop with hybrid graphics the OS decides, not the page.

One more test-environment surprise, much later: Playwright's web server failed to start because port 4173, Vite's default preview port, was already taken by another project's preview server on the same machine, listening on IPv6 only. Playwright's "is a server already running?" check didn't see it and its own server couldn't bind. The tests, benchmark and capture scripts now use their own unusual ports.

## Brute force first

The first commit had no grid at all: one compute pass, every particle against every other, streamed through workgroup memory 256 at a time. It was worth having. At 65k particles it took 9.5 ms per step a few seconds after spawning (and 11.0 ms in the later benchmark, once the particles had clumped and more pairs fell inside the radius and took the expensive branch). That's the number the grid had to beat, and it stays in the app behind `?method=brute`, which also makes it a second opinion in the tests: the brute-force GPU path is checked against the brute-force CPU path.

## The scan worked the first time, so I didn't trust it

The multi-level prefix sum (1024 elements per workgroup, block totals scanned recursively, offsets added back down) passed a bit-exact comparison against a CPU scan on its first run, for lengths from 1 up to 3 million (1, 3, 1023, 1024, 1025, 4096, 70,000, 1,048,577 and 3,000,000). That made me suspicious that the multi-level path wasn't actually running, so the end-to-end test also asserts how many levels each length used: 1024 elements is one level, 1025 is two, 1,048,577 is three. It was running.

The things that made it easy were decided up front: every level is padded to a multiple of 1024 so there's no ragged last block, values past the real length are masked to zero when loaded instead of relying on the padding being clean, and the bin buffer has one extra always-empty bin so that `binStart[b + 1]` is the end of every bin, including the last.

## How close is "matches the CPU"?

After one step of 4,096 particles the largest position difference between the GPU and the float64 reference was 1.91e-6. That world is about 20.7 units across, and between 16 and 32 one f32 ulp is 2^-19 ≈ 1.91e-6. So after one step the GPU is off by exactly one rounding of the stored position, which is about as good as it can get. After ten steps it was 4.3e-6. The tests assert 1e-5 and 1e-4 respectively, with headroom for other GPUs and drivers.

Matching particles up needed one decision early on: the GPU reorders particles every step, so each particle carries an id in the upper 28 bits of its tag (the species is in the lower four). The CPU reference re-indexes both sides by id before comparing.

## Timestamps were finer than I expected

I'd read that Chrome quantises timestamp queries to 100 µs unless a developer flag is set, and wrote the HUD to average over a window expecting mostly zeros for the small passes. The raw values in Chrome 157 here came back in steps of 32 ns (0.002048 ms, 0.002080 ms, 0.001984 ms for the clear pass), so the averages are much more meaningful than planned. The averaging stayed anyway.

## Picking a density by looking at contact sheets

The first default was 30 neighbours per interaction radius, which seemed generous. It produced a uniform speckle of tiny clusters at any sensible zoom. Rather than guess, I wrote a throwaway harness that loads the app with a URL hash per candidate, steps it 900 to 1,500 times with nothing rendered in between, screenshots it and tiles the shots into one image. Comparing densities side by side made it obvious: around 80 is where the classic particle-life structures (membranes, rings, worms) show up. 120 was richer still, but the force pass does work in proportion to density, so 80 it is.

The same harness found the presets. A trick that saved a lot of time: 16,384 particles in a 640 × 360 screenshot covers about the same number of interaction radii per pixel as 65,536 particles at 1280 × 720, so I could render 16 small candidates per sheet and still see what the real thing would look like. To tell "beautiful but frozen" from "beautiful and moving" in a still, the harness also read back the velocities and printed the mean speed under each tile: symmetric matrices consistently came out near zero, which is the physics working (no energy source) rather than a bug.

## A rounding bug in the URL code, caught by a property test

The URL round-trip test encodes 200 random states and checks that decoding gives back exactly the same object. It failed on the first run: a speed of 3.25 came back as 3.3. `snap()` worked out how many decimals to keep from `log10(step)`, which for a step of 0.25 gives one decimal instead of two. It now counts the digits after the decimal point in the step itself.

## The speedup that was a bug

Moving the attraction matrix out of the uniform buffer and into workgroup memory was the first optimisation I tried on the force pass. I named the matrix row offset `row`, and the benchmark came back with the force pass at a million particles dropping from 4.53 ms to 0.98 ms. That was too good. The force loop already had a `let row = u32(y) * P.grid` inside the loop over neighbouring rows, and WGSL lets an inner scope shadow an outer `let` without complaint, so every particle was reading the matrix row of whatever grid row it happened to be looking at. Physically nonsense, but it ran fine and still looked like particle life.

With the grid variable renamed, the real result was 4.53 ms down to 3.75 ms. I put the bug back temporarily to check that the GPU-vs-CPU test would have caught it: it fails with a maximum velocity difference of 1.1 against a tolerance of 1e-4. Good to know, but the lesson is to run the correctness tests before reading the benchmark.

## What actually moved the force pass

All at a million particles, Tidepool preset, one benchmark run each:

| Change | Forces pass |
|---|---:|
| Matrix read from the uniform buffer | 4.53 ms |
| Matrix copied into workgroup memory | 3.75 ms |
| Workgroup size 64 / 128 / 256 | 3.84 / 3.74 / 3.75 ms |
| `inverseSqrt(r²)` instead of `sqrt` and a divide | 3.49 ms |

Workgroup size made no difference I could separate from run-to-run noise, so it's 128. The matrix move matters because neighbouring threads look up different columns: indexing a uniform array with a per-thread index is exactly the access pattern constant caches handle worst.

The bigger lever isn't in the shader at all. The same million particles cost 0.99 ms in the force pass with the Necklaces preset and 4.49 ms with Swimmers, because Swimmers packs everything into dense clumps and each particle has to look at 693 candidates instead of 233. The grid keeps the cost proportional to local crowding, but it can't make a crowded neighbourhood cheap. Per candidate the cost is close to flat across particle counts: from 262k to 1M particles the force pass went from 0.82 to 3.54 ms, 4.3 times as long for 4 times the particles and 5% more candidates each.

16k particles is the one size that doesn't fit the pattern (0.27 ms, against 0.41 ms for four times as many). My guess is that 128 workgroups simply aren't enough to keep the GPU busy, but I haven't profiled it.

## Drawing the torus

The first version of torus tiling drew every particle once per world-sized tile that touched the screen. In the default view the world exactly fills the screen width, and with a sprite radius of margin on each side that touches three tiles horizontally, so a million particles meant three million instances, two thirds of them thrown away in the vertex shader. Working out how many images of a single particle the visible span can actually hold (two, in that view) and stepping from the first image at the span's edge brought the draw pass at a million particles from 2.02 ms to 1.43 ms.

## Tuning the look

Switching to an HDR buffer with a tone curve changed how big sprites should be. The first try (a half-size of 0.42 interaction radii with a strong halo) turned every preset into pastel foam; overlapping halos pushed everything towards white. 0.3 with a much fainter halo kept particles distinct and still lets real clusters bloom.

Trails had a similar problem. A still particle under a fade of 0.9 per frame settles at ten times its normal brightness. Scaling each frame's contribution by `(1 - trails)^0.6` still washed out at 0.9, and `^0.85` looks right: still things stay about as bright as without trails, and moving particles leave a visible tail.

## Getting the GIF under 5 MB

Sizes here are MiB, as the capture script prints them. The first hero GIF was 20.2 MiB: 150 frames at 640 × 360 with a 256-colour palette, recorded from the moment of spawning. What brought it down, in order:

- 560 × 315, 120 frames, 128 colours, and flattening near-black pixels to pure black before quantising: 10.1 MiB. The composite pass deliberately adds half an 8-bit step of noise to hide banding; in a GIF that noise is invisible and incompressible.
- Starting the recording after 700 steps instead of near the spawn, with 100 frames: 6.7 MiB. The first few hundred steps are a dense, noisy soup, which is the worst case for LZW.
- 64 colours, from one shared palette sampled across the clip so colours don't flicker between frames: 5.4 MiB.
- Marking pixels whose palette index didn't change as transparent: 5.25 MiB. Only about 2%, because with trails on nearly every pixel near a particle changes every frame.
- 512 × 288: 4.3 MiB.

The trajectories aren't bit-reproducible (see the README's known gaps), so every recording differs a little and the size wandered between 4.3 and 4.7 MiB across runs of the 100-frame version. The script now records 90 frames to leave some margin; the committed GIF is 4.2 MiB (4.4 MB).

## A starting count from a one-second probe

The probe times frames at 65,536 particles, throws away the first 20 timed frames while clocks settle, averages the next 40, and extrapolates linearly. On the RTX 5070 in headless Chrome it measures about 0.12 ms per simulation step, 0.12 ms for the sprite pass and 0.01 ms for compositing, and picks 262,144, the top of the automatic range.

Linear is pessimistic there. The benchmark table has GPU time per frame going from 0.61 ms at 65,536 particles to 1.24 ms at 262,144: twice the cost for four times the particles, so at these sizes a large share of the time does not grow with the count. A guess that errs low is the right failure for a first impression. The range stops at 262,144 on purpose: the presets were tuned around the default, and a million particles is still one key press away.

Automated browsers don't probe unless the URL asks for it (`?probe=1`), so the end-to-end tests and the benchmark keep starting at 65,536 particles.
