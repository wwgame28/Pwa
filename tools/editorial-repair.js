#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const files = ['data/scenes.json', 'data/expansion.json', 'data/intimate-expansion.json'];
const payloads = new Map(files.map(file => [file, JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))]));
const allScenes = files.flatMap(file => payloads.get(file).scenes || []);
const sceneMap = new Map(allScenes.map(scene => [scene.id, scene]));
const documentsRaw = JSON.parse(fs.readFileSync(path.join(root, 'data/documents.json'), 'utf8'));
const documents = documentsRaw.documents || documentsRaw;
const keyFrameData = JSON.parse(fs.readFileSync(path.join(root, 'data/keyframes.json'), 'utf8'));
const keyFrames = new Set(keyFrameData.frames);

const generatedEvidencePattern = /внимание команды останавливает новая улика|Находка не даёт готового ответа/;
const generatedEventPattern = /происходит событие|Теперь важен не красивый ответ/;
const generatedEndingPattern = /Эпилог фиксирует итог|После Периметра новости/;
const currentGeneratedPattern = /^(?:Несостыковку замечают почти одновременно|Первое объяснение рассыпается после короткой проверки|Разговор обрывается, когда детали перестают совпадать|Команда возвращается к фактам и находит противоречие|Один вопрос заставляет всех пересмотреть услышанное|Молчание затягивается: прежняя версия больше не сходится с фактами|(?:Артём|Ева|Марина|Глеб|Зорин|Сергей|Фёдор) (?:замечает несостыковку|задерживает взгляд|сверяет услышанное|не принимает первое объяснение|реагирует раньше|возвращает разговор)|За воротами жизнь не возвращается|Утро приходит вовремя|Первые недели проходят|После возвращения каждому приходится|О Периметре начинают говорить)/;
const injectedAnchorPattern = /^В локации «[^»]+» начинается событие «[^»]+»\.\n\n/;
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
function seedOf(value) {
  return [...String(value || '')].reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 5381);
}
function pick(items, scene, salt = 0) {
  const digest = crypto.createHash('sha256').update(`${scene.id}|${salt}`).digest();
  return items[digest.readUInt32BE(0) % items.length];
}
function focusLead(scene, salt = 0) {
  const focus = clean(scene.focus || 'Команда');
  if (/команда/i.test(focus)) return pick([
    'Несостыковку замечают почти одновременно.',
    'Первое объяснение рассыпается после короткой проверки.',
    'Разговор обрывается, когда детали перестают совпадать.',
    'Команда возвращается к фактам и находит противоречие.',
    'Один вопрос заставляет всех пересмотреть услышанное.',
    'Молчание затягивается: прежняя версия больше не сходится с фактами.'
  ], scene, salt);
  return pick([
    `${focus} замечает несостыковку раньше остальных.`,
    `${focus} задерживает взгляд на детали, которую остальные пропустили.`,
    `${focus} сверяет услышанное с фактами и находит расхождение.`,
    `${focus} не принимает первое объяснение и просит проверить детали.`,
    `${focus} реагирует раньше, чем остальные успевают договориться.`,
    `${focus} возвращает разговор к фактам.`
  ], scene, salt);
}
function placeDetail(scene) {
  const location = clean(scene.location).toLowerCase();
  if (/автобус/.test(location)) return 'За окнами дрожит серый свет, а шум дороги делает каждую паузу заметнее.';
  if (/архив/.test(location)) return 'Сухой шелест папок и гул вентиляции подчёркивают каждую паузу.';
  if (/кухн|столов/.test(location)) return 'Запах остывшей еды смешивается с сыростью; привычное место больше не кажется безопасным.';
  if (/лаборатор|px-17/.test(location)) return 'Холодный свет ложится на металл, а показания приборов расходятся с ожиданиями.';
  if (/подзем|тоннел|коридор|переход/.test(location)) return 'Гул вентиляции разносит шаги дальше, чем хотелось бы.';
  if (/двор|крыша|ворот|кпп/.test(location)) return 'Ветер перебирает кабели и открытые конструкции, не оставляя разговору укрытия.';
  if (/гараж|техническ|генератор/.test(location)) return 'Металл остывает медленно, а запах топлива мешает понять, что изменилось первым.';
  if (/мед|сан|душ|раздев|деконтам/.test(location)) return 'Влажный воздух и резкий свет делают присутствие других особенно ощутимым.';
  return 'Тишину нарушают только вентиляция и редкие шаги за стеной.';
}
function sceneMotif(scene) {
  const title = clean(scene.title).toLowerCase();
  if (/двер|шлюз|ворот|замок|проход/.test(title)) return 'Механизм отвечает с задержкой, и привычный путь перестаёт выглядеть надёжным.';
  if (/след|пятн|кров|отпечат|царап|метк/.test(title)) return 'На поверхности остаётся след, который трудно объяснить случайностью.';
  if (/звук|радио|голос|сигнал|шёпот|стук|звонок/.test(title)) return 'Короткий сигнал повторяется с одинаковым интервалом и обрывает разговор.';
  if (/запис|папк|документ|журнал|письм|карточ|фото|лист|схем|досье/.test(title)) return 'Записи и отметки расходятся по времени, хотя должны описывать один порядок событий.';
  if (/свет|ламп|тень|окно|зеркал|экран/.test(title)) return 'Свет выхватывает деталь, прежде скрытую в полумраке.';
  if (/генератор|кабел|рубильник|насос|двигател|вентиляц|щит/.test(title)) return 'Оборудование работает неровно, и паузы между циклами становятся слишком длинными.';
  if (/вода|душ|пар|труб|кран|слив/.test(title)) return 'Вода идёт с перебоями, оставляя после себя металлический запах.';
  if (/ключ|канистр|ящик|контейнер|сумк|пакет|фляг|термос/.test(title)) return 'Предмет лежит не там, где его ожидали увидеть, и выглядит недавно перемещённым.';
  if (/марин|ева|арт[её]м|глеб|зорин|сергей|человек|дежурн/.test(title)) return 'Чужая реакция меняет настроение группы раньше, чем звучит объяснение.';
  return placeDetail(scene);
}
function referencedDocumentTitles(scene) {
  const ids = new Set(scene.choices.flatMap(choice => choice.effects?.docs || []));
  return [...ids].map(id => documents[id]?.title).filter(Boolean);
}
function evidenceText(scene) {
  const docs = referencedDocumentTitles(scene);
  const verification = pick([
    'След проверяют по времени, показаниям и тому, что осталось на месте.',
    'Найденное сравнивают с журналом и маршрутными отметками.',
    'Важны мелочи: время, порядок действий и чужие показания.',
    'Любая версия теперь должна выдержать сверку с журналом и фактами.',
    'Детали фиксируют отдельно, чтобы позднее не спутать память с догадкой.',
    'Пока остальные спорят, наблюдение раскладывают на проверяемые факты.'
  ], scene, 7);
  const conclusion = docs.length
    ? pick([
      'Сверка указывает на связанный материал в архиве. Совпадение сохраняют для проверки, не меняя оригинал.',
      'В журнале находится дополнительная запись. Копию отмечают отдельно, а источник оставляют нетронутым.',
      'Архив подтверждает часть наблюдения. Этого недостаточно для вывода, но достаточно, чтобы отбросить одну из версий.'
    ], scene, 13)
    : pick([
      'Версии расходятся, поэтому наблюдение сохраняют без поспешного вывода.',
      'Проверка не даёт полного ответа, но отделяет факт от слухов.',
      'Совпадение фиксируют в журнале и оставляют открытым до следующей сверки.',
      'После проверки одна версия отпадает, а остальные требуют новых фактов.'
    ], scene, 13);
  return `${focusLead(scene)} ${sceneMotif(scene)} ${verification}\n\n${conclusion}`;
}
function eventText(scene) {
  const reaction = pick([
    'Несколько секунд уходят на сверку, после которой прежняя версия уже не выглядит убедительно.',
    'Спор быстро упирается в один вопрос: кто готов отвечать за следующий шаг.',
    'Прежний план ещё можно сохранить, но теперь его придётся подтвердить фактами.',
    'Никто не говорит вслух, что времени стало меньше, но все начинают двигаться быстрее.',
    'Порядок действий приходится пересобрать прямо на месте.',
    'Каждая новая деталь усиливает напряжение, хотя голоса становятся тише.'
  ], scene, 19);
  const followup = pick([
    'Группа сверяет маршрут и распределяет задачи, не скрывая сомнений.',
    'Ответа пока нет; остаётся проверить последовательность действий и не потерять друг друга.',
    'Короткий разговор возвращает внимание к людям, времени и безопасному пути назад.',
    'Разногласие остаётся, но теперь ясно, какие факты нужно проверить первыми.',
    'Пауза заканчивается, когда появляется конкретный порядок дальнейших действий.',
    'Все запоминают сказанное: позднее именно эта деталь может изменить общую версию.'
  ], scene, 31);
  return `${focusLead(scene, 3)} ${sceneMotif(scene)}\n\n${reaction} ${followup}`;
}
function endingText(scene) {
  const focus = clean(scene.focus || 'Команда');
  const title = clean(scene.title).toLowerCase();
  let opening;
  if (/показани|комисси/.test(title)) opening = `${focus} отвечает на вопросы комиссии, сверяя каждую фразу с уцелевшим журналом.`;
  else if (/публику|новост|сообщени|отправляет|документ|файл|письм/.test(title)) opening = 'Сохранённые материалы покидают закрытый архив и начинают жить собственной жизнью.';
  else if (/огонь|сгора|исчезает|теряет данные|пустоту/.test(title)) opening = 'Часть архива исчезает безвозвратно; остаются лишь копии, память и следы поспешной эвакуации.';
  else if (/двер|ворот|тоннел|выход|замок|контур/.test(title)) opening = 'Последний проход закрывается за спиной, отделяя выживших от того, что осталось внутри.';
  else if (/голос|раци|шёпот|молчит|тишин|экран/.test(title)) opening = 'В эфире остаётся короткий сигнал, который никто не решается считать случайным.';
  else if (/жертв|свидетел|выживш|помощ/.test(title)) opening = 'Список вернувшихся оказывается короче, чем надеялись спасатели.';
  else if (/система|фонд|редакц|ложь|правд|запечатан/.test(title)) opening = 'Официальная версия появляется быстро, но уцелевшие записи не дают ей стать единственной.';
  else if (/эпилог/.test(title)) opening = `${focus} возвращается к обычной жизни медленно, измеряя дни не календарём, а спокойным сном.`;
  else opening = pick([
    'За воротами жизнь не возвращается к прежнему ритму.',
    'Утро приходит вовремя, но привычный мир уже выглядит иначе.',
    'Первые недели проходят среди допросов, медицинских осмотров и тишины.',
    'После возвращения каждому приходится заново объяснять, что произошло.',
    'О Периметре начинают говорить шёпотом, даже когда опасность остаётся далеко.'
  ], scene, 41);
  const consequence = pick([
    'Отчёты расходятся, свидетели помнят одно и то же по-разному, а сделанный выбор остаётся в документах.',
    'Сохранённые записи меняют официальную версию, но не стирают личную память.',
    'Правда выходит наружу частями: в показаниях, закрытых письмах и долгих паузах.',
    'Некоторые сведения остаются под грифом, однако последствия уже невозможно скрыть.',
    'То, что удалось вынести, становится доказательством; остальное продолжает жить в памяти.'
  ], scene, 47);
  const personal = /команда/i.test(focus)
    ? 'Люди расходятся по разным дорогам, сохранив общую память о том, что пережили вместе.'
    : `${focus} учится жить с тем, что удалось сохранить и что пришлось оставить внутри.`;
  return `${opening} ${consequence}\n\n${personal}`;
}
function intimateText(scene) {
  const focus = clean(scene.focus || 'взрослые участники экспедиции').replace(/,\s*(\d+)\s*(лет|года?)/i, ' ($1 $2)');
  const title = clean(scene.title).toLowerCase();
  let setting;
  if (/душ|вода|промыв|реагент|пар/.test(title)) setting = 'Вода стихает, а пар ещё держится у стен, скрывая всё откровенное.';
  else if (/полотен/.test(title)) setting = 'Чистое полотенце и рассеянный свет оставляют видимыми только лица и руки.';
  else if (/халат/.test(title)) setting = 'Халат остаётся запахнутым, пока резкий свет отражается от влажной плитки.';
  else if (/рубаш|форма/.test(title)) setting = 'Чистую одежду передают за перегородку, не нарушая личного пространства.';
  else if (/плед|одеял|термопокрывал/.test(title)) setting = 'Плотная ткань укрывает тело, оставляя открытыми только лицо и ладони.';
  else if (/зеркал/.test(title)) setting = 'Треснувшее зеркало дробит отражение и не показывает ничего откровенного.';
  else if (/стекл|ширм/.test(title)) setting = 'Матовое стекло и ширма превращают тела в неясные силуэты.';
  else if (/двер/.test(title)) setting = 'Полоса света под дверью очерчивает силуэты, не открывая никаких деталей.';
  else if (/койк/.test(title)) setting = 'Койка остаётся укрыта одеялом, а свет почти не достигает дальнего угла.';
  else if (/тень|ламп|свет/.test(title)) setting = 'Мягкий свет оставляет тела в тени и удерживает всё личное за пределами взгляда.';
  else if (/койк|тишин|минут|сигнал|возвращен|ответ/.test(title)) setting = 'На несколько минут шум комплекса отступает, позволяя говорить тихо и без спешки.';
  else setting = 'Тишина становится безопасной, а свет скрывает всё, что должно остаться личным.';
  const opening = pick([
    `${focus} остаётся рядом, когда шум за дверью наконец стихает.`,
    `${focus} задерживается ещё на несколько минут, не пытаясь заполнить тишину словами.`,
    `${focus} снимает напряжение долгим выдохом и остаётся на безопасном расстоянии.`,
    `${focus} не торопит происходящее и первым делом спрашивает о границах.`
  ], scene, 53);
  const consent = pick([
    'Оба героя совершеннолетние и прямо подтверждают взаимное согласие. Любое сомнение сразу останавливает близость.',
    'Границы проговариваются вслух; молчание не считается разрешением, а отказ принимается без давления.',
    'Продолжение возможно только при ясном согласии совершеннолетних участников и прекращается по первому сомнению.',
    'Никто не торопит другого: совершеннолетние герои сохраняют право остановиться в любую секунду.'
  ], scene, 61);
  return `${setting} ${opening}\n\n${consent}`;
}

function choiceAction(label) {
  if (/точную запись/i.test(label)) return 'Вы заносите время и детали в журнал.';
  if (/сверить наблюдение/i.test(label)) return 'Группа по очереди сравнивает показания.';
  if (/отложить вывод/i.test(label)) return 'Вы оставляете вывод открытым и отмечаете, каких фактов не хватает.';
  if (/сопоставить факты/i.test(label)) return 'Маршрутный журнал даёт новую точку для проверки.';
  if (/проверенные детали/i.test(label)) return 'В запись попадают только подтверждённые детали.';
  if (/проверить факты/i.test(label)) return 'Вы останавливаете группу для короткой сверки.';
  if (/действовать сразу/i.test(label)) return 'Группа двигается до того, как путь успевает закрыться.';
  if (/удержать команду/i.test(label)) return 'Вы собираете людей вместе и распределяете задачи.';
  if (/промолчать/i.test(label)) return 'Вы не вмешиваетесь и внимательно следите за реакциями.';
  if (/протоколу безопасности/i.test(label)) return 'Группа возвращается к безопасному порядку действий.';
  return `Вы решаете ${clean(label).replace(/^./u, char => char.toLowerCase())}.`;
}
function effectTone(choice) {
  const vars = choice.effects?.vars || {};
  const trust = Object.entries(vars).filter(([key]) => key.startsWith('trust_')).reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const action = choiceAction(choice.text);
  if (trust < 0) return `${action} Напряжение возрастает, и недоверие повлияет на дальнейшие решения.`;
  if ((choice.effects?.docs || []).length) return `${action} Связанный материал добавляется в журнал без изменения оригинала.`;
  if (trust > 0) return `${action} Ясный порядок действий укрепляет доверие внутри группы.`;
  return `${action} Последствия этого шага сохраняются в журнале.`;
}
function repairChoices(scene) {
  if (scene.kind === 'ending' || scene.kind === 'intimate') return;
  const evidence = scene.kind === 'evidence';
  const evidenceLabels = [
    'Сделать точную запись в журнале',
    'Сверить наблюдение со всей группой',
    'Отложить вывод до следующей проверки',
    'Сопоставить факты с маршрутным журналом',
    'Оставить только проверенные детали'
  ];
  const eventLabels = [
    'Проверить факты перед следующим шагом',
    'Действовать сразу, пока путь открыт',
    'Удержать команду вместе',
    'Промолчать и наблюдать',
    'Вернуться к протоколу безопасности'
  ];
  const labels = evidence ? evidenceLabels : eventLabels;
  const offset = seedOf(scene.id) % labels.length;
  scene.choices.forEach((choice, index) => {
    choice.text = labels[(index + offset) % labels.length] || 'Продолжить осторожно';
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
  const fullMatch = scene.id.match(/^INT_FULL_(\d{3})$/);
  const arcExit = fullMatch ? [
    [1, 6, 'SCENE_106'],
    [7, 12, 'SCENE_115'],
    [13, 18, 'SCENE_286'],
    [19, 24, 'SCENE_376'],
    [25, 30, 'SCENE_456'],
    [31, 36, 'SCENE_526']
  ].find(([from, to]) => Number(fullMatch[1]) >= from && Number(fullMatch[1]) <= to)?.[2] : null;
  scene.choices.forEach((choice, index) => {
    choice.text = labels[index] || `Сохранить границы — вариант ${index + 1}`;
    const flags = choice.effects?.flags || {};
    const flagNames = Object.keys(flags).join(' ');
    if (/kissed_/.test(flagNames)) choice.outcome = 'После прямого подтверждения согласия герои обмениваются коротким поцелуем и сразу возвращаются к разговору о границах.';
    else if (/embraced_/.test(flagNames)) choice.outcome = 'Объятие остаётся коротким и взаимным; любой шаг назад принимается без вопросов.';
    else if (/wore_player_shirt/.test(flagNames)) choice.outcome = 'Марина принимает запасную рубашку и переодевается за ширмой, сохраняя личное пространство.';
    else if (/rejected_old_uniform/.test(flagNames)) choice.outcome = 'Ева откладывает старую форму и выбирает чистую одежду, не позволяя торопить себя.';
    else if (/silenced_px17_scanner/.test(flagNames)) choice.outcome = 'Сканер выключают, чтобы оставить момент личным и не нарушать согласованные границы.';
    else if (/future_promise/.test(flagNames)) choice.outcome = 'Артём обещает вернуться к этому разговору после выхода, не требуя ответа сейчас.';
    else choice.outcome = outcomes[index] || outcomes[1];
    if (index === 1 && arcExit) choice.next = arcExit;
  });
}

function normalizeCommonOutcomes(scene) {
  for (const choice of scene.choices) {
    const label = clean(choice.text);
    const outcome = clean(choice.outcome);
    if (/сфотограф|сделать снимок|снять .*на фото/i.test(label)) {
      choice.outcome = 'Вы фотографируете находку и сохраняете проверяемую копию, не меняя оригинал.';
    } else if (/дать ей время/i.test(label)) {
      choice.outcome = 'Вы не торопите её. В ответ она спокойнее формулирует решение и сохраняет право отказаться.';
    } else if (/удержать группу вместе/i.test(label)) {
      choice.outcome = 'Вы собираете всю группу и не позволяете страху разделить людей.';
    } else if (/Коридор реагирует|коридор отвечает|Локация «/i.test(outcome)) {
      choice.outcome = 'Риск меняет обстановку; команда фиксирует последствия и перестраивает план.';
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

const repairedTitles = {
  SCENE_060: 'Сбой на 03:07',
  SCENE_116: 'Лист из папки Евы',
  SCENE_045: 'Метка Марины',
  SCENE_254: 'Выбор сектора',
  SCENE_273: 'Срыв под давлением',
  SCENE_259: 'Пропавшие семь минут',
  SCENE_298: 'Правда или люди',
  SCENE_314: 'Ваш голос в технической рации',
  SCENE_320: 'Ваш голос в рации',
  SCENE_343: 'Кому довериться',
  SCENE_344: 'Выживший начинает говорить',
  SCENE_345: 'Имя в старом списке',
  SCENE_346: 'Противоречие в показаниях',
  SCENE_347: 'Последнее предупреждение',
  SCENE_355: 'Сон на холодном столе',
  SCENE_365: 'Голос из коридора',
  SCENE_373: 'Маршрут через темноту',
  SCENE_415: 'Что спасать первым',
  SCENE_437: 'Кто пойдёт рядом',
  SCENE_439: 'Глеб отдаёт ключ',
  SCENE_440: 'Марина передаёт рацию',
  SCENE_441: 'Ева открывает журнал',
  SCENE_442: 'Артём перестаёт шутить',
  SCENE_453: 'Собственный страх',
  SCENE_468: 'Подпись на полях',
  SCENE_491: 'Что вынести из архива',
  SCENE_518: 'Свой голос в динамике',
  SCENE_550: 'Последнее слово',
  SCENE_554: 'Кто пойдёт с вами',
  SCENE_565: 'Собственная вина',
  SCENE_569: 'Если идти одному',
  SCENE_564: 'Повторяющиеся фамилии',
  SCENE_600: 'Свидетельствам не верят',
  SCENE_606: 'Вердикт системы',
  SCENE_609: 'Цена вашего решения',
  SCENE_626: 'Ваш голос после возвращения',
  INT_FULL_024: 'Полоса света под дверью'
};

const authoredRepairs = {
  SCENE_115: 'Артём долго вертит в руках телефон, прежде чем рассказать о Сергее. За неделю до выезда тот прислал фотографию двери без номера и попросил никому её не показывать.\n\nСообщение оборвалось на половине фразы. Теперь Артём признаётся, что согласился на экспедицию именно поэтому, хотя в анкете указал другую причину.',
  SCENE_117: 'Ева вспоминает предупреждение Фёдора у шлагбаума: если знакомый голос звучит из пустого помещения, сначала нужно увидеть говорящего и только потом отвечать.\n\nАртём записывает правило на обороте маршрутного листа. Никто не смеётся — после рации оно больше не кажется суеверием.',
  SCENE_208: 'На обороте дежурного листа Глеб находит столбец фамилий. Рядом с каждой стоит время, а несколько имён обведены красным карандашом.\n\nВ списке есть люди, которых группа видела утром, и те, кого уже много лет считают погибшими. Порядок записей не совпадает с журналом проходной.',
  SCENE_280: 'Ева узнаёт подпись на полях лабораторного отчёта. Буквы принадлежат ей, но дата поставлена за два года до её первого контракта с фондом.\n\nОна сравнивает нажим, сокращения и медицинские пометки. Подделка слишком точна, чтобы списать её на чужую руку.',
  SCENE_301: 'Директорский сейф открыт, хотя кодовая панель не повреждена. Внутри лежат пустые конверты, резервный пропуск и папка с вырванными первыми страницами.\n\nЕва находит на внутренней стенке свежую пыль от бумаги. Документы забрали недавно и закрывать дверцу уже не стали.',
  SCENE_259: 'На настенных часах проходит семь минут, которых нет ни в одном журнале. Артём проверяет диктофон: запись обрывается на середине фразы и продолжается уже после того, как группа сменила позицию.\n\nНикто не помнит перехода между этими моментами. В журнал вносят разрыв времени и имена всех, кто находился в холле.',
  SCENE_344: 'У стены сидит человек в чужой рабочей куртке. Ева даёт ему воду и просит не торопиться. Он называет номер смены, но не может вспомнить, сколько дней провёл внутри.\n\nНа вопрос о других людях выживший отвечает не сразу: ночью он слышал шаги и голос, который звал каждого по имени.',
  SCENE_345: 'Артём кладёт перед выжившим старый список дежурных. Тот проводит пальцем по фамилиям и останавливается на имени, вычеркнутом три года назад.\n\nОн уверяет, что разговаривал с этим человеком утром. Время в его рассказе не совпадает ни с часами, ни с журналом проходной.',
  SCENE_346: 'Группа восстанавливает путь выжившего по следам на мокром полу. Он говорит, что пришёл один, однако у входа видны две разные пары отпечатков.\n\nЕва замечает свежую повязку на его руке. Глеб просит повторить рассказ ещё раз, не подсказывая ни места, ни времени.',
  SCENE_347: 'Марина спрашивает, что находится за следующей дверью. Выживший смотрит на рацию и просит выключить её прежде, чем ответить.\n\nОн предупреждает: если из темноты прозвучит знакомый голос, нельзя отвечать сразу. Сначала нужно увидеть человека и убедиться, что его губы действительно двигаются.',
  SCENE_439: 'Глеб достаёт запасной ключ и кладёт его на открытую ладонь. Он признаётся, что уже проходил этим маршрутом и потому слишком часто отвечал раньше, чем звучал вопрос.\n\nКлюч остаётся между вами. Теперь доверие зависит не от его обещаний, а от того, кто понесёт ответственность за следующий проход.',
  SCENE_440: 'Марина снимает рацию с ремня и передаёт её вам. Впервые она прямо говорит, что боится услышать собственный голос из пустого коридора.\n\nОна не просит защиты. Ей нужно знать, что при следующем сигнале кто-то останется рядом и проверит источник вместе с ней.',
  SCENE_441: 'Ева открывает медицинский журнал на страницах, которые прежде держала закрытыми. Несколько подписей принадлежат людям, официально никогда не работавшим в комплексе.\n\nОна разрешает сделать копию, но просит оставить оригинал у неё. Это не оправдание — только факт, который она больше не скрывает.',
  SCENE_442: 'Артём больше не шутит. Он показывает последнее фото Сергея и признаётся, что знал о закрытом маршруте ещё до выезда.\n\nНа снимке видна дверь без номера и часть предупреждающей полосы. Артём готов рассказать остальное, если его не перебьют обвинением.',
  SCENE_505: 'В лабораторном стекле рядом с Артёмом появляется отражение женщины, которой нет в комнате. Он называет её Ниной раньше, чем успевает понять, что сказал имя вслух.\n\nОтражение не повторяет движений. Нина поднимает руку и указывает на закрытый аварийный выход, а затем исчезает вместе со вспышкой света.',
  SCENE_509: 'Артём просит остановиться и наконец рассказывает о Сергее без шуток. Они вместе нашли старый маршрут к лаборатории, но Сергей пошёл проверять его один и больше не вернулся.\n\nАртём хочет знать, была ли фотография предупреждением или приглашением. Ответ может быть в метках на двери и в последнем сообщении Сергея.',
  SCENE_556: 'На столе лежат четыре копии одного отчёта, и в каждой вымарано другое имя. Кто-то передавал фонду сведения о маршруте группы ещё до выезда.\n\nПодозрение падает сразу на нескольких людей. Обвинение может расколоть команду, но молчание оставит предателю возможность сделать следующий шаг.',
  SCENE_603: 'Через месяц Глеб получает письмо, написанное его почерком. Внутри нет обратного адреса — только схема закрытого маршрута и просьба не возвращаться одному.\n\nПоследняя строка появилась поверх старого сгиба: «Ты уже читал это письмо и всё равно пришёл». Глеб прячет лист, но не уничтожает его.'
};

const authoredChoices = {
  SCENE_115: ['Спросить, когда Артём видел Сергея', 'Попросить Еву проверить детали', 'Дать Артёму договорить'],
  SCENE_117: ['Записать правило дословно', 'Напомнить правило всей группе', 'Не обсуждать его вслух'],
  SCENE_208: ['Сверить имена с журналом', 'Показать список группе', 'Сохранить копию отдельно'],
  SCENE_280: ['Скопировать страницу с подписью', 'Спросить Еву прямо', 'Не показывать подпись группе'],
  SCENE_301: ['Скопировать содержимое сейфа', 'Показать папку группе', 'Закрыть сейф и сохранить код'],
  SCENE_344: ['Попросить назвать имя из списка', 'Спросить, как он попал внутрь', 'Дать Еве проверить его состояние'],
  SCENE_345: ['Сверить фамилию с журналом', 'Показать старую фотографию', 'Спросить о последней смене'],
  SCENE_346: ['Проверить следы у входа', 'Сравнить рассказ с журналом', 'Попросить группу не перебивать', 'Отметить противоречие и идти дальше'],
  SCENE_347: ['Спросить, чего он боится', 'Записать предупреждение дословно', 'Оставить ему рацию'],
  SCENE_439: ['Принять ключ Глеба', 'Попросить рассказать всё', 'Оставить ключ ему'],
  SCENE_440: ['Взять рацию Марины', 'Спросить, чего она боится', 'Предложить идти вместе', 'Дать ей вести группу'],
  SCENE_441: ['Прочитать журнал вместе', 'Оставить записи Еве', 'Сверить записи с фактами'],
  SCENE_442: ['Посмотреть фотографию Артёма', 'Не давить на него', 'Спросить о Сергее'],
  SCENE_505: ['Спросить Артёма, кто такая Нина', 'Подойти к отражению вместе', 'Проверить аварийный выход'],
  SCENE_509: ['Попросить Артёма рассказать о Сергее', 'Спросить, что он скрывал', 'Проверить последнее фото'],
  SCENE_556: ['Сверить факты до обвинения', 'Назвать самого опасного человека', 'Защитить того, кому доверяете', 'Не называть никого']
};

let rewritten = 0;
let intimateRewritten = 0;
let imagesRemoved = 0;
let anchorsRemoved = 0;
for (const scene of allScenes) {
  normalizeFocusFromTitle(scene);
  if (repairedTitles[scene.id]) {
    scene.title = repairedTitles[scene.id];
    normalizeFocusFromTitle(scene);
  }
  for (const variant of scene.variants || []) variant.text = String(variant.text || '').replace(/^Игрок просыпается/u, 'Вы просыпаетесь');
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
  if (injectedAnchorPattern.test(scene.text)) {
    scene.text = scene.text.replace(injectedAnchorPattern, '');
    anchorsRemoved += 1;
  }
  const currentGenerated = currentGeneratedPattern.test(scene.text);
  const generatedEvidence = scene.kind === 'evidence' && (generatedEvidencePattern.test(scene.text) || currentGenerated);
  const generatedEvent = scene.kind !== 'evidence' && scene.kind !== 'ending' && (generatedEventPattern.test(scene.text) || currentGenerated);
  const generatedEnding = scene.kind === 'ending' && (generatedEndingPattern.test(scene.text) || currentGenerated);
  if (generatedEvidence || generatedEvent || generatedEnding) {
    scene.text = generatedEvidence ? evidenceText(scene) : generatedEnding ? endingText(scene) : eventText(scene);
    repairChoices(scene);
    rewritten += 1;
  }
  normalizeCommonOutcomes(scene);
}

for (const [id, text] of Object.entries(authoredRepairs)) {
  const scene = sceneMap.get(id);
  if (!scene) continue;
  scene.text = text;
  const labels = authoredChoices[id];
  if (labels) scene.choices.forEach((choice, index) => {
    if (labels[index]) choice.text = labels[index];
    choice.outcome = effectTone(choice);
  });
}
const hallTrial = sceneMap.get('SCENE_246');
if (hallTrial) {
  hallTrial.title = 'Столовая после обвала';
  hallTrial.location = 'Столовая';
}
const sergeyStory = sceneMap.get('SCENE_115');
if (sergeyStory) sergeyStory.focus = 'Артём';
const fyodorRule = sceneMap.get('SCENE_117');
if (fyodorRule) fyodorRule.focus = 'Фёдор';
const directorSafe = sceneMap.get('SCENE_301');
if (directorSafe) directorSafe.location = 'Административные кабинеты';
const missingMorning = sceneMap.get('SCENE_201');
if (missingMorning) {
  const inspect = missingMorning.choices.find(choice => choice.id === 'inspect_table');
  if (inspect) inspect.outcome = 'Вы раскладываете найденные вещи по порядку и отмечаете, кому они могли принадлежать.';
}
const speakingRadio = sceneMap.get('SCENE_320');
if (speakingRadio) {
  const record = speakingRadio.choices.find(choice => choice.id === 'record_voice');
  if (record) record.outcome = 'Вы сохраняете запись сигнала с точной отметкой времени; копия остаётся в журнале.';
}
const brokenSpeech = sceneMap.get('EXTRA_A1_01');
if (brokenSpeech) {
  const confront = brokenSpeech.choices.find(choice => choice.id === 'extra_a1_01_1');
  if (confront) confront.outcome = 'Вы говорите: «Хватит этой херни, Глеб. Говори сейчас». Он выдерживает ваш взгляд, но отвечает не на тот вопрос, который вы задали.';
}

// A reader should never encounter two scenes with completely identical prose.
// When deterministic variations still collide, keep the first text intact and
// add a short, story-native observation to the later entries.
let duplicateTextsResolved = 0;
const scenesByText = new Map();
for (const scene of allScenes) {
  const text = scene.text.trim();
  if (!scenesByText.has(text)) scenesByText.set(text, []);
  scenesByText.get(text).push(scene);
}
for (const group of scenesByText.values()) {
  if (group.length < 2) continue;
  for (let index = 1; index < group.length; index += 1) {
    const scene = group[index];
    const additions = scene.kind === 'intimate' ? [
      'Разговор заканчивается без спешки и давления.',
      'Пауза остаётся общей, а границы — ясными.'
    ] : scene.kind === 'ending' ? [
      'В окончательном отчёте остаётся лишь то, что удалось подтвердить.',
      'Остальное каждый из свидетелей хранит по-своему.'
    ] : [
      'Наблюдение отмечают отдельно от предположений.',
      'Пока никто не берётся назвать случившееся случайностью.'
    ];
    scene.text = `${scene.text}\n\n${additions[(index - 1) % additions.length]}`;
    duplicateTextsResolved += 1;
  }
}

// One shared ending card explicitly names both mutually exclusive outcomes.
// It is therefore accurate for the opening scene of either branch.
const mercifulLie = sceneMap.get('SCENE_586');
if (mercifulLie) mercifulLie.image = 'assets/images/ending_lie.webp';
const redacted = sceneMap.get('SCENE_591');
if (redacted) {
  redacted.title = 'Концовка: Красная редакция';
  redacted.image = 'assets/images/ending_lie.webp';
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
let absolute = 6 * 60 + 42;
for (let index = 0; index < order.length; index += 1) {
  const scene = sceneMap.get(order[index]);
  if (scene.act === 2 && absolute < 24 * 60 + 6 * 60 + 30) absolute = 24 * 60 + 6 * 60 + 30;
  if (scene.act === 3 && absolute < 2 * 24 * 60 + 6 * 60 + 30) absolute = 2 * 24 * 60 + 6 * 60 + 30;
  const day = Math.floor(absolute / (24 * 60)) + 1;
  const minuteOfDay = absolute % (24 * 60);
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  scene.time = `День ${day}, ${hours}:${minutes}`;
  absolute += 6;
}

for (const file of files) fs.writeFileSync(path.join(root, file), `${JSON.stringify(payloads.get(file), null, 2)}\n`);
console.log(JSON.stringify({scenes: allScenes.length, rewritten, intimate_rewritten: intimateRewritten, anchors_removed: anchorsRemoved, duplicate_texts_resolved: duplicateTextsResolved, images_removed: imagesRemoved, key_frames_kept: keyFrames.size, chronology: order.length}, null, 2));
