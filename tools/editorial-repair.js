#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['data/scenes.json', 'data/expansion.json', 'data/intimate-expansion.json'];
const payloads = new Map(files.map(file => [file, JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))]));
const allScenes = files.flatMap(file => payloads.get(file).scenes || []);
const sceneMap = new Map(allScenes.map(scene => [scene.id, scene]));
const documentsRaw = JSON.parse(fs.readFileSync(path.join(root, 'data/documents.json'), 'utf8'));
const documents = documentsRaw.documents || documentsRaw;
const keyFrameData = JSON.parse(fs.readFileSync(path.join(root, 'data/keyframes.json'), 'utf8'));
const keyFrames = new Set(keyFrameData.frames);

const templatePattern = /собираются вокруг сцены так плотно|становится маленьким узлом доверия|выглядит как мелочь: лист|встречает команду|После «Периметра» не бывает чистой тишины|находят след, который не просится в руки/;
const characters = ['Артём', 'Ева', 'Марина', 'Глеб', 'Зорин', 'Сергей'];
const characterForms = [
  ['Артём', /Арт[её]м(?:а|у|ом|е)?/],
  ['Ева', /Ев(?:а|ы|е|у|ой)/],
  ['Марина', /Марин(?:а|ы|е|у|ой)/],
  ['Глеб', /Глеб(?:а|у|ом|е)?/],
  ['Зорин', /Зорин(?:а|у|ым|е)?/],
  ['Сергей', /Серге(?:й|я|ю|ем|е)/]
];

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const quote = value => `«${clean(value)}»`;
function focusLine(scene) {
  const focus = clean(scene.focus || 'Команда');
  if (/команда/i.test(focus)) return 'Команда реагирует по-разному: кто-то проверяет путь, кто-то следит за людьми, а кто-то слишком долго молчит.';
  return `${focus} оказывается ближе остальных к происходящему. Реакция выдаёт больше, чем любые объяснения.`;
}
function referencedDocumentTitles(scene) {
  const ids = new Set(scene.choices.flatMap(choice => choice.effects?.docs || []));
  return [...ids].map(id => documents[id]?.title).filter(Boolean);
}
function documentContext(scene) {
  const docs = referencedDocumentTitles(scene);
  return docs.length ? ` С этим решением связаны материалы: ${docs.map(quote).join(', ')}.` : '';
}
function evidenceText(scene) {
  const docs = referencedDocumentTitles(scene);
  const documentLine = docs.length ? `С уликой связаны материалы: ${docs.map(quote).join(', ')}.` : 'Улика существует не только в словах: её можно проверить и сопоставить с уже найденными фактами.';
  return `В локации ${quote(scene.location)} внимание команды останавливает новая улика — ${quote(scene.title)}. Детали фиксируют на месте, сверяя время, следы и показания.\n\n${focusLine(scene)} ${documentLine}\n\nНаходка не даёт готового ответа. Она убирает одну удобную версию и заставляет решить, кому показать доказательство и что сохранить до следующей проверки.`;
}
function eventText(scene) {
  return `В локации ${quote(scene.location)} происходит событие ${quote(scene.title)}. Оно меняет темп вылазки: привычный маршрут больше нельзя считать безопасным, а прежний план — достаточным.\n\n${focusLine(scene)} Смысл происходящего становится яснее только по реакции людей и по тому, какие детали они пытаются не замечать.${documentContext(scene)}\n\nТеперь важен не красивый ответ, а последовательное решение. Следующий шаг определит доверие внутри группы и то, с каким запасом времени команда продолжит путь.`;
}
function endingText(scene) {
  return `Эпилог фиксирует итог ${quote(scene.title)}. Это прямое следствие решения, принятого в Центральном архиве, а не ещё одна альтернативная концовка.\n\nПосле Периметра новости, отчёты и показания расходятся, но выбранная версия событий остаётся последовательной. Люди живут с одной правдой — полной, отредактированной, уничтоженной, запечатанной или отданной системе.\n\nЭхо не исчезает. Оно меняет голос и ведёт к общему эпилогу, не смешивая эту ветку с другими финалами.`;
}
function intimateText(scene) {
  const focus = clean(scene.focus || 'взрослые участники экспедиции');
  return `В локации ${quote(scene.location)} наступает тихий момент ${quote(scene.title)}. ${focus} остаётся в мягком свете, за паром, тканью или закрывающей тенью; никаких откровенных деталей не видно.\n\nБлизость строится только на ясном согласии совершеннолетних героев. Любое движение можно остановить, а молчание не принимается за разрешение.\n\nСцена говорит не о наготе, а о доверии после страха. Когда момент заканчивается, герои возвращаются к вылазке без нарушения личных границ.`;
}

function effectTone(choice) {
  const vars = choice.effects?.vars || {};
  const trust = Object.entries(vars).filter(([key]) => key.startsWith('trust_')).reduce((sum, [, value]) => sum + Number(value || 0), 0);
  if (trust < 0) return 'Решение принято, но в разговоре остаётся холод: доверие уменьшается, и это будет заметно дальше.';
  if ((choice.effects?.docs || []).length) return 'Вы фиксируете улику и сохраняете проверяемые детали. Документ добавлен в архив без подмены смысла находки.';
  if (trust > 0) return 'Вы действуете открыто. Напряжение не исчезает, но доверие внутри группы становится крепче.';
  return 'Решение зафиксировано. Команда принимает последствия и продолжает путь без скрытого повторного выбора.';
}
function repairChoices(scene) {
  if (scene.kind === 'ending' || scene.kind === 'intimate') return;
  const evidence = scene.kind === 'evidence';
  const evidenceLabels = [
    `Зафиксировать улику ${quote(scene.title)}`,
    'Обсудить детали со всей группой',
    'Сохранить сведения до следующей проверки',
    'Сверить улику с маршрутным журналом',
    'Отказаться от поспешного вывода'
  ];
  const eventLabels = [
    `Разобраться, что означает ${quote(scene.title)}`,
    'Действовать сразу, пока путь открыт',
    'Сначала удержать команду вместе',
    'Сохранить молчание и наблюдать',
    'Вернуться к протоколу безопасности'
  ];
  const labels = evidence ? evidenceLabels : eventLabels;
  scene.choices.forEach((choice, index) => {
    choice.text = labels[index] || `Вариант ${index + 1}: продолжить осторожно`;
    choice.outcome = effectTone(choice);
  });
}

function repairIntimateChoices(scene) {
  const labels = [
    'Спросить, комфортно ли продолжать',
    'Оставить больше личного пространства',
    'Остановиться и вернуться к разговору',
    'Подтвердить границы вслух'
  ];
  const outcomes = [
    'Оба совершеннолетних героя ясно подтверждают согласие и сохраняют право остановиться в любой момент.',
    'Дистанция остаётся безопасной; доверие не требует ни спешки, ни откровенности.',
    'Близость прекращается без давления, а разговор продолжается спокойно и честно.',
    'Границы названы прямо; продолжение возможно только при взаимном согласии.'
  ];
  scene.choices.forEach((choice, index) => {
    choice.text = labels[index] || `Сохранить границы — вариант ${index + 1}`;
    choice.outcome = outcomes[index] || outcomes[1];
  });
}

function normalizeCommonOutcomes(scene) {
  for (const choice of scene.choices) {
    const label = clean(choice.text);
    const outcome = clean(choice.outcome);
    if (/сфотограф|сделать снимок/i.test(label)) {
      choice.outcome = 'Вы фотографируете находку и сохраняете проверяемую копию, не меняя оригинал.';
    } else if (/дать ей время/i.test(label)) {
      choice.outcome = 'Вы не торопите её. В ответ она спокойнее формулирует решение и сохраняет право отказаться.';
    } else if (/удержать группу вместе/i.test(label)) {
      choice.outcome = 'Вы собираете всю группу и не позволяете страху разделить людей.';
    } else if (/Коридор реагирует|коридор отвечает/i.test(outcome)) {
      choice.outcome = `Локация ${quote(scene.location)} отвечает на риск изменением обстановки; команда фиксирует последствия.`;
    }
    if (/(Марин|Ев)/i.test(label) && /\bего\b|\bон\b/i.test(clean(choice.outcome))) {
      choice.outcome = 'Вы даёте ей пространство для решения; её реакция остаётся честной и заметной для группы.';
    }
  }
}

function normalizeFocusFromTitle(scene) {
  const named = characterForms.find(([, pattern]) => pattern.test(scene.title));
  if (named) scene.focus = named[0];
  if (/\bNPC\b/.test(scene.title)) scene.title = scene.title.replace(/\bNPC\b/g, characters.includes(scene.focus) ? scene.focus : 'Один человек');
}

let rewritten = 0;
let intimateRewritten = 0;
let imagesRemoved = 0;
for (const scene of allScenes) {
  normalizeFocusFromTitle(scene);
  if (scene.location === 'Финальные локации') scene.location = 'После Периметра';
  if (!keyFrames.has(scene.id) && Object.prototype.hasOwnProperty.call(scene, 'image')) {
    delete scene.image;
    imagesRemoved += 1;
  }
  if (scene.kind === 'intimate') {
    scene.text = intimateText(scene);
    repairIntimateChoices(scene);
    intimateRewritten += 1;
    continue;
  }
  const templated = templatePattern.test(scene.text);
  if (templated) {
    scene.text = scene.kind === 'evidence' ? evidenceText(scene) : scene.kind === 'ending' ? endingText(scene) : eventText(scene);
    repairChoices(scene);
    rewritten += 1;
  } else if (scene.kind !== 'ending' && !scene.text.includes(scene.title)) {
    scene.text = `В локации ${quote(scene.location)} начинается событие ${quote(scene.title)}.\n\n${scene.text}`;
  }
  normalizeCommonOutcomes(scene);
}

// One shared ending card explicitly names both mutually exclusive outcomes.
// It is therefore accurate for the opening scene of either branch.
const mercifulLie = sceneMap.get('SCENE_586');
if (mercifulLie) mercifulLie.image = 'assets/images/ending_lie.webp';
const redacted = sceneMap.get('SCENE_591');
if (redacted) {
  redacted.title = 'Концовка: Красная редакция';
  redacted.image = 'assets/images/ending_lie.webp';
  redacted.text = endingText(redacted);
}

// The opening choices now lead to the scene their wording promises.
const opening = sceneMap.get('SCENE_001');
if (opening) {
  const targets = {tone_plan: 'SCENE_004', tone_joke: 'SCENE_002', tone_missing: 'SCENE_003'};
  for (const choice of opening.choices) if (targets[choice.id]) choice.next = targets[choice.id];
}

// Build the exact runtime graph, including redirect insertions, and assign a
// monotonic six-minute field timeline so no possible transition goes back.
const redirectByScene = new Map();
for (const file of ['data/expansion.json', 'data/intimate-expansion.json']) {
  for (const [anchor, next] of Object.entries(payloads.get(file).redirects || {})) redirectByScene.set(anchor, next);
}
function targetFor(scene, choice) {
  if (redirectByScene.has(scene.id)) return redirectByScene.get(scene.id);
  if (choice.next === 'GAME_COMPLETE') return null;
  if (choice.next === 'ACT_END_1') return 'SCENE_201';
  if (choice.next === 'ACT_END_2') return 'SCENE_401';
  return sceneMap.has(choice.next) ? choice.next : null;
}
const outgoing = new Map(allScenes.map(scene => [scene.id, new Set()]));
const indegree = new Map(allScenes.map(scene => [scene.id, 0]));
for (const scene of allScenes) for (const choice of scene.choices) {
  const target = targetFor(scene, choice);
  if (!target || outgoing.get(scene.id).has(target)) continue;
  outgoing.get(scene.id).add(target);
  indegree.set(target, indegree.get(target) + 1);
}
const ready = [...allScenes.filter(scene => indegree.get(scene.id) === 0).map(scene => scene.id)].sort();
const order = [];
while (ready.length) {
  const id = ready.shift();
  order.push(id);
  for (const target of outgoing.get(id)) {
    indegree.set(target, indegree.get(target) - 1);
    if (indegree.get(target) === 0) {
      ready.push(target);
      ready.sort();
    }
  }
}
if (order.length !== allScenes.length) throw new Error(`Cannot assign chronology: topological order has ${order.length}/${allScenes.length} scenes`);
const startMinutes = 6 * 60 + 42;
for (let index = 0; index < order.length; index += 1) {
  const absolute = startMinutes + index * 6;
  const day = Math.floor(absolute / (24 * 60)) + 1;
  const minuteOfDay = absolute % (24 * 60);
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  sceneMap.get(order[index]).time = `День ${day}, ${hours}:${minutes}`;
}

for (const file of files) fs.writeFileSync(path.join(root, file), `${JSON.stringify(payloads.get(file), null, 2)}\n`);
console.log(JSON.stringify({scenes: allScenes.length, rewritten, intimate_rewritten: intimateRewritten, images_removed: imagesRemoved, key_frames_kept: keyFrames.size, chronology: order.length}, null, 2));
