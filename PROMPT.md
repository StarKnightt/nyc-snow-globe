# The brief

This is the prompt this project was built from. It was pasted into Cursor as a single message, and everything in the repository came out of it and out of the builder/critic loop it sets up.

---

> Build a real-time 3D snow globe of New York in the browser. Three.js (WebGPU with WebGL fallback), Vite, use pnpm for everything. Everything is made in code: no downloaded models, textures, HDRIs or audio. Any sound is synthesized from math.
>
> Use these skills where they help:
> - github.com/cloudai-x/threejs-skills
> - github.com/dgreenheck/webgpu-claude-skill
> - github.com/majidmanzarpour/threejs-game-skills
> - skills.sh
>
> THE SCENE
> - A glass snow globe on a wooden desk, soft light from a window. Clean, premium product-shot feel.
> - Inside: a tiny winter Manhattan. Empire State Building as the hero, brownstones, a slice of snowy Central Park trees, and yellow taxis that actually drive along the streets.
> - The glass must read as real glass: refraction of the city through it, fresnel reflections of the room and window, a subtle caustic on the desk.
> - A heavy wooden or brass base with soft contact shadow.
>
> THE INTERACTION
> - Grab and drag the globe to shake it. Snow swirls hard with real momentum, then slowly settles back over the city, with flakes piling lightly on rooftops and trees.
> - Thousands of flakes, GPU particles, each with tumble and drift. The water inside has a slight lag and slosh.
> - Slow auto-orbit camera when idle, scroll to zoom in toward the street level and taxis.
>
> /loop
> Run this gauntlet until the critic finds nothing left to fix:
> 1. Builder agent implements or improves the scene.
> 2. Builder takes screenshots from 6 fixed camera angles plus 3 mid-shake frames.
> 3. A separate critic agent (run sequentially, never in parallel) compares every screenshot against real photographs of glass snow globes, real Manhattan street photography in winter, and real product photography lighting. The critic lists every concrete difference that makes it look fake: glass thickness, refraction, snow size and density, building proportions, taxi color and scale, shadow softness, color temperature. No subjective "looks good" judgments, only differences from the real references.
> 4. Builder fixes every item on the critic's list, then repeat from step 2.
> Log each round's list of problems and how many were fixed.
>
> WHEN DONE
> - Write a short README with how it was built and the number of critic rounds.
> - Make an OG image of the snow globe mid-shake, used as the GitHub repo's social preview.

---

## What changed along the way

The brief was the starting point. After the initial daytime rounds passed the critic loop, the scene was steered into a **Cozy Winter Night** version at the user's request:

- **Night illumination from within.** The snow globe became the primary light source in a dark, warm room: 88% of building windows across the Empire State Building, the Chrysler Building, the Flatiron wedge, the midtown towers and the brownstones glow in warm yellow and amber, street lamps cast warm pools on the wet asphalt, and the twelve yellow taxis drive with headlights, street beams and red taillights on.
- **Warm glow and caustics on the walnut desk.** Warm golden light spills out of the globe onto the straight-grain walnut tabletop around the base, paired with organic refractive caustics and a dispersive cardioid caustic computed in the desk's TSL shader.
- **An out-of-focus night NYC window behind the desk.** A curved night window frames an out-of-focus New York skyline against a deep indigo winter sky, warm amber and cool sapphire bokeh circles, and soft snow falling outside.
- **Sparkling snow and mid-shake opening.** The 4,500 3D snow crystals catch the warm city glow and glint as they tumble, the scene opens mid-shake on the first frame, and a custom SVG loading screen tracks the procedural build stages on boot.
