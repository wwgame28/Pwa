#!/usr/bin/env node
'use strict';

/**
 * Read-only integrity checks for the generated scene-art library.
 *
 * Requirements: Node.js 18+ and ImageMagick's `identify` executable.
 * This script never writes to the project.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(ROOT, 'data');
const IMAGE_ROOT = path.join(ROOT, 'assets', 'images');
const SCENE_ART_ROOT = path.join(ROOT, 'assets', 'scene-art');
const EXPECTED_SCENES = 584;
const EXPECTED_DIMENSIONS = '960x540';
const PACKS = [
  'data/scenes.json',
  'data/expansion.json',
  'data/intimate-expansion.json',
];

// Non-master photographic sources explicitly used by generate-scene-art.js.
const KNOWN_PHOTO_BASENAMES = new Set([
  'act1_bus.webp',
  'cafeteria_night.webp',
  'central_archive.webp',
  'checkpoint_fedor.webp',
  'empty_seat.webp',
  'gates_closed.webp',
  'generator.webp',
  'second_night.webp',
  'zorin_glass.webp',
]);

const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(absolutePath, label) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`${label}: cannot read valid JSON (${error.message})`);
    return null;
  }
}

function sceneArtName(sceneId) {
  const safe = String(sceneId).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `${safe}.webp`;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function isAllowedPhotoBasename(basename) {
  return (
    /^master_[a-z0-9_-]+\.webp$/iu.test(basename) ||
    /^intimate_[a-z0-9_-]+\.webp$/iu.test(basename) ||
    /^scene_exact_[a-z0-9_-]+\.webp$/iu.test(basename) ||
    KNOWN_PHOTO_BASENAMES.has(basename)
  );
}

function extractFunctionBody(source, functionName) {
  const signature = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const match = signature.exec(source);
  if (!match) return null;

  const openingBrace = match.index + match[0].lastIndexOf('{');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }
  return null;
}

function stripStringsAndComments(source) {
  let result = '';
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        result += '  ';
        blockComment = false;
        index += 1;
      } else {
        result += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      result += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (character === '/' && next === '/') {
      result += '  ';
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      result += '  ';
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      result += ' ';
      continue;
    }
    result += character;
  }
  return result;
}

function loadScenes() {
  const scenes = [];
  for (const relativePath of PACKS) {
    const payload = readJson(path.join(ROOT, relativePath), relativePath);
    if (!payload) continue;
    if (!Array.isArray(payload.scenes)) {
      fail(`${relativePath}: expected a scenes array`);
      continue;
    }
    scenes.push(...payload.scenes);
  }

  if (scenes.length !== EXPECTED_SCENES) {
    fail(`scene packs: expected ${EXPECTED_SCENES} scenes, found ${scenes.length}`);
  }

  const seen = new Map();
  for (const scene of scenes) {
    if (!scene || typeof scene.id !== 'string' || !scene.id.trim()) {
      fail('scene packs: found a scene without a non-empty string id');
      continue;
    }
    if (seen.has(scene.id)) {
      fail(`scene packs: duplicate id ${scene.id}`);
    } else {
      seen.set(scene.id, scene);
    }
  }
  return { scenes, byId: seen };
}

function auditSceneArt(scenes) {
  const identifyVersion = spawnSync('identify', ['-version'], { encoding: 'utf8' });
  const identifyAvailable = identifyVersion.status === 0;
  if (!identifyAvailable) {
    fail(`scene art: ImageMagick identify is unavailable (${identifyVersion.error?.message || identifyVersion.stderr?.trim() || 'unknown error'})`);
  }

  let present = 0;
  let nonEmpty = 0;
  let correctDimensions = 0;
  const hashes = new Map();

  for (const scene of scenes) {
    if (!scene || typeof scene.id !== 'string' || !scene.id.trim()) continue;
    const artPath = path.join(SCENE_ART_ROOT, sceneArtName(scene.id));
    let stat;
    try {
      stat = fs.statSync(artPath);
    } catch {
      fail(`scene art: missing ${path.relative(ROOT, artPath)} for ${scene.id}`);
      continue;
    }
    if (!stat.isFile()) {
      fail(`scene art: expected a file at ${path.relative(ROOT, artPath)} for ${scene.id}`);
      continue;
    }
    present += 1;
    if (stat.size <= 0) {
      fail(`scene art: ${path.relative(ROOT, artPath)} is empty`);
      continue;
    }
    nonEmpty += 1;

    if (identifyAvailable) {
      const identified = spawnSync('identify', ['-format', '%wx%h', artPath], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      const dimensions = identified.stdout?.trim();
      if (identified.status !== 0) {
        fail(`scene art: identify failed for ${scene.id} (${identified.stderr?.trim() || identified.error?.message || 'unknown error'})`);
      } else if (dimensions !== EXPECTED_DIMENSIONS) {
        fail(`scene art: ${scene.id} is ${dimensions || 'unknown size'}, expected ${EXPECTED_DIMENSIONS}`);
      } else {
        correctDimensions += 1;
      }
    }

    try {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(artPath)).digest('hex');
      const ids = hashes.get(digest) || [];
      ids.push(scene.id);
      hashes.set(digest, ids);
    } catch (error) {
      fail(`scene art: cannot hash ${scene.id} (${error.message})`);
    }
  }

  const duplicateGroups = [...hashes.values()].filter((ids) => ids.length > 1);
  for (const ids of duplicateGroups) {
    fail(`scene art: identical SHA-256 shared by ${ids.join(', ')}`);
  }
  if (scenes.length === EXPECTED_SCENES && hashes.size !== EXPECTED_SCENES) {
    fail(`scene art: expected ${EXPECTED_SCENES} unique SHA-256 hashes, found ${hashes.size}`);
  }

  return {
    present,
    nonEmpty,
    correctDimensions,
    uniqueHashes: hashes.size,
    duplicateGroups: duplicateGroups.length,
    identifyAvailable,
  };
}

function auditOverrides(byId) {
  let overrideFiles = [];
  try {
    overrideFiles = fs.readdirSync(DATA_ROOT)
      .filter((name) => /^art-overrides-.*\.json$/u.test(name))
      .sort();
  } catch (error) {
    fail(`overrides: cannot list data directory (${error.message})`);
  }

  let entries = 0;
  for (const fileName of overrideFiles) {
    const relativeFile = `data/${fileName}`;
    const payload = readJson(path.join(DATA_ROOT, fileName), relativeFile);
    if (!payload) continue;
    if (Array.isArray(payload) || typeof payload !== 'object') {
      fail(`${relativeFile}: expected an object mapping scene ids to image paths`);
      continue;
    }

    for (const [sceneId, sourcePath] of Object.entries(payload)) {
      entries += 1;
      if (!byId.has(sceneId)) {
        fail(`${relativeFile}: unknown scene id ${sceneId}`);
      }
      if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
        fail(`${relativeFile}: ${sceneId} has a non-string or empty source path`);
        continue;
      }

      const absoluteSource = path.resolve(ROOT, sourcePath);
      if (!isInside(IMAGE_ROOT, absoluteSource)) {
        fail(`${relativeFile}: ${sceneId} source escapes assets/images (${sourcePath})`);
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(absoluteSource);
      } catch {
        fail(`${relativeFile}: ${sceneId} source does not exist (${sourcePath})`);
        continue;
      }
      if (!stat.isFile()) {
        fail(`${relativeFile}: ${sceneId} source is not a file (${sourcePath})`);
        continue;
      }

      const basename = path.basename(absoluteSource);
      if (!isAllowedPhotoBasename(basename)) {
        fail(`${relativeFile}: ${sceneId} uses a disallowed legacy/UI source (${sourcePath})`);
      }
    }
  }
  return { files: overrideFiles.length, entries };
}

function auditFilmstripRemoval() {
  const indexPath = path.join(ROOT, 'index.html');
  const appPath = path.join(ROOT, 'app.js');
  let indexSource = '';
  let appSource = '';

  try {
    indexSource = fs.readFileSync(indexPath, 'utf8');
  } catch (error) {
    fail(`UI check: cannot read index.html (${error.message})`);
  }
  try {
    appSource = fs.readFileSync(appPath, 'utf8');
  } catch (error) {
    fail(`UI check: cannot read app.js (${error.message})`);
  }

  if (/sceneFilmstrip/u.test(indexSource)) {
    fail('UI check: index.html still contains sceneFilmstrip');
  }
  if (/filmstrip\.css/u.test(indexSource)) {
    fail('UI check: index.html still loads filmstrip.css');
  }

  const renderSceneBody = extractFunctionBody(appSource, 'renderScene');
  if (renderSceneBody === null) {
    fail('UI check: could not locate a complete renderScene function in app.js');
  } else if (/\brenderFilmstrip\s*\(/u.test(stripStringsAndComments(renderSceneBody))) {
    fail('UI check: renderScene still calls renderFilmstrip');
  }

  return {
    indexHasSceneFilmstrip: /sceneFilmstrip/u.test(indexSource),
    indexLoadsFilmstripCss: /filmstrip\.css/u.test(indexSource),
    renderSceneCallsFilmstrip: renderSceneBody === null
      ? null
      : /\brenderFilmstrip\s*\(/u.test(stripStringsAndComments(renderSceneBody)),
  };
}

function main() {
  const { scenes, byId } = loadScenes();
  const art = auditSceneArt(scenes);
  const overrides = auditOverrides(byId);
  const ui = auditFilmstripRemoval();

  process.stdout.write('Perimeter scene-art QA\n');
  process.stdout.write(`  Scenes: ${scenes.length}/${EXPECTED_SCENES}; unique ids: ${byId.size}\n`);
  process.stdout.write(
    `  Scene art: present ${art.present}/${EXPECTED_SCENES}; non-empty ${art.nonEmpty}/${EXPECTED_SCENES}; ` +
    `dimensions ${art.identifyAvailable ? `${art.correctDimensions}/${EXPECTED_SCENES}` : 'not checked'}\n`
  );
  process.stdout.write(
    `  SHA-256: ${art.uniqueHashes}/${EXPECTED_SCENES} unique; duplicate groups: ${art.duplicateGroups}\n`
  );
  process.stdout.write(`  Overrides: ${overrides.files} file(s), ${overrides.entries} entries checked\n`);
  process.stdout.write(
    `  Filmstrip removal: index hook=${ui.indexHasSceneFilmstrip ? 'present' : 'absent'}, ` +
    `CSS=${ui.indexLoadsFilmstripCss ? 'present' : 'absent'}, ` +
    `renderScene call=${ui.renderSceneCallsFilmstrip === null ? 'unknown' : ui.renderSceneCallsFilmstrip ? 'present' : 'absent'}\n`
  );

  if (errors.length) {
    process.stderr.write(`\nFAIL: ${errors.length} problem(s) found\n`);
    for (const error of errors) process.stderr.write(`  - ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nPASS: all scene-art integrity checks passed.\n');
}

main();
