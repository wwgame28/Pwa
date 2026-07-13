#!/usr/bin/env node
'use strict';

/**
 * Build a deterministic 16:9 illustration for every playable scene.
 *
 * The generator deliberately reuses the project's curated, non-explicit art
 * library.  A semantic matcher chooses the closest source image, while a
 * scene-id seed gives every output its own crop, grade, vignette and subtle
 * secondary exposure.  No captions or other text are painted into the art.
 *
 * Requirements: Node.js 18+ and ImageMagick 6/7 (`convert`).
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMAGE_ROOT = path.join(ROOT, 'assets', 'images');
const OUTPUT_ROOT = path.join(ROOT, 'assets', 'scene-art');
const EXPECTED_SCENES = 584;
const WIDTH = 960;
const HEIGHT = 540;
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.SCENE_ART_JOBS) || 4));

const PACKS = [
  'data/scenes.json',
  'data/expansion.json',
  'data/intimate-expansion.json',
];

const ART = {
  bus: ['act1_bus.webp'],
  checkpoint: [
    'master_checkpoint.webp', 'checkpoint_fedor.webp',
    'master_gates.webp', 'gates_closed.webp',
  ],
  courtyard: [
    'master_courtyard.webp', 'master_rooftop.webp',
    'checkpoint_fedor.webp', 'second_night.webp',
  ],
  administration: [
    'master_admin.webp', 'master_corridor.webp', 'master_dossier.webp',
    'master_window.webp', 'central_archive.webp', 'empty_seat.webp',
  ],
  dining: ['master_cafeteria.webp', 'cafeteria_night.webp', 'empty_seat.webp'],
  technical: [
    'master_generator.webp', 'generator.webp', 'master_garage.webp',
    'master_emergency.webp',
  ],
  archive: [
    'master_archive.webp', 'central_archive.webp',
    'master_dossier.webp', 'empty_seat.webp',
  ],
  radio: ['master_radio.webp', 'master_core.webp', 'generator.webp'],
  underground: [
    'master_tunnel.webp', 'master_door.webp', 'master_bunks.webp',
    'master_decon.webp', 'generator.webp',
  ],
  laboratory: [
    'master_lab.webp', 'master_medbay.webp', 'master_glass.webp',
    'master_decon.webp', 'central_archive.webp',
  ],
  meeting: [
    'master_trial.webp', 'master_gathering.webp', 'master_cafeteria.webp',
    'cafeteria_night.webp', 'empty_seat.webp',
  ],
  finale: [
    'master_core.webp', 'master_emergency.webp', 'master_gates.webp',
    'master_gathering.webp', 'master_glass.webp', 'zorin_glass.webp',
    'gates_closed.webp',
  ],
  aftermath: [
    'master_gathering.webp', 'master_rooftop.webp', 'master_window.webp',
    'zorin_glass.webp', 'act1_bus.webp', 'gates_closed.webp',
  ],
  intimate: Array.from({ length: 36 }, (_, index) =>
    `intimate_full_${String(index + 1).padStart(2, '0')}.webp`
  ),
};

const RULES = [
  ['bus', /автобус|дорог|сосны|трасс|шоссе/iu],
  ['radio', /радио|раци|передатчик|сервер|эфир|связ|динамик|антенн/iu],
  ['laboratory', /лаборатор|px[-–— ]?17|медблок|медпункт|изолятор|операцион|препарат|ампул|образец/iu],
  ['underground', /подзем|тоннел|шахт|люк|лестниц|гермозатвор|переход|убежищ/iu],
  ['archive', /архив|досье|картотек|папк|документ|протокол|хранилищ/iu],
  ['dining', /столов|кухн|кофе|термос|еда|чашк|поднос/iu],
  ['technical', /генератор|техническ|котельн|гараж|кабел|щиток|аварийн|электр|вентиляц|фильтр/iu],
  ['checkpoint', /кпп|ворот|контур|пропуск|пост охраны|шлагбаум|периметр/iu],
  ['courtyard', /двор|крыша|улиц|снаружи|площадк|внешн/iu],
  ['meeting', /совещан|допрос|суд|стол переговор|собрани|испытан|три правды/iu],
  ['aftermath', /после периметра|эпилог|новая игра|послеслов|спустя/iu],
  ['finale', /финал|выбор|развязк|правд|печать|систем|ложь|зорин|последн/iu],
  ['administration', /холл|администра|кабинет|коридор|комната|приёмн|зал/iu],
];

const TINTS = ['#7d927c', '#8a785f', '#647784', '#87717b', '#6f806c', '#7b6e61'];
// The allowlist is deliberately derived only from non-intimate semantic pools.
// Legacy UI/title cards never enter a pool and therefore cannot be selected,
// even when an old scene.image field still points at one of them.
const PHOTO_ART = new Set(
  Object.entries(ART)
    .filter(([category]) => category !== 'intimate')
    .flatMap(([, files]) => files)
);

function readScenes() {
  const scenes = PACKS.flatMap((relativePath) => {
    const payload = JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
    if (!Array.isArray(payload.scenes)) {
      throw new Error(`${relativePath} does not contain a scenes array`);
    }
    return payload.scenes;
  });

  if (scenes.length !== EXPECTED_SCENES) {
    throw new Error(`Expected ${EXPECTED_SCENES} scenes, found ${scenes.length}`);
  }
  if (new Set(scenes.map((scene) => scene.id)).size !== scenes.length) {
    throw new Error('Scene ids must be unique');
  }
  return scenes;
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function fileNameFor(scene) {
  const safe = String(scene.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!safe) throw new Error(`Cannot create a filename for scene ${scene.id}`);
  return `${safe}.webp`;
}

function sceneCorpus(scene) {
  return [scene.location, scene.title, scene.phase, scene.focus, scene.text]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function categoryFor(scene) {
  if (isIntimateContext(scene)) return 'intimate';
  const fields = [
    [scene.title, 7],
    [scene.phase, 5],
    [scene.location, 4],
    [String(scene.text || '').slice(0, 420), 3],
    [scene.text, 1],
  ];
  let best = null;
  for (let ruleIndex = 0; ruleIndex < RULES.length; ruleIndex += 1) {
    const [category, pattern] = RULES[ruleIndex];
    let score = 0;
    for (const [value, weight] of fields) {
      if (value && pattern.test(String(value).toLowerCase())) score += weight;
    }
    if (score > 0 && (!best || score > best.score || (score === best.score && ruleIndex < best.ruleIndex))) {
      best = { category, score, ruleIndex };
    }
  }
  if (best) return best.category;
  if (Number(scene.act) === 3) return 'finale';
  if (Number(scene.act) === 2) return 'underground';
  return 'administration';
}

function isIntimateContext(scene) {
  if (scene.kind === 'intimate' || /^INT(?:IMATE|_FULL)/i.test(scene.id)) return true;
  const ratedAdult = String(scene.content_rating || '').includes('18');
  const showerContext = /душ|раздевал|деконтам|промывоч|матов.*стекл/iu.test(
    [scene.location, scene.title, scene.phase].filter(Boolean).join(' ')
  );
  return ratedAdult && showerContext;
}

function explicitSource(scene) {
  if (!scene.image) return null;
  const absolute = path.resolve(ROOT, scene.image);
  if (!absolute.startsWith(`${IMAGE_ROOT}${path.sep}`) || !fs.existsSync(absolute)) {
    throw new Error(`Missing or unsafe image path in ${scene.id}: ${scene.image}`);
  }
  const baseName = path.basename(absolute);
  const safeIntimate = /^intimate_(?:full_|exact_)?\d+\.webp$/u.test(baseName);
  if (PHOTO_ART.has(baseName)) return absolute;
  if (isIntimateContext(scene) && safeIntimate) return absolute;
  return null;
}

function artPath(fileName) {
  const absolute = path.join(IMAGE_ROOT, fileName);
  if (!fs.existsSync(absolute)) throw new Error(`Missing source art: ${absolute}`);
  return absolute;
}

function sourcesFor(scene) {
  const seed = hash32(scene.id);
  const category = categoryFor(scene);
  const pool = ART[category];
  const explicit = explicitSource(scene);
  const primary = explicit || artPath(pool[seed % pool.length]);

  let secondaryPool = pool.map(artPath).filter((candidate) => candidate !== primary);
  if (!secondaryPool.length) {
    const fallbackCategory = Number(scene.act) === 3 ? 'finale' : Number(scene.act) === 2 ? 'technical' : 'administration';
    secondaryPool = ART[fallbackCategory].map(artPath).filter((candidate) => candidate !== primary);
  }
  const secondary = secondaryPool[hash32(`${scene.id}:secondary`) % secondaryPool.length];
  return { category, primary, secondary };
}

function convertArgs(scene, output) {
  const seed = hash32(scene.id);
  const { category, primary, secondary } = sourcesFor(scene);
  const cropX = seed % 81;
  const cropY = (seed >>> 7) % 46;
  const cropX2 = (seed >>> 13) % 81;
  const cropY2 = (seed >>> 19) % 46;
  const brightness = 96 + ((seed >>> 2) % 9);
  const saturation = category === 'intimate' ? 72 + ((seed >>> 6) % 12) : 74 + ((seed >>> 6) % 18);
  const hue = 96 + ((seed >>> 11) % 9);
  const contrast = (1.8 + ((seed >>> 16) % 15) / 10).toFixed(1);
  const opacity = category === 'intimate' ? 4 + ((seed >>> 21) % 4) : 7 + ((seed >>> 21) % 5);
  const tint = TINTS[(seed >>> 24) % TINTS.length];
  const tintStrength = 2 + ((seed >>> 28) % 4);
  const quality = 58 + (seed % 5);
  const edgeLevel = 45 + ((seed >>> 4) % 10);

  return [
    '(', primary,
      '-auto-orient', '-resize', '1040x585^', '-gravity', 'NorthWest',
      '-crop', `${WIDTH}x${HEIGHT}+${cropX}+${cropY}`, '+repage',
      '-modulate', `${brightness},${saturation},${hue}`,
      '-sigmoidal-contrast', `${contrast}x50%`,
    ')',
    '(', secondary,
      '-auto-orient', '-resize', '1040x585^', '-gravity', 'NorthWest',
      '-crop', `${WIDTH}x${HEIGHT}+${cropX2}+${cropY2}`, '+repage',
      '-modulate', '92,65,100', '-blur', '0x2.1',
      '-alpha', 'set', '-channel', 'A', '-evaluate', 'set', `${opacity}%`, '+channel',
    ')',
    '-compose', 'over', '-composite',
    '-fill', tint, '-colorize', `${tintStrength}%`,
    '(', '-size', `${WIDTH}x${HEIGHT}`, 'radial-gradient:white-black',
      '+level', `${edgeLevel}%,100%`,
    ')',
    '-compose', 'multiply', '-composite',
    '-strip',
    '-define', 'webp:method=6',
    '-define', 'webp:thread-level=1',
    '-quality', String(quality),
    output,
  ];
}

function validateOutput(scene, output) {
  const result = spawnSync('identify', ['-format', '%wx%h', output], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() !== `${WIDTH}x${HEIGHT}`) {
    throw new Error(
      `Invalid output for ${scene.id}: ${result.stdout.trim() || result.stderr.trim() || 'unreadable image'}`
    );
  }
}

function optimizeOversize(scene, output) {
  for (let attempt = 1; attempt <= 5 && fs.statSync(output).size > 25 * 1024; attempt += 1) {
    const candidate = `${output}.optimized-${attempt}.webp`;
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    const result = spawnSync('convert', [
      output, '-strip', '-define', 'webp:method=6', '-quality', '58', candidate,
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`Could not optimize ${scene.id}: ${result.stderr.trim()}`);
    }
    validateOutput(scene, candidate);
    if (fs.statSync(candidate).size < fs.statSync(output).size) {
      fs.renameSync(candidate, output);
    } else {
      fs.unlinkSync(candidate);
      break;
    }
  }
}

function outputIsValid(scene) {
  const output = path.join(OUTPUT_ROOT, fileNameFor(scene));
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) return false;
  try {
    validateOutput(scene, output);
    return true;
  } catch {
    return false;
  }
}

function runConvert(scene) {
  const output = path.join(OUTPUT_ROOT, fileNameFor(scene));
  return new Promise((resolve, reject) => {
    const child = spawn('convert', convertArgs(scene, output), { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ImageMagick failed for ${scene.id}: ${errors.trim()}`));
      } else {
        try {
          validateOutput(scene, output);
          optimizeOversize(scene, output);
          validateOutput(scene, output);
          resolve(output);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

async function mapConcurrent(items, limit, worker) {
  let cursor = 0;
  let completed = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) {
        process.stdout.write(`Generated ${completed}/${items.length}\n`);
      }
    }
  });
  await Promise.all(runners);
}

async function main() {
  const scenes = readScenes();
  const prefixIndex = process.argv.indexOf('--prefix');
  const prefix = prefixIndex >= 0 ? process.argv[prefixIndex + 1] : null;
  const repairOnly = process.argv.includes('--repair');
  const oversizeOnly = process.argv.includes('--oversize');
  if (prefixIndex >= 0 && !prefix) throw new Error('Usage: --prefix SCENE_ID_PREFIX');
  let selectedScenes = prefix
    ? scenes.filter((scene) => String(scene.id).toUpperCase().startsWith(prefix.toUpperCase()))
    : scenes;
  if (repairOnly) selectedScenes = selectedScenes.filter((scene) => !outputIsValid(scene));
  if (oversizeOnly) {
    selectedScenes = selectedScenes.filter((scene) => {
      const output = path.join(OUTPUT_ROOT, fileNameFor(scene));
      return fs.existsSync(output) && fs.statSync(output).size > 25 * 1024;
    });
  }
  if ((repairOnly || oversizeOnly) && !selectedScenes.length) {
    process.stdout.write('Nothing to repair; every requested output is valid and within target size.\n');
    return;
  }
  if (!selectedScenes.length) throw new Error(`No scenes matched prefix: ${prefix}`);

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  // Clean interrupted encoder candidates owned by this generator.
  for (const entry of fs.readdirSync(OUTPUT_ROOT)) {
    if (/\.webp\.optimized-\d+\.webp$/u.test(entry)) fs.unlinkSync(path.join(OUTPUT_ROOT, entry));
  }

  // A full build starts clean. A prefix build overwrites only matching scenes.
  if (!prefix && !repairOnly && !oversizeOnly) {
    for (const entry of fs.readdirSync(OUTPUT_ROOT)) {
      if (/^[a-z0-9_-]+\.webp$/u.test(entry)) fs.unlinkSync(path.join(OUTPUT_ROOT, entry));
    }
  }

  await mapConcurrent(selectedScenes, CONCURRENCY, runConvert);

  // Some ImageMagick 6 WebP builds occasionally leave an empty file under
  // parallel load while still returning exit code 0. Recheck the whole batch
  // and deterministically repair any such artifact one at a time.
  const invalid = selectedScenes.filter((scene) => !outputIsValid(scene));
  if (invalid.length) {
    process.stdout.write(`Repairing ${invalid.length} invalid outputs sequentially\n`);
    for (const scene of invalid) await runConvert(scene);
  }
  const stillInvalid = selectedScenes.filter((scene) => !outputIsValid(scene));
  if (stillInvalid.length) {
    throw new Error(`Invalid outputs remain: ${stillInvalid.map((scene) => scene.id).join(', ')}`);
  }

  const outputs = fs.readdirSync(OUTPUT_ROOT).filter((name) => name.endsWith('.webp'));
  if (!prefix && outputs.length !== EXPECTED_SCENES) {
    throw new Error(`Expected ${EXPECTED_SCENES} outputs, found ${outputs.length}`);
  }

  let bytes = 0;
  let overTarget = 0;
  for (const name of outputs) {
    const stat = fs.statSync(path.join(OUTPUT_ROOT, name));
    bytes += stat.size;
    if (stat.size > 25 * 1024) overTarget += 1;
  }

  process.stdout.write(
    `Done: generated ${selectedScenes.length}; library has ${outputs.length} scene images, ${WIDTH}x${HEIGHT}, ` +
    `${(bytes / 1024 / 1024).toFixed(2)} MiB total, ${overTarget} above 25 KiB.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
