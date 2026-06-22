/**
 * GLB Optimizer — Local Web Server
 * Run: node server.mjs
 * Open: http://localhost:3000
 */

import http     from 'http';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';

import { NodeIO }         from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  simplify, weld, dedup, prune,
  flatten, resample, listTextureSlots,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = 3000;
const TMP_DIR   = path.join(__dirname, 'tmp');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// ── Extensions UE5 can't import ──────────────────────────────────────────────
const STRIP_EXTS = new Set([
  'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_texture_basisu',
]);

const DATA_SLOTS = new Set([
  'occlusionTexture','metallicRoughnessTexture','clearcoatRoughnessTexture',
  'transmissionTexture','thicknessTexture','specularTexture','sheenRoughnessTexture',
]);
const NORMAL_SLOTS = new Set(['normalTexture','clearcoatNormalTexture']);

// ── Wait for wasm engines ─────────────────────────────────────────────────────
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
console.log('✓ Compression engines ready');

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMeshStats(doc) {
  let verts = 0, tris = 0, meshCount = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    meshCount++;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (pos) verts += pos.getCount();
      if (idx) tris  += Math.floor(idx.getCount() / 3);
    }
  }
  return { verts, tris, meshCount };
}

function getDocStats(doc, fileSize) {
  const textures  = doc.getRoot().listTextures();
  const anims     = doc.getRoot().listAnimations().length;
  const skins     = doc.getRoot().listSkins().length;
  const meshStats = getMeshStats(doc);
  let texBytes    = 0;
  const texDetail = [];
  for (const t of textures) {
    const img  = t.getImage();
    const sz   = img ? img.length : 0;
    texBytes += sz;
    texDetail.push({
      name:   t.getName() || 'texture',
      mime:   t.getMimeType() || 'unknown',
      size:   sz,
    });
  }
  return {
    fileSize, texBytes, texCount: textures.length,
    texDetail, anims, skins,
    ...meshStats,
  };
}

async function hasRealAlpha(buf) {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.hasAlpha || meta.channels < 4) return false;
    const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const step = Math.max(4, Math.floor(data.length / (4 * 4096)));
    for (let i = 3; i < data.length; i += step * 4) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch { return false; }
}

async function compressTexture(tex, opts) {
  const imgData = tex.getImage();
  if (!imgData || imgData.length === 0) return 0;

  const origSize = imgData.length;
  const origMime = tex.getMimeType();
  const slots    = listTextureSlots(tex);
  const isData   = slots.some(s => DATA_SLOTS.has(s));
  const isNormal = slots.some(s => NORMAL_SLOTS.has(s));

  let meta;
  try { meta = await sharp(imgData).metadata(); }
  catch { return 0; }

  const maxPx = opts.texResize === '1K' ? 1024 : 2048;
  const needsResize = (meta.width || 0) > maxPx || (meta.height || 0) > maxPx;

  let pipeline = sharp(imgData);
  if (needsResize) {
    pipeline = pipeline.resize(maxPx, maxPx, {
      fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3,
    });
  }

  let compressed, mimeType;

  if (isData) {
    compressed = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    mimeType = 'image/png';
    if (compressed.length >= origSize && !needsResize) return 0;
  } else {
    const realAlpha = origMime === 'image/png' ? await hasRealAlpha(imgData) : false;
    if (realAlpha) {
      compressed = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      mimeType = 'image/png';
      if (compressed.length >= origSize && !needsResize) return 0;
    } else if (isNormal) {
      compressed = await pipeline.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
      mimeType = 'image/jpeg';
    } else {
      compressed = await pipeline.jpeg({ quality: 85, chromaSubsampling: '4:2:0' }).toBuffer();
      mimeType = 'image/jpeg';
    }
  }

  tex.setImage(compressed);
  tex.setMimeType(mimeType);
  return origSize - compressed.length;
}

// ── Core compression function ─────────────────────────────────────────────────
async function compressGLB(inputPath, outputPath, opts) {
  const readerIO = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

  const doc = await readerIO.read(inputPath);

  // Strip UE5-bad extensions
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (STRIP_EXTS.has(ext.extensionName)) ext.dispose();
  }

  const inputSize  = fs.statSync(inputPath).size;
  const statsBefore = getDocStats(doc, inputSize);

  const log = [];

  // STEP 1 — Mesh simplification
  if (opts.simplify) {
    const ratio = parseFloat(opts.simplifyRatio) || 0.5;
    const error = parseFloat(opts.simplifyError) || 0.01;
    const vBefore = statsBefore.verts;
    await doc.transform(
      weld({ tolerance: 0.0001 }),
      simplify({ simplifier: MeshoptSimplifier, ratio, error }),
    );
    const vAfter = getMeshStats(doc).verts;
    log.push(`Mesh: ${vBefore.toLocaleString()} → ${vAfter.toLocaleString()} vertices (${(((vBefore-vAfter)/vBefore)*100).toFixed(0)}% reduced)`);
  }

  // STEP 2 — Animation resample
  if (opts.resample && doc.getRoot().listAnimations().length > 0) {
    await doc.transform(resample());
    log.push(`Animations: keyframes resampled losslessly`);
  }

  // STEP 3 — Texture compression
  if (opts.texCompress || opts.texResize) {
    const textures = doc.getRoot().listTextures();
    let totalSaved = 0;
    for (const tex of textures) {
      totalSaved += await compressTexture(tex, opts);
    }
    log.push(`Textures: saved ${(totalSaved/1024/1024).toFixed(2)} MB from ${textures.length} texture(s)`);
  }

  // STEP 4 — Cleanup
  if (opts.cleanup) {
    await doc.transform(dedup(), prune(), flatten());
    log.push(`Cleanup: duplicates removed, scene flattened`);
  }

  // Write clean output (no meshopt encoding = UE5 safe)
  const writerIO = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await writerIO.write(outputPath, doc);

  const outputSize   = fs.statSync(outputPath).size;
  const statsAfter   = getDocStats(doc, outputSize);
  const savedBytes   = inputSize - outputSize;
  const savedPct     = ((savedBytes / inputSize) * 100).toFixed(1);

  return {
    ok: true,
    log,
    before: statsBefore,
    after:  statsAfter,
    savedBytes,
    savedPct,
  };
}

// ── Parse multipart body (no extra deps) ─────────────────────────────────────
function parseMultipart(body, boundary) {
  const parts = {};
  const boundaryBuf = Buffer.from('--' + boundary);
  let pos = 0;

  while (pos < body.length) {
    const boundaryIdx = body.indexOf(boundaryBuf, pos);
    if (boundaryIdx === -1) break;
    pos = boundaryIdx + boundaryBuf.length;
    if (body[pos] === 0x2d && body[pos+1] === 0x2d) break; // '--'
    if (body[pos] === 0x0d) pos += 2; // \r\n

    // Read headers
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerStr = body.slice(pos, headerEnd).toString();
    pos = headerEnd + 4;

    // Find next boundary
    const nextBoundary = body.indexOf(boundaryBuf, pos);
    const contentEnd   = nextBoundary === -1 ? body.length : nextBoundary - 2;
    const content      = body.slice(pos, contentEnd);
    pos = nextBoundary;

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    if (nameMatch) {
      parts[nameMatch[1]] = {
        value:    fileMatch ? null  : content.toString(),
        buffer:   fileMatch ? content : null,
        filename: fileMatch ? fileMatch[1] : null,
      };
    }
  }
  return parts;
}

// ── HTTP Server ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // Serve frontend
  if (req.method === 'GET' && url === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // Download compressed file
  if (req.method === 'GET' && url.startsWith('/download/')) {
    const filename = path.basename(url.replace('/download/', ''));
    const filepath = path.join(TMP_DIR, filename);
    if (fs.existsSync(filepath)) {
      res.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      fs.createReadStream(filepath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Serve compressed file for 3D preview
  if (req.method === 'GET' && url.startsWith('/preview/')) {
    const filename = path.basename(url.replace('/preview/', ''));
    const filepath = path.join(TMP_DIR, filename);
    if (fs.existsSync(filepath)) {
      res.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filepath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // Upload + compress
  if (req.method === 'POST' && url === '/compress') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const body     = Buffer.concat(chunks);
        const ct       = req.headers['content-type'] || '';
        const boundary = ct.split('boundary=')[1];
        if (!boundary) throw new Error('No boundary in multipart');

        const parts = parseMultipart(body, boundary);
        if (!parts.file?.buffer) throw new Error('No file uploaded');

        const opts = {
          simplify:      parts.simplify?.value      === 'true',
          simplifyRatio: parts.simplifyRatio?.value  || '0.5',
          simplifyError: parts.simplifyError?.value  || '0.01',
          texCompress:   parts.texCompress?.value    === 'true',
          texResize:     parts.texResize?.value      || 'none',
          resample:      parts.resample?.value       === 'true',
          cleanup:       parts.cleanup?.value        === 'true',
        };

        const origName     = parts.file.filename || 'model.glb';
        const baseName     = origName.replace(/\.glb$/i, '');
        const inputPath    = path.join(TMP_DIR, `in_${Date.now()}.glb`);
        const outputName   = `${baseName}_optimized.glb`;
        const outputPath   = path.join(TMP_DIR, outputName);

        fs.writeFileSync(inputPath, parts.file.buffer);

        const result = await compressGLB(inputPath, outputPath, opts);
        fs.unlinkSync(inputPath);

        // Clean up old tmp files (keep last 20)
        const tmpFiles = fs.readdirSync(TMP_DIR)
          .map(f => ({ f, t: fs.statSync(path.join(TMP_DIR, f)).mtimeMs }))
          .sort((a, b) => a.t - b.t);
        if (tmpFiles.length > 20) {
          tmpFiles.slice(0, tmpFiles.length - 20)
            .forEach(({ f }) => {
              try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch {}
            });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result, outputName }));
      } catch (err) {
        console.error('Compress error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════════════╗`);
  console.log(`  ║   GLB Optimizer is running!           ║`);
  console.log(`  ║   Open: http://localhost:${PORT}         ║`);
  console.log(`  ╚═══════════════════════════════════════╝\n`);
});
