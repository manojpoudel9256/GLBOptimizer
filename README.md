# GLB Optimizer — Local Web App
## For Unreal Engine 5

A lightweight local web tool for compressing `.glb` 3D models with live preview, size comparison, and UE5-compatible output.

---

## Quick Start

1. Place these files in the same folder:
   - `server.mjs`
   - `index.html`
   - `package.json`

2. Open a terminal in that folder and run:
   ```powershell
   npm install
   ```

3. Start the app:
   ```powershell
   node server.mjs
   ```

4. Open your browser and visit:
   ```text
   http://localhost:3000
   ```

5. To stop the server, press `Ctrl+C`.

---

## How it works

- Upload a `.glb` file
- Choose compression options
- Preview the optimized model in 3D
- Download the final `.glb`

This makes it easy to reduce file size before importing assets into Unreal Engine 5.

---

## User Guide

1. **Upload** your `.glb` file using the upload area.
2. **Choose options** for mesh simplification, texture compression, and more.
3. **Set simplify ratio** — `50%` is a good default.
4. **Click Optimize** and wait for the process to finish.
5. **Preview** the optimized model in the built-in viewer.
6. **Download** the optimized `.glb` file.

---

## Options Explained

| Option | What it does | Best use case |
|--------|-------------|---------------|
| Mesh Simplification | Reduces polygon count | Use for geometry-heavy models |
| Texture Compression | Converts textures to smaller formats | Use when textures are large |
| Texture Resize | Limits texture resolution | Use 2K for quality, 1K for smaller size |
| Animation Resample | Shrinks animation keyframe data | Enable only for animated models |
| Remove Unused Data | Removes unused nodes, meshes, and metadata | Always enable for extra savings |

---

## Simplify Ratio Guide

| Ratio | What it keeps | Expected result |
|-------|---------------|-----------------|
| 75% | Most detail | Moderate compression, high quality |
| 50% | Good balance | Strong compression, good quality |
| 25% | Maximum reduction | Smaller file, noticeable detail loss |

---

## Tips

- View the output in `http://localhost:3000` before downloading.
- Use the preview controls to rotate and inspect the optimized mesh.
- Smaller textures and fewer vertices generally produce the biggest file reduction.
- This tool is designed to generate UE5-friendly `.glb` files.

---

## Notes

- Install dependencies only once with `npm install`.
- If the app does not open, check for Node.js and package installation issues.
- The optimized file is ready to import into Unreal Engine 5.
