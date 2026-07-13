#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((value, index, list) => {
  if (!value.startsWith('--')) return [value, true];
  const key = value.slice(2);
  const next = list[index + 1];
  return [key, next && !next.startsWith('--') ? next : true];
}));
const shardCount = Math.max(1, Number(args.shards) || 1);
const shardIndex = Math.max(0, Number(args.shard) || 0);
if (shardIndex >= shardCount) throw new Error(`Shard ${shardIndex} is outside 0..${shardCount - 1}`);

const readText = file => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = file => JSON.parse(readText(file));
const base = readJson('data/scenes.json');
const expansion = readJson('data/expansion.json');
const intimate = readJson('data/intimate-expansion.json');
const documentsRaw = readJson('data/documents.json');
const documents = documentsRaw.documents || documentsRaw;
const keyFrameData = readJson('data/keyframes.json');
const appSource = readText('app.js');
const htmlSource = readText('index.html');
const swSource = readText('sw.js');
const cssSource = readText('styles.css');

function applyExpansion(target, addition) {
  const ids = new Set(target.scenes.map(scene => scene.id));
  for (const [anchor, next] of Object.entries(addition.redirects || {})) {
    const scene = target.scenes.find(item => item.id === anchor);
    if (scene) for (const choice of scene.choices) choice.next = next;
  }
  for (const scene of addition.scenes || []) {
    if (!ids.has(scene.id)) {
      target.scenes.push(scene);
      ids.add(scene.id);
    }
  }
}

applyExpansion(base, expansion);
applyExpansion(base, intimate);
const scenes = base.scenes;
const sceneMap = new Map(scenes.map(scene => [scene.id, scene]));
const assignedScenes = scenes.filter((_, index) => index % shardCount === shardIndex);

const weights = {
  schema: 12,
  graph: 18,
  choices: 22,
  saves: 16,
  story: 10,
  pwa: 12,
  iphone: 10
};
const categories = Object.fromEntries(Object.keys(weights).map(key => [key, {passed: 0, total: 0}]));
const failures = [];
function check(condition, category, code, message, context = {}) {
  categories[category].total += 1;
  if (condition) categories[category].passed += 1;
  else failures.push({code, category, message, context});
  return condition;
}

const hash = crypto.createHash('sha256');
for (const file of ['index.html', 'styles.css', 'app.js', 'sw.js', 'data/scenes.json', 'data/documents.json', 'data/expansion.json', 'data/intimate-expansion.json', 'data/keyframes.json']) {
  hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file)));
}
const buildHash = hash.digest('hex');

check(Array.isArray(scenes) && scenes.length === 584, 'schema', 'SCENE_COUNT', 'Runtime scene count must be 584', {actual: scenes.length});
check(sceneMap.size === scenes.length, 'schema', 'SCENE_IDS', 'Scene IDs must be unique', {unique: sceneMap.size, total: scenes.length});
check(Object.keys(documents).length === 40, 'schema', 'DOC_COUNT', 'Document count must be 40', {actual: Object.keys(documents).length});

const seenSceneIds = new Set();
for (const scene of scenes) {
  check(typeof scene.id === 'string' && scene.id.length > 0, 'schema', 'SCENE_ID_EMPTY', 'Scene ID is missing', {scene: scene.id});
  check(!seenSceneIds.has(scene.id), 'schema', 'SCENE_ID_DUPLICATE', 'Duplicate scene ID', {scene: scene.id});
  seenSceneIds.add(scene.id);
  check([1, 2, 3].includes(scene.act), 'schema', 'SCENE_ACT', 'Scene act must be 1..3', {scene: scene.id, act: scene.act});
  check(typeof scene.title === 'string' && scene.title.trim().length > 0, 'schema', 'SCENE_TITLE', 'Scene title is empty', {scene: scene.id});
  check(typeof scene.text === 'string' && scene.text.trim().length > 0, 'schema', 'SCENE_TEXT', 'Scene text is empty', {scene: scene.id});
  check(Array.isArray(scene.choices) && scene.choices.length > 0, 'schema', 'SCENE_CHOICES', 'Scene has no choices', {scene: scene.id});
  const choiceIds = new Set();
  for (const choice of scene.choices || []) {
    check(typeof choice.id === 'string' && choice.id.length > 0, 'schema', 'CHOICE_ID', 'Choice ID is empty', {scene: scene.id});
    check(!choiceIds.has(choice.id), 'schema', 'CHOICE_ID_DUPLICATE', 'Choice ID repeats inside a scene', {scene: scene.id, choice: choice.id});
    choiceIds.add(choice.id);
  }
}

function targetFor(scene, choice) {
  if (choice.next === 'GAME_COMPLETE') return 'GAME_COMPLETE';
  if (sceneMap.has(choice.next)) return choice.next;
  if (choice.next === 'ACT_END_1' && scene.act === 1) return 'SCENE_201';
  if (choice.next === 'ACT_END_2' && scene.act === 2) return 'SCENE_401';
  return null;
}

const edges = new Map(scenes.map(scene => [scene.id, new Set()]));
const referencedDocs = new Set();
const producedFlags = new Map();
for (const scene of scenes) {
  for (const choice of scene.choices) {
    const target = targetFor(scene, choice);
    check(target !== null, 'graph', 'NEXT_BROKEN', 'Choice target is invalid', {scene: scene.id, choice: choice.id, next: choice.next});
    if (target && target !== 'GAME_COMPLETE') edges.get(scene.id).add(target);
    for (const id of choice.effects?.docs || []) {
      referencedDocs.add(id);
      check(Object.prototype.hasOwnProperty.call(documents, id), 'story', 'DOC_BROKEN', 'Choice references an unknown document', {scene: scene.id, choice: choice.id, document: id});
    }
    for (const [flag, value] of Object.entries(choice.effects?.flags || {})) {
      if (!producedFlags.has(flag)) producedFlags.set(flag, new Set());
      producedFlags.get(flag).add(JSON.stringify(value));
    }
    for (const [name, value] of Object.entries(choice.effects?.vars || {})) {
      check(Number.isFinite(Number(value)), 'schema', 'VAR_NOT_NUMERIC', 'Variable effect must be numeric', {scene: scene.id, choice: choice.id, variable: name, value});
    }
  }
  for (const variant of scene.variants || []) {
    const condition = variant.if || {};
    if (condition.flag && Object.prototype.hasOwnProperty.call(condition, 'eq')) {
      check(producedFlags.get(condition.flag)?.has(JSON.stringify(condition.eq)) === true, 'story', 'VARIANT_UNREACHABLE', 'Scene variant condition cannot be produced', {scene: scene.id, flag: condition.flag, value: condition.eq});
    }
  }
}

function storyMinute(value) {
  const match = String(value || '').match(/^День\s+(\d+),\s*(\d{2}):(\d{2})$/);
  if (!match) return null;
  return (Number(match[1]) - 1) * 24 * 60 + Number(match[2]) * 60 + Number(match[3]);
}
for (const scene of scenes) {
  const from = storyMinute(scene.time);
  check(from !== null, 'story', 'TIME_FORMAT', 'Scene time must use День N, HH:MM', {scene: scene.id, time: scene.time});
  for (const target of edges.get(scene.id) || []) {
    const to = storyMinute(sceneMap.get(target)?.time);
    check(to !== null && to > from, 'story', 'TIME_REGRESSION', 'Story transition goes backward or keeps the same time', {scene: scene.id, time: scene.time, target, targetTime: sceneMap.get(target)?.time});
  }
}
check(storyMinute(sceneMap.get('SCENE_201')?.time) >= 24 * 60 + 6 * 60, 'story', 'ACT2_MORNING_TIME', 'Act II morning must begin on Day 2 after 06:00', {time: sceneMap.get('SCENE_201')?.time});
check(storyMinute(sceneMap.get('SCENE_336')?.time) >= 24 * 60 + 18 * 60, 'story', 'SECOND_NIGHT_START', 'Second-night phase starts before evening', {time: sceneMap.get('SCENE_336')?.time});
check(storyMinute(sceneMap.get('SCENE_365')?.time) < 2 * 24 * 60 + 6 * 60, 'story', 'SECOND_NIGHT_END', 'Second-night phase runs past dawn', {time: sceneMap.get('SCENE_365')?.time});
check(storyMinute(sceneMap.get('SCENE_380')?.time) >= 2 * 24 * 60, 'story', 'THIRD_DAY_DOOR_TIME', 'Third-day door occurs before Day 3', {time: sceneMap.get('SCENE_380')?.time});

const reachable = new Set(['SCENE_001']);
const queue = ['SCENE_001'];
while (queue.length) {
  const id = queue.shift();
  for (const next of edges.get(id) || []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
}
for (const scene of scenes) check(reachable.has(scene.id), 'graph', 'SCENE_UNREACHABLE', 'Scene is unreachable from SCENE_001', {scene: scene.id});

const reverse = new Map(scenes.map(scene => [scene.id, new Set()]));
const canFinish = new Set();
for (const scene of scenes) for (const choice of scene.choices) {
  const target = targetFor(scene, choice);
  if (target === 'GAME_COMPLETE') canFinish.add(scene.id);
  else if (target) reverse.get(target).add(scene.id);
}
const finishQueue = [...canFinish];
while (finishQueue.length) {
  const id = finishQueue.shift();
  for (const prev of reverse.get(id) || []) if (!canFinish.has(prev)) { canFinish.add(prev); finishQueue.push(prev); }
}
for (const scene of scenes) check(canFinish.has(scene.id), 'graph', 'NO_GAME_COMPLETE', 'Scene cannot reach GAME_COMPLETE', {scene: scene.id});

const visiting = new Set(), visited = new Set();
let firstCycle = null;
function visit(id, stack) {
  if (visiting.has(id)) { firstCycle ||= [...stack, id]; return; }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const next of edges.get(id) || []) visit(next, [...stack, id]);
  visiting.delete(id);
  visited.add(id);
}
visit('SCENE_001', []);
check(!firstCycle, 'graph', 'GRAPH_CYCLE', 'Story graph contains a cycle', {cycle: firstCycle});

for (const id of Object.keys(documents)) check(referencedDocs.has(id), 'story', 'DOC_UNREACHABLE', 'Document is never unlocked by a choice', {document: id});

const finalChoiceScene = sceneMap.get('SCENE_575');
const commonEpilogue = 'SCENE_616';
const finalBranches = [];
for (const choice of finalChoiceScene?.choices || []) {
  const start = targetFor(finalChoiceScene, choice);
  const members = new Set();
  const pending = [start];
  let reachesCommon = false;
  while (pending.length) {
    const id = pending.pop();
    if (id === commonEpilogue) { reachesCommon = true; continue; }
    if (!id || id === 'GAME_COMPLETE' || members.has(id)) continue;
    members.add(id);
    for (const next of edges.get(id) || []) pending.push(next);
  }
  check(reachesCommon, 'story', 'FINAL_NO_COMMON', 'Final branch does not reach the common epilogue', {choice: choice.id, start});
  finalBranches.push({choice: choice.id, members});
}
for (let a = 0; a < finalBranches.length; a++) for (let b = a + 1; b < finalBranches.length; b++) {
  const overlap = [...finalBranches[a].members].filter(id => finalBranches[b].members.has(id));
  check(overlap.length === 0, 'story', 'FINAL_BRANCH_LEAK', 'Final branches overlap before common epilogue', {a: finalBranches[a].choice, b: finalBranches[b].choice, overlap});
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function modelState() {
  return {current: '', visited: [], codex: [], vars: {}, flags: {}, journal: [], pending: null, unlockedAct: 1, completedActs: [], gameComplete: false};
}
function applyChoiceModel(state, scene, choice) {
  if (state.pending) return state;
  const target = targetFor(scene, choice);
  if (!target) return state;
  const effects = choice.effects || {};
  for (const [key, value] of Object.entries(effects.vars || {})) state.vars[key] = (Number(state.vars[key]) || 0) + Number(value);
  Object.assign(state.flags, effects.flags || {});
  for (const id of effects.docs || []) if (!state.codex.includes(id)) state.codex.push(id);
  if (effects.unlock_act) state.unlockedAct = Math.max(state.unlockedAct, Number(effects.unlock_act));
  if (effects.complete_act && !state.completedActs.includes(Number(effects.complete_act))) state.completedActs.push(Number(effects.complete_act));
  if (!state.visited.includes(scene.id)) state.visited.push(scene.id);
  state.journal.push({sceneId: scene.id, choice: choice.text, outcome: choice.outcome || ''});
  state.pending = {scene: scene.id, selected: choice.text, next: target, complete: target === 'GAME_COMPLETE'};
  return state;
}

for (const scene of assignedScenes) {
  for (const choice of scene.choices) {
    check(typeof choice.text === 'string' && choice.text.trim().length > 0, 'choices', 'CHOICE_TEXT', 'Choice text is empty', {scene: scene.id, choice: choice.id});
    check(typeof choice.outcome === 'string' && choice.outcome.trim().length > 0, 'choices', 'CHOICE_OUTCOME', 'Choice outcome is empty', {scene: scene.id, choice: choice.id});
    const state = modelState();
    state.current = scene.id;
    const before = JSON.stringify(state);
    applyChoiceModel(state, scene, choice);
    check(JSON.stringify(state) !== before, 'choices', 'CHOICE_NO_EFFECT', 'Choice did not create a pending decision', {scene: scene.id, choice: choice.id});
    check(state.pending?.scene === scene.id, 'choices', 'PENDING_SCENE', 'Pending decision points to wrong scene', {scene: scene.id, choice: choice.id});
    check(state.pending?.next === targetFor(scene, choice), 'choices', 'PENDING_NEXT', 'Pending decision has wrong target', {scene: scene.id, choice: choice.id});
    check(state.visited.filter(id => id === scene.id).length === 1, 'choices', 'VISITED_ONCE', 'Visited scene was not recorded exactly once', {scene: scene.id, choice: choice.id});
    check(state.journal.length === 1, 'choices', 'JOURNAL_ONCE', 'Choice journal entry count is wrong', {scene: scene.id, choice: choice.id});
    const locked = JSON.stringify(state);
    applyChoiceModel(state, scene, choice);
    check(JSON.stringify(state) === locked, 'choices', 'DOUBLE_TAP', 'Second tap changed a locked decision', {scene: scene.id, choice: choice.id});
    const reloaded = clone(state);
    check(JSON.stringify(reloaded) === locked, 'saves', 'PENDING_RELOAD', 'Pending decision changed after JSON save/reload', {scene: scene.id, choice: choice.id});
    const target = reloaded.pending.next;
    reloaded.pending = null;
    reloaded.gameComplete = target === 'GAME_COMPLETE';
    reloaded.current = reloaded.gameComplete ? 'GAME_COMPLETE' : target;
    check(reloaded.gameComplete || sceneMap.has(reloaded.current), 'choices', 'CONTINUE_TARGET', 'Continue leads to an invalid scene', {scene: scene.id, choice: choice.id, target});
    for (const id of choice.effects?.docs || []) check(state.codex.includes(id), 'choices', 'DOC_NOT_APPLIED', 'Choice document effect was not applied', {scene: scene.id, choice: choice.id, document: id});
    for (const [flag, value] of Object.entries(choice.effects?.flags || {})) check(JSON.stringify(state.flags[flag]) === JSON.stringify(value), 'choices', 'FLAG_NOT_APPLIED', 'Choice flag effect was not applied', {scene: scene.id, choice: choice.id, flag});
  }
}

check(/if\(state\.pending\)return/.test(appSource), 'saves', 'RUNTIME_PENDING_GUARD', 'Runtime lacks pending decision guard');
check(/choice-locked/.test(appSource) && /ЗАФИКСИРОВАНО/.test(appSource), 'saves', 'RUNTIME_LOCK_UI', 'Runtime lacks locked-choice UI');
check(/function choiceTarget/.test(appSource) && /Переход повреждён/.test(appSource), 'saves', 'RUNTIME_TARGET_GUARD', 'Runtime masks invalid choice targets');
check(/x\.journal=.*filter/.test(appSource) && /Number\.isFinite\(parsedAt\)/.test(appSource), 'saves', 'SAVE_MIGRATION', 'Runtime lacks defensive save migration');
check(/seenFrames/.test(appSource), 'saves', 'FRAME_SAVE', 'Runtime does not persist shown key frames');

check(Array.isArray(keyFrameData.frames), 'iphone', 'KEYFRAME_LIST', 'Key frame manifest frames must be an array');
check(new Set(keyFrameData.frames).size === keyFrameData.frames.length, 'iphone', 'KEYFRAME_DUPLICATE', 'Key frame manifest contains duplicates');
check(keyFrameData.frames.length === 17, 'iphone', 'KEYFRAME_COUNT', 'Exactly 17 curated key frames are expected', {actual: keyFrameData.frames.length});
check(Number(keyFrameData.hold_ms) >= 1200 && Number(keyFrameData.hold_ms) <= 8000, 'iphone', 'KEYFRAME_DURATION', 'Key frame duration is outside safe range', {actual: keyFrameData.hold_ms});
const keyFrameImages = [];
for (const id of keyFrameData.frames) {
  const scene = sceneMap.get(id);
  check(Boolean(scene), 'iphone', 'KEYFRAME_SCENE', 'Key frame scene does not exist', {scene: id});
  check(Boolean(scene?.image), 'iphone', 'KEYFRAME_IMAGE', 'Key frame scene has no curated image', {scene: id});
  if (scene?.image) {
    keyFrameImages.push(`./${scene.image}`);
    check(fs.existsSync(path.join(root, scene.image)), 'iphone', 'KEYFRAME_FILE', 'Key frame image file is missing', {scene: id, image: scene.image});
  }
}
for (const scene of scenes) {
  const hasImage = Object.prototype.hasOwnProperty.call(scene, 'image') && Boolean(scene.image);
  check(keyFrameData.frames.includes(scene.id) ? hasImage : !Object.prototype.hasOwnProperty.call(scene, 'image'), 'iphone', 'IMAGE_DATA_POLICY', 'Only manifest key frames may retain image metadata', {scene: scene.id, image: scene.image || null});
}
const brokenTemplate = /собираются вокруг сцены так плотно|становится маленьким узлом доверия|выглядит как мелочь: лист|встречает команду|находят след, который не просится в руки|В локации «|происходит событие|начинается событие|останавливает новая улика|Находка не даёт готового ответа|Теперь важен не красивый ответ|С уликой связаны материалы|С этим решением связаны материалы|Эпилог фиксирует итог|Локация «/;
const brokenTitle = /Игрок|— эхо \d+|Разговор с выжившим \d+|Первая пропущенная сцена|Сцена доверия/;
const cameraMeta = /\bкадр\b|камер|композиц|цензур|фокус(?:е|ом)?\b|снято|план остаётся|остаётся выше пояса/i;
for (const scene of scenes) {
  check(!brokenTemplate.test(scene.text), 'story', 'EDITORIAL_TEMPLATE', 'Broken generated prose template remains', {scene: scene.id});
  check(!brokenTitle.test(scene.title), 'story', 'EDITORIAL_TITLE', 'Visible title contains generator or player-facing service residue', {scene: scene.id, title: scene.title});
  for (const variant of scene.variants || []) check(!/^Игрок\b/u.test(String(variant.text || '')), 'story', 'VARIANT_PLAYER_LABEL', 'Story variant addresses the player as a service label', {scene: scene.id});
  if (scene.kind === 'intimate') check(!cameraMeta.test(scene.text), 'story', 'INTIMATE_CAMERA_META', 'Intimate prose still describes camera/censorship instead of the story', {scene: scene.id});
  const outcomes = new Set();
  for (const choice of scene.choices) {
    check(!/Зафиксировать улику «|Разобраться, что означает «|Вариант \d+:/i.test(choice.text), 'story', 'CHOICE_TEMPLATE', 'Choice repeats a generated scene title or placeholder', {scene: scene.id, choice: choice.id, text: choice.text});
    check(!brokenTemplate.test(choice.outcome || ''), 'story', 'OUTCOME_TEMPLATE', 'Choice outcome contains service-style generated prose', {scene: scene.id, choice: choice.id});
    check(!outcomes.has(choice.outcome), 'story', 'DUPLICATE_OUTCOME', 'Different choices in one scene show identical outcomes', {scene: scene.id, choice: choice.id});
    outcomes.add(choice.outcome);
  }
}
const proseOwners = new Map();
for (const scene of scenes) {
  const normalized = scene.text.trim();
  check(!proseOwners.has(normalized), 'story', 'DUPLICATE_SCENE_TEXT', 'Two scenes contain completely identical prose', {scene: scene.id, duplicateOf: proseOwners.get(normalized)});
  proseOwners.set(normalized, scene.id);
}
for (const scene of scenes.filter(item => /^INT_FULL_\d{3}$/.test(item.id))) {
  const number = Number(scene.id.slice(-3));
  if (number % 6 !== 0) check(scene.choices[0]?.next !== scene.choices[1]?.next, 'story', 'INTIMATE_EXIT_CHOICE', 'Personal-space choice does not leave the optional intimate sequence', {scene: scene.id, next: scene.choices.map(choice => choice.next)});
}
check(!/sceneArtPath|sceneFallbackImages|setSceneImage|imagePool/.test(appSource), 'iphone', 'ORDINARY_IMAGE_CODE', 'Runtime still contains per-scene or fallback image loading');
check(/!db\.keyFrames\.has\(scene\.id\).*return/.test(appSource), 'iphone', 'KEYFRAME_GATE', 'Runtime does not gate image requests behind key frame manifest');
check(/img\.removeAttribute\('src'\)/.test(appSource), 'iphone', 'FRAME_CLEANUP', 'Runtime does not remove image source after display');
check(/visibilitychange.*hideKeyFrame\(true\)/.test(appSource), 'iphone', 'FRAME_BACKGROUND', 'Runtime does not dismiss key frame when iPhone backgrounds the app');
check(/aria-hidden="true"/.test(htmlSource) && /id="sceneVisual"/.test(htmlSource), 'iphone', 'FRAME_A11Y', 'Key frame overlay is not decorative for assistive technology');
check(/\.scene-card\{grid-template-columns:1fr/.test(cssSource), 'iphone', 'READING_LAYOUT', 'Reading card is not permanently single-column');

const swContext = {self: {addEventListener() {}, skipWaiting() {}, clients: {claim() {}}}};
vm.runInNewContext(`${swSource}\n;globalThis.__qa={CACHE,CORE,KEY_FRAMES};`, swContext);
const swData = swContext.__qa;
const appVersion = appSource.match(/APP_VERSION='([^']+)'/)?.[1];
check(Boolean(appVersion), 'pwa', 'APP_VERSION', 'APP_VERSION is missing');
check(swData.CACHE === `perimeter-v${appVersion}`, 'pwa', 'CACHE_VERSION', 'Service worker cache version differs from app version', {appVersion, cache: swData.CACHE});
check(htmlSource.includes(`app.js?v=${appVersion}`) && htmlSource.includes(`styles.css?v=${appVersion}`), 'pwa', 'HTML_VERSION', 'HTML asset versions differ from app version', {appVersion});
check(swData.CORE.includes('./data/keyframes.json') && swData.CORE.includes('./data/intimate-expansion.json'), 'pwa', 'PRECACHE_DATA', 'Service worker misses runtime JSON');
const expectedKeyFrameFiles = [...new Set(keyFrameImages)].sort();
const actualKeyFrameFiles = [...new Set(swData.KEY_FRAMES)].sort();
check(JSON.stringify(actualKeyFrameFiles) === JSON.stringify(expectedKeyFrameFiles), 'pwa', 'PRECACHE_KEYFRAMES', 'Service worker key frames differ from manifest scene images', {expected: expectedKeyFrameFiles, actual: actualKeyFrameFiles});
for (const item of [...swData.CORE, ...swData.KEY_FRAMES]) {
  if (item === './') continue;
  const file = item.replace(/^\.\//, '').split('?')[0];
  check(fs.existsSync(path.join(root, file)), 'pwa', 'PRECACHE_FILE', 'Service worker precache file is missing', {file});
}
check(!/INTIMATE_FRAMES/.test(swSource), 'pwa', 'OLD_IMAGE_CACHE', 'Service worker still preloads removed full image collection');
check(!/renderFilmstrip/.test(appSource), 'iphone', 'FILMSTRIP_RUNTIME', 'Filmstrip runtime returned');
check(!/filmstrip\.css/.test(htmlSource), 'iphone', 'FILMSTRIP_CSS', 'Filmstrip CSS is still loaded');

for (const source of [appSource, swSource]) {
  try { new vm.Script(source); check(true, 'pwa', 'JS_SYNTAX', ''); }
  catch (error) { check(false, 'pwa', 'JS_SYNTAX', 'JavaScript syntax error', {error: error.message}); }
}
for (const id of ['boot','shell','sceneVisual','sceneImage','sceneTitle','sceneText','choices','outcome','ageDialog','profileDialog','toast']) {
  check(htmlSource.includes(`id="${id}"`), 'iphone', 'DOM_ID', 'Required DOM node is missing', {id});
}

let weighted = 0;
for (const [name, values] of Object.entries(categories)) {
  const ratio = values.total ? values.passed / values.total : 1;
  weighted += weights[name] * ratio;
}
const score = failures.length ? Math.min(99, Math.floor(weighted)) : 100;
const choiceCount = assignedScenes.reduce((sum, scene) => sum + scene.choices.length, 0);
const assertionCount = Object.values(categories).reduce((sum, value) => sum + value.total, 0);
const passedCount = Object.values(categories).reduce((sum, value) => sum + value.passed, 0);
const report = {
  schema: 'perimeter.qa-shard.v1',
  build_hash: buildHash,
  agent: args.agent ? String(args.agent) : null,
  shard: shardIndex,
  total_shards: shardCount,
  assigned_scenes: assignedScenes.map(scene => scene.id),
  summary: {
    runtime_scenes: scenes.length,
    runtime_choices: scenes.reduce((sum, scene) => sum + scene.choices.length, 0),
    assigned_scene_count: assignedScenes.length,
    assigned_choice_count: choiceCount,
    key_frames: keyFrameData.frames.length,
    assertions: assertionCount,
    passed: passedCount,
    failed: failures.length,
    score
  },
  categories,
  failures
};

if (args.output) {
  const output = path.resolve(root, String(args.output));
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, args.compact ? 0 : 2));
if (failures.length) process.exitCode = 1;
