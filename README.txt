# GLB Optimizer — Local Web App
## For Unreal Engine 5

A local web tool to compress .glb 3D models with a live 3D preview and before/after stats.

---

## Setup (one time only)

1. Put ALL these files in one folder:
   - `server.mjs`
   - `index.html`
   - `package.json`

2. Open a terminal in that folder and run:
   ```
   npm install
   ```
   This takes 1-2 minutes. You only do this once.

---

## Run it

Every time you want to use it:

```
node server.mjs
```

Then open your browser and go to:
```
http://localhost:3000
```

To stop the server, press Ctrl+C in the terminal.

---

## How to use

1. **Upload** — drop your .glb file onto the upload zone
2. **Choose options** — toggle what compression steps to apply
3. **Set simplify ratio** — 50% is a good start. Lower = smaller file, less detail
4. **Click Optimize** — wait for processing (big models take 30-60 seconds)
5. **View result** — 3D model loads, rotate with mouse, check stats
6. **Download** — click the green button to save the optimized .glb

---

## Options explained

| Option | What it does | When to use |
|--------|-------------|-------------|
| Mesh Simplification | Reduces polygon count | Always — biggest size win for geometry-heavy models |
| Texture Compression | PNG → JPEG (60-80% smaller) | Always — huge win if Meshy exported PNG textures |
| Texture Resize | Caps textures at 2K or 1K | Use 2K for quality, 1K for maximum compression |
| Animation Resample | Reduces animation keyframe data | Enable if model has animations/bones |
| Remove Unused Data | Deletes duplicates and empty nodes | Always — safe and free size reduction |

---

## Simplify Ratio guide

| Ratio | Vertices kept | Expected size reduction | Quality |
|-------|--------------|------------------------|---------|
| 75%   | 75%          | ~35-45%                | Nearly identical |
| 50%   | 50%          | ~50-60%                | Good, minor loss |
| 25%   | 25%          | ~65-75%                | Visible, acceptable |

---

## Tips

- Check the compressed model at https://gltf.report before importing to UE5
- Wireframe button shows polygon density
- Auto Rotate lets you inspect the model from all angles
- Output is always UE5-compatible (no meshopt, no WebP, no Draco)
